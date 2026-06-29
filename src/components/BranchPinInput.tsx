import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, FormErrorMessage } from 'tsp-form';

interface BranchPinInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
}

/**
 * Branch PIN input — 6-digit password field with label and error display.
 * Use this for any action that requires branch PIN authorization.
 */
export function BranchPinInput({ value, onChange, label, required, error, disabled }: BranchPinInputProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col">
      <label className="form-label">
        {label || t('contract.pin')}{required && ' *'}
      </label>
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder={t('contract.pinPlaceholder')}
        maxLength={6}
        className="w-full"
        style={{ WebkitTextSecurity: 'disc' } as CSSProperties}
        disabled={disabled}
      />
      {error && <FormErrorMessage error={{ message: error }} />}
    </div>
  );
}
