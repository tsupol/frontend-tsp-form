import { forwardRef } from 'react';
import type { InputProps } from 'tsp-form';
import { Input } from 'tsp-form';
import { sanitizeSerial } from '../lib/validators';
import { ImeiInput } from './ImeiInput';

type SerialInputProps = Omit<InputProps, 'value' | 'onChange'> & {
  value: string;
  /** Receives the sanitized serial (uppercase A-Z/0-9, max 20). */
  onChange: (serial: string) => void;
};

/**
 * Serial-number entry: uppercases as typed and drops anything that isn't
 * A-Z/0-9 — including Thai characters typed with the wrong keyboard, which are
 * otherwise invisible in the field. The serial-side twin of `ImeiInput`.
 * Format errors (length per brand) are the caller's: `identifierFormatReason`.
 */
export const SerialInput = forwardRef<HTMLInputElement, SerialInputProps>(
  ({ value, onChange, ...rest }, ref) => (
    <Input
      ref={ref}
      value={value}
      onChange={(e) => onChange(sanitizeSerial(e.target.value))}
      autoCapitalize="characters"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      {...rest}
    />
  ),
);

SerialInput.displayName = 'SerialInput';

type IdentifierInputProps = Omit<InputProps, 'value' | 'onChange' | 'inputMode'> & {
  /** IMEI / IMEI2 → digits-only; SERIAL_NO → `SerialInput`; anything else → plain trimmed text. */
  identifierType: string | null | undefined;
  value: string;
  onChange: (value: string) => void;
};

/** One field for "a device identifier of type X" — picks the right sanitizing input. */
export const IdentifierInput = forwardRef<HTMLInputElement, IdentifierInputProps>(
  ({ identifierType, value, onChange, ...rest }, ref) => {
    if (identifierType === 'IMEI' || identifierType === 'IMEI2') {
      return <ImeiInput ref={ref} value={value} onChange={onChange} {...rest} />;
    }
    if (identifierType === 'SERIAL_NO') {
      return <SerialInput ref={ref} value={value} onChange={onChange} {...rest} />;
    }
    return <Input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
  },
);

IdentifierInput.displayName = 'IdentifierInput';
