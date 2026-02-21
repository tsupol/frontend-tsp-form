import { useState, useEffect, useCallback } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Input, Button, FormErrorMessage, RadioGroup } from 'tsp-form';
import { Check } from 'lucide-react';
import { validateIMEI, validateiPhoneSerial, formatIMEI } from '../../lib/validators';
import { useRegister } from './RegisterLayout';
import { AutocompleteInput, type AutocompleteSuggestion } from '../../components/AutocompleteInput';
import { mockSearchImei } from '../../mocks/imeiSearch';

interface DeviceFormData {
  imei: string;
  serial: string;
}

export function Step1DeviceInfo() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, updateData } = useRegister();

  const [deviceType, setDeviceType] = useState<'with-sim' | 'without-sim'>(data.deviceType);
  const [formattedImei, setFormattedImei] = useState<string>(data.imei ? formatIMEI(data.imei) : '');
  const [imeiValid, setImeiValid] = useState(false);
  const [serialValid, setSerialValid] = useState(false);

  const hasSim = deviceType === 'with-sim';

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    setValue,
    trigger,
    clearErrors,
  } = useForm<DeviceFormData>({
    defaultValues: { imei: data.imei, serial: data.serial },
    mode: 'onBlur',
  });

  // Clear IMEI when switching to no-SIM mode
  useEffect(() => {
    if (!hasSim) {
      setValue('imei', '');
      setFormattedImei('');
      setImeiValid(false);
      clearErrors('imei');
    }
  }, [hasSim, setValue, clearErrors]);

  const handleImeiSearch = useCallback(async (query: string): Promise<AutocompleteSuggestion[]> => {
    const results = await mockSearchImei(query);
    return results.map((item) => ({
      value: item.imei,
      label: `${item.imei} - ${item.device}`,
    }));
  }, []);

  const validateImeiField = (value: string) => {
    if (!hasSim) return true;
    const result = validateIMEI(value);
    setImeiValid(result.valid);
    if (result.valid) {
      setFormattedImei(formatIMEI(value));
    } else {
      setFormattedImei('');
    }
    return result.valid || result.error;
  };

  const validateSerialField = (value: string) => {
    const result = validateiPhoneSerial(value);
    setSerialValid(result.valid);
    return result.valid || result.error;
  };

  const onSubmit = (formData: DeviceFormData) => {
    updateData({
      deviceType,
      imei: hasSim ? formData.imei.replace(/[\s-]/g, '') : '',
      serial: formData.serial.replace(/\s/g, '').toUpperCase(),
    });
    navigate('/admin/register/scan');
  };

  const deviceTypeOptions = [
    { value: 'with-sim' as const, label: t('register.withSim') },
    { value: 'without-sim' as const, label: t('register.withoutSim') },
  ];

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="form-grid gap-6">
      {/* Device Type Selection */}
      <div className="border border-line bg-surface p-6 rounded-lg">
        <h2 className="font-semibold mb-4">{t('register.deviceType')}</h2>
        <RadioGroup
          name="deviceType"
          value={deviceType}
          onChange={setDeviceType}
          options={deviceTypeOptions}
          className="flex gap-6"
        />
      </div>

      {/* IMEI Input */}
      <div className={`border border-line bg-surface p-6 rounded-lg ${!hasSim ? 'opacity-50' : ''}`}>
        <h2 className="font-semibold mb-4">{t('device.imei')}</h2>

        <div className="flex flex-col">
          <Controller
            name="imei"
            control={control}
            rules={{
              required: hasSim ? t('device.imeiRequired') : false,
              validate: validateImeiField,
            }}
            render={({ field }) => (
              <AutocompleteInput
                placeholder="353456789012348"
                maxLength={17}
                disabled={!hasSim}
                value={field.value}
                onChange={(value) => {
                  field.onChange(value);
                  // Trigger validation after selection
                  setTimeout(() => trigger('imei'), 0);
                }}
                onBlur={field.onBlur}
                onSearch={handleImeiSearch}
                minSearchLength={3}
                debounceMs={300}
                noResultsText={t('common.noData')}
                error={hasSim && !!errors.imei}
                endIcon={hasSim && imeiValid && !errors.imei ? <Check size={16} className="text-success" /> : undefined}
              />
            )}
          />
          <FormErrorMessage error={hasSim ? errors.imei : undefined} />
        </div>

        {hasSim && formattedImei && !errors.imei && (
          <div className="text-sm text-control-label mt-2">
            {t('device.formatted')}: <span className="font-mono">{formattedImei}</span>
          </div>
        )}

        <div className="text-xs text-control-label mt-3">
          {t('device.imeiHint')}
        </div>
        <div className="text-xs text-control-label mt-1">
          {t('register.imeiSearchHint')}
        </div>
      </div>

      {/* Serial Input */}
      <div className="border border-line bg-surface p-6 rounded-lg">
        <h2 className="font-semibold mb-4">{t('device.serial')}</h2>

        <div className="flex flex-col">
          <Input
            placeholder="C39XXXXXXXXX"
            maxLength={14}
            error={!!errors.serial}
            endIcon={serialValid && !errors.serial ? <Check size={16} className="text-success" /> : undefined}
            {...register('serial', {
              required: t('device.serialRequired'),
              validate: validateSerialField,
            })}
          />
          <FormErrorMessage error={errors.serial} />
        </div>

        <div className="text-xs text-control-label mt-3">
          {t('device.serialHint')}
        </div>
        <div className="text-xs text-control-label mt-1">
          {t('common.example')}: <span className="font-mono">C39XJZZ1GRY3</span>
        </div>
      </div>

      <Button type="submit" variant="outline" className="w-full">
        {t('register.next')}
      </Button>
    </form>
  );
}
