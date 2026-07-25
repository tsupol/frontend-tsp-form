export interface CompanyConfig {
  company_id: number;
  company_name: string;
  holding_id: number;
  draft_expiry_days: number;
  draft_expiry_warn_days: number;
  grace_period_days: number;
  late_fee_per_day: number;
  late_fee_split_holding: number;
  late_fee_split_company: number;
  comm_min_active_days: number;
  comm_min_paid_installments: number;
  comm_require_no_overdue: boolean;
  pause_enabled: boolean;
  pause_max_deferred: number;
  repo_fee_per_case: number;
  max_co_lessees: number;
  deposit_max_days: number;
  buyback_auto_reject_days: number;
  pay_pending_limit: number;
  repair_pickup_max_days: number;
  icloud_device_cap: number;
  updated_by: number | null;
  updated_at: string;
}

export type EditableField = {
  key: keyof CompanyConfig;
  label: string;
  type: 'number' | 'boolean';
  group: string;
  min?: number;
  max?: number;
};
