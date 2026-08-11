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
    case 'PENDING_PAYMENT_AND_SIGN': return 'warning';
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

export const STATE_VALUES = [
  'DRAFT', 'SAVING', 'PENDING_APPROVAL', 'APPROVED', 'PENDING_PAYMENT',
  'ACTIVE', 'WAIT_LEGAL_PROCESS', 'ON_LEGAL_PROCESS', 'ON_COURT_PROCESS',
  'COMPLETED', 'TERMINATED', 'VOIDED', 'CANCELLED', 'EXPIRED',
] as const;

/** Resolve STATE_VALUES → Select options. Pass `t` so labels are localized. */
export function stateOptions(t: TFunction) {
  return STATE_VALUES.map((v) => ({ value: v, label: getStateLabel(v, t) }));
}

// ── Product name ────────────────────────────────────────────────────────────

/**
 * The contract views send a literal `"-"` for `product_display_name` when the
 * contract has no model picked yet — a placeholder, not a name. Rendering it
 * raw puts a stray dash where a product should be (and, worse, makes empty
 * sections look populated). Normalise it to null so the usual
 * `?? variant_name ?? model_name` fallbacks work as intended.
 */
export function productName(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v && v !== '-' ? v : null;
}
