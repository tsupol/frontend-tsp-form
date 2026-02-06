/**
 * Validates IMEI using Luhn algorithm
 * IMEI is 15 digits, last digit is check digit
 */
export function validateIMEI(imei: string): { valid: boolean; error?: string } {
  // Remove spaces and dashes
  const cleaned = imei.replace(/[\s-]/g, '');

  // Check length
  if (cleaned.length === 0) {
    return { valid: false, error: 'IMEI is required' };
  }

  if (cleaned.length !== 15) {
    return { valid: false, error: 'IMEI must be 15 digits' };
  }

  // Check if all digits
  if (!/^\d{15}$/.test(cleaned)) {
    return { valid: false, error: 'IMEI must contain only digits' };
  }

  // Luhn algorithm check
  if (!luhnCheck(cleaned)) {
    return { valid: false, error: 'Invalid IMEI (checksum failed)' };
  }

  return { valid: true };
}

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
 * Validates iPhone Serial Number
 * - 12 characters (post-2021) or 11 characters (older)
 * - Alphanumeric, typically uppercase
 * - No O or I (to avoid confusion with 0 and 1)
 */
export function validateiPhoneSerial(serial: string): { valid: boolean; error?: string } {
  // Remove spaces
  const cleaned = serial.replace(/\s/g, '').toUpperCase();

  if (cleaned.length === 0) {
    return { valid: false, error: 'Serial number is required' };
  }

  // Check length (11 or 12 characters)
  if (cleaned.length !== 11 && cleaned.length !== 12) {
    return { valid: false, error: 'Serial must be 11 or 12 characters' };
  }

  // Check alphanumeric only
  if (!/^[A-Z0-9]+$/.test(cleaned)) {
    return { valid: false, error: 'Serial must be alphanumeric' };
  }

  // Apple serials don't contain O or I
  if (/[OI]/.test(cleaned)) {
    return { valid: false, error: 'Serial cannot contain O or I' };
  }

  return { valid: true };
}

/**
 * Format IMEI for display (XXX-XXXXXX-XXXXXX-X)
 */
export function formatIMEI(imei: string): string {
  const cleaned = imei.replace(/[\s-]/g, '');
  if (cleaned.length !== 15) return imei;
  return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 8)}-${cleaned.slice(8, 14)}-${cleaned.slice(14)}`;
}
