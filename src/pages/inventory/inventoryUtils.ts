/**
 * Shared inventory constants and helpers.
 * Used across all inventory pages for consistent bucket/condition display.
 */

// ============================================================================
// Bucket display config (19 statuses)
// ============================================================================

export const BUCKET_CONFIG: Record<string, { labelKey: string; color: string }> = {
  // Inbound
  INBOUND_PENDING_COMPANY_APPROVAL: { labelKey: 'inventory.inboundPendingApproval', color: 'bg-warning/15 text-warning' },
  INBOUND_APPROVED_AWAITING_BRANCH_CONFIRM: { labelKey: 'inventory.inboundAwaitingConfirm', color: 'bg-warning/15 text-warning' },
  INBOUND_RECEIVED_UNREGISTERED: { labelKey: 'inventory.inboundUnregistered', color: 'bg-warning/15 text-warning' },
  // On hand
  ON_HAND_PENDING_READY: { labelKey: 'inventory.pendingReady', color: 'bg-info/15 text-info' },
  ON_HAND_AVAILABLE: { labelKey: 'inventory.available', color: 'bg-success/15 text-success' },
  IN_USE_INTERNAL: { labelKey: 'inventory.inUseInternal', color: 'bg-primary/15 text-primary' },
  // Transit
  IN_TRANSIT_OUTBOUND: { labelKey: 'inventory.inTransitOut', color: 'bg-info/15 text-info' },
  IN_TRANSIT_INBOUND: { labelKey: 'inventory.inTransitIn', color: 'bg-info/15 text-info' },
  // Hold
  QUARANTINED: { labelKey: 'inventory.quarantine', color: 'bg-warning/15 text-warning' },
  IN_REPAIR: { labelKey: 'inventory.inRepair', color: 'bg-danger/15 text-danger' },
  OUT_REPAIR: { labelKey: 'inventory.outRepair', color: 'bg-danger/15 text-danger' },
  DAMAGED_SCRAP_PENDING: { labelKey: 'inventory.damagedScrap', color: 'bg-danger/15 text-danger' },
  // Customer
  WITH_CUSTOMER_ACTIVE: { labelKey: 'inventory.withCustomer', color: 'bg-primary/15 text-primary' },
  REPOSSESSED_PENDING_CLEARANCE: { labelKey: 'inventory.repossessed', color: 'bg-warning/15 text-warning' },
  LOANED_OUT: { labelKey: 'inventory.loanedOut', color: 'bg-info/15 text-info' },
  // Exit
  OWNERSHIP_TRANSFERRED: { labelKey: 'inventory.ownershipTransferred', color: 'bg-fg/10 text-fg/60' },
  DISPOSED_SOLD_SCRAP: { labelKey: 'inventory.disposedScrap', color: 'bg-fg/10 text-fg/60' },
  SOLD_B2B_EXTERNAL: { labelKey: 'inventory.soldB2B', color: 'bg-fg/10 text-fg/60' },
  SOLD_B2C_EXTERNAL: { labelKey: 'inventory.soldB2C', color: 'bg-fg/10 text-fg/60' },
  WRITTEN_OFF: { labelKey: 'inventory.writtenOff', color: 'bg-fg/10 text-fg/60' },
};

export function getBucketLabel(bucket: string, t: (key: string) => string): string {
  const cfg = BUCKET_CONFIG[bucket];
  return cfg ? t(cfg.labelKey) : bucket.replace(/_/g, ' ');
}

export function getBucketColor(bucket: string): string {
  return BUCKET_CONFIG[bucket]?.color ?? 'bg-fg/10 text-fg/60';
}

// ============================================================================
// Condition display config
// ============================================================================

export const CONDITION_CONFIG: Record<string, { labelKey: string; textColor: string }> = {
  NEW: { labelKey: 'inventory.conditionNEW', textColor: 'text-success' },
  REFURBISHED: { labelKey: 'inventory.conditionREFURBISHED', textColor: 'text-info' },
  USED_A: { labelKey: 'inventory.conditionUSED_A', textColor: 'text-warning' },
  USED_B: { labelKey: 'inventory.conditionUSED_B', textColor: 'text-fg/60' },
};

export function getConditionLabel(condition: string, t: (key: string) => string): string {
  const cfg = CONDITION_CONFIG[condition];
  return cfg ? t(cfg.labelKey) : condition;
}

export function getConditionTextColor(condition: string): string {
  return CONDITION_CONFIG[condition]?.textColor ?? 'text-fg/60';
}

export const CONDITION_OPTIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'REFURBISHED', label: 'Refurbished' },
  { value: 'USED_A', label: 'Used A' },
  { value: 'USED_B', label: 'Used B' },
];

// ============================================================================
// Formatting
// ============================================================================

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '0';
  return n.toLocaleString();
}

