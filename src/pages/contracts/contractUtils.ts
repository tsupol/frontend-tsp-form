import type { TFunction } from 'i18next';

// ── State badge helpers ─────────────────────────────────────────────────────

export function getStateColor(state: string): string {
  switch (state) {
    case 'DRAFT': return 'bg-fg/10 text-fg/60';
    case 'SAVING': return 'bg-info/15 text-info';
    case 'PENDING_APPROVAL': return 'bg-warning/15 text-warning';
    case 'APPROVED': return 'bg-info/15 text-info';
    case 'PENDING_PAYMENT': return 'bg-warning/15 text-warning';
    case 'ACTIVE': return 'bg-success/15 text-success';
    case 'WAIT_LEGAL_PROCESS': return 'bg-warning/15 text-warning';
    case 'ON_LEGAL_PROCESS': return 'bg-danger/15 text-danger';
    case 'ON_COURT_PROCESS': return 'bg-danger/20 text-danger';
    case 'COMPLETED': return 'bg-primary/15 text-primary';
    case 'TERMINATED': return 'bg-danger/15 text-danger';
    case 'VOIDED': return 'bg-fg/10 text-fg/40';
    case 'CANCELLED': return 'bg-fg/10 text-fg/40';
    case 'EXPIRED': return 'bg-fg/10 text-fg/40';
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

// ── Date helpers (DOB) ────────────────────────────────────────────────────

/** Convert Date to YYYY-MM-DD string in local timezone (not UTC) */
export function toLocalDateStr(date: Date | null): string {
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Parse YYYY-MM-DD string to Date (avoiding UTC shift) */
export function parseLocalDate(str: string): Date | null {
  if (!str) return null;
  return new Date(str + 'T00:00:00');
}

/** Calculate age from DOB string */
export function getAge(dob: string): number {
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

// ── Scope options ───────────────────────────────────────────────────────────

export const SCOPE_OPTIONS = ['OPEN', 'CLOSED', 'ALL'] as const;
export type ContractScope = typeof SCOPE_OPTIONS[number];

/** Maps UI scope tabs to p_states[] for fn_contract_search */
export const SCOPE_TO_STATES: Record<ContractScope, string[] | null> = {
  OPEN: ['ACTIVE', 'WAIT_LEGAL_PROCESS', 'ON_LEGAL_PROCESS', 'ON_COURT_PROCESS'],
  CLOSED: ['COMPLETED', 'TERMINATED', 'VOIDED'],
  ALL: null,
};

// ── State filter options ────────────────────────────────────────────────────

export const STATE_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SAVING', label: 'Saving' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'TERMINATED', label: 'Terminated' },
  { value: 'VOIDED', label: 'Voided' },
];
