import type { ReactNode } from 'react';

interface Props {
  title: string;
  count?: number;
  alert?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function PanelSection({ title, count, alert, children, className }: Props) {
  return (
    <div className={className}>
      {/* Title bar */}
      <span className="panel-section-title">
        {title}{count != null && ` (${count})`}
      </span>

      {/* Alert */}
      {alert && <div className="mb-3">{alert}</div>}

      {/* Content */}
      {children}
    </div>
  );
}
