import type { TFunction } from 'i18next';

// ── State badge helpers ─────────────────────────────────────────────────────

export type BadgeColor = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'default';

export function getStateColor(state: string): BadgeColor {
  switch (state) {
    case 'DRAFT': return 'default';
    case 'SAVING': return 'info';
    case 'PENDING_APPROVAL': return 'warning';
    case 'APPROVED': return 'info';
    case 'PENDING_PAYMENT': return 'warning';
    case 'ACTIVE': return 'success';
    case 'WAIT_LEGAL_PROCESS': return 'warning';
    case 'ON_LEGAL_PROCESS': return 'danger';
    case 'ON_COURT_PROCESS': return 'danger';
    case 'COMPLETED': return 'primary';
    case 'TERMINATED': return 'danger';
    case 'VOIDED': return 'default';
    case 'CANCELLED': return 'default';
    case 'EXPIRED': return 'default';
    default: return 'default';
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
