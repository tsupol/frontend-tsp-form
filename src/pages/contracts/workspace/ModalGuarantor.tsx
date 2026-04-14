import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Input, Select, Button, InputDatePicker } from 'tsp-form';
import { ShieldAlert, CheckCircle, XCircle, Calendar } from 'lucide-react';
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
  { value: 'นาย', label: 'นาย' },
  { value: 'นาง', label: 'นาง' },
  { value: 'นางสาว', label: 'นางสาว' },
  { value: 'Mr.', label: 'Mr.' },
  { value: 'Mrs.', label: 'Mrs.' },
  { value: 'Ms.', label: 'Ms.' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ModalGuarantor({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { data: workspace, updateData } = useWorkspace();

  const [idType, setIdType] = useState<'CITIZEN_ID' | 'PASSPORT'>('CITIZEN_ID');
  const [idNumber, setIdNumber] = useState('');
  const [prefix, setPrefix] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [tel, setTel] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');
  const [result, setResult] = useState<CustomerRegisterResult | null>(null);

  const guarantorId = workspace.guarantors.length > 0 ? workspace.guarantors[0].customerId : null;

  const [showAddressCurrent, setShowAddressCurrent] = useState(false);
  const [showAddressWork, setShowAddressWork] = useState(false);

  const { data: addresses = [], refetch: refetchAddresses } = useQuery({
    queryKey: ['guarantor-addresses', guarantorId],
    queryFn: () => apiClient.get<CustomerAddress[]>(`/v_customer_addresses?customer_id=eq.${guarantorId}&order=address_type`),
    enabled: !!guarantorId,
  });

  const currentAddress = addresses.find(a => a.address_type === 'CURRENT');
  const workAddress = addresses.find(a => a.address_type === 'WORK');

  const handleRegister = async () => {
    if (!idNumber.trim() || !firstName.trim() || !lastName.trim() || !tel.trim()) return;
    setSubmitting(true);
    setApiError('');

    try {
      const res = await apiClient.rpc<CustomerRegisterResult>('fn_customer_register_or_update', {
        p_id_type: idType,
        p_id_number: idNumber.trim(),
        p_prefix: prefix || null,
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_date_of_birth: dateOfBirth || null,
        p_tel: tel.trim(),
      });

      setResult(res);

      if (res.action !== 'BLOCK') {
        updateData({
          guarantors: [...workspace.guarantors, { customerId: res.customer_id, fullName: res.full_name, idNumber: res.id_number }],
          guarantorSkipped: false,
        });

        // Attach guarantor to contract if draft exists
        if (workspace.contractId) {
          await apiClient.rpc('fn_contract_add_guarantor', {
            p_contract_id: workspace.contractId,
            p_customer_id: res.customer_id,
          }).catch(() => {});
        }
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setApiError(translated || err.message);
      } else {
        setApiError(String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="40rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('workspace.cardGuarantor')}</h2>
      </div>
      <div className="modal-content" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        <div className="flex flex-col gap-5">
          {apiError && (
            <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{apiError}</div></div></div>
          )}

          {result && (
            result.action === 'BLOCK' ? (
              <div className="alert alert-danger">
                <ShieldAlert size={18} />
                <div>
                  <div className="alert-title">{t('wizard.blacklisted')}</div>
                  <div className="alert-description">{result.blacklist_reasons?.[0]?.reason ?? t('wizard.blacklistedDesc')}</div>
                </div>
              </div>
            ) : (
              <div className="alert alert-success">
                <CheckCircle size={18} />
                <div><div className="alert-title">{result.is_new ? t('wizard.customerCreated') : t('wizard.customerUpdated')}</div></div>
              </div>
            )
          )}

          <div className="form-grid gap-4">
            <div className="flex gap-3">
              <div className="flex flex-col" style={{ width: '10rem' }}>
                <label className="form-label">{t('wizard.idType')}</label>
                <Select options={ID_TYPE_OPTIONS} value={idType} onChange={(val) => setIdType((val as string) as 'CITIZEN_ID' | 'PASSPORT')} size="sm" />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('wizard.idNumber')}</label>
                <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} size="sm" className="w-full" />
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
                <InputDatePicker
                  value={dateOfBirth ? new Date(dateOfBirth) : null}
                  onChange={(date) => setDateOfBirth(date ? date.toISOString().slice(0, 10) : '')}
                  size="sm"
                  endIcon={<Calendar size={16} />}
                  calendar="gregorian"
                />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('wizard.tel')}</label>
                <Input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="0xx-xxx-xxxx" size="sm" className="w-full" />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button color="primary" onClick={handleRegister} disabled={submitting || !idNumber.trim() || !firstName.trim() || !lastName.trim() || !tel.trim()}>
              {submitting ? t('common.saving') : t('wizard.registerCustomer')}
            </Button>
          </div>

          {/* Address sections for guarantor */}
          {guarantorId && (
            <>
              <div className="border-t border-line" />
              <div className="text-xs text-subtle">{t('workspace.guarantorAddresses')}</div>

              <button
                className="w-full text-left border border-line rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 hover:bg-surface-hover cursor-pointer"
                onClick={() => setShowAddressCurrent(!showAddressCurrent)}
              >
                {currentAddress ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
                <span className="flex-1">{t('workspace.addressCurrent')}</span>
              </button>
              {showAddressCurrent && (
                <AddressFormPostal customerId={guarantorId} addressType="CURRENT" existing={currentAddress} onSuccess={() => { refetchAddresses(); setShowAddressCurrent(false); }} />
              )}

              <button
                className="w-full text-left border border-line rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 hover:bg-surface-hover cursor-pointer"
                onClick={() => setShowAddressWork(!showAddressWork)}
              >
                {workAddress ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
                <span className="flex-1">{t('workspace.addressWork')}</span>
              </button>
              {showAddressWork && (
                <AddressFormPostal customerId={guarantorId} addressType="WORK" existing={workAddress} onSuccess={() => { refetchAddresses(); setShowAddressWork(false); }} />
              )}
            </>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
