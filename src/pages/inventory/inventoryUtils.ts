/**
 * Shared inventory constants and helpers.
 * Used across all inventory pages for consistent bucket/condition display.
 */

// ============================================================================
// Bucket display config (19 statuses)
// ============================================================================

export type BucketBadgeColor = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export const BUCKET_CONFIG: Record<string, { labelKey: string; color: BucketBadgeColor }> = {
  // Inbound
  INBOUND_PENDING_COMPANY_APPROVAL: { labelKey: 'inventory.inboundPendingApproval', color: 'warning' },
  INBOUND_APPROVED_AWAITING_BRANCH_CONFIRM: { labelKey: 'inventory.inboundAwaitingConfirm', color: 'warning' },
  INBOUND_RECEIVED_UNREGISTERED: { labelKey: 'inventory.inboundUnregistered', color: 'warning' },
  // On hand
  ON_HAND_PENDING_READY: { labelKey: 'inventory.pendingReady', color: 'info' },
  ON_HAND_AVAILABLE: { labelKey: 'inventory.available', color: 'success' },
  IN_USE_INTERNAL: { labelKey: 'inventory.inUseInternal', color: 'primary' },
  // Transit
  IN_TRANSIT_OUTBOUND: { labelKey: 'inventory.inTransitOut', color: 'info' },
  IN_TRANSIT_INBOUND: { labelKey: 'inventory.inTransitIn', color: 'info' },
  // Hold
  QUARANTINED: { labelKey: 'inventory.quarantine', color: 'warning' },
  IN_REPAIR: { labelKey: 'inventory.inRepair', color: 'danger' },
  OUT_REPAIR: { labelKey: 'inventory.outRepair', color: 'danger' },
  DAMAGED_SCRAP_PENDING: { labelKey: 'inventory.damagedScrap', color: 'danger' },
  // Customer
  WITH_CUSTOMER_ACTIVE: { labelKey: 'inventory.withCustomer', color: 'primary' },
  REPOSSESSED_PENDING_CLEARANCE: { labelKey: 'inventory.repossessed', color: 'warning' },
  LOANED_OUT: { labelKey: 'inventory.loanedOut', color: 'info' },
  // Exit
  OWNERSHIP_TRANSFERRED: { labelKey: 'inventory.ownershipTransferred', color: 'default' },
  DISPOSED_SOLD_SCRAP: { labelKey: 'inventory.disposedScrap', color: 'default' },
  SOLD_B2B_EXTERNAL: { labelKey: 'inventory.soldB2B', color: 'default' },
  SOLD_B2C_EXTERNAL: { labelKey: 'inventory.soldB2C', color: 'default' },
  WRITTEN_OFF: { labelKey: 'inventory.writtenOff', color: 'default' },
};

export function getBucketLabel(bucket: string, t: (key: string) => string): string {
  const cfg = BUCKET_CONFIG[bucket];
  return cfg ? t(cfg.labelKey) : bucket.replace(/_/g, ' ');
}

export function getBucketColor(bucket: string): BucketBadgeColor {
  return BUCKET_CONFIG[bucket]?.color ?? 'default';
}

// ============================================================================
// Condition display config
// ============================================================================

export const CONDITION_CONFIG: Record<string, { labelKey: string; textColor: string }> = {
  NEW: { labelKey: 'inventory.conditionNEW', textColor: 'text-success' },
  REFURBISHED: { labelKey: 'inventory.conditionREFURBISHED', textColor: 'text-info' },
  USED_A: { labelKey: 'inventory.conditionUSED_A', textColor: 'text-warning' },
  USED_B: { labelKey: 'inventory.conditionUSED_B', textColor: 'text-subtle' },
};

export function getConditionLabel(condition: string, t: (key: string) => string): string {
  const cfg = CONDITION_CONFIG[condition];
  return cfg ? t(cfg.labelKey) : condition;
}

export function getConditionTextColor(condition: string): string {
  return CONDITION_CONFIG[condition]?.textColor ?? 'text-subtle';
}

export const CONDITION_OPTIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'REFURBISHED', label: 'Refurbished' },
  { value: 'USED', label: 'Used (A+B)' },
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

