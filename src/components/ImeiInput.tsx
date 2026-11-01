import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, type InputProps } from 'tsp-form';
import { ScanBarcode } from 'lucide-react';
import { useBarcodeScanner } from './BarcodeScanner';

/** Strip to digits and cap at IMEI length (15). String-only, so leading zeros survive. */
export function sanitizeImei(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 15);
}

/**
 * Pull the IMEI out of whatever a barcode carried. Box labels print one
 * Code 128 per line (EID / IMEI / IMEI2), so a scan is usually the bare
 * 15 digits — but a text/QR payload like "IMEI 350814291240588" also works.
 * No standalone 15-digit run (e.g. the 32-digit EID line) → falls back to
 * the plain sanitize, which the caller's format check then flags.
 */
function imeiFromScan(raw: string): string {
  const m = raw.match(/(?<!\d)\d{15}(?!\d)/);
  return m ? m[0] : sanitizeImei(raw);
}

type ImeiInputProps = Omit<InputProps, 'value' | 'onChange' | 'inputMode'> & {
  value: string;
  /** Receives sanitized digits (non-digits stripped, capped at 15). */
  onChange: (digits: string) => void;
  /** Camera scan button at the end of the field (default on). */
  scan?: boolean;
};

/**
 * IMEI entry: digit-only (strips letters/dashes/spaces as typed or pasted),
 * capped at 15, and surfaces the numeric keyboard on mobile. All other Input
 * props (className, error, endIcon, placeholder, size, …) pass through.
 *
 * Carries its own barcode scanner (camera or photo) as the end icon, so every
 * IMEI field in the app can read the box label. Pass `scan={false}` or your
 * own `endIcon` to drop it.
 *
 * Not for the register flow's IMEI field — that one tolerates dashes and
 * autocompletes by partial IMEI, so it only takes inputMode="numeric".
 */
export const ImeiInput = forwardRef<HTMLInputElement, ImeiInputProps>(
  ({ value, onChange, scan = true, endIcon, onEndIconClick, ...rest }, ref) => {
    const { t } = useTranslation();
    const { open, scannerEl } = useBarcodeScanner({ onScan: (v) => onChange(imeiFromScan(v)) });
    const showScan = scan && endIcon === undefined;
    return (
      <>
        <Input
          ref={ref}
          value={value}
          onChange={(e) => onChange(sanitizeImei(e.target.value))}
          inputMode="numeric"
          endIcon={showScan ? <ScanBarcode size={16} aria-label={t('barcodeScanner.title', { defaultValue: 'Scan barcode' })} /> : endIcon}
          onEndIconClick={showScan ? open : onEndIconClick}
          {...rest}
        />
        {showScan && scannerEl}
      </>
    );
  },
);

ImeiInput.displayName = 'ImeiInput';
