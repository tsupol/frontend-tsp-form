import type { ReactNode } from 'react';
import { CheckCircle, Circle, AlertTriangle, Lock } from 'lucide-react';
import type { CardStatus } from './WorkspaceTypes';

interface SummaryCardProps {
  title: string;
  status: CardStatus;
  icon?: ReactNode;
  onEdit?: () => void;
  disabled?: boolean;
  active?: boolean;
  shake?: boolean;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

const STATUS_ICON: Record<CardStatus, ReactNode> = {
  complete: <CheckCircle size={16} className="text-success shrink-0" />,
  partial: <Circle size={16} className="text-fg/30 shrink-0" />,
  empty: <Circle size={16} className="text-fg/30 shrink-0" />,
  warning: <AlertTriangle size={16} className="text-warning-fg shrink-0" />,
  locked: <Lock size={16} className="text-fg/20 shrink-0" />,
};

export function SummaryCard({ title, status, icon, onEdit, disabled, active, shake, children, actions, className }: SummaryCardProps) {
  const clickable = !!onEdit && !disabled && !active && status !== 'locked';

  return (
    <div
      className={`border rounded-lg transition-colors ${
        active ? 'border-primary bg-primary-soft' :
        status === 'complete' ? 'border-success-border bg-success/10' :
        status === 'locked' ? 'border-line-subtle bg-surface/50 opacity-60' :
        'border-line bg-bg'
      } ${clickable ? 'cursor-pointer hover:border-fg/20' : ''} ${shake ? 'animate-shake' : ''} ${className ?? ''}`}
      onClick={clickable ? onEdit : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onEdit?.(); } : undefined}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        {icon ?? STATUS_ICON[status]}
        <span className="font-medium text-sm flex-1">{title}</span>
        {actions}
      </div>
      <div className="px-4 pb-3 text-sm">
        {children}
      </div>
    </div>
  );
}
