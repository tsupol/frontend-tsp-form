import { forwardRef } from 'react';
import { MaskedInput, type MaskedInputProps } from 'tsp-form';

type CurrencyInputProps = Omit<MaskedInputProps, 'mask' | 'dynamicMask'> & {
  /** Max decimal places (default 2) */
  decimalScale?: number;
};

/**
 * Project-standard currency input — wraps tsp-form's MaskedInput with
 * mask="number" and decimalScale=2 by default.
 */
export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ decimalScale = 2, ...props }, ref) => (
    <MaskedInput ref={ref} {...props} mask="number" decimalScale={decimalScale} />
  ),
);

CurrencyInput.displayName = 'CurrencyInput';
