export type WizardSection = 'setup' | 'condition' | 'photos' | 'submit';

export type CardStatus = 'empty' | 'partial' | 'complete' | 'locked';

export interface BuybackLine {
  po_line_id: number;
  model_id: number | null;
  variant_id: number | null;
  sku_code: string | null;
  brand_name: string | null;
  family_name: string | null;
  model_name: string | null;
  variant_name: string | null;
  buyback_price: number | null;
  unit_cost: number | null;
  item_condition: string | null;
  condition_snapshot: Record<string, unknown> | null;
  note: string | null;
  images: unknown[];
  asset_match_result: string | null;
  asset_intake_status: string | null;
  attempted_identifiers_json: { type: string; value: string }[] | null;
}

export interface BuybackDraft {
  po_id: number;
  po_no: string;
  code_display: string | null;
  status: string;
  supplier_name: string;
  notes: string | null;
  branch_id: number | null;
  branch_name: string | null;
  auto_reject_after: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  c_total_lines: number;
  lines: BuybackLine[];
}

export interface ConditionSnapshot {
  OVERALL_CONDITION?: string;
  SCREEN_CONDITION?: string;
  BODY_CONDITION?: string;
  BATTERY_HEALTH?: string;
  CONDITION_NOTES?: string;
}

// Conventional values — backend stores jsonb as-is, so these are UI-chosen.
export const OVERALL_CONDITION_OPTIONS = [
  { value: 'EXCELLENT', label: 'Excellent' },
  { value: 'GOOD', label: 'Good' },
  { value: 'FAIR', label: 'Fair' },
  { value: 'POOR', label: 'Poor' },
];

export const SCREEN_CONDITION_OPTIONS = [
  { value: 'NO_DAMAGE', label: 'No damage' },
  { value: 'MINOR', label: 'Minor scratches' },
  { value: 'CRACKED', label: 'Cracked' },
  { value: 'BROKEN', label: 'Broken' },
];

export const BODY_CONDITION_OPTIONS = [
  { value: 'NO_DAMAGE', label: 'No damage' },
  { value: 'MINOR', label: 'Minor scratches' },
  { value: 'MODERATE', label: 'Moderate dents' },
  { value: 'MAJOR', label: 'Major damage' },
];

export const ITEM_CONDITION_OPTIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'REFURBISHED', label: 'Refurbished' },
  { value: 'USED_A', label: 'Used A' },
  { value: 'USED_B', label: 'Used B' },
];

// Branch-observed condition fields. CONNECTIVITY is a model attribute — not in
// this list; it gets auto-stamped from model.connectivity at save time.
export const CONDITION_KEYS: (keyof ConditionSnapshot)[] = [
  'OVERALL_CONDITION',
  'SCREEN_CONDITION',
  'BODY_CONDITION',
  'BATTERY_HEALTH',
];
