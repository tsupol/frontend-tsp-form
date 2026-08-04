import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input, Select, Button, InputDatePicker, Modal, MaskedInput } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { ShieldAlert, AlertTriangle, CheckCircle, XCircle, Keyboard, Search, Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { translateApiError } from '../../../lib/apiErrors';
import { invalidateMediaUrl } from '../../../lib/upload';
import { beMediaUploadFromImage } from '../../../lib/beMedia';
import { toLocalDateStr, parseLocalDate, makeDatePickerFormat } from '../../../lib/format';
import { useMediaUrl } from '../../../hooks/useMediaUrl';
import { useWorkspace } from './WorkspaceContext';
import { AddressCard, AddressEditModal } from '../../../components/AddressCard';
import { IdCardScanner, type DetectedIdCardFields } from '../../../components/IdCardScanner';
import { passesThaiCidChecksum } from '../../../lib/ocr/extractIdCard';
import type { CustomerRegisterResult, CustomerAddress } from './WorkspaceTypes';
import { useCustomerMatch, type MatchedCustomer } from './useCustomerMatch';
import { CustomerMatchResults } from './CustomerMatchResults';

const thaiPhoneMask = (digits: string) => {
  if (digits.startsWith('02')) return '##-###-####';
  const prefix = digits.slice(0, 2);
  if (['03','04','05','07'].includes(prefix)) return '###-###-###';
  return '###-###-####'; // mobile 06x, 08x, 09x
};

const ID_TYPE_VALUES = ['CITIZEN_ID', 'PASSPORT'] as const;

const PREFIX_OPTIONS = [
  { value: '', label: '-' },
  { value: 'นาย', label: 'นาย' },
  { value: 'นาง', label: 'นาง' },
  { value: 'นางสาว', label: 'นางสาว' },
  { value: 'Mr.', label: 'Mr.' },
  { value: 'Mrs.', label: 'Mrs.' },
  { value: 'Ms.', label: 'Ms.' },
];

interface CustomerSearchResult {
  id: number;
  id_type: string;
  id_number: string;
  prefix: string | null;
  first_name: string;
  last_name: string;
  full_name: string;
  tel: string | null;
  tel2: string | null;
  date_of_birth: string | null;
}

interface CustomerSnapshot {
  idType: string;
  idNumber: string;
  prefix: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  tel: string;
  tel2: string;
}

function makeSnapshot(c: CustomerSearchResult): CustomerSnapshot {
  return {
    idType: c.id_type, idNumber: c.id_number, prefix: c.prefix ?? '',
    firstName: c.first_name, lastName: c.last_name,
    dateOfBirth: c.date_of_birth ?? '', tel: c.tel ?? '', tel2: c.tel2 ?? '',
  };
}

interface FieldComparison {
  field: string;
  value: string;
  original: string;
  changed: boolean;
}

const COMPARE_FIELDS: Array<{ key: keyof CustomerSnapshot; labelKey: string }> = [
  { key: 'idType', labelKey: 'contract.compareField_idType' },
  { key: 'idNumber', labelKey: 'contract.compareField_idNumber' },
  { key: 'prefix', labelKey: 'contract.compareField_prefix' },
  { key: 'firstName', labelKey: 'contract.compareField_firstName' },
  { key: 'lastName', labelKey: 'contract.compareField_lastName' },
  { key: 'dateOfBirth', labelKey: 'contract.compareField_dateOfBirth' },
  { key: 'tel', labelKey: 'contract.compareField_tel' },
  { key: 'tel2', labelKey: 'contract.compareField_tel2' },
];

// `field` carries the i18n key; the render site resolves it with t(). The
// downstream "ID changed?" check compares against the idType/idNumber keys.
function compareFields(original: CustomerSnapshot, current: CustomerSnapshot): { all: FieldComparison[]; hasChanges: boolean } {
  const all: FieldComparison[] = COMPARE_FIELDS.map(({ key, labelKey }) => ({
    field: labelKey,
    value: current[key] || '—',
    original: original[key] || '—',
    changed: original[key] !== current[key],
  }));
  return { all, hasChanges: all.some(f => f.changed) };
}

interface Props { onClose: () => void }

const KNOWN_TH_PREFIXES = new Set(PREFIX_OPTIONS.map(o => o.value).filter(Boolean));

export function PanelCustomer({ onClose: _onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { data: workspace, contract, updateData, invalidateContract, invalidateCustomer, setPanelDirty } = useWorkspace();
  const queryClient = useQueryClient();

  // Form fields
  const [idType, setIdType] = useState<'CITIZEN_ID' | 'PASSPORT'>('CITIZEN_ID');
  const [idNumber, setIdNumber] = useState('');
  const [prefix, setPrefix] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [tel, setTel] = useState('');
  const [tel2, setTel2] = useState('');
  const [isTypingDob, setIsTypingDob] = useState(false);

  // Selected existing customer — original snapshot for diff
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const originalRef = useRef<CustomerSnapshot | null>(null);
  const prefilledRef = useRef(false);

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');
  // ID-card photo save failures are surfaced separately (warning, not blocker)
  // — the customer is already saved; only the photo didn't attach. Silent-
  // swallowing here hid a real cross-holding DB collision from the desk.
  const [idCardError, setIdCardError] = useState('');
  const [result, setResult] = useState<CustomerRegisterResult | null>(workspace.customerResult);

  // Pre-fill from existing customer when continuing a draft
  useEffect(() => {
    if (prefilledRef.current || !workspace.customerId || idNumber) return;
    prefilledRef.current = true;

    apiClient.get<CustomerSearchResult[]>(`/v_customers?id=eq.${workspace.customerId}`)
      .then(res => {
        const c = res[0];
        if (!c) return;
        setIdType(c.id_type as 'CITIZEN_ID' | 'PASSPORT');
        setIdNumber(c.id_number);
        setPrefix(c.prefix ?? '');
        setFirstName(c.first_name);
        setLastName(c.last_name);
        setDateOfBirth(c.date_of_birth ?? '');
        setTel(c.tel ?? '');
        setTel2(c.tel2 ?? '');
        setSelectedCustomer(c);
        originalRef.current = makeSnapshot(c);
      })
      .catch(() => {});
  }, [workspace.customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const { result: matchResult, matching: searching, runMatch, reset: resetMatch, blocked: idNameMismatch } = useCustomerMatch();
  const [hasSearched, setHasSearched] = useState(false);
  const [confirmData, setConfirmData] = useState<FieldComparison[] | null>(null);
  const [editAddressType, setEditAddressType] = useState<'HOME' | 'WORK' | 'SHIPPING' | null>(null);

  // Pending scanned ID card image — uploaded to backend once we have a customer_id.
  const pendingScanRef = useRef<UploadedImage | null>(null);

  // Address
  const customerId = workspace.customerId;

  const { data: addresses = [], refetch: refetchAddresses } = useQuery({
    queryKey: ['customer-addresses', customerId],
    queryFn: () => apiClient.get<CustomerAddress[]>(`/v_customer_addresses?customer_id=eq.${customerId}&order=address_type`),
    enabled: !!customerId,
  });
  const homeAddress = addresses.find(a => a.address_type === 'HOME');
  const workAddress = addresses.find(a => a.address_type === 'WORK');
  const shippingAddress = addresses.find(a => a.address_type === 'SHIPPING');

  // Currently-saved ID card so the scanner can show it on revisit.
  const { data: idCardDocs = [] } = useQuery({
    queryKey: ['customer-idcard', customerId],
    queryFn: () => apiClient.get<{ file_url: string }[]>(
      `/v_customer_documents?customer_id=eq.${customerId}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true&select=file_url&order=uploaded_at.desc&limit=1`
    ),
    enabled: !!customerId,
  });
  const { url: existingIdCardUrl } = useMediaUrl(idCardDocs[0]?.file_url ?? null);


  // Dirty tracking — compare against loaded snapshot, not just non-empty
  useEffect(() => {
    if (originalRef.current) {
      const { hasChanges } = compareFields(originalRef.current, getCurrentSnapshot());
      setPanelDirty(hasChanges);
    } else {
      setPanelDirty(!!(idNumber || firstName || lastName || tel || tel2 || dateOfBirth || prefix));
    }
  }, [idNumber, firstName, lastName, tel, tel2, dateOfBirth, prefix, idType, setPanelDirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setPanelDirty(false), [setPanelDirty]);

  // Editing the ID/name after a check invalidates the previous verdict — clear it
  // so a stale ID_MATCH_NAME_MISMATCH can't keep the button blocked after a fix.
  useEffect(() => {
    if (hasSearched && !selectedCustomer) { resetMatch(); setHasSearched(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idNumber, firstName, lastName]);

  // ── Dedupe check (fn_customer_match) ─────────────────────────────────────
  // Was an id_number.ilike on v_customers, but that view masks the CID so an ID
  // search always returned nothing. fn_customer_match searches the unmasked id
  // holding-wide and returns a verdict — incl. ID_MATCH_NAME_MISMATCH, which we
  // block on (mig 623/624, see UI_FEEDBACK/2026-07-14 fn_customer_match_dedupe).
  const handleSearch = async () => {
    setHasSearched(true);
    setSelectedCustomer(null);
    await runMatch({ idNumber, firstName, lastName });
  };

  // ── Select existing customer ────────────────────────────────────────────
  // fn_customer_match doesn't return date_of_birth, so fetch it by id to complete
  // the form (match gives us the unmasked CID + everything else).
  const handleSelectCustomer = async (m: MatchedCustomer) => {
    let dob: string | null = null;
    try {
      const rows = await apiClient.get<{ date_of_birth: string | null }[]>(
        `/v_customers?id=eq.${m.id}&select=date_of_birth&limit=1`,
      );
      dob = rows[0]?.date_of_birth ?? null;
    } catch { /* DOB optional — staff can fill it */ }

    const customer: CustomerSearchResult = {
      id: m.id, id_type: m.id_type, id_number: m.id_number,
      prefix: m.prefix, first_name: m.first_name, last_name: m.last_name,
      full_name: m.full_name, tel: m.tel, tel2: m.tel2, date_of_birth: dob,
    };
    setSelectedCustomer(customer);
    originalRef.current = makeSnapshot(customer);

    // Fill form
    setIdType(m.id_type);
    setIdNumber(m.id_number);
    setPrefix(m.prefix ?? '');
    setFirstName(m.first_name);
    setLastName(m.last_name);
    setDateOfBirth(dob ?? '');
    setTel(m.tel ?? '');
    setTel2(m.tel2 ?? '');
    setApiError('');
    setResult(null);
  };

  // ── Use / Register ──────────────────────────────────────────────────────
  const getCurrentSnapshot = (): CustomerSnapshot => ({
    idType, idNumber, prefix, firstName, lastName, dateOfBirth, tel, tel2,
  });

  const handleUseOrRegister = () => {
    setApiError('');

    // Never register/overwrite when the CID belongs to a different-named customer.
    if (idNameMismatch) return;

    // If existing customer selected, check for changes
    if (selectedCustomer && originalRef.current) {
      const { all, hasChanges } = compareFields(originalRef.current, getCurrentSnapshot());
      if (hasChanges) {
        // Validate CID only if ID was changed
        const idChanged = all.some(f => f.changed && (f.field === 'contract.compareField_idNumber' || f.field === 'contract.compareField_idType'));
        if (idChanged && idType === 'CITIZEN_ID' && idNumber.replace(/\D/g, '').length !== 13) {
          setApiError(t('workspace.citizenIdLength'));
          return;
        }
        setConfirmData(all);
        return;
      }
      // No changes — just attach
      void doAttach(selectedCustomer.id, selectedCustomer.full_name);
      return;
    }

    // New customer — validate all
    if (idType === 'CITIZEN_ID' && idNumber.replace(/\D/g, '').length !== 13) {
      setApiError(t('workspace.citizenIdLength'));
      return;
    }
    if (!idNumber.trim() || !firstName.trim() || !lastName.trim() || !tel.trim() || !dateOfBirth) return;

    doRegister();
  };

  const doRegister = async () => {
    setSubmitting(true);
    setApiError('');
    try {
      const res = await apiClient.rpc<CustomerRegisterResult>('fn_customer_register_or_update', {
        p_id_type: idType, p_id_number: idNumber.trim(), p_prefix: prefix || null,
        p_first_name: firstName.trim(), p_last_name: lastName.trim(),
        p_date_of_birth: dateOfBirth || null, p_tel: tel.trim(), p_tel2: tel2.trim() || null,
      });
      setResult(res);
      if (res.action !== 'BLOCK') {
        await doAttach(res.customer_id, res.full_name);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setApiError(translated || err.code || err.message);
      } else setApiError(String(err));
    } finally { setSubmitting(false); }
  };

  const doUpdateAndAttach = async () => {
    setConfirmData(null);
    await doRegister(); // fn_customer_register_or_update handles both create and update by id_number
  };

  // Persist the OCR-scanned ID card image as the customer's ID_CARD_FRONT
  // document. Best-effort — failures are silent because the user can still
  // re-upload from the Documents panel.
  const persistScannedIdCard = async (custId: number, image: UploadedImage) => {
    setIdCardError('');
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
      queryClient.invalidateQueries({ queryKey: ['customer-idcard', custId] });
      queryClient.invalidateQueries({ queryKey: ['customer-summary', custId] });
      queryClient.invalidateQueries({ queryKey: ['contract-readiness'] });
    } catch (err) {
      // The customer is saved; only the ID photo failed. Surface it as a
      // warning (not a blocker) with the real backend reason — never swallow.
      // A silent catch here hid a cross-holding DB collision in the field.
      console.error('[id-card] persist failed', err);
      setIdCardError(err instanceof ApiError ? translateApiError(err, t) : (err instanceof Error ? err.message : String(err)));
    }
  };

  // OCR scanner callback — overwrite form fields with detected values. Skipped
  // entirely for an existing (already-saved) customer to avoid corrupting their
  // record, but for a new registration each scan wins.
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

  const handleOcrPersist = async (img: UploadedImage) => {
    setIdCardError('');
    if (customerId) {
      await persistScannedIdCard(customerId, img);
    } else {
      // No customer yet — hold the image; doAttach flushes it once the
      // customer is created (and surfaces any failure there).
      pendingScanRef.current = img;
    }
  };

  // Attach the picked customer to the contract. When no contractId exists yet,
  // WorkspaceContext will create a draft from the customerId we set on data;
  // when one does, we call the attach RPC directly so failures surface here
  // instead of being swallowed by the background effect.
  const doAttach = async (custId: number, custName: string) => {
    setApiError('');
    try {
      if (workspace.contractId && contract?.customer_id !== custId) {
        setSubmitting(true);
        await apiClient.rpc('fn_contract_attach_customer', {
          p_contract_id: workspace.contractId,
          p_customer_id: custId,
        });
      }
      updateData({
        customerId: custId,
        customerName: custName,
        customerDateOfBirth: dateOfBirth || null,
        customerResult: result ?? {
          customer_id: custId, is_new: false, id_type: idType, id_number: idNumber,
          full_name: custName, is_blacklisted: false, blacklist_reasons: [],
          has_overdue: false, overdue_contract_count: 0, active_contract_count: 0, action: 'OK',
        },
      });
      invalidateContract();
      invalidateCustomer();
      setSelectedCustomer(null);
      originalRef.current = null;
      setPanelDirty(false);
      // If we held a scanned ID card until the customer existed, persist it now.
      if (pendingScanRef.current) {
        const img = pendingScanRef.current;
        pendingScanRef.current = null;
        void persistScannedIdCard(custId, img);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setApiError(translated || err.code || err.message);
      } else setApiError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddressSuccess = (_type: 'HOME' | 'WORK' | 'SHIPPING') => {
    refetchAddresses();
    invalidateCustomer();
  };

  const canSearch = !!(idNumber.trim() || firstName.trim() || lastName.trim());
  const isExisting = !!selectedCustomer;

  // Has the customer panel already been attached to the current contract?
  // If yes, "use this customer" is a no-op — only "save changes" makes sense.
  const alreadyAttached = !!(workspace.contractId && selectedCustomer && contract?.customer_id === selectedCustomer.id);
  const hasInfoChanges = !!(originalRef.current && compareFields(originalRef.current, getCurrentSnapshot()).hasChanges);

  // The action button stays visible at all times; it's just disabled when the
  // customer is attached and nothing's been edited (nothing to save / no-op
  // "use" action).
  const buttonNoop = isExisting && !hasInfoChanges && alreadyAttached;
  const buttonLabel = hasInfoChanges
    ? t('common.save')
    : (isExisting ? t('workspace.useThisCustomer') : t('wizard.registerCustomer'));

  return (
    <div className="p-4 flex flex-col gap-3 max-w-2xl">
      {apiError && <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{apiError}</div></div></div>}
      {result && <ResultBanner result={result} t={t} />}

      {/* ID card scanner — autofills the form for new customers (gated inside
          handleOcrDetected when an existing customer is selected), and always
          re-persists the uploaded image as ID_CARD_FRONT. */}
      <IdCardScanner
        onDetected={handleOcrDetected}
        onPersist={handleOcrPersist}
        disabled={submitting}
        existingImageUrl={existingIdCardUrl}
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

      {idCardError && (
        <div className="alert alert-warning">
          <AlertTriangle size={18} />
          <div>
            <div className="alert-title">{t('workspace.idCardSaveFailed', { defaultValue: 'ID card photo not saved' })}</div>
            <div className="alert-description">{idCardError}</div>
            <div className="alert-description">{t('workspace.idCardSaveFailedHint', { defaultValue: 'You can re-upload it from the Documents step.' })}</div>
          </div>
        </div>
      )}

      {/* Form */}
      <div className="form-grid">
        <div className="flex gap-3">
          <div className="flex flex-col" style={{ width: '10rem' }}>
            <label className="form-label">{t('wizard.idType')}</label>
            <Select options={ID_TYPE_VALUES.map(v => ({ value: v, label: t(`contract.idType_${v}`) }))} value={idType} onChange={(val) => setIdType((val as string) as 'CITIZEN_ID' | 'PASSPORT')} size="sm" disabled={!!selectedCustomer} />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{t('wizard.idNumber')}</label>
            {idType === 'CITIZEN_ID' ? (
              <MaskedInput
                mask="#-####-#####-##-#"
                placeholder=""
                value={idNumber}
                onChange={(raw) => setIdNumber(raw)}
                size="sm"
                className="w-full"
                disabled={!!selectedCustomer}
                endIcon={<CidChecksumIcon digits={idNumber} />}
              />
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
              onEndIconClick={() => setIsTypingDob(t => !t)}
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
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{t('wizard.tel2')}</label>
            <MaskedInput dynamicMask={thaiPhoneMask} value={tel2} onChange={(raw) => setTel2(raw)} size="sm" className="w-full" />
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={handleSearch}
          disabled={searching || !canSearch}
          startIcon={searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        >
          {t('workspace.checkCustomer')}
        </Button>
        <Button
          color={hasInfoChanges || isExisting ? 'primary' : undefined}
          variant={hasInfoChanges || isExisting ? undefined : 'outline'}
          onClick={handleUseOrRegister}
          disabled={submitting || buttonNoop || idNameMismatch || !idNumber.trim() || !firstName.trim() || !lastName.trim() || !tel.trim() || !dateOfBirth}
          startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : undefined}
        >
          {submitting ? t('common.saving') : buttonLabel}
        </Button>
      </div>

      {/* Dedupe-check results — verdict-driven; blocks on ID_MATCH_NAME_MISMATCH */}
      {hasSearched && matchResult && !searching && (
        <CustomerMatchResults
          result={matchResult}
          selectedId={selectedCustomer?.id ?? null}
          onSelect={handleSelectCustomer}
        />
      )}

      {/* Addresses — disabled until customer attached */}
      <div className="mt-6">
        <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
          {t('customer.addresses')}
        </h3>
        <AddressCard
          label={t('customer.addressHome')}
          address={homeAddress}
          onEdit={() => setEditAddressType('HOME')}
          disabled={!customerId}
        />
        <AddressCard
          label={t('customer.addressWork')}
          address={workAddress}
          onEdit={() => setEditAddressType('WORK')}
          disabled={!customerId}
        />
        <AddressCard
          label={t('customer.addressShipping')}
          address={shippingAddress}
          onEdit={() => setEditAddressType('SHIPPING')}
          disabled={!customerId}
          optional
          emptyHint={t('workspace.shippingAddressHint')}
        />
      </div>

      {customerId && (
        <AddressEditModal
          open={!!editAddressType}
          onClose={() => setEditAddressType(null)}
          customerId={customerId}
          addressType={editAddressType ?? 'HOME'}
          existing={
            editAddressType === 'HOME' ? homeAddress
              : editAddressType === 'WORK' ? workAddress
              : editAddressType === 'SHIPPING' ? shippingAddress
              : undefined
          }
          onSuccess={() => handleAddressSuccess(editAddressType ?? 'HOME')}
        />
      )}

      {/* Confirm changes modal — shows all fields, changed ones in green */}
      <Modal open={!!confirmData} onClose={() => setConfirmData(null)} maxWidth="32rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('workspace.confirmUpdateTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={() => setConfirmData(null)} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          <p className="text-sm mb-3">{t('workspace.confirmUpdateMessage')}</p>
          {confirmData && (
            <div className="border border-line rounded-lg divide-y divide-line text-sm">
              {confirmData.map((f, i) => (
                <div key={i} className="px-3 py-2 flex items-center gap-3">
                  <span className="font-medium w-28 shrink-0 text-subtle">{t(f.field)}</span>
                  <span className={`flex-1 ${f.changed ? 'text-success font-medium' : ''}`}>
                    {f.value}
                  </span>
                  {f.changed && (
                    <span className="text-xs text-danger line-through shrink-0">{f.original}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button variant="outline" onClick={() => setConfirmData(null)}>{t('common.cancel')}</Button>
          <Button color="primary" onClick={doUpdateAndAttach}>{t('workspace.updateAndUse')}</Button>
        </div>
      </Modal>
    </div>
  );
}

function CidChecksumIcon({ digits }: { digits: string }) {
  const raw = digits.replace(/\D/g, '');
  if (raw.length !== 13) return null;
  return passesThaiCidChecksum(raw)
    ? <CheckCircle size={14} className="text-success" />
    : <XCircle size={14} className="text-warning-fg" />;
}

function ResultBanner({ result, t }: { result: CustomerRegisterResult; t: (key: string, opts?: Record<string, unknown>) => string }) {
  if (result.action === 'BLOCK') return <div className="alert alert-danger"><ShieldAlert size={18} /><div><div className="alert-title">{t('wizard.blacklisted')}</div><div className="alert-description">{result.blacklist_reasons?.[0]?.reason ?? t('wizard.blacklistedDesc')}</div></div></div>;
  if (result.action === 'WARNING') return <div className="alert alert-warning"><AlertTriangle size={18} /><div><div className="alert-title">{t('wizard.customerWarning')}</div><div className="alert-description">{t('wizard.overdueContracts', { count: result.overdue_contract_count })}</div></div></div>;
  return <div className="alert alert-success"><CheckCircle size={18} /><div><div className="alert-title">{result.is_new ? t('wizard.customerCreated') : t('wizard.customerUpdated')}</div></div></div>;
}
