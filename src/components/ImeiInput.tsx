import { forwardRef } from 'react';
import { Input, type InputProps } from 'tsp-form';

/** Strip to digits and cap at IMEI length (15). String-only, so leading zeros survive. */
export function sanitizeImei(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 15);
}

type ImeiInputProps = Omit<InputProps, 'value' | 'onChange' | 'inputMode'> & {
  value: string;
  /** Receives sanitized digits (non-digits stripped, capped at 15). */
  onChange: (digits: string) => void;
};

/**
 * IMEI entry: digit-only (strips letters/dashes/spaces as typed or pasted),
 * capped at 15, and surfaces the numeric keyboard on mobile. All other Input
 * props (className, error, endIcon, placeholder, size, …) pass through.
 *
 * Not for the register flow's IMEI field — that one tolerates dashes and
 * autocompletes by partial IMEI, so it only takes inputMode="numeric".
 */
export const ImeiInput = forwardRef<HTMLInputElement, ImeiInputProps>(
  ({ value, onChange, ...rest }, ref) => (
    <Input
      ref={ref}
      value={value}
      onChange={(e) => onChange(sanitizeImei(e.target.value))}
      inputMode="numeric"
      {...rest}
    />
  ),
);

ImeiInput.displayName = 'ImeiInput';
