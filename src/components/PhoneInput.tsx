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
 */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  (props, ref) => (
    <MaskedInput ref={ref} {...props} dynamicMask={thaiPhoneMask} />
  ),
);

PhoneInput.displayName = 'PhoneInput';
