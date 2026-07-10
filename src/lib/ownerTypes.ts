// Shared helpers for the intake-owner-config feature and the ownership display badges.
// See UI_SUMMARY/125_INTAKE_OWNER_CONFIG.md.

export type OwnerType = 'HOLDING' | 'COMPANY' | 'BRANCH';
export type IntakeChannel = 'PURCHASE' | 'ASSET_REGISTER' | 'DEAL_PARTNER' | 'STOCK_GAIN' | 'BUYBACK';
export type BranchType = 'INTERNAL' | 'EXTERNAL' | 'DEAL_PARTNER';

// Fixed channel enum + sort order. Mirrors inv.ref_intake_channels.
// FALLBACK: v_ref_intake_channels is 403 for COMPANY_ADMIN (BE grant gap — see
// UI_FEEDBACK/2026-07-11_NOTICE_intake_channels_view_403.md). Labels come from i18n
// (channel.*) until BE grants the view; then switch back to reading it from the API.
export const INTAKE_CHANNELS: IntakeChannel[] = [
  'PURCHASE', 'ASSET_REGISTER', 'DEAL_PARTNER', 'STOCK_GAIN', 'BUYBACK',
];

export const BRANCH_TYPES: BranchType[] = ['INTERNAL', 'EXTERNAL', 'DEAL_PARTNER'];

export const OWNER_TYPES: OwnerType[] = ['HOLDING', 'COMPANY', 'BRANCH'];

// Badge color per owner_type. HOLDING=info (blue), COMPANY=success (green), BRANCH=warning (orange).
export const OWNER_BADGE_COLOR: Record<OwnerType, 'info' | 'success' | 'warning'> = {
  HOLDING: 'info',
  COMPANY: 'success',
  BRANCH: 'warning',
};
