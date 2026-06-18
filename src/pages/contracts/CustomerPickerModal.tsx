import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Input, Select, MaskedInput, InputDatePicker } from 'tsp-form';
import { Search, Loader2, CheckCircle, XCircle, Keyboard } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { passesThaiCidChecksum } from '../../lib/ocr/extractIdCard';
import { toLocalDateStr, parseLocalDate, makeDatePickerFormat } from '../../lib/format';

const ID_TYPE_OPTIONS = [
  { value: 'CITIZEN_ID', label: 'Citizen ID' },
  { value: 'PASSPORT', label: 'Passport' },
];
const PREFIX_OPTIONS = [
  { value: '', label: '-' },
  { value: 'นาย', label: 'นาย' }, { value: 'นาง', label: 'นาง' }, { value: 'นางสาว', label: 'นางสาว' },
  { value: 'Mr.', label: 'Mr.' }, { value: 'Mrs.', label: 'Mrs.' }, { value: 'Ms.', label: 'Ms.' },
];

const thaiPhoneMask = (digits: string) => {
  if (digits.startsWith('02')) return '##-###-####';
  const prefix = digits.slice(0, 2);
  if (['03', '04', '05', '07'].includes(prefix)) return '###-###-###';
  return '###-###-####';
};

interface SearchResult {
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

interface CustomerRegisterResult {
  customer_id: number;
  full_name: string;
  id_number: string;
  action: 'CREATED' | 'UPDATED' | 'BLOCK';
}

interface Props {
  open: boolean;
  title: string;
  /** Customer IDs that should not be selectable (already attached). */
  excludeCustomerIds?: number[];
  onClose: () => void;
  onPick: (customerId: number, fullName: string) => Promise<void> | void;
}

export function CustomerPickerModal({ open, title, excludeCustomerIds = [], onClose, onPick }: Props) {
  const { t, i18n } = useTranslation();

  const [idType, setIdType] = useState<'CITIZEN_ID' | 'PASSPORT'>('CITIZEN_ID');
  const [idNumber, setIdNumber] = useState('');
  const [prefix, setPrefix] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [tel, setTel] = useState('');
  const [tel2, setTel2] = useState('');
  const [isTypingDob, setIsTypingDob] = useState(false);

  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setIdType('CITIZEN_ID'); setIdNumber(''); setPrefix(''); setFirstName('');
    setLastName(''); setDateOfBirth(''); setTel(''); setTel2('');
    setSelected(null); setResults([]); setHasSearched(false);
    setSubmitting(false); setError('');
  }, [open]);

  const canSearch = !!(idNumber.trim() || firstName.trim() || lastName.trim());
  const isExisting = !!selected;
  // CITIZEN_ID must pass the Thai 13-digit checksum before we register — the
  // backend rejects it as CORE.VALIDATION.INVALID_CITIZEN_ID otherwise.
  const cidDigits = idNumber.replace(/\D/g, '');
  const cidValid = !!selected || idType !== 'CITIZEN_ID' || passesThaiCidChecksum(cidDigits);
  const canRegisterAndPick = !!idNumber.trim() && !!firstName.trim() && !!lastName.trim() && !!tel.trim() && !!dateOfBirth && cidValid;

  const handleSearch = async () => {
    setSearching(true); setHasSearched(true); setError('');
    try {
      const params: string[] = ['is_active=is.true', 'order=full_name', 'limit=10'];
      const orParts: string[] = [];
      if (idNumber.trim()) orParts.push(`id_number.ilike.*${encodeURIComponent(idNumber.trim())}*`);
      if (firstName.trim()) orParts.push(`first_name.ilike.*${encodeURIComponent(firstName.trim())}*`);
      if (lastName.trim()) orParts.push(`last_name.ilike.*${encodeURIComponent(lastName.trim())}*`);
      if (orParts.length > 0) params.push(`or=(${orParts.join(',')})`);
      const data = await apiClient.get<SearchResult[]>(`/v_customers?${params.join('&')}`);
      setResults(data.filter(c => !excludeCustomerIds.includes(c.id)));
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const handleSelectExisting = (c: SearchResult) => {
    setSelected(c);
    setIdType(c.id_type as 'CITIZEN_ID' | 'PASSPORT');
    setIdNumber(c.id_number);
    setPrefix(c.prefix ?? '');
    setFirstName(c.first_name);
    setLastName(c.last_name);
    setDateOfBirth(c.date_of_birth ?? '');
    setTel(c.tel ?? '');
    setTel2(c.tel2 ?? '');
    setError('');
  };

  const submitWithCustomer = async (customerId: number, fullName: string) => {
    setSubmitting(true); setError('');
    try {
      await onPick(customerId, fullName);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.code || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async () => {
    if (selected) {
      await submitWithCustomer(selected.id, selected.full_name);
      return;
    }
    if (idType === 'CITIZEN_ID' && !passesThaiCidChecksum(cidDigits)) {
      setError(cidDigits.length !== 13
        ? t('workspace.citizenIdLength', { defaultValue: 'Citizen ID must be 13 digits' })
        : t('workspace.citizenIdInvalid', { defaultValue: 'Invalid citizen ID — checksum does not match' }));
      return;
    }
    if (!canRegisterAndPick) return;
    setSubmitting(true); setError('');
    try {
      const res = await apiClient.rpc<CustomerRegisterResult>('fn_customer_register_or_update', {
        p_id_type: idType,
        p_id_number: idNumber.trim(),
        p_prefix: prefix || null,
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_date_of_birth: dateOfBirth || null,
        p_tel: tel.trim(),
        p_tel2: tel2.trim() || null,
      });
      if (res.action === 'BLOCK') {
        setError(t('wizard.blacklisted', { defaultValue: 'Customer is blacklisted' }));
        setSubmitting(false);
        return;
      }
      await submitWithCustomer(res.customer_id, res.full_name);
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.code || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="36rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-3">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-grid">
            <div className="flex gap-3">
              <div className="flex flex-col" style={{ width: '10rem' }}>
                <label className="form-label">{t('wizard.idType')}</label>
                <Select
                  options={ID_TYPE_OPTIONS}
                  value={idType}
                  onChange={(val) => setIdType(val as 'CITIZEN_ID' | 'PASSPORT')}
                  size="sm"
                  disabled={!!selected}
                />
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
                    disabled={!!selected}
                    endIcon={
                      selected || cidDigits.length !== 13 ? undefined
                        : passesThaiCidChecksum(cidDigits) ? <CheckCircle size={14} className="text-success" />
                        : <XCircle size={14} className="text-warning-fg" />
                    }
                  />
                ) : (
                  <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} size="sm" className="w-full" disabled={!!selected} />
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col" style={{ width: '7rem' }}>
                <label className="form-label">{t('wizard.prefix')}</label>
                <Select options={PREFIX_OPTIONS} value={prefix} onChange={(v) => setPrefix(v as string)} size="sm" clearable />
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
                <InputDatePicker
                  value={parseLocalDate(dateOfBirth)}
                  onChange={(d) => setDateOfBirth(toLocalDateStr(d))}
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
            <div className="flex gap-3">
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('wizard.tel2', { defaultValue: 'Phone 2 (optional)' })}</label>
                <MaskedInput dynamicMask={thaiPhoneMask} value={tel2} onChange={(raw) => setTel2(raw)} size="sm" className="w-full" />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <Button
              variant="outline"
              onClick={handleSearch}
              disabled={searching || !canSearch}
              startIcon={searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            >
              {t('workspace.checkCustomer', { defaultValue: 'Search' })}
            </Button>
          </div>

          {hasSearched && (
            <div className="mt-3">
              {results.length > 0 ? (
                <div className="border border-line rounded-lg divide-y divide-line overflow-hidden max-h-48 overflow-y-auto better-scroll">
                  {results.map(c => (
                    <button
                      key={c.id}
                      className={`w-full text-left px-4 py-2.5 hover:bg-surface-hover transition-colors cursor-pointer flex items-center justify-between bg-transparent border-none ${
                        selected?.id === c.id ? 'bg-primary-soft border-l-2 border-l-primary' : ''
                      }`}
                      onClick={() => handleSelectExisting(c)}
                    >
                      <div>
                        <div className="font-medium text-sm">{c.full_name}</div>
                        <div className="text-xs text-subtle">{c.id_type}: {c.id_number} {c.tel ? `· ${c.tel}` : ''}</div>
                      </div>
                      {selected?.id === c.id && <CheckCircle size={14} className="text-primary-fg" />}
                    </button>
                  ))}
                </div>
              ) : !searching ? (
                <div className="text-sm text-subtle text-center py-2">
                  {t('workspace.noCustomerFound', { defaultValue: 'No customer found — fill the form to register a new one' })}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={handleConfirm}
            disabled={submitting || (!isExisting && !canRegisterAndPick)}
            startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : undefined}
          >
            {submitting
              ? t('common.saving')
              : isExisting
                ? t('workspace.useThisCustomer', { defaultValue: 'Use this customer' })
                : t('wizard.registerCustomer', { defaultValue: 'Register & use' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
