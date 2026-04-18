import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, TextArea, Select, Button, FormErrorMessage, InputDatePicker } from 'tsp-form';
import { AlertTriangle, ShieldAlert, CheckCircle, XCircle, Calendar } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { toLocalDateStr, parseLocalDate } from '../contractUtils';
import { MOCK_PROVINCES, getDistrictsByProvince, getSubdistrictsByDistrict } from './AddressMock';
import type { CustomerFormData, CustomerRegisterResult } from './WizardTypes';

// ⚠️ MOCK DATA — replace with real API (v_provinces/v_districts/v_subdistricts) when available

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

const emptyForm: CustomerFormData = {
  id_type: 'CITIZEN_ID',
  id_number: '',
  prefix: '',
  first_name: '',
  last_name: '',
  date_of_birth: '',
  tel: '',
  tel2: '',
  address: '',
  province_id: null,
  district_id: null,
  subdistrict_id: null,
  zip_code: '',
  google_map: '',
  facebook: '',
  line_id: '',
};

interface Props {
  title: string;
  onSubmit: (customerId: number, result: CustomerRegisterResult) => void;
  submitLabel?: string;
  loading?: boolean;
}

export function CustomerForm({ title, onSubmit, submitLabel, loading: externalLoading }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CustomerFormData>({ ...emptyForm });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');
  const [result, setResult] = useState<CustomerRegisterResult | null>(null);

  const set = <K extends keyof CustomerFormData>(key: K, value: CustomerFormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // ⚠️ MOCK DATA — replace with real API when available
  const provinceOptions = useMemo(() =>
    MOCK_PROVINCES.map(p => ({ value: String(p.id), label: `${p.name_th} (${p.name_en})` })),
    []
  );

  const districtOptions = useMemo(() => {
    if (!form.province_id) return [];
    return getDistrictsByProvince(form.province_id).map(d => ({
      value: String(d.id), label: `${d.name_th} (${d.name_en})`,
    }));
  }, [form.province_id]);

  const subdistrictOptions = useMemo(() => {
    if (!form.district_id) return [];
    return getSubdistrictsByDistrict(form.district_id).map(s => ({
      value: String(s.id), label: `${s.name_th} (${s.name_en})`,
    }));
  }, [form.district_id]);

  const handleProvinceChange = (val: string | string[] | null) => {
    const id = val ? Number(val) : null;
    setForm(prev => ({ ...prev, province_id: id, district_id: null, subdistrict_id: null, zip_code: '' }));
  };

  const handleDistrictChange = (val: string | string[] | null) => {
    const id = val ? Number(val) : null;
    setForm(prev => ({ ...prev, district_id: id, subdistrict_id: null, zip_code: '' }));
  };

  const handleSubdistrictChange = (val: string | string[] | null) => {
    const id = val ? Number(val) : null;
    // ⚠️ MOCK DATA — auto-fill zip code from mock
    const sub = id ? getSubdistrictsByDistrict(form.district_id!).find(s => s.id === id) : null;
    setForm(prev => ({ ...prev, subdistrict_id: id, zip_code: sub?.zip_code ?? '' }));
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.id_number.trim()) errs.id_number = t('common.required');
    if (!form.first_name.trim()) errs.first_name = t('common.required');
    if (!form.last_name.trim()) errs.last_name = t('common.required');
    if (!form.tel.trim()) errs.tel = t('common.required');
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setApiError('');
    setResult(null);

    try {
      const res = await apiClient.rpc<CustomerRegisterResult>('fn_customer_register_or_update', {
        p_id_type: form.id_type,
        p_id_number: form.id_number.trim(),
        p_prefix: form.prefix || null,
        p_first_name: form.first_name.trim(),
        p_last_name: form.last_name.trim(),
        p_date_of_birth: form.date_of_birth || null,
        p_tel: form.tel.trim(),
        p_tel2: form.tel2.trim() || null,
        p_address: form.address.trim() || null,
        p_province_id: form.province_id,
        p_district_id: form.district_id,
        p_subdistrict_id: form.subdistrict_id,
        p_zip_code: form.zip_code.trim() || null,
        p_google_map: form.google_map.trim() || null,
        p_facebook: form.facebook.trim() || null,
        p_line_id: form.line_id.trim() || null,
      });

      setResult(res);

      // If blocked (blacklisted), don't proceed
      if (res.action !== 'BLOCK') {
        onSubmit(res.customer_id, res);
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

  const isLoading = submitting || externalLoading;

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold">{title}</h2>

      {/* API Error */}
      {apiError && (
        <div className="alert alert-danger">
          <XCircle size={18} />
          <div><div className="alert-description">{apiError}</div></div>
        </div>
      )}

      {/* Result badges */}
      {result && (
        <ResultBanner result={result} t={t} />
      )}

      {/* Form fields */}
      <div className="form-grid gap-4">
        {/* ID Type + Number */}
        <div className="flex gap-3">
          <div className="flex flex-col" style={{ width: '10rem' }}>
            <label className="form-label">{t('wizard.idType')}</label>
            <Select
              options={ID_TYPE_OPTIONS}
              value={form.id_type}
              onChange={(val) => set('id_type', (val as string) as CustomerFormData['id_type'])}
              size="sm"
            />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{t('wizard.idNumber')}</label>
            <Input
              value={form.id_number}
              onChange={(e) => set('id_number', e.target.value)}
              placeholder={form.id_type === 'CITIZEN_ID' ? '1-xxxx-xxxxx-xx-x' : 'Passport number'}
              size="sm"
              className="w-full"
            />
            <FormErrorMessage error={errors.id_number ? { message: errors.id_number } : undefined} />
          </div>
        </div>

        {/* Prefix + First + Last */}
        <div className="flex gap-3">
          <div className="flex flex-col" style={{ width: '7rem' }}>
            <label className="form-label">{t('wizard.prefix')}</label>
            <Select
              options={PREFIX_OPTIONS}
              value={form.prefix}
              onChange={(val) => set('prefix', val as string)}
              size="sm"
              clearable
            />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{t('wizard.firstName')}</label>
            <Input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} size="sm" className="w-full" />
            <FormErrorMessage error={errors.first_name ? { message: errors.first_name } : undefined} />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{t('wizard.lastName')}</label>
            <Input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} size="sm" className="w-full" />
            <FormErrorMessage error={errors.last_name ? { message: errors.last_name } : undefined} />
          </div>
        </div>

        {/* Date of birth + Tel + Tel2 */}
        <div className="flex gap-3">
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{t('wizard.dateOfBirth')}</label>
            <InputDatePicker
              value={parseLocalDate(form.date_of_birth)}
              onChange={(date) => set('date_of_birth', toLocalDateStr(date))}
              size="sm"
              endIcon={<Calendar size={16} />}
              calendar="gregorian"
            />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{t('wizard.tel')}</label>
            <Input value={form.tel} onChange={(e) => set('tel', e.target.value)} placeholder="0xx-xxx-xxxx" size="sm" className="w-full" />
            <FormErrorMessage error={errors.tel ? { message: errors.tel } : undefined} />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{t('wizard.tel2')}</label>
            <Input value={form.tel2} onChange={(e) => set('tel2', e.target.value)} size="sm" className="w-full" />
          </div>
        </div>

        {/* Address */}
        <div className="flex flex-col">
          <label className="form-label">{t('wizard.address')}</label>
          <TextArea value={form.address} onChange={(e) => set('address', e.target.value)} size="sm" rows={2} className="w-full" />
        </div>

        {/* Province + District */}
        <div className="flex gap-3">
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{t('wizard.province')}</label>
            <Select
              options={provinceOptions}
              value={form.province_id ? String(form.province_id) : null}
              onChange={handleProvinceChange}
              placeholder={t('wizard.selectProvince')}
              size="sm"
              showChevron
              clearable
              searchable
            />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{t('wizard.district')}</label>
            <Select
              options={districtOptions}
              value={form.district_id ? String(form.district_id) : null}
              onChange={handleDistrictChange}
              placeholder={t('wizard.selectDistrict')}
              size="sm"
              showChevron
              clearable
              searchable
              disabled={!form.province_id}
            />
          </div>
        </div>

        {/* Subdistrict + Zip */}
        <div className="flex gap-3">
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{t('wizard.subdistrict')}</label>
            <Select
              options={subdistrictOptions}
              value={form.subdistrict_id ? String(form.subdistrict_id) : null}
              onChange={handleSubdistrictChange}
              placeholder={t('wizard.selectSubdistrict')}
              size="sm"
              showChevron
              clearable
              searchable
              disabled={!form.district_id}
            />
          </div>
          <div className="flex flex-col" style={{ width: '8rem' }}>
            <label className="form-label">{t('wizard.zipCode')}</label>
            <Input value={form.zip_code} onChange={(e) => set('zip_code', e.target.value)} size="sm" className="w-full" />
          </div>
        </div>

        {/* Social / map */}
        <div className="flex gap-3">
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">Facebook</label>
            <Input value={form.facebook} onChange={(e) => set('facebook', e.target.value)} size="sm" className="w-full" />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">LINE ID</label>
            <Input value={form.line_id} onChange={(e) => set('line_id', e.target.value)} size="sm" className="w-full" />
          </div>
        </div>

        <div className="flex flex-col">
          <label className="form-label">Google Map</label>
          <Input value={form.google_map} onChange={(e) => set('google_map', e.target.value)} placeholder="https://maps.google.com/..." size="sm" className="w-full" />
        </div>
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <Button color="primary" onClick={handleSubmit} disabled={isLoading}>
          {isLoading ? t('common.saving') : (submitLabel ?? t('wizard.registerCustomer'))}
        </Button>
      </div>
    </div>
  );
}

// ── Result Banner ─────────────────────────────────────────────────────────

function ResultBanner({ result, t }: { result: CustomerRegisterResult; t: (key: string, opts?: Record<string, unknown>) => string }) {
  if (result.action === 'BLOCK') {
    const reason = result.blacklist_reasons?.[0]?.reason;
    return (
      <div className="alert alert-danger">
        <ShieldAlert size={18} />
        <div>
          <div className="alert-title">{t('wizard.blacklisted')}</div>
          <div className="alert-description">
            {reason ?? t('wizard.blacklistedDesc')}
          </div>
        </div>
      </div>
    );
  }

  if (result.action === 'WARNING') {
    return (
      <div className="alert alert-warning">
        <AlertTriangle size={18} />
        <div>
          <div className="alert-title">{t('wizard.customerWarning')}</div>
          <div className="alert-description">
            {t('wizard.overdueContracts', { count: result.overdue_contract_count })}
            {result.active_contract_count > 0 && ` · ${t('wizard.activeContracts', { count: result.active_contract_count })}`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="alert alert-success">
      <CheckCircle size={18} />
      <div>
        <div className="alert-title">
          {result.is_new ? t('wizard.customerCreated') : t('wizard.customerUpdated')}
        </div>
        {result.active_contract_count > 0 && (
          <div className="alert-description">
            {t('wizard.activeContracts', { count: result.active_contract_count })}
          </div>
        )}
      </div>
    </div>
  );
}
