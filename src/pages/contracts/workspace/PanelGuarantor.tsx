import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input, Select, Button, InputDatePicker, Checkbox } from 'tsp-form';
import { ShieldAlert, CheckCircle, XCircle, Calendar, Search, Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useWorkspace } from './WorkspaceContext';
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

export function PanelGuarantor({ onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { data: workspace, updateData } = useWorkspace();

  const [idType, setIdType] = useState<'CITIZEN_ID' | 'PASSPORT'>('CITIZEN_ID');
  const [idNumber, setIdNumber] = useState('');
  const [prefix, setPrefix] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [tel, setTel] = useState('');

  const [selectedGuarantor, setSelectedGuarantor] = useState<SearchResult | null>(null);
  const prefilledRef = useRef(false);

  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');
  const [result, setResult] = useState<CustomerRegisterResult | null>(workspace.guarantorResult);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [useDifferentWorkAddress, setUseDifferentWorkAddress] = useState(false);
  const guarantorId = workspace.guarantorId;

  const { data: addresses = [], refetch: refetchAddresses } = useQuery({
    queryKey: ['guarantor-addresses', guarantorId],
    queryFn: () => apiClient.get<CustomerAddress[]>(`/v_customer_addresses?customer_id=eq.${guarantorId}&order=address_type`),
    enabled: !!guarantorId,
  });
  const currentAddress = addresses.find(a => a.address_type === 'CURRENT');
  const workAddress = addresses.find(a => a.address_type === 'WORK');

  // Pre-fill when continuing draft with existing guarantor
  useEffect(() => {
    if (prefilledRef.current || !guarantorId || idNumber) return;
    prefilledRef.current = true;
    apiClient.get<SearchResult[]>(`/v_customers?id=eq.${guarantorId}`)
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
        setSelectedGuarantor(c);
      })
      .catch(() => {});
  }, [guarantorId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = async () => {
    setSearching(true); setHasSearched(true);
    try {
      const params: string[] = ['is_active=is.true', 'order=full_name', 'limit=10'];
      const orParts: string[] = [];
      if (idNumber.trim()) orParts.push(`id_number.ilike.*${encodeURIComponent(idNumber.trim())}*`);
      if (firstName.trim()) orParts.push(`first_name.ilike.*${encodeURIComponent(firstName.trim())}*`);
      if (lastName.trim()) orParts.push(`last_name.ilike.*${encodeURIComponent(lastName.trim())}*`);
      if (orParts.length > 0) params.push(`or=(${orParts.join(',')})`);
      setSearchResults(await apiClient.get<SearchResult[]>(`/v_customers?${params.join('&')}`));
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  };

  const handleSelectGuarantor = (c: SearchResult) => {
    setSelectedGuarantor(c);
    setIdType(c.id_type as 'CITIZEN_ID' | 'PASSPORT');
    setIdNumber(c.id_number);
    setPrefix(c.prefix ?? '');
    setFirstName(c.first_name);
    setLastName(c.last_name);
    setDateOfBirth(c.date_of_birth ?? '');
    setTel(c.tel ?? '');
    setApiError(''); setResult(null);
  };

  const handleUseOrRegister = async () => {
    setApiError('');
    if (selectedGuarantor) {
      // Use existing — just attach
      doAttach(selectedGuarantor.id, selectedGuarantor.full_name);
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
      if (res.action !== 'BLOCK') {
        setResult(res);
        updateData({ guarantorId: res.customer_id, guarantorResult: res, guarantorSkipped: false });
        if (workspace.contractId) {
          try {
            await apiClient.rpc('fn_contract_add_guarantor', { p_contract_id: workspace.contractId, p_customer_id: res.customer_id, p_relation: null });
          } catch (attachErr) {
            if (attachErr instanceof ApiError) {
              const tr = (attachErr.messageKey ? t(attachErr.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (attachErr.code ? t(attachErr.code, { ns: 'apiErrors', defaultValue: '' }) : '');
              setApiError(tr || attachErr.code || attachErr.message);
            }
          }
        }
      } else {
        setResult(res);
      }
    } catch (err) {
      if (err instanceof ApiError) { const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : ''); setApiError(tr || err.code || err.message); }
      else setApiError(String(err));
    } finally { setSubmitting(false); }
  };

  const doAttach = async (custId: number, custName: string) => {
    const res: CustomerRegisterResult = { customer_id: custId, is_new: false, id_type: idType, id_number: idNumber, full_name: custName, is_blacklisted: false, blacklist_reasons: [], has_overdue: false, overdue_contract_count: 0, active_contract_count: 0, action: 'OK' };
    updateData({ guarantorId: custId, guarantorResult: res, guarantorSkipped: false });
    setResult(res);
    if (workspace.contractId) {
      try {
        await apiClient.rpc('fn_contract_add_guarantor', { p_contract_id: workspace.contractId, p_customer_id: custId, p_relation: null });
      } catch (err) {
        if (err instanceof ApiError) {
          const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
          setApiError(tr || err.code || err.message);
        }
      }
    }
  };

  const handleAddressSuccess = (type: 'CURRENT' | 'WORK') => { refetchAddresses(); };

  const canSearch = !!(idNumber.trim() || firstName.trim() || lastName.trim());
  const isExisting = !!selectedGuarantor;
  const buttonLabel = isExisting ? t('workspace.useThisCustomer') : t('wizard.registerCustomer');

  return (
    <div className="p-4 flex flex-col gap-5 max-w-2xl">
      {apiError && <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{apiError}</div></div></div>}
      {result && (result.action === 'BLOCK'
        ? <div className="alert alert-danger"><ShieldAlert size={18} /><div><div className="alert-title">{t('wizard.blacklisted')}</div></div></div>
        : <div className="alert alert-success"><CheckCircle size={18} /><div><div className="alert-title">{result.is_new ? t('wizard.customerCreated') : t('wizard.customerUpdated')}</div></div></div>
      )}

      <div className="form-grid gap-4">
        <div className="flex gap-3">
          <div className="flex flex-col" style={{ width: '10rem' }}>
            <label className="form-label">{t('wizard.idType')}</label>
            <Select options={ID_TYPE_OPTIONS} value={idType} onChange={(val) => setIdType((val as string) as 'CITIZEN_ID' | 'PASSPORT')} size="sm" disabled={!!selectedGuarantor} />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{t('wizard.idNumber')}</label>
            <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} size="sm" className="w-full" disabled={!!selectedGuarantor} />
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
        <Button variant="outline" onClick={handleSearch} disabled={searching || !canSearch} startIcon={searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}>
          {t('workspace.checkCustomer')}
        </Button>
        <Button color={isExisting ? 'primary' : undefined} variant={isExisting ? undefined : 'outline'} onClick={handleUseOrRegister} disabled={submitting || !idNumber.trim() || !firstName.trim() || !lastName.trim() || !tel.trim()} startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : undefined}>
          {submitting ? t('common.saving') : buttonLabel}
        </Button>
      </div>

      {hasSearched && (
        <div className="flex flex-col gap-1">
          {searchResults.length > 0 ? (
            <div className="border border-line rounded-lg divide-y divide-line overflow-hidden max-h-48 overflow-y-auto better-scroll">
              {searchResults.map(c => (
                <button key={c.id} className={`w-full text-left px-4 py-2.5 hover:bg-surface-hover transition-colors cursor-pointer flex items-center justify-between ${selectedGuarantor?.id === c.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`} onClick={() => handleSelectGuarantor(c)}>
                  <div>
                    <div className="font-medium text-sm">{c.full_name}</div>
                    <div className="text-xs text-subtle">{c.id_type}: {c.id_number} {c.tel ? `· ${c.tel}` : ''}</div>
                  </div>
                  {selectedGuarantor?.id === c.id && <CheckCircle size={14} className="text-primary" />}
                </button>
              ))}
            </div>
          ) : !searching ? (
            <div className="text-sm text-subtle text-center py-2">{t('workspace.noCustomerFound')}</div>
          ) : null}
        </div>
      )}

      {/* Address — disabled until guarantor attached */}
      {guarantorId && (
        <>
          <div className="border-t border-line pt-4" />
          <div className="font-medium text-sm mb-3">{t('workspace.addressCurrent')}</div>
          <AddressFormPostal customerId={guarantorId} addressType="CURRENT" existing={currentAddress} onSuccess={() => handleAddressSuccess('CURRENT')} />

          <div className="mt-4 mb-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={useDifferentWorkAddress} onChange={(e) => setUseDifferentWorkAddress((e.target as HTMLInputElement).checked)} />
              {t('workspace.useDifferentWorkAddress')}
            </label>
          </div>

          {useDifferentWorkAddress && (
            <>
              <div className="font-medium text-sm mb-3">{t('workspace.addressWork')}</div>
              <AddressFormPostal customerId={guarantorId} addressType="WORK" existing={workAddress} onSuccess={() => handleAddressSuccess('WORK')} />
            </>
          )}
        </>
      )}
    </div>
  );
}
