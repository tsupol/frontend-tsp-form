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
      className={`border-b border-line transition-colors ${
        active ? 'bg-primary-soft' :
        status === 'complete' ? 'bg-success-soft' :
        status === 'locked' ? 'opacity-60' :
        ''
      } ${clickable ? 'cursor-pointer hover:bg-surface-hover' : ''} ${shake ? 'animate-shake' : ''} ${className ?? ''}`}
      onClick={clickable ? onEdit : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onEdit?.(); } : undefined}
    >
      {/* Icon in its own gutter, vertically centered on the title row; the
          right column holds title + content so they share one left edge. */}
      <div className="flex gap-2 px-4 py-4">
        <span className="shrink-0 flex items-center h-5">{icon ?? STATUS_ICON[status]}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 h-5">
            <span className="font-medium text-sm flex-1">{title}</span>
            {actions}
          </div>
          <div className="text-sm mt-1.5">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
