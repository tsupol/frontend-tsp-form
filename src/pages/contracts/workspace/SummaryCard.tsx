import type { ReactNode } from 'react';
import { Button } from 'tsp-form';
import { CheckCircle, Circle, AlertTriangle, Lock, Pencil } from 'lucide-react';
import type { CardStatus } from './WorkspaceTypes';

interface SummaryCardProps {
  title: string;
  status: CardStatus;
  onEdit?: () => void;
  disabled?: boolean;
  children: ReactNode;
  actions?: ReactNode;
}

const STATUS_ICON: Record<CardStatus, ReactNode> = {
  complete: <CheckCircle size={16} className="text-success shrink-0" />,
  partial: <Circle size={16} className="text-warning shrink-0" />,
  empty: <Circle size={16} className="text-fg/30 shrink-0" />,
  warning: <AlertTriangle size={16} className="text-warning shrink-0" />,
  locked: <Lock size={16} className="text-fg/20 shrink-0" />,
};

export function SummaryCard({ title, status, onEdit, disabled, children, actions }: SummaryCardProps) {
  return (
    <div className={`border rounded-lg transition-colors ${
      status === 'complete' ? 'border-success/30 bg-success/3' :
      status === 'locked' ? 'border-line/50 bg-surface/50 opacity-60' :
      'border-line bg-bg'
    }`}>
      <div className="flex items-center gap-2 px-4 py-3">
        {STATUS_ICON[status]}
        <span className="font-medium text-sm flex-1">{title}</span>
        {actions}
        {onEdit && !disabled && status !== 'locked' && (
          <Button size="sm" variant="ghost" onClick={onEdit} className="btn-icon-sm shrink-0">
            <Pencil size={14} />
          </Button>
        )}
      </div>
      <div className="px-4 pb-3 text-sm">
        {children}
      </div>
    </div>
  );
}
