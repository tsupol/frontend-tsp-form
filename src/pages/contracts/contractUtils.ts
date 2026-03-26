import type { TFunction } from 'i18next';

// ── State badge helpers ─────────────────────────────────────────────────────

export function getStateColor(state: string): string {
  switch (state) {
    case 'DRAFT': return 'bg-fg/10 text-fg/60';
    case 'SAVING': return 'bg-info/15 text-info';
    case 'ACTIVE': return 'bg-success/15 text-success';
    case 'COMPLETED': return 'bg-primary/15 text-primary';
    case 'TERMINATED': return 'bg-danger/15 text-danger';
    case 'VOIDED': return 'bg-fg/10 text-fg/40';
    default: return 'bg-fg/10 text-fg/60';
  }
}

export function getStateLabel(state: string, t: TFunction): string {
  return t(`contract.state_${state}`, { defaultValue: state });
}

// ── Currency formatter ──────────────────────────────────────────────────────

export const fmtCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
};

// ── Scope options ───────────────────────────────────────────────────────────

export const SCOPE_OPTIONS = ['OPEN', 'OVERDUE', 'CLOSED', 'ALL'] as const;
export type ContractScope = typeof SCOPE_OPTIONS[number];

// ── State filter options ────────────────────────────────────────────────────

export const STATE_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SAVING', label: 'Saving' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'TERMINATED', label: 'Terminated' },
  { value: 'VOIDED', label: 'Voided' },
];
