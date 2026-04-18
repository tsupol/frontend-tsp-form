import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input, Select, Button, InputDatePicker, MaskedInput, useSnackbarContext } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { ShieldAlert, CheckCircle, XCircle, Calendar, Search, Loader2, Trash2, AlertTriangle, CreditCard, PenLine, ChevronDown, ChevronRight, Plus, User } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { uploadToS3 } from '../../../lib/upload';
import { useWorkspace } from './WorkspaceContext';
import { PanelSection } from './PanelSection';
import { AddressFormPostal } from './AddressFormPostal';
import { SingleUpload } from './SingleUpload';
import type { CustomerRegisterResult, CustomerAddress } from './WorkspaceTypes';

interface CustomerDocument {
  id: number;
  file_url: string;
}

interface ContractDocument {
  id: number;
  file_url: string;
}

const ID_TYPE_OPTIONS = [
  { value: 'CITIZEN_ID', label: 'Citizen ID' },
  { value: 'PASSPORT', label: 'Passport' },
];
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

export function PanelGuarantor({ onClose: _onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { data: workspace, updateData } = useWorkspace();

  // ── Existing guarantors list ────────────────────────────────────────────
  const [removing, setRemoving] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [expandedGuarantor, setExpandedGuarantor] = useState<number | null>(
    workspace.guarantors.length === 1 ? workspace.guarantors[0].customerId : null
  );
  const [showAddForm, setShowAddForm] = useState(workspace.guarantors.length === 0);

  const handleRemove = async (customerId: number) => {
    if (!workspace.contractId) return;
    setRemoving(customerId);
    setRemoveError('');
    try {
      await apiClient.rpc('fn_contract_remove_guarantor', {
        p_contract_id: workspace.contractId,
        p_customer_id: customerId,
      });
      updateData({
        guarantors: workspace.guarantors.filter(g => g.customerId !== customerId),
      });
      if (expandedGuarantor === customerId) setExpandedGuarantor(null);
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setRemoveError(tr || err.code || err.message);
      } else setRemoveError(String(err));
    } finally {
      setRemoving(null);
    }
  };

  // ── Add new guarantor form ──────────────────────────────────────────────
  const [idType, setIdType] = useState<'CITIZEN_ID' | 'PASSPORT'>('CITIZEN_ID');
  const [idNumber, setIdNumber] = useState('');
  const [prefix, setPrefix] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [tel, setTel] = useState('');

  const [selectedCustomer, setSelectedCustomer] = useState<SearchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');
  const [result, setResult] = useState<CustomerRegisterResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const resetForm = () => {
    setIdType('CITIZEN_ID'); setIdNumber(''); setPrefix(''); setFirstName('');
    setLastName(''); setDateOfBirth(''); setTel('');
    setSelectedCustomer(null); setResult(null); setApiError('');
    setSearchResults([]); setHasSearched(false);
  };

  const handleSearch = async () => {
    setSearching(true); setHasSearched(true);
    try {
      const params: string[] = ['is_active=is.true', 'order=full_name', 'limit=10'];
      const orParts: string[] = [];
      if (idNumber.trim()) orParts.push(`id_number.ilike.*${encodeURIComponent(idNumber.trim())}*`);
      if (firstName.trim()) orParts.push(`first_name.ilike.*${encodeURIComponent(firstName.trim())}*`);
      if (lastName.trim()) orParts.push(`last_name.ilike.*${encodeURIComponent(lastName.trim())}*`);
      if (orParts.length > 0) params.push(`or=(${orParts.join(',')})`);
      const results = await apiClient.get<SearchResult[]>(`/v_customers?${params.join('&')}`);
      setSearchResults(workspace.customerId ? results.filter(c => c.id !== workspace.customerId) : results);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  };

  const handleSelectCustomer = (c: SearchResult) => {
    setSelectedCustomer(c);
    setIdType(c.id_type as 'CITIZEN_ID' | 'PASSPORT');
    setIdNumber(c.id_number);
    setPrefix(c.prefix ?? '');
    setFirstName(c.first_name);
    setLastName(c.last_name);
    setDateOfBirth(c.date_of_birth ?? '');
    setTel(c.tel ?? '');
    setApiError(''); setResult(null);
  };

  const attachGuarantor = async (custId: number, fullName: string, idNum: string) => {
    if (!workspace.contractId) return;
    if (custId === workspace.customerId) {
      setApiError(t('workspace.guarantorCannotBeSelf'));
      return;
    }
    if (workspace.guarantors.some(g => g.customerId === custId)) {
      setApiError(t('workspace.guarantorAlreadyAttached'));
      return;
    }
    try {
      await apiClient.rpc('fn_contract_add_guarantor', {
        p_contract_id: workspace.contractId,
        p_customer_id: custId,
        p_relation: null,
      });
      updateData({
        guarantors: [...workspace.guarantors, { customerId: custId, fullName, idNumber: idNum }],
        guarantorSkipped: false,
      });
      resetForm();
      setShowAddForm(false);
      setExpandedGuarantor(custId);
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setApiError(tr || err.code || err.message);
      }
    }
  };

  const handleUseOrRegister = async () => {
    setApiError('');
    if (selectedCustomer) {
      await attachGuarantor(selectedCustomer.id, selectedCustomer.full_name, selectedCustomer.id_number);
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
      await attachGuarantor(res.customer_id, res.full_name, res.id_number);
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setApiError(tr || err.code || err.message);
      } else setApiError(String(err));
    } finally { setSubmitting(false); }
  };

  const canSearch = !!(idNumber.trim() || firstName.trim() || lastName.trim());
  const isExisting = !!selectedCustomer;
  const buttonLabel = isExisting ? t('workspace.useThisCustomer') : t('wizard.registerCustomer');
  const hasGuarantors = workspace.guarantors.length > 0;

  return (
    <div className="p-4 flex flex-col max-w-2xl">
      <PanelSection title={t('workspace.cardGuarantor')} count={workspace.guarantors.length}
        alert={
          removeError ? <div className="alert alert-danger"><XCircle size={14} /><span>{removeError}</span></div>
          : (workspace.customerId && workspace.guarantors.length === 0 && workspace.customerDateOfBirth && (() => {
              const birth = new Date(workspace.customerDateOfBirth!);
              const now = new Date();
              let age = now.getFullYear() - birth.getFullYear();
              const m = now.getMonth() - birth.getMonth();
              if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
              return age < 18;
            })()) ? <div className="alert alert-warning"><AlertTriangle size={14} /><span>{t('workspace.guarantorRequired')}</span></div>
          : undefined
        }
      >
        {/* Existing guarantors — accordion */}
        {hasGuarantors && (
          <div className="flex flex-col gap-2 mb-4">
            {workspace.guarantors.map(g => (
              <GuarantorRow
                key={g.customerId}
                guarantor={g}
                contractId={workspace.contractId}
                expanded={expandedGuarantor === g.customerId}
                onToggle={() => setExpandedGuarantor(expandedGuarantor === g.customerId ? null : g.customerId)}
                onRemove={() => handleRemove(g.customerId)}
                removing={removing === g.customerId}
              />
            ))}
          </div>
        )}

        {/* Add form — inline when no guarantors, expandable toggle when 1+ */}
        {hasGuarantors && !showAddForm && (
          <Button onClick={() => setShowAddForm(true)} startIcon={<Plus size={14} />} className="w-full">
            {t('workspace.addGuarantor')}
          </Button>
        )}

        {(showAddForm || !hasGuarantors) && (
          <div className={hasGuarantors ? 'border border-line rounded-lg p-3' : 'p-3 rounded-md border border-dashed border-line'}>
            {hasGuarantors && (
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">{t('workspace.addGuarantor')}</span>
                <button className="text-subtle hover:text-fg cursor-pointer bg-transparent border-none p-1" onClick={() => { setShowAddForm(false); resetForm(); }}>
                  <XCircle size={16} />
                </button>
              </div>
            )}

            {apiError && <div className="alert alert-danger mb-3"><XCircle size={18} /><div><div className="alert-description">{apiError}</div></div></div>}
            {result?.action === 'BLOCK' && (
              <div className="alert alert-danger"><ShieldAlert size={18} /><div><div className="alert-title">{t('wizard.blacklisted')}</div></div></div>
            )}

            <div className="form-grid gap-4">
              <div className="flex gap-3">
                <div className="flex flex-col" style={{ width: '10rem' }}>
                  <label className="form-label">{t('wizard.idType')}</label>
                  <Select options={ID_TYPE_OPTIONS} value={idType} onChange={(val) => setIdType((val as string) as 'CITIZEN_ID' | 'PASSPORT')} size="sm" disabled={!!selectedCustomer} />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <label className="form-label">{t('wizard.idNumber')}</label>
                  <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} size="sm" className="w-full" disabled={!!selectedCustomer} />
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
                  <InputDatePicker value={dateOfBirth ? new Date(dateOfBirth + 'T00:00:00') : null} onChange={(date) => setDateOfBirth(date ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` : '')} size="sm" endIcon={<Calendar size={16} />} calendar="gregorian" locale={i18n.language} />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <label className="form-label">{t('wizard.tel')}</label>
                  <MaskedInput dynamicMask={thaiPhoneMask} value={tel} onChange={(raw) => setTel(raw)} placeholder="0X-XXX-XXXX" size="sm" className="w-full" />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleSearch} disabled={searching || !canSearch} startIcon={searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}>
                {t('workspace.checkCustomer')}
              </Button>
              <Button color={isExisting ? 'primary' : undefined} variant={isExisting ? undefined : 'outline'} onClick={handleUseOrRegister} disabled={submitting || !idNumber.trim() || !firstName.trim() || !lastName.trim() || !tel.trim() || !dateOfBirth} startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : undefined}>
                {submitting ? t('common.saving') : buttonLabel}
              </Button>
            </div>

            {hasSearched && (
              <div className="flex flex-col gap-1 mt-3">
                {searchResults.length > 0 ? (
                  <div className="border border-line rounded-lg divide-y divide-line overflow-hidden max-h-48 overflow-y-auto better-scroll">
                    {searchResults.map(c => (
                      <button key={c.id} className={`w-full text-left px-4 py-2.5 hover:bg-surface-hover transition-colors cursor-pointer flex items-center justify-between ${selectedCustomer?.id === c.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`} onClick={() => handleSelectCustomer(c)}>
                        <div>
                          <div className="font-medium text-sm">{c.full_name}</div>
                          <div className="text-xs text-subtle">{c.id_type}: {c.id_number} {c.tel ? `· ${c.tel}` : ''}</div>
                        </div>
                        {selectedCustomer?.id === c.id && <CheckCircle size={14} className="text-primary" />}
                      </button>
                    ))}
                  </div>
                ) : !searching ? (
                  <div className="text-sm text-subtle text-center py-2">{t('workspace.noCustomerFound')}</div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </PanelSection>
    </div>
  );
}

// ── Section toggle header ─────────────────────────────────────────────────

function SectionHeader({ label, done, expanded, onToggle }: {
  label: string; done: boolean; expanded: boolean; onToggle: () => void;
}) {
  return (
    <>
      <div className="border-t border-line -mx-3" />
      <button
        className="w-full flex items-center gap-2 py-2 px-3 -mx-3 text-sm font-medium cursor-pointer bg-transparent border-none text-current hover:bg-surface-hover transition-colors"
        style={{ width: 'calc(100% + 1.5rem)' }}
        onClick={onToggle}
      >
        {expanded ? <ChevronDown size={13} className="text-subtle" /> : <ChevronRight size={13} className="text-subtle" />}
        {done ? <CheckCircle size={13} className="text-success" /> : <AlertTriangle size={13} className="text-warning" />}
        <span>{label}</span>
      </button>
    </>
  );
}

// ── Guarantor row — accordion with collapsible sections ───────────────────

const thaiPhoneMask = (digits: string) => {
  if (digits.startsWith('02')) return '##-###-####';
  const prefix = digits.slice(0, 2);
  if (['03','04','05','07'].includes(prefix)) return '###-###-###';
  return '###-###-####';
};

interface GuarantorCustomer {
  id: number; id_type: string; id_number: string;
  prefix: string | null; first_name: string; last_name: string;
  date_of_birth: string | null; tel: string | null;
}

function GuarantorRow({ guarantor, contractId, expanded, onToggle, onRemove, removing }: {
  guarantor: { customerId: number; fullName: string; idNumber: string };
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

  // Fetch guarantor customer info
  const { data: custInfo, refetch: refetchCustInfo } = useQuery({
    queryKey: ['guarantor-info', guarantor.customerId],
    queryFn: () => apiClient.get<GuarantorCustomer[]>(`/v_customers?id=eq.${guarantor.customerId}&select=id,id_type,id_number,prefix,first_name,last_name,date_of_birth,tel`).then(r => r[0] ?? null),
  });

  const { data: addresses = [], refetch: refetchAddresses } = useQuery({
    queryKey: ['guarantor-addresses', guarantor.customerId],
    queryFn: () => apiClient.get<CustomerAddress[]>(`/v_customer_addresses?customer_id=eq.${guarantor.customerId}&order=address_type`),
  });
  const homeAddress = addresses.find(a => a.address_type === 'HOME');
  const workAddress = addresses.find(a => a.address_type === 'WORK');

  const { data: idCardDocs = [] } = useQuery({
    queryKey: ['guarantor-idcard', guarantor.customerId],
    queryFn: () => apiClient.get<CustomerDocument[]>(
      `/v_customer_documents?customer_id=eq.${guarantor.customerId}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true&select=id,file_url`
    ),
  });

  const { data: sigDocs = [] } = useQuery({
    queryKey: ['guarantor-signature', contractId, guarantor.customerId],
    queryFn: () => apiClient.get<ContractDocument[]>(
      `/v_contract_documents?contract_id=eq.${contractId}&customer_id=eq.${guarantor.customerId}&doc_type=eq.SIGNATURE_PAD&select=id,file_url`
    ),
    enabled: !!contractId,
  });

  const idCard = idCardDocs[0] ?? null;
  const signature = sigDocs[0] ?? null;
  const hasInfo = !!custInfo?.date_of_birth;
  const isComplete = hasInfo && !!homeAddress && !!workAddress && !!idCard && !!signature;

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

  // Sync form when custInfo arrives
  if (custInfo && !infoLoaded) {
    setEditPrefix(custInfo.prefix ?? '');
    setEditFirstName(custInfo.first_name);
    setEditLastName(custInfo.last_name);
    setEditDob(custInfo.date_of_birth ?? '');
    setEditTel(custInfo.tel ?? '');
    setInfoLoaded(true);
  }

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
      queryClient.invalidateQueries({ queryKey: ['guarantor-status'] });
      setInfoSaved(true);
      setTimeout(() => setInfoSaved(false), 2000);
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={18} /><div><div className="alert-title">{t('common.saved')}</div></div></div> });
    } catch {} finally { setInfoSaving(false); }
  };

  // ── Uploads ─────────────────────────────────────────────────────────
  const uploadIdCard = async (images: UploadedImage[]) => {
    if (images.length === 0) return;
    setUploading('ID_CARD');
    try {
      const img = images[0];
      const ts = Date.now();
      const key = `uploads/customers/${guarantor.customerId}/id-card-${ts}.webp`;
      await uploadToS3(img.file, key);
      await apiClient.rpc('fn_customer_document_upload', {
        p_customer_id: guarantor.customerId, p_doc_type: 'ID_CARD_FRONT', p_file_url: `/${key}`,
      });
      queryClient.invalidateQueries({ queryKey: ['guarantor-idcard', guarantor.customerId] });
      setCacheBust(n => n + 1);
    } catch {} finally { setUploading(''); }
  };

  const uploadSignature = async (images: UploadedImage[]) => {
    if (!contractId || images.length === 0) return;
    setUploading('SIGNATURE');
    try {
      const img = images[0];
      const ts = Date.now();
      const key = `uploads/contracts/${contractId}/signature-${guarantor.customerId}-${ts}.webp`;
      await uploadToS3(img.file, key);
      await apiClient.rpc('fn_contract_document_upload', {
        p_contract_id: contractId, p_doc_type: 'SIGNATURE_PAD', p_file_url: `/${key}`,
        p_customer_id: guarantor.customerId,
      });
      queryClient.invalidateQueries({ queryKey: ['guarantor-signature', contractId, guarantor.customerId] });
      setCacheBust(n => n + 1);
    } catch {} finally { setUploading(''); }
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${isComplete ? 'border-success/30' : 'border-warning/30'}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer bg-surface-hover/50 hover:bg-surface-hover transition-colors" onClick={onToggle}>
        {expanded ? <ChevronDown size={14} className="text-subtle shrink-0" /> : <ChevronRight size={14} className="text-subtle shrink-0" />}
        {isComplete
          ? <CheckCircle size={14} className="text-success shrink-0" />
          : <AlertTriangle size={14} className="text-warning shrink-0" />
        }
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{guarantor.fullName}</div>
          {guarantor.idNumber && <div className="text-xs text-subtle">{guarantor.idNumber}</div>}
        </div>
        {confirmRemove ? (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <button className="px-2 py-1 rounded text-xs font-medium bg-danger text-white hover:bg-danger/80 cursor-pointer border-none"
              onClick={() => { setConfirmRemove(false); onRemove(); }} disabled={removing}>
              {removing ? <Loader2 size={12} className="animate-spin" /> : t('common.confirm')}
            </button>
            <button className="px-2 py-1 rounded text-xs text-subtle hover:text-fg cursor-pointer bg-transparent border-none"
              onClick={() => setConfirmRemove(false)}>{t('common.cancel')}</button>
          </div>
        ) : (
          <button className="p-1.5 rounded hover:bg-danger/10 cursor-pointer text-control-label hover:text-danger transition-colors bg-transparent border-none"
            onClick={(e) => { e.stopPropagation(); setConfirmRemove(true); }} title={t('common.remove')}>
            <Trash2 size={14} />
          </button>
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
                      <Select options={ID_TYPE_OPTIONS} value={custInfo?.id_type ?? 'CITIZEN_ID'} onChange={() => {}} size="sm" disabled />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <label className="form-label">{t('wizard.idNumber')}</label>
                      <Input size="sm" value={custInfo?.id_number ?? ''} disabled className="w-full" />
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
                      <InputDatePicker value={editDob ? new Date(editDob + 'T00:00:00') : null} onChange={(date) => setEditDob(date ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` : '')} size="sm" endIcon={<Calendar size={16} />} calendar="gregorian" locale={i18n.language} />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <label className="form-label">{t('wizard.tel')}</label>
                      <MaskedInput dynamicMask={thaiPhoneMask} value={editTel} onChange={(raw) => setEditTel(raw)} placeholder="0X-XXX-XXXX" size="sm" className="w-full" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    color={infoSaved ? 'success' : 'primary'}
                    onClick={handleInfoSave}
                    disabled={infoSaving || !editFirstName.trim() || !editLastName.trim() || !editDob}
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
                <AddressFormPostal customerId={guarantor.customerId} addressType="HOME" existing={homeAddress} onSuccess={() => refetchAddresses()} />
              </div>
            )}
          </div>

          {/* Work Address */}
          <div className="px-3">
            <SectionHeader label={t('workspace.addressWork')} done={!!workAddress} expanded={openSection === 'work'} onToggle={() => toggle('work')} />
            {openSection === 'work' && (
              <div className="pt-2 pb-4">
                <AddressFormPostal customerId={guarantor.customerId} addressType="WORK" existing={workAddress} onSuccess={() => refetchAddresses()} />
              </div>
            )}
          </div>

          {/* ID Card */}
          <div className="px-3">
            <SectionHeader label={t('workspace.docIdPhoto')} done={!!idCard} expanded={openSection === 'idcard'} onToggle={() => toggle('idcard')} />
            {openSection === 'idcard' && (
              <div className="pt-2 pb-4">
                <SingleUpload icon={<CreditCard size={14} />} label={t('workspace.docIdPhoto')} fileUrl={idCard?.file_url ?? null} uploading={uploading === 'ID_CARD'} onUpload={uploadIdCard} cacheBust={cacheBust} />
              </div>
            )}
          </div>

          {/* Signature */}
          <div className="px-3">
            <SectionHeader label={t('workspace.docSignature')} done={!!signature} expanded={openSection === 'signature'} onToggle={() => toggle('signature')} />
            {openSection === 'signature' && (
              <div className="pt-2 pb-4">
                <SingleUpload icon={<PenLine size={14} />} label={t('workspace.docSignature')} fileUrl={signature?.file_url ?? null} uploading={uploading === 'SIGNATURE'} onUpload={uploadSignature} disabled={!contractId} cacheBust={cacheBust} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
