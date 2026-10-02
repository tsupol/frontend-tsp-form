// Label/value rows for detail panels, and the plain bordered section that holds
// them. Every row is the same two columns — label, value — with no per-row
// icon, so values line up down a section and across sections (the repo job
// panel, the collector's device box, the device & app status lines). The
// section title carries the icon.

import type { ReactNode } from 'react';

export function DetailLine({ label, children, className = '' }: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start gap-2 text-sm min-w-0 ${className}`}>
      <span className="text-xs text-subtle shrink-0 w-24 mt-0.5">{label}</span>
      <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">{children}</div>
    </div>
  );
}

/** A plain bordered box (no fill) with a small title row. `action` sits at the
 *  right end of the title row. */
export function DetailSection({ icon, title, action, children, className = '' }: {
  icon?: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-md border border-line px-3 py-3 flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2 min-h-7">
        {icon && <span className="text-subtle shrink-0">{icon}</span>}
        <h3 className="text-sm font-medium">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}
