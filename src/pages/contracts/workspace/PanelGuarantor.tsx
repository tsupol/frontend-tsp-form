import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input, Select, Button, InputDatePicker, Checkbox } from 'tsp-form';
import { ShieldAlert, CheckCircle, XCircle, Calendar, Search, Loader2, Trash2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useWorkspace } from './WorkspaceContext';
import { PanelSection } from './PanelSection';
import { AddressFormPostal } from './AddressFormPostal';
import type { CustomerRegisterResult, CustomerAddress } from './WorkspaceTypes';

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

export function PanelGuarantor({ onClose }: Props) { // eslint-disable-line @typescript-eslint/no-unused-vars
  const { t, i18n } = useTranslation();
  const { data: workspace, updateData } = useWorkspace();

  // ── Existing guarantors list ────────────────────────────────────────────
  const [removing, setRemoving] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [expandedGuarantor, setExpandedGuarantor] = useState<number | null>(null);

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
    // Cannot add self as guarantor
    if (custId === workspace.customerId) {
      setApiError(t('workspace.guarantorCannotBeSelf'));
      return;
    }
    // Check not already attached
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
    // Register new
    if (idType === 'CITIZEN_ID' && idNumber.replace(/\D/g, '').length !== 13) {
      setApiError(t('workspace.citizenIdLength')); return;
    }
    if (!idNumber.trim() || !firstName.trim() || !lastName.trim() || !tel.trim()) return;
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
        {workspace.guarantors.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {workspace.guarantors.map(g => (
              <GuarantorRow
                key={g.customerId}
                guarantor={g}
                expanded={expandedGuarantor === g.customerId}
                onToggle={() => setExpandedGuarantor(expandedGuarantor === g.customerId ? null : g.customerId)}
                onRemove={() => handleRemove(g.customerId)}
                removing={removing === g.customerId}
              />
            ))}
          </div>
        )}

        <div className="p-3 rounded-md border border-dashed border-line">
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
                <label className="form-label">{t('wizard.dateOfBirth')}</label>
                <InputDatePicker value={dateOfBirth ? new Date(dateOfBirth + 'T00:00:00') : null} onChange={(date) => setDateOfBirth(date ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` : '')} size="sm" endIcon={<Calendar size={16} />} calendar="gregorian" locale={i18n.language} />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('wizard.tel')}</label>
                <Input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="0xx-xxx-xxxx" size="sm" className="w-full" />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleSearch} disabled={searching || !canSearch} startIcon={searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}>
              {t('workspace.checkCustomer')}
            </Button>
            <Button color={isExisting ? 'primary' : undefined} variant={isExisting ? undefined : 'outline'} size="sm" onClick={handleUseOrRegister} disabled={submitting || !idNumber.trim() || !firstName.trim() || !lastName.trim() || !tel.trim()} startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : undefined}>
              {submitting ? t('common.saving') : buttonLabel}
            </Button>
          </div>

          {hasSearched && (
            <div className="flex flex-col gap-1">
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
      </PanelSection>
    </div>
  );
}

// ── Guarantor row with expand for address ─────────────────────────────────

function GuarantorRow({ guarantor, expanded, onToggle, onRemove, removing }: {
  guarantor: { customerId: number; fullName: string; idNumber: string };
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const { t } = useTranslation();
  const [useDifferentWorkAddress, setUseDifferentWorkAddress] = useState(false);

  const { data: addresses = [], refetch: refetchAddresses } = useQuery({
    queryKey: ['guarantor-addresses', guarantor.customerId],
    queryFn: () => apiClient.get<CustomerAddress[]>(`/v_customer_addresses?customer_id=eq.${guarantor.customerId}&order=address_type`),
    enabled: expanded,
  });
  const currentAddress = addresses.find(a => a.address_type === 'CURRENT');
  const workAddress = addresses.find(a => a.address_type === 'WORK');

  return (
    <div className="border border-success/30 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer bg-transparent border-none text-current" onClick={onToggle}>
          <ShieldCheck size={14} className="text-success shrink-0" />
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{guarantor.fullName}</div>
            {guarantor.idNumber && <div className="text-xs text-subtle">{guarantor.idNumber}</div>}
          </div>
        </button>
        <button
          className="p-1.5 rounded hover:bg-danger/10 cursor-pointer text-control-label hover:text-danger transition-colors bg-transparent border-none"
          onClick={onRemove}
          disabled={removing}
          title={t('common.remove')}
        >
          {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-line p-3 flex flex-col gap-4">
          <div className="font-medium text-sm">{t('workspace.addressCurrent')}</div>
          <AddressFormPostal customerId={guarantor.customerId} addressType="CURRENT" existing={currentAddress} onSuccess={() => refetchAddresses()} />

          <div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={useDifferentWorkAddress} onChange={(e) => setUseDifferentWorkAddress((e.target as HTMLInputElement).checked)} />
              {t('workspace.useDifferentWorkAddress')}
            </label>
          </div>

          {useDifferentWorkAddress && (
            <>
              <div className="font-medium text-sm">{t('workspace.addressWork')}</div>
              <AddressFormPostal customerId={guarantor.customerId} addressType="WORK" existing={workAddress} onSuccess={() => refetchAddresses()} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
