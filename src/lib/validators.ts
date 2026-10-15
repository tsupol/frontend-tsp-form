/**
 * Luhn algorithm for IMEI validation
 */
function luhnCheck(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = parseInt(digits[i], 10);

    // Double every second digit from the right (0-indexed: positions 0,2,4... from right)
    // In 0-indexed from left for 15 digits: positions 1,3,5,7,9,11,13
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * Serial as stored: uppercase A-Z/0-9 only, max 20. Strips everything else —
 * spaces, dashes, and the invisible Thai tone marks that ride along when the
 * keyboard was left on Thai (AT-2609-000071-7 was registered as "๋J5923DFC3P").
 */
export function sanitizeSerial(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}

export type IdentifierFormatReason =
  | 'IMEI_FORMAT'
  | 'IMEI_LUHN_FAIL'
  | 'APPLE_SERIAL_FORMAT'
  | 'SERIAL_FORMAT';

/**
 * The backend's identifier format rule (mig 1357, `inv._identifier_format_reason`),
 * mirrored exactly so the form blocks what the DB would reject:
 *   IMEI / IMEI2 — 15 digits + Luhn
 *   SERIAL_NO    — Apple: 10 or 12 × A-Z/0-9; any other brand: 6-20 × A-Z/0-9
 * Other identifier types have no rule. Returns null when valid, else the same
 * reason code the backend sends in `params.reason`, so one translation covers both.
 */
export function identifierFormatReason(
  type: string | null | undefined,
  value: string,
  isApple: boolean,
): IdentifierFormatReason | null {
  const v = value.trim();
  if (type === 'IMEI' || type === 'IMEI2') {
    if (!/^\d{15}$/.test(v)) return 'IMEI_FORMAT';
    return luhnCheck(v) ? null : 'IMEI_LUHN_FAIL';
  }
  if (type === 'SERIAL_NO') {
    const s = v.toUpperCase();
    if (isApple && !/^([0-9A-Z]{10}|[0-9A-Z]{12})$/.test(s)) return 'APPLE_SERIAL_FORMAT';
    if (!/^[0-9A-Z]{6,20}$/.test(s)) return 'SERIAL_FORMAT';
  }
  return null;
}

/** Brand check the backend uses (`prod.ref_brands.code = 'APPLE'`), from the name the views return. */
export function isAppleBrand(brand: string | null | undefined): boolean {
  return (brand ?? '').trim().toUpperCase() === 'APPLE';
}

/**
 * Why a stored Thai phone number does not look dialable, or null when it does.
 * Mobile: 10 digits starting 06 / 08 / 09. Landline: 9 digits starting 02–07.
 * For display checks on numbers already saved — input uses the masked field.
 */
export type ThaiPhoneReason = 'length' | 'prefix';

export function thaiPhoneReason(raw: string | null | undefined): ThaiPhoneReason | null {
  const d = (raw ?? '').replace(/\D/g, '');
  if (/^0[689]/.test(d)) return d.length === 10 ? null : 'length';
  if (/^0[2-7]/.test(d)) return d.length === 9 ? null : 'length';
  return 'prefix';
}
