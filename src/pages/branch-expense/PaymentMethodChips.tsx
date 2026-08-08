import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { EXPENSE_PAYMENT_METHODS, type ExpensePaymentMethod } from './branchExpenseTypes';

// Picker for the 5 expense payment methods (CASH/TRANSFER/PROMPTPAY/CARD/
// OTHER). Big touch targets per the mobile-first record flow (doc 106).
// Clearable: tapping the selected option again clears it (payment_method is
// optional).
//
// tsp-form Button carries the selected/unselected states — solid primary vs
// outline default — so the picker inherits the app's button sizing, focus ring,
// and disabled handling instead of re-deriving them from Tailwind.
export function PaymentMethodChips({ value, onChange, disabled }: {
  value: ExpensePaymentMethod | '';
  onChange: (v: ExpensePaymentMethod | '') => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2" role="group">
      {EXPENSE_PAYMENT_METHODS.map((m) => {
        const selected = value === m;
        return (
          <Button
            key={m}
            type="button"
            // md (the default) so the row lines up with the Inputs and Selects
            // above it — sm renders 28px against their 36px.
            variant={selected ? 'solid' : 'outline'}
            color={selected ? 'primary' : 'default'}
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(selected ? '' : m)}
          >
            {t(`branchExpense.paymentMethod_${m}`)}
          </Button>
        );
      })}
    </div>
  );
}
