import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input, Select, Button, InputDatePicker, MaskedInput, useSnackbarContext } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { ShieldAlert, CheckCircle, XCircle, Keyboard, Search, Loader2, Trash2, AlertTriangle, CreditCard, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { translateApiError } from '../../../lib/apiErrors';
import { invalidateMediaUrl } from '../../../lib/upload';
import { beMediaUploadFromImage } from '../../../lib/beMedia';
import { toLocalDateStr, parseLocalDate, makeDatePickerFormat, getAge, ADULT_AGE } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import { PanelSection } from './PanelSection';
import { AddressFormPostal } from './AddressFormPostal';
import { IdPhotoUpload } from './IdPhotoUpload';
import { IdCardScanner, type DetectedIdCardFields } from '../../../components/IdCardScanner';
import { passesThaiCidChecksum } from '../../../lib/ocr/extractIdCard';
import type { CustomerRegisterResult, CustomerAddress } from './WorkspaceTypes';
import { useCustomerMatch, type MatchedCustomer } from './useCustomerMatch';
import { CustomerMatchResults } from './CustomerMatchResults';

const KNOWN_TH_PREFIXES = new Set(['นาย', 'นาง', 'นางสาว']);

interface CustomerDocument {
  id: number;
  file_url: string;
}

const ID_TYPE_VALUES = ['CITIZEN_ID', 'PASSPORT'] as const;
const PREFIX_OPTIONS = [
  { value: '', label: '-' },
  { value: 'นาย', label: 'นาย' }, { value: 'นาง', label: 'นาง' }, { value: 'นางสาว', label: 'นางสาว' },
  { value: 'Mr.', label: 'Mr.' }, { value: 'Mrs.', label: 'Mrs.' }, { value: 'Ms.', label: 'Ms.' },
];

interface SearchResult {
  id: number; id_type: string; id_number: string; prefix: string | null;
  first_name: string; last_name: string; full_name: string;
  tel: string | null; date_of_birth: string | null;
}

interface Props { onClose: () => void }

export function PanelCoLessee({ onClose: _onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { data: workspace, coLesseeList, invalidateCoLessees, setPanelDirty } = useWorkspace();
  const queryClient = useQueryClient();

  // Map server coLesseeList to the shape used by the panel
  const coLessees = coLesseeList.map(g => ({ customerId: g.customer_id, fullName: g.customer_name, idNumber: g.id_number ?? '' }));

  // ── Existing co-lessees list ────────────────────────────────────────────
  const [removing, setRemoving] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [expandedCoLessee, setExpandedCoLessee] = useState<number | null>(
    coLessees.length === 1 ? coLessees[0].customerId : null
  );
  const [showAddForm, setShowAddForm] = useState(coLessees.length === 0);

  const handleRemove = async (customerId: number) => {
    if (!workspace.contractId) return;
    setRemoving(customerId);
    setRemoveError('');
    try {
      await apiClient.rpc('fn_contract_remove_co_lessee', {
        p_contract_id: workspace.contractId,
        p_customer_id: customerId,
      });
      invalidateCoLessees();
      if (expandedCoLessee === customerId) setExpandedCoLessee(null);
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = translateApiError(err, t);
        setRemoveError(tr || err.code || err.message);
      } else setRemoveError(String(err));
    } finally {
      setRemoving(null);
    }
  };

  // ── Add new co-lessee form ──────────────────────────────────────────────
  const [idType, setIdType] = useState<'CITIZEN_ID' | 'PASSPORT'>('CITIZEN_ID');
  const [idNumber, setIdNumber] = useState('');
  const [prefix, setPrefix] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [tel, setTel] = useState('');

  const [isTypingDob, setIsTypingDob] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<SearchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');
  const [result, setResult] = useState<CustomerRegisterResult | null>(null);
  const { result: matchResult, matching: searching, runMatch, reset: resetMatch, blocked: idNameMismatch } = useCustomerMatch();
  const [hasSearched, setHasSearched] = useState(false);

  // Pending scanned ID card image — uploaded to backend once we have a customer_id.
  const pendingScanRef = useRef<UploadedImage | null>(null);

  // Track dirty state for nav guard
  useEffect(() => {
    setPanelDirty(!!(idNumber || firstName || lastName || tel || dateOfBirth || prefix));
  }, [idNumber, firstName, lastName, tel, dateOfBirth, prefix, setPanelDirty]);
  useEffect(() => () => setPanelDirty(false), [setPanelDirty]);

  // Editing ID/name after a check invalidates the verdict — clear it so a stale
  // ID_MATCH_NAME_MISMATCH can't keep the button blocked after a fix.
  useEffect(() => {
    if (hasSearched && !selectedCustomer) { resetMatch(); setHasSearched(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idNumber, firstName, lastName]);

  const resetForm = () => {
    setIdType('CITIZEN_ID'); setIdNumber(''); setPrefix(''); setFirstName('');
    setLastName(''); setDateOfBirth(''); setTel('');
    setSelectedCustomer(null); setResult(null); setApiError('');
    resetMatch(); setHasSearched(false);
    pendingScanRef.current = null;
  };

  // Persist the OCR-scanned ID card as the co-lessee's ID_CARD_FRONT document.
  const persistScannedIdCard = async (custId: number, image: UploadedImage) => {
    try {
      const results = await beMediaUploadFromImage({
        type: 'customer_id_card',
        image,
        params: { customer_id: custId },
      });
      const key = results.lg?.key ?? Object.values(results)[0]?.key;
      if (!key) throw new Error('be-media returned no key');
      await apiClient.rpc('fn_customer_document_upload', {
        p_customer_id: custId,
        p_doc_type: 'ID_CARD_FRONT',
        p_file_url: `/${key}`,
      });
      invalidateMediaUrl(key);
      queryClient.invalidateQueries({ queryKey: ['co-lessee-idcard', custId] });
      queryClient.invalidateQueries({ queryKey: ['co-lessee-status'] });
      queryClient.invalidateQueries({ queryKey: ['co-lessee-all-complete'] });
    } catch (err) {
      // Co-lessee is saved; only the ID photo failed. Surface the real reason
      // (never swallow — this hid a cross-holding DB collision in the field).
      console.error('[co-lessee id-card] persist failed', err);
      setApiError(err instanceof ApiError ? translateApiError(err, t) : (err instanceof Error ? err.message : String(err)));
    }
  };

  // Apply OCR-detected fields. Each scan overwrites the previous values so
  // re-scanning works; skipped for an existing customer to protect their data.
  const handleOcrDetected = (f: DetectedIdCardFields) => {
    if (selectedCustomer) return;
    if (f.cid) {
      setIdType('CITIZEN_ID');
      setIdNumber(f.cid);
    }
    if (f.prefix && KNOWN_TH_PREFIXES.has(f.prefix)) setPrefix(f.prefix);
    if (f.firstName) setFirstName(f.firstName);
    if (f.lastName) setLastName(f.lastName);
    if (f.dob) setDateOfBirth(f.dob);
  };

  const handleOcrPersist = (img: UploadedImage) => {
    pendingScanRef.current = img;
  };

  // Dedupe check via fn_customer_match (unmasked CID + verdict). The old
  // id_number.ilike on v_customers always returned 0 rows (masked CID).
  const handleSearch = async () => {
    setHasSearched(true);
    setSelectedCustomer(null);
    await runMatch({ idNumber, firstName, lastName });
  };

  // fn_customer_match omits date_of_birth — fetch it by id to complete the form.
  const handleSelectCustomer = async (m: MatchedCustomer) => {
    let dob: string | null = null;
    try {
      const rows = await apiClient.get<{ date_of_birth: string | null }[]>(
        `/v_customers?id=eq.${m.id}&select=date_of_birth&limit=1`,
      );
      dob = rows[0]?.date_of_birth ?? null;
    } catch { /* DOB optional */ }

    setSelectedCustomer({
      id: m.id, id_type: m.id_type, id_number: m.id_number,
      prefix: m.prefix, first_name: m.first_name, last_name: m.last_name,
      full_name: m.full_name, tel: m.tel, date_of_birth: dob,
    });
    setIdType(m.id_type);
    setIdNumber(m.id_number);
    setPrefix(m.prefix ?? '');
    setFirstName(m.first_name);
    setLastName(m.last_name);
    setDateOfBirth(dob ?? '');
    setTel(m.tel ?? '');
    setApiError(''); setResult(null);
  };

  const attachCoLessee = async (custId: number) => {
    if (!workspace.contractId) return;
    if (custId === workspace.customerId) {
      setApiError(t('workspace.coLesseeCannotBeSelf'));
      return;
    }
    if (coLessees.some(g => g.customerId === custId)) {
      setApiError(t('workspace.coLesseeAlreadyAttached'));
      return;
    }
    try {
      await apiClient.rpc('fn_contract_add_co_lessee', {
        p_contract_id: workspace.contractId,
        p_customer_id: custId,
        p_relation: null,
      });
      // Persist any scanned ID card image before we reset form state.
      if (pendingScanRef.current) {
        const img = pendingScanRef.current;
        pendingScanRef.current = null;
        void persistScannedIdCard(custId, img);
      }
      invalidateCoLessees();
      resetForm();
      setShowAddForm(false);
      setExpandedCoLessee(custId);
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = translateApiError(err, t);
        setApiError(tr || err.code || err.message);
      }
    }
  };

  const handleUseOrRegister = async () => {
    setApiError('');
    // Never register/overwrite when the CID belongs to a different-named customer.
    if (idNameMismatch) return;
    if (selectedCustomer) {
      await attachCoLessee(selectedCustomer.id);
      return;
    }
    if (idType === 'CITIZEN_ID' && idNumber.replace(/\D/g, '').length !== 13) {
      setApiError(t('workspace.citizenIdLength')); return;
    }
    if (!idNumber.trim() || !firstName.trim() || !lastName.trim() || !tel.trim() || !dateOfBirth) return;
    setSubmitting(true);
    try {
      const res = await apiClient.rpc<CustomerRegisterResult>('fn_customer_register_or_update', {
        p_id_type: idType, p_id_number: idNumber.trim(), p_prefix: prefix || null,
        p_first_name: firstName.trim(), p_last_name: lastName.trim(),
        p_date_of_birth: dateOfBirth || null, p_tel: tel.trim(),
      });
      if (res.action === 'BLOCK') {
        setResult(res);
        return;
      }
      setResult(res);
      await attachCoLessee(res.customer_id);
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = translateApiError(err, t);
        setApiError(tr || err.code || err.message);
      } else setApiError(String(err));
    } finally { setSubmitting(false); }
  };

  const canSearch = !!(idNumber.trim() || firstName.trim() || lastName.trim());
  const isExisting = !!selectedCustomer;
  const buttonLabel = isExisting ? t('workspace.useThisCustomer') : t('wizard.registerCustomer');
  const hasCoLessees = coLessees.length > 0;

  return (
    <div className="p-4 flex flex-col max-w-2xl">
      <PanelSection title={t('workspace.cardCoLessee')} count={coLessees.length}
        alert={
          removeError ? <div className="alert alert-danger"><XCircle size={14} /><span>{removeError}</span></div>
          : (workspace.customerId && coLessees.length === 0 && workspace.customerDateOfBirth
              && getAge(workspace.customerDateOfBirth) < ADULT_AGE)
            ? <div className="alert alert-warning"><AlertTriangle size={14} /><span>{t('workspace.coLesseeRequired')}</span></div>
          : undefined
        }
      >
        {/* Existing co-lessees — accordion */}
        {hasCoLessees && (
          <div className="flex flex-col gap-2 mb-4">
            {coLessees.map(g => (
              <CoLesseeRow
                key={g.customerId}
                coLessee={g}
                contractId={workspace.contractId}
                expanded={expandedCoLessee === g.customerId}
                onToggle={() => setExpandedCoLessee(expandedCoLessee === g.customerId ? null : g.customerId)}
                onRemove={() => handleRemove(g.customerId)}
                removing={removing === g.customerId}
              />
            ))}
          </div>
        )}

        {/* Add form — inline when no co-lessees, expandable toggle when 1+ */}
        {hasCoLessees && !showAddForm && (
          <Button onClick={() => setShowAddForm(true)} startIcon={<Plus size={14} />} className="w-full">
            {t('workspace.addCoLessee')}
          </Button>
        )}

        {(showAddForm || !hasCoLessees) && (
          <div className={hasCoLessees ? 'border border-line rounded-lg p-3' : 'p-3 rounded-md border border-dashed border-line'}>
            {hasCoLessees && (
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">{t('workspace.addCoLessee')}</span>
                <button className="text-subtle hover:text-fg cursor-pointer bg-transparent border-none p-1" onClick={() => { setShowAddForm(false); resetForm(); }}>
                  <XCircle size={16} />
                </button>
              </div>
            )}

            {apiError && <div className="alert alert-danger mb-3"><XCircle size={18} /><div><div className="alert-description">{apiError}</div></div></div>}
            {result?.action === 'BLOCK' && (
              <div className="alert alert-danger mb-3"><ShieldAlert size={18} /><div><div className="alert-title">{t('wizard.blacklisted')}</div></div></div>
            )}

            <div className="mb-3">
              <IdCardScanner
                onDetected={handleOcrDetected}
                onPersist={handleOcrPersist}
                disabled={submitting}
                currentFields={{
                  cid: idNumber,
                  prefix,
                  firstName,
                  lastName,
                  dob: dateOfBirth,
                }}
                onCopyCid
                onCopyField={(field, value) => {
                  if (field === 'cid') {
                    setIdType('CITIZEN_ID');
                    setIdNumber(value);
                  } else if (field === 'prefix') {
                    if (KNOWN_TH_PREFIXES.has(value)) setPrefix(value);
                  } else if (field === 'firstName') {
                    setFirstName(value);
                  } else if (field === 'lastName') {
                    setLastName(value);
                  } else if (field === 'dob') {
                    setDateOfBirth(value);
                  }
                }}
              />
            </div>

            <div className="form-grid">
              <div className="flex gap-3">
                <div className="flex flex-col" style={{ width: '10rem' }}>
                  <label className="form-label">{t('wizard.idType')}</label>
                  <Select options={ID_TYPE_VALUES.map(v => ({ value: v, label: t(`contract.idType_${v}`) }))} value={idType} onChange={(val) => setIdType((val as string) as 'CITIZEN_ID' | 'PASSPORT')} size="sm" disabled={!!selectedCustomer} />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <label className="form-label">{t('wizard.idNumber')}</label>
                  {idType === 'CITIZEN_ID' ? (
                    <MaskedInput mask="#-####-#####-##-#" placeholder="" value={idNumber} onChange={(raw) => setIdNumber(raw)} size="sm" className="w-full" disabled={!!selectedCustomer} endIcon={<CidChecksumIcon digits={idNumber} />} />
                  ) : (
                    <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} size="sm" className="w-full" disabled={!!selectedCustomer} />
                  )}
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex flex-col" style={{ width: '7rem' }}>
                  <label className="form-label">{t('wizard.prefix')}</label>
                  <Select options={PREFIX_OPTIONS} value={prefix} onChange={(val) => setPrefix(val as string)} size="sm" clearable />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <label className="form-label">{t('wizard.firstName')}</label>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} size="sm" className="w-full" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <label className="form-label">{t('wizard.lastName')}</label>
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} size="sm" className="w-full" />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex flex-col flex-1 min-w-0">
                  <label className="form-label">{t('wizard.dateOfBirth')} *</label>
                  <InputDatePicker
                    value={parseLocalDate(dateOfBirth)}
                    onChange={(date) => setDateOfBirth(toLocalDateStr(date))}
                    size="sm"
                    endIcon={<Keyboard size={16} />}
                    onEndIconClick={() => setIsTypingDob(v => !v)}
                    calendar="gregorian"
                    locale={i18n.language}
                    dateFormat={makeDatePickerFormat(i18n.language)}
                    typingMode={isTypingDob}
                    onTypingModeChange={setIsTypingDob}
                    typingMask="##/##/####"
                    typingPlaceholder="DD/MM/YYYY"
                    parseTypedDate={(raw) => {
                      if (raw.length !== 8) return null;
                      const day = parseInt(raw.slice(0, 2), 10);
                      const month = parseInt(raw.slice(2, 4), 10);
                      let year = parseInt(raw.slice(4, 8), 10);
                      if (year > 2400) year -= 543;
                      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                      const d = new Date(year, month - 1, day);
                      if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                      return d;
                    }}
                  />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <label className="form-label">{t('wizard.tel')}</label>
                  <MaskedInput dynamicMask={thaiPhoneMask} value={tel} onChange={(raw) => setTel(raw)} size="sm" className="w-full" />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleSearch} disabled={searching || !canSearch} startIcon={searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}>
                {t('workspace.checkCustomer')}
              </Button>
              <Button color={isExisting ? 'primary' : undefined} variant={isExisting ? undefined : 'outline'} onClick={handleUseOrRegister} disabled={submitting || idNameMismatch || !idNumber.trim() || !firstName.trim() || !lastName.trim() || !tel.trim() || !dateOfBirth} startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : undefined}>
                {submitting ? t('common.saving') : buttonLabel}
              </Button>
            </div>

            {hasSearched && matchResult && !searching && (
              <CustomerMatchResults
                result={{
                  ...matchResult,
                  // A co-lessee can't be the primary lessee — drop the primary from the list.
                  customers: workspace.customerId
                    ? matchResult.customers.filter(c => c.id !== workspace.customerId)
                    : matchResult.customers,
                }}
                selectedId={selectedCustomer?.id ?? null}
                onSelect={handleSelectCustomer}
              />
            )}
          </div>
        )}
      </PanelSection>
    </div>
  );
}

// ── Section toggle header ─────────────────────────────────────────────────

function CidChecksumIcon({ digits }: { digits: string }) {
  const raw = digits.replace(/\D/g, '');
  if (raw.length !== 13) return null;
  return passesThaiCidChecksum(raw)
    ? <CheckCircle size={14} className="text-success" />
    : <XCircle size={14} className="text-warning-fg" />;
}

function SectionHeader({ label, done, expanded, onToggle, optional }: {
  label: string; done: boolean; expanded: boolean; onToggle: () => void;
  // optional sections show a neutral empty circle instead of a warning icon
  // when not done — used for the co-lessee signature which can be captured
  // later from the Documents panel.
  optional?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="border-t border-line -mx-3" />
      <button
        className={`w-full flex items-center gap-2 py-2 px-3 -mx-3 text-sm font-medium cursor-pointer border-none text-current transition-colors ${
          done ? 'bg-success-soft hover:bg-success-soft' : 'bg-transparent hover:bg-surface-hover'
        }`}
        style={{ width: 'calc(100% + 1.5rem)' }}
        onClick={onToggle}
      >
        {expanded ? <ChevronDown size={13} className="text-subtle" /> : <ChevronRight size={13} className="text-subtle" />}
        {done
          ? <CheckCircle size={13} className="text-success" />
          : optional
            ? <span className="w-3 h-3 rounded-full border-2 border-fg/30 inline-block" />
            : <AlertTriangle size={13} className="text-warning-fg" />}
        <span>{label}</span>
        {optional && !done && (
          <span className="ml-auto text-xs font-normal text-subtle pr-1">
            ({t('common.optional', { defaultValue: 'optional' })})
          </span>
        )}
      </button>
    </>
  );
}

// ── Co-lessee row — accordion with collapsible sections ───────────────────

const thaiPhoneMask = (digits: string) => {
  if (digits.startsWith('02')) return '##-###-####';
  const prefix = digits.slice(0, 2);
  if (['03','04','05','07'].includes(prefix)) return '###-###-###';
  return '###-###-####';
};

interface CoLesseeCustomer {
  id: number; id_type: string; id_number: string;
  prefix: string | null; first_name: string; last_name: string;
  date_of_birth: string | null; tel: string | null;
}

function CoLesseeRow({ coLessee, expanded, onToggle, onRemove, removing }: {
  coLessee: { customerId: number; fullName: string; idNumber: string };
  contractId: number | null;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [uploading, setUploading] = useState('');
  const [cacheBust, setCacheBust] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>('info');

  // Fetch co-lessee customer info
  const { data: custInfo, refetch: refetchCustInfo } = useQuery({
    queryKey: ['co-lessee-info', coLessee.customerId],
    queryFn: () => apiClient.get<CoLesseeCustomer[]>(`/v_customers?id=eq.${coLessee.customerId}&select=id,id_type,id_number,prefix,first_name,last_name,date_of_birth,tel`).then(r => r[0] ?? null),
  });

  const { data: addresses = [], refetch: refetchAddresses } = useQuery({
    queryKey: ['co-lessee-addresses', coLessee.customerId],
    queryFn: () => apiClient.get<CustomerAddress[]>(`/v_customer_addresses?customer_id=eq.${coLessee.customerId}&order=address_type`),
  });
  const homeAddress = addresses.find(a => a.address_type === 'HOME');
  const workAddress = addresses.find(a => a.address_type === 'WORK');

  const { data: idCardDocs = [] } = useQuery({
    queryKey: ['co-lessee-idcard', coLessee.customerId],
    queryFn: () => apiClient.get<CustomerDocument[]>(
      `/v_customer_documents?customer_id=eq.${coLessee.customerId}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true&select=id,file_url`
    ),
  });

  const idCard = idCardDocs[0] ?? null;
  const hasInfo = !!custInfo?.date_of_birth;
  // Co-lessee signature is captured in the Documents step, not here.
  const isComplete = hasInfo && !!homeAddress && !!workAddress && !!idCard;

  const toggle = (section: string) => setOpenSection(openSection === section ? null : section);

  // ── Basic info edit ─────────────────────────────────────────────────
  const [editPrefix, setEditPrefix] = useState('');
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editDob, setEditDob] = useState('');
  const [editTel, setEditTel] = useState('');
  const [infoLoaded, setInfoLoaded] = useState(false);
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoSaved, setInfoSaved] = useState(false);
  const [isTypingEditDob, setIsTypingEditDob] = useState(false);

  // Sync form when custInfo arrives
  if (custInfo && !infoLoaded) {
    setEditPrefix(custInfo.prefix ?? '');
    setEditFirstName(custInfo.first_name);
    setEditLastName(custInfo.last_name);
    setEditDob(custInfo.date_of_birth ?? '');
    setEditTel(custInfo.tel ?? '');
    setInfoLoaded(true);
  }

  // Dirty check vs. the loaded snapshot — drives the save button's disabled state.
  const hasInfoChanges = !!custInfo && (
    editPrefix !== (custInfo.prefix ?? '')
    || editFirstName !== custInfo.first_name
    || editLastName !== custInfo.last_name
    || editDob !== (custInfo.date_of_birth ?? '')
    || editTel !== (custInfo.tel ?? '')
  );

  // Surface a mutation failure instead of swallowing it. The real backend
  // reason (e.g. a cross-holding DB collision) must reach the desk.
  const showError = (err: unknown) => {
    const msg = err instanceof ApiError ? translateApiError(err, t) : (err instanceof Error ? err.message : String(err));
    addSnackbar({ message: <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{msg}</div></div></div> });
  };

  const handleInfoSave = async () => {
    if (!custInfo) return;
    setInfoSaving(true);
    try {
      await apiClient.rpc('fn_customer_register_or_update', {
        p_id_type: custInfo.id_type, p_id_number: custInfo.id_number,
        p_prefix: editPrefix || null,
        p_first_name: editFirstName.trim(), p_last_name: editLastName.trim(),
        p_date_of_birth: editDob || null, p_tel: editTel.trim(),
      });
      refetchCustInfo();
      queryClient.invalidateQueries({ queryKey: ['co-lessee-status'] }); queryClient.invalidateQueries({ queryKey: ['co-lessee-all-complete'] });
      setInfoSaved(true);
      setTimeout(() => setInfoSaved(false), 2000);
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={18} /><div><div className="alert-title">{t('common.saved')}</div></div></div> });
    } catch (err) {
      console.error('[co-lessee info] save failed', err);
      showError(err);
    } finally { setInfoSaving(false); }
  };

  // ── Uploads ─────────────────────────────────────────────────────────
  const uploadIdCard = async (images: UploadedImage[]) => {
    if (images.length === 0 || !coLessee.customerId) return;
    setUploading('ID_CARD');
    try {
      const results = await beMediaUploadFromImage({
        type: 'customer_id_card',
        image: images[0],
        params: { customer_id: coLessee.customerId },
      });
      const key = results.lg?.key ?? Object.values(results)[0]?.key;
      if (!key) throw new Error('Upload returned no key');
      await apiClient.rpc('fn_customer_document_upload', {
        p_customer_id: coLessee.customerId, p_doc_type: 'ID_CARD_FRONT', p_file_url: `/${key}`,
      });
      invalidateMediaUrl(key);
      queryClient.invalidateQueries({ queryKey: ['co-lessee-idcard', coLessee.customerId] });
      queryClient.invalidateQueries({ queryKey: ['co-lessee-status'] }); queryClient.invalidateQueries({ queryKey: ['co-lessee-all-complete'] });
      setCacheBust(n => n + 1);
    } catch (err) {
      console.error('[co-lessee id-card] upload failed', err);
      showError(err);
    } finally { setUploading(''); }
  };

  return (
    <div className="border border-success-border rounded-lg overflow-hidden transition-colors">
      {/* Header — accent marks an added co-lessee */}
      <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer bg-success-soft hover:bg-surface-hover transition-colors" onClick={onToggle}>
        {expanded ? <ChevronDown size={14} className="text-subtle shrink-0" /> : <ChevronRight size={14} className="text-subtle shrink-0" />}
        {isComplete
          ? <CheckCircle size={14} className="text-success shrink-0" />
          : <AlertTriangle size={14} className="text-warning-fg shrink-0" />
        }
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{coLessee.fullName}</div>
          {coLessee.idNumber && <div className="text-xs text-subtle">{coLessee.idNumber}</div>}
        </div>
        {confirmRemove ? (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <Button
              color="danger"
              size="sm"
              disabled={removing}
              startIcon={removing ? <Loader2 size={12} className="animate-spin" /> : undefined}
              onClick={() => { setConfirmRemove(false); onRemove(); }}
            >
              {t('common.confirm')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="btn-icon-sm"
            startIcon={<Trash2 size={14} />}
            onClick={(e) => { e.stopPropagation(); setConfirmRemove(true); }}
            title={t('common.remove')}
            aria-label={t('common.remove')}
          />
        )}
      </div>

      {/* Expandable sections */}
      {expanded && (
        <div className="border-t border-line">
          {/* Basic Info */}
          <div className="px-3">
            <SectionHeader label={t('customer.basicInfo')} done={hasInfo} expanded={openSection === 'info'} onToggle={() => toggle('info')} />
            {openSection === 'info' && infoLoaded && (
              <div className="pt-2 pb-4">
                <div className="form-grid">
                  <div className="flex gap-3">
                    <div className="flex flex-col" style={{ width: '10rem' }}>
                      <label className="form-label">{t('wizard.idType')}</label>
                      <Select options={ID_TYPE_VALUES.map(v => ({ value: v, label: t(`contract.idType_${v}`) }))} value={custInfo?.id_type ?? 'CITIZEN_ID'} onChange={() => {}} size="sm" disabled />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <label className="form-label">{t('wizard.idNumber')}</label>
                      {custInfo?.id_type === 'CITIZEN_ID' ? (
                        <MaskedInput mask="#-####-#####-##-#" placeholder="" value={custInfo?.id_number ?? ''} onChange={() => {}} size="sm" className="w-full" disabled endIcon={<CidChecksumIcon digits={custInfo?.id_number ?? ''} />} />
                      ) : (
                        <Input size="sm" value={custInfo?.id_number ?? ''} disabled className="w-full" />
                      )}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex flex-col" style={{ width: '7rem' }}>
                      <label className="form-label">{t('wizard.prefix')}</label>
                      <Select options={PREFIX_OPTIONS} value={editPrefix} onChange={v => setEditPrefix(v as string)} size="sm" clearable />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <label className="form-label">{t('wizard.firstName')}</label>
                      <Input size="sm" value={editFirstName} onChange={e => setEditFirstName(e.target.value)} className="w-full" />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <label className="form-label">{t('wizard.lastName')}</label>
                      <Input size="sm" value={editLastName} onChange={e => setEditLastName(e.target.value)} className="w-full" />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex flex-col flex-1 min-w-0">
                      <label className="form-label">{t('wizard.dateOfBirth')} *</label>
                      <InputDatePicker
                        value={parseLocalDate(editDob)}
                        onChange={(date) => setEditDob(toLocalDateStr(date))}
                        size="sm"
                        endIcon={<Keyboard size={16} />}
                        onEndIconClick={() => setIsTypingEditDob(v => !v)}
                        calendar="gregorian"
                        locale={i18n.language}
                        dateFormat={makeDatePickerFormat(i18n.language)}
                        typingMode={isTypingEditDob}
                        onTypingModeChange={setIsTypingEditDob}
                        typingMask="##/##/####"
                        typingPlaceholder="DD/MM/YYYY"
                        parseTypedDate={(raw) => {
                          if (raw.length !== 8) return null;
                          const day = parseInt(raw.slice(0, 2), 10);
                          const month = parseInt(raw.slice(2, 4), 10);
                          let year = parseInt(raw.slice(4, 8), 10);
                          if (year > 2400) year -= 543;
                          if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                          const d = new Date(year, month - 1, day);
                          if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                          return d;
                        }}
                      />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <label className="form-label">{t('wizard.tel')}</label>
                      <MaskedInput dynamicMask={thaiPhoneMask} value={editTel} onChange={(raw) => setEditTel(raw)} size="sm" className="w-full" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    color={infoSaved ? 'success' : 'primary'}
                    onClick={handleInfoSave}
                    disabled={infoSaving || (!hasInfoChanges && !infoSaved) || !editFirstName.trim() || !editLastName.trim() || !editDob}
                    startIcon={infoSaved ? <CheckCircle size={16} /> : undefined}
                  >
                    {infoSaving ? t('common.saving') : infoSaved ? t('common.saved') : t('common.save')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Home Address */}
          <div className="px-3">
            <SectionHeader label={t('workspace.addressHome')} done={!!homeAddress} expanded={openSection === 'home'} onToggle={() => toggle('home')} />
            {openSection === 'home' && (
              <div className="pt-2 pb-4">
                <AddressFormPostal customerId={coLessee.customerId} addressType="HOME" existing={homeAddress} onSuccess={() => { refetchAddresses(); queryClient.invalidateQueries({ queryKey: ['co-lessee-status'] }); queryClient.invalidateQueries({ queryKey: ['co-lessee-all-complete'] }); }} />
              </div>
            )}
          </div>

          {/* Work Address */}
          <div className="px-3">
            <SectionHeader label={t('workspace.addressWork')} done={!!workAddress} expanded={openSection === 'work'} onToggle={() => toggle('work')} />
            {openSection === 'work' && (
              <div className="pt-2 pb-4">
                <AddressFormPostal customerId={coLessee.customerId} addressType="WORK" existing={workAddress} onSuccess={() => { refetchAddresses(); queryClient.invalidateQueries({ queryKey: ['co-lessee-status'] }); queryClient.invalidateQueries({ queryKey: ['co-lessee-all-complete'] }); }} />
              </div>
            )}
          </div>

          {/* ID Card */}
          <div className="px-3">
            <SectionHeader label={t('workspace.docIdPhoto')} done={!!idCard} expanded={openSection === 'idcard'} onToggle={() => toggle('idcard')} />
            {openSection === 'idcard' && (
              <div className="pt-2 pb-4">
                <IdPhotoUpload icon={<CreditCard size={14} />} label={t('workspace.docIdPhoto')} type="customer_id_card" fileUrl={idCard?.file_url ?? null} uploading={uploading === 'ID_CARD'} onUpload={uploadIdCard} cacheBust={cacheBust} />
              </div>
            )}
          </div>

          {/* Signature is captured in the Documents step (alongside the
              lessee), not here — see PanelDocuments. */}
        </div>
      )}
    </div>
  );
}

