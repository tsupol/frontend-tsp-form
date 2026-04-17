import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { Input, Select, Button, FormErrorMessage, useSnackbarContext } from 'tsp-form';
import { XCircle, CheckCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import type { PostalLookup, CustomerAddress } from './WorkspaceTypes';

interface Props {
  customerId: number;
  addressType: 'HOME' | 'WORK' | 'SHIPPING';
  existing?: CustomerAddress;
  onSuccess: () => void;
}

export function AddressFormPostal({ customerId, addressType, existing, onSuccess }: Props) {
  const { t } = useTranslation();

  const isShipping = addressType === 'SHIPPING';

  const { register, handleSubmit, formState: { errors, isDirty }, watch, setValue, reset } = useForm({
    defaultValues: {
      address_line1: existing?.address_line1 ?? '',
      address_line2: existing?.address_line2 ?? '',
      soi: existing?.soi ?? '',
      road: existing?.road ?? '',
      postal_code: existing?.postal_code ?? '',
      sub_district: existing?.sub_district ?? '',
      district: existing?.district ?? '',
      province: existing?.province ?? '',
      recipient_name: existing?.recipient_name ?? '',
      recipient_tel: existing?.recipient_tel ?? '',
      note: existing?.note ?? '',
    },
  });

  // Sync form when existing data arrives after mount (async query)
  const loadedId = useRef<number | undefined>(existing?.id);
  useEffect(() => {
    if (existing && existing.id !== loadedId.current) {
      loadedId.current = existing.id;
      reset({
        address_line1: existing.address_line1 ?? '',
        address_line2: existing.address_line2 ?? '',
        soi: existing.soi ?? '',
        road: existing.road ?? '',
        postal_code: existing.postal_code ?? '',
        sub_district: existing.sub_district ?? '',
        district: existing.district ?? '',
        province: existing.province ?? '',
        recipient_name: existing.recipient_name ?? '',
        recipient_tel: existing.recipient_tel ?? '',
        note: existing.note ?? '',
      });
    }
  }, [existing, reset]);

  register('sub_district', { required: t('common.required') });
  register('district', { required: t('common.required') });
  register('province', { required: t('common.required') });

  const { addSnackbar } = useSnackbarContext();
  const postalCode = watch('postal_code');
  const [postalResults, setPostalResults] = useState<PostalLookup[]>([]);
  const [apiError, setApiError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (postalCode.length === 5) {
      apiClient.get<PostalLookup[]>(`/v_postal_lookup?postal_code=eq.${postalCode}`)
        .then(setPostalResults)
        .catch(() => setPostalResults([]));
    } else {
      setPostalResults([]);
    }
  }, [postalCode]);

  const subDistrictOptions = useMemo(
    () => postalResults.map(p => ({ value: p.sub_district, label: p.sub_district })),
    [postalResults],
  );

  const handleSubDistrictSelect = (val: string | string[] | null) => {
    const sub = val as string;
    const match = postalResults.find(p => p.sub_district === sub);
    if (match) {
      setValue('sub_district', match.sub_district, { shouldDirty: true });
      setValue('district', match.district, { shouldDirty: true });
      setValue('province', match.province, { shouldDirty: true });
    }
  };

  const onSubmit = async (data: Record<string, string>) => {
    setSaving(true);
    setApiError('');
    try {
      await apiClient.rpc('fn_customer_address_upsert', {
        p_customer_id: customerId,
        p_address_type: addressType,
        p_address_line1: data.address_line1.trim(),
        p_address_line2: data.address_line2.trim() || null,
        p_soi: data.soi.trim() || null,
        p_road: data.road.trim() || null,
        p_sub_district: data.sub_district.trim(),
        p_district: data.district.trim(),
        p_province: data.province.trim(),
        p_postal_code: data.postal_code.trim(),
        p_recipient_name: isShipping ? (data.recipient_name.trim() || null) : null,
        p_recipient_tel: isShipping ? (data.recipient_tel.trim() || null) : null,
        p_note: data.note.trim() || null,
        p_id: existing?.id ?? null,
      });
      // Reset dirty state with saved values
      reset(data);
      // Button state
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Snackbar
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('customer.addressSaved')}</div></div>
          </div>
        ),
      });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setApiError(translated || err.message);
      } else setApiError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {apiError && <div className="alert alert-danger text-xs mb-3"><XCircle size={14} /><span>{apiError}</span></div>}
      <div className="form-grid">
        <div className="flex flex-col">
          <label className="form-label">{t('customer.addressLine1')} *</label>
          <Input size="sm" className="w-full" {...register('address_line1', { required: t('common.required') })} />
          <FormErrorMessage error={errors.address_line1} />
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('customer.addressLine2')}</label>
          <Input size="sm" className="w-full" {...register('address_line2')} />
        </div>
        <div className="flex gap-3">
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.soi')}</label>
            <Input size="sm" className="w-full" {...register('soi')} />
          </div>
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.road')}</label>
            <Input size="sm" className="w-full" {...register('road')} />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.postalCode')} *</label>
            <Input size="sm" className="w-full" maxLength={5} {...register('postal_code', { required: t('common.required') })} />
            <FormErrorMessage error={errors.postal_code} />
          </div>
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.subDistrict')} *</label>
            {postalResults.length > 0 ? (
              <Select
                size="sm"
                options={subDistrictOptions}
                value={watch('sub_district')}
                onChange={handleSubDistrictSelect}
                placeholder={t('customer.selectSubDistrict')}
                showChevron
              />
            ) : (
              <Input size="sm" className="w-full" value={watch('sub_district')} onChange={e => setValue('sub_district', e.target.value, { shouldValidate: true })} />
            )}
            <FormErrorMessage error={errors.sub_district} />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.district')} *</label>
            <Input size="sm" className="w-full" disabled={postalResults.length > 0} value={watch('district')} onChange={e => setValue('district', e.target.value, { shouldValidate: true })} />
            <FormErrorMessage error={errors.district} />
          </div>
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.province')} *</label>
            <Input size="sm" className="w-full" disabled={postalResults.length > 0} value={watch('province')} onChange={e => setValue('province', e.target.value, { shouldValidate: true })} />
            <FormErrorMessage error={errors.province} />
          </div>
        </div>
        {isShipping && (
          <>
            <div className="flex gap-3">
              <div className="flex flex-col flex-1">
                <label className="form-label">{t('customer.recipientName')}</label>
                <Input size="sm" className="w-full" {...register('recipient_name')} />
              </div>
              <div className="flex flex-col flex-1">
                <label className="form-label">{t('customer.recipientTel')}</label>
                <Input size="sm" className="w-full" {...register('recipient_tel')} />
              </div>
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('customer.note')}</label>
              <Input size="sm" className="w-full" {...register('note')} />
            </div>
          </>
        )}
      </div>
      <div className="flex justify-end">
        <Button
          color={saved ? 'success' : 'primary'}
          type="submit"
          disabled={saving || (!isDirty && !saved)}
          startIcon={saved ? <CheckCircle size={16} /> : undefined}
        >
          {saving ? t('common.loading') : saved ? t('common.saved') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}
