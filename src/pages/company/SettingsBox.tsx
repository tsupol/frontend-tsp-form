import type { ReactNode } from 'react';

// One setting group on either company-settings tab: a box with its title and
// one-line hint. Things inside it are plain rows — never another bordered box; a list
// inside splits with full-width lines (SETTINGS_BOX_ROWS), not boxes of its own.
export function SettingsBox({ title, hint, children, testId, className }: {
  title: ReactNode;
  /** Placement in the parent grid only (e.g. a column span) — never its look. */
  className?: string;
  hint?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    // A column, so a footer row given mt-auto sits at the bottom when boxes in a row
    // are stretched to one height — their Save buttons then line up.
    <section className={`rounded-lg border border-line p-4 flex flex-col ${className ?? ''}`} data-testid={testId}>
      <h4 className={`text-sm font-semibold text-fg uppercase tracking-wider ${hint ? 'mb-1' : 'mb-3'}`}>{title}</h4>
      {hint && <p className="text-xs text-subtle mb-3">{hint}</p>}
      {children}
    </section>
  );
}

/** A list inside a SettingsBox: lines run edge to edge of the box, rows keep its padding. */
export const SETTINGS_BOX_ROWS = '-mx-4 border-t border-line divide-y divide-line';
