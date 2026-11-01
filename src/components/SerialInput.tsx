import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { InputProps } from 'tsp-form';
import { Input } from 'tsp-form';
import { ScanBarcode } from 'lucide-react';
import { sanitizeSerial } from '../lib/validators';
import { ImeiInput } from './ImeiInput';
import { useBarcodeScanner } from './BarcodeScanner';

/**
 * Serial out of a barcode payload: drop a printed "S/N" / "SN:" / "Serial" prefix
 * (text and QR labels carry it, bare Code 128 lines don't), then sanitize.
 */
function serialFromScan(raw: string): string {
  return sanitizeSerial(raw.replace(/^\s*(?:S\/N|SN|SERIAL(?:\s*(?:NO|NUMBER))?)\s*[:.#-]?\s*/i, ''));
}

type SerialInputProps = Omit<InputProps, 'value' | 'onChange'> & {
  value: string;
  /** Receives the sanitized serial (uppercase A-Z/0-9, max 20). */
  onChange: (serial: string) => void;
  /** Camera scan button at the end of the field (default on). */
  scan?: boolean;
};

/**
 * Serial-number entry: uppercases as typed and drops anything that isn't
 * A-Z/0-9 — including Thai characters typed with the wrong keyboard, which are
 * otherwise invisible in the field. The serial-side twin of `ImeiInput`.
 * Format errors (length per brand) are the caller's: `identifierFormatReason`.
 * Same barcode scanner end icon as `ImeiInput` — `scan={false}` or your own
 * `endIcon` drops it.
 */
export const SerialInput = forwardRef<HTMLInputElement, SerialInputProps>(
  ({ value, onChange, scan = true, endIcon, onEndIconClick, ...rest }, ref) => {
    const { t } = useTranslation();
    const { open, scannerEl } = useBarcodeScanner({ onScan: (v) => onChange(serialFromScan(v)) });
    const showScan = scan && endIcon === undefined;
    return (
      <>
        <Input
          ref={ref}
          value={value}
          onChange={(e) => onChange(sanitizeSerial(e.target.value))}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          endIcon={showScan ? <ScanBarcode size={16} aria-label={t('barcodeScanner.title', { defaultValue: 'Scan barcode' })} /> : endIcon}
          onEndIconClick={showScan ? open : onEndIconClick}
          {...rest}
        />
        {showScan && scannerEl}
      </>
    );
  },
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
