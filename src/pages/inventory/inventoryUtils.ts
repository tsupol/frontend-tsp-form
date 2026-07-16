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
  SOLD_OUTRIGHT: { labelKey: 'inventory.soldOutright', color: 'default' },
  PENDING_SALE_APPROVAL: { labelKey: 'inventory.pendingSaleApproval', color: 'warning' },
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
// Lot status display config (lot.status — returned by convert / split RPCs)
// ============================================================================

export const LOT_STATUS_CONFIG: Record<string, { labelKey: string }> = {
  ACTIVE: { labelKey: 'inventory.lotStatusActive' },
  DEPLETED: { labelKey: 'inventory.lotStatusDepleted' },
};

export function getLotStatusLabel(status: string, t: (key: string) => string): string {
  const cfg = LOT_STATUS_CONFIG[status];
  return cfg ? t(cfg.labelKey) : status;
}

// ============================================================================
// Condition display config
// ============================================================================

export const CONDITION_CONFIG: Record<string, { labelKey: string; textColor: string }> = {
  NEW: { labelKey: 'inventory.conditionNEW', textColor: 'text-success' },
  REFURBISHED: { labelKey: 'inventory.conditionREFURBISHED', textColor: 'text-info' },
  USED_A: { labelKey: 'inventory.conditionUSED_A', textColor: 'text-warning-fg' },
  USED_B: { labelKey: 'inventory.conditionUSED_B', textColor: 'text-subtle' },
  // Synthetic combined value used as a filter shortcut for USED_A + USED_B.
  USED: { labelKey: 'inventory.conditionUSED', textColor: 'text-warning-fg' },
};

export function getConditionLabel(condition: string, t: (key: string) => string): string {
  const cfg = CONDITION_CONFIG[condition];
  return cfg ? t(cfg.labelKey) : condition;
}

export function getConditionTextColor(condition: string): string {
  return CONDITION_CONFIG[condition]?.textColor ?? 'text-subtle';
}

export const CONDITION_VALUES = ['NEW', 'REFURBISHED', 'USED', 'USED_A', 'USED_B'];

// ============================================================================
// Formatting
// ============================================================================

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '0';
  return n.toLocaleString();
}

// Prefer the backend-formatted display code (e.g. `AT-2604-000105-4`) and
// fall back to the raw code (e.g. `AT26040001054`) when the view doesn't
// yet expose a display column. Once backend fills the gap (PO, transfer),
// the UI picks it up automatically.
export const codeDisplay = (display?: string | null, raw?: string | null): string =>
  display ?? raw ?? '';

// ============================================================================
// Asset search — dash-insensitive matching
// ============================================================================
//
// Asset codes exist in two forms: the raw stored `asset_code` (dash-free, e.g.
// `AT26040001013`) and the displayed `asset_code_display` (dashed, e.g.
// `AT-2604-000101-3`). Users read and type the dashed form off the screen, but
// naive searches only match one form and silently return nothing for the other.
// These helpers make every asset search accept both forms.

/** Strip dashes from a search term so it can match the dash-free `asset_code`/`imei`. */
export const stripAssetDashes = (s: string): string => s.replace(/-/g, '');

/**
 * Build a PostgREST `or=(...)` clause (WITHOUT the leading `&or=` / parens) that
 * matches an asset by code either way, plus any extra text fields passed in.
 *
 * Dashed fields (`asset_code_display`, `serial_no`) match the raw term; dash-free
 * fields (`asset_code`, `imei`) match the dash-stripped term. Mirrors the
 * reference implementation in AssetsPage.
 *
 * `term` must already be trimmed. `extraFields` are matched against the raw term
 * with `ilike.*term*` (e.g. `model_name`, `brand_name`).
 */
export function assetSearchOrClause(term: string, extraFields: string[] = []): string {
  const stripped = stripAssetDashes(term);
  const conds = [
    `asset_code_display.ilike.*${term}*`,
    `serial_no.ilike.*${term}*`,
    `asset_code.ilike.*${stripped}*`,
    `imei.ilike.*${stripped}*`,
    ...extraFields.map(f => `${f}.ilike.*${term}*`),
  ];
  return `or=(${conds.join(',')})`;
}

/**
 * Dash-insensitive client-side asset-code match. Returns true if the (already
 * lowercased) query matches either the dashed display code or the raw code,
 * comparing both with dashes removed so `AT26040001013`, `AT-2604-000101-3`,
 * and `2604000101` all match the same asset.
 */
export function assetCodeMatches(lowerQuery: string, display?: string | null, raw?: string | null): boolean {
  const q = stripAssetDashes(lowerQuery);
  if (!q) return false;
  const codes = [display, raw].filter(Boolean).map(c => stripAssetDashes(c!.toLowerCase()));
  return codes.some(c => c.includes(q));
}

