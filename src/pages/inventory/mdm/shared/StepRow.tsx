// One row of the readiness checklist: numbered dot, connector line, title, and
// an optional body slot.
//
// Its own file because steps 1–5 (EnrollChecklist) and steps 6–7
// (EnrollReadinessSteps) both draw it, and the two screens must not drift. It
// was copied between three files before 2026-08-17 — the dot geometry and the
// done/current/todo colours had already diverged (one copy had lost the
// motion-safe transitions), which is exactly the drift this consolidation is
// for.

import type { ReactNode } from 'react';
// Check, not CheckCircle: the dot the icon sits inside is already a filled
// circle, so a circled glyph draws a ring inside a ring.
import { Check, type LucideIcon } from 'lucide-react';

export type StepStatus = 'done' | 'current' | 'todo';

export function StepRow({
  n, icon: Icon, title, where, state, last, children,
}: {
  n: number;
  icon: LucideIcon;
  title: string;
  where?: string;
  state: StepStatus;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center shrink-0">
        {/* motion-safe: the colour change is the only cue that the flow moved
            forward, so it transitions rather than snapping — but a user who
            asked for less motion gets it instantly. */}
        <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 motion-safe:transition-colors motion-safe:duration-200 ${
          state === 'current' ? 'bg-primary border-primary text-primary-contrast'
            : state === 'done' ? 'bg-success border-success text-success-contrast'
              : 'bg-surface border-line text-subtle'
        }`}>
          {state === 'done' ? <Check size={14} strokeWidth={3} /> : <Icon size={12} />}
        </div>
        {!last && <div className={`w-0.5 flex-1 min-h-[0.75rem] my-0.5 motion-safe:transition-colors motion-safe:duration-200 ${state === 'done' ? 'bg-success' : 'bg-line'}`} />}
      </div>
      <div className="pb-3 min-w-0 flex-1">
        <div className={`text-sm font-medium leading-snug motion-safe:transition-colors ${
          state === 'current' ? 'text-primary-fg' : state === 'done' ? 'text-success-fg' : 'text-fg'
        }`}>
          <span className="text-subtler tabular-nums">{n}. </span>{title}
        </div>
        {where && <div className="text-xs text-subtle leading-snug mt-0.5">{where}</div>}
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}
