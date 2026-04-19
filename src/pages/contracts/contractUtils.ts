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
  { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PENDING_PAYMENT', label: 'Pending Payment' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'WAIT_LEGAL_PROCESS', label: 'Wait Legal Process' },
  { value: 'ON_LEGAL_PROCESS', label: 'On Legal Process' },
  { value: 'ON_COURT_PROCESS', label: 'On Court Process' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'TERMINATED', label: 'Terminated' },
  { value: 'VOIDED', label: 'Voided' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
];
