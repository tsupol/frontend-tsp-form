// Shared types + module config for the 3 Dunning Config tabs (notif, blacklist,
// legal). Each module exposes the same RPC shape via different names
// (`api.fn_admin_<module>_dunning_stage_list / _set / _reset`). Each list row
// has the same generic envelope:
//
//   { kind, stage, description, template, effective, ...moduleField }
//
// where the per-module extra field is:
//   - notif     : event_type   (fixed by stage, NOT editable via _set)
//   - blacklist : reason_code  (editable)
//   - legal     : action_code  (editable)
//
// Notif's event_type comes back at the top level of the row; the others come
// inside template/effective. We normalize that in the hook.
//
// The former `ops` (call-center) ladder was removed 2026-07-28 — the automatic
// call-ticket system it configured is obsolete (nothing read the ladder). See
// UI_FEEDBACK/2026-07-27_REMOVE_ops_call_ticket_dunning_obsolete.md.

export type DunningModule = 'notif' | 'blacklist' | 'legal';

export type StageKind = 'pre_due' | 'overdue' | string;

// Embedded "template" (system default) — present on every row.
export interface DunningStageTemplate {
  active: boolean;
  day_from: number;
  day_to: number | null;
  priority: number;
  // Per-module extra. Present only for non-notif modules — but kept optional
  // on the union so a single type covers all 4.
  reason_code?: string;
  action_code?: string;
}

// Embedded "effective" — what's actually applied for this holding (with
// audit + custom-flag bookkeeping).
export interface DunningStageEffective extends DunningStageTemplate {
  is_custom: boolean;
  updated_at: string | null;
  updated_by: number | null;
}

export interface DunningStageRow {
  kind: StageKind;
  stage: string;            // stable code, e.g. "overdue_8d"
  description: string;
  template: DunningStageTemplate;
  // null when the holding has no override for this stage — the template (system
  // default) is then what's actually applied. Callers must fall back to template.
  effective: DunningStageEffective | null;
  // Notif only: top-level event_type (read-only label, no _set param)
  event_type?: string;
}

export interface DunningStagesResponse {
  holding_id: number;
  stages: DunningStageRow[];
}

// Per-module config: which extra editable field (if any) the _set RPC exposes.
export interface DunningModuleConfig {
  module: DunningModule;
  /** Extra column key for non-notif modules. Notif has none (it's a fixed event_type label). */
  extraField?: 'reason_code' | 'action_code';
  /** i18n key under `dunningSystem.tab_*` for tab label */
  labelKey: string;
  /** RPC function names — derived but spelled out for clarity */
  rpc: {
    list:  string;  // fn_admin_<module>_dunning_stage_list
    set:   string;  // fn_admin_<module>_dunning_stage_set
    reset: string;  // fn_admin_<module>_dunning_stage_reset
  };
}

export const MODULE_CONFIG: Record<DunningModule, DunningModuleConfig> = {
  notif: {
    module: 'notif',
    labelKey: 'dunningSystem.tab_notif',
    rpc: {
      list:  'fn_admin_notif_dunning_stage_list',
      set:   'fn_admin_notif_dunning_stage_set',
      reset: 'fn_admin_notif_dunning_stage_reset',
    },
  },
  blacklist: {
    module: 'blacklist',
    extraField: 'reason_code',
    labelKey: 'dunningSystem.tab_blacklist',
    rpc: {
      list:  'fn_admin_blacklist_dunning_stage_list',
      set:   'fn_admin_blacklist_dunning_stage_set',
      reset: 'fn_admin_blacklist_dunning_stage_reset',
    },
  },
  legal: {
    module: 'legal',
    extraField: 'action_code',
    labelKey: 'dunningSystem.tab_legal',
    rpc: {
      list:  'fn_admin_legal_dunning_stage_list',
      set:   'fn_admin_legal_dunning_stage_set',
      reset: 'fn_admin_legal_dunning_stage_reset',
    },
  },
};

// Read the per-module extra value from a row's applied config in a type-safe
// way. Falls back to the template when the holding has no override.
// Returns undefined for notif (no extra).
export function getEffectiveExtra(
  row: DunningStageRow,
  cfg: DunningModuleConfig,
): string | undefined {
  if (!cfg.extraField) return undefined;
  return (row.effective ?? row.template)[cfg.extraField];
}
