import { useTranslation } from 'react-i18next';
import { CheckCircle } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';

interface CardPostPaymentProps {
  onEdit?: () => void;
  active?: boolean;
}

export function CardPostPayment({ onEdit, active }: CardPostPaymentProps) {
  const { t } = useTranslation();
  const { data } = useWorkspace();
  const clickable = !!onEdit && !active;

  return (
    <div
      className={`border rounded-lg transition-colors ${
        active ? 'border-success bg-success/10' :
        'border-success/40 bg-success/5 hover:border-success/60 cursor-pointer'
      }`}
      onClick={clickable ? onEdit : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onEdit?.(); } : undefined}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <CheckCircle size={16} className="text-success shrink-0" />
        <span className="font-medium text-sm flex-1">{t('wizard.paymentConfirmed')}</span>
        {data.billCode && (
          <span className="text-xs font-mono text-subtle">{data.billCode}</span>
        )}
      </div>
    </div>
  );
}
