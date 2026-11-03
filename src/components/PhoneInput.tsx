import { forwardRef } from 'react';
import { MaskedInput, type MaskedInputProps } from 'tsp-form';

type PhoneInputProps = Omit<MaskedInputProps, 'mask' | 'dynamicMask'>;

const thaiPhoneMask = (digits: string) => {
  if (digits.startsWith('02')) return '##-###-####';
  const prefix = digits.slice(0, 2);
  if (['03', '04', '05', '07'].includes(prefix)) return '###-###-###';
  return '###-###-####'; // mobile 06x, 08x, 09x
};

/**
 * Project-standard phone input — wraps tsp-form's MaskedInput with
 * Thai phone dynamic mask baked in.
 *
 * Digits only go to the mask: it counts every character of `value` as a digit,
 * so a stored "02-123-4567" would show as "02--12-3-45".
 */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, ...props }, ref) => (
    <MaskedInput
      ref={ref}
      {...props}
      value={value === undefined ? undefined : value.replace(/\D/g, '')}
      dynamicMask={thaiPhoneMask}
    />
  ),
);

PhoneInput.displayName = 'PhoneInput';
