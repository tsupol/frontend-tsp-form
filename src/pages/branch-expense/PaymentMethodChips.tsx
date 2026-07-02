import { useTranslation } from 'react-i18next';
import { EXPENSE_PAYMENT_METHODS, type ExpensePaymentMethod } from './branchExpenseTypes';

// Chip-style picker for the 5 expense payment methods (CASH/TRANSFER/PROMPTPAY/
// CARD/OTHER). Big touch targets per the mobile-first record flow (doc 106).
// Clearable: tapping the selected chip again clears it (payment_method is optional).
export function PaymentMethodChips({ value, onChange }: {
  value: ExpensePaymentMethod | '';
  onChange: (v: ExpensePaymentMethod | '') => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      {EXPENSE_PAYMENT_METHODS.map((m) => {
        const selected = value === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(selected ? '' : m)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors cursor-pointer ${
              selected
                ? 'border-primary bg-primary-soft text-primary-fg font-medium'
                : 'border-line bg-surface text-fg hover:bg-surface-hover'
            }`}
          >
            {t(`branchExpense.paymentMethod_${m}`)}
          </button>
        );
      })}
    </div>
  );
}
