import { useTranslation } from 'react-i18next';
import { Star, CreditCard } from 'lucide-react';
import { fmtCurrency } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';

export function CardReviewPay({ onEdit, active, disabled }: { onEdit?: () => void; active?: boolean; disabled?: boolean }) {
  const { t } = useTranslation();
  const { contract } = useWorkspace();

  const score = contract?.staff_confidence_score;
  const downPayment = contract?.down_payment ?? 0;
  const insuranceDeposit = contract?.insurance_deposit ?? 0;
  const total = downPayment + insuranceDeposit;
  const clickable = !!onEdit && !disabled && !active;

  return (
    <div
      className={`border rounded-lg transition-colors ${
        disabled ? 'border-line/50 bg-surface/50 opacity-50' :
        active ? 'border-primary bg-primary-soft' :
        'border-primary bg-primary-soft hover:border-primary cursor-pointer'
      }`}
      onClick={clickable ? onEdit : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onEdit?.(); } : undefined}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <CreditCard size={16} className="text-primary-fg shrink-0" />
        <span className="font-medium text-sm flex-1">{t('workspace.cardReviewPay')}</span>
      </div>
      <div className="px-4 pb-3 text-sm flex flex-col gap-1.5">
        {/* Confidence score */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-subtle">{t('workspace.confidence')}</span>
          {score ? (
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map(n => (
                <Star key={n} size={12} className={n <= score ? 'text-warning-fg fill-warning' : 'text-fg/15'} />
              ))}
            </div>
          ) : (
            <span className="text-xs text-warning-fg">{t('workspace.notRated')}</span>
          )}
        </div>
        {/* Bill preview */}
        {total > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-subtle">{t('workspace.total')}</span>
            <span className="text-xs font-medium tabular-nums">{fmtCurrency(total)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
