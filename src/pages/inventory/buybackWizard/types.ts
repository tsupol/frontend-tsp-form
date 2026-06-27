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
// Labels are i18n keys under `buyback.condition` / `buyback.grade`; callers
// resolve with `t(opt.labelKey)`.
export const OVERALL_CONDITION_VALUES = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR'] as const;
export const SCREEN_CONDITION_VALUES = ['NO_DAMAGE', 'MINOR', 'CRACKED', 'BROKEN'] as const;
export const BODY_CONDITION_VALUES = ['NO_DAMAGE', 'MINOR', 'MODERATE', 'MAJOR'] as const;
export const ITEM_CONDITION_VALUES = ['NEW', 'REFURBISHED', 'USED_A', 'USED_B'] as const;

export const OVERALL_CONDITION_OPTIONS = OVERALL_CONDITION_VALUES.map((v) => ({ value: v, labelKey: `buyback.condition.${v}` }));
export const SCREEN_CONDITION_OPTIONS = SCREEN_CONDITION_VALUES.map((v) => ({ value: v, labelKey: `buyback.condition.${v}` }));
export const BODY_CONDITION_OPTIONS = BODY_CONDITION_VALUES.map((v) => ({ value: v, labelKey: `buyback.condition.${v}` }));
export const ITEM_CONDITION_OPTIONS = ITEM_CONDITION_VALUES.map((v) => ({ value: v, labelKey: `buyback.grade.${v}` }));

type LabelKeyOpt = { value: string; labelKey: string };
export function resolveOptions(opts: LabelKeyOpt[], t: (k: string) => string) {
  return opts.map((o) => ({ value: o.value, label: t(o.labelKey) }));
}

// Branch-observed condition fields. CONNECTIVITY is a model attribute — not in
// this list; it gets auto-stamped from model.connectivity at save time.
export const CONDITION_KEYS: (keyof ConditionSnapshot)[] = [
  'OVERALL_CONDITION',
  'SCREEN_CONDITION',
  'BODY_CONDITION',
  'BATTERY_HEALTH',
];
