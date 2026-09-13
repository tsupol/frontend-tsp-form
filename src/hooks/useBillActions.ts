import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

export type BillActionCode =
  | 'ADD_PAYMENT'
  | 'CONFIRM_PAYMENT'
  | 'VOID_PAYMENT'
  | 'ADD_LINE'
  | 'EDIT_LINE'
  | 'REMOVE_LINE'
  | 'CONVERT_TO_GIFT'
  | 'SUBMIT_APPROVAL'
  | 'REVIEW_APPROVAL'
  | 'CANCEL_APPROVAL'
  | 'CANCEL_BILL'
  | 'VOID_BILL'
  | 'CANCEL_CLOSED_DAY'
  | 'REVERSE_BILL'
  | 'REVERSE_CREDIT_NOTE'
  // mig 1159: waive the late fee on an already-issued CONTRACT_FEE bill
  | 'WAIVE_LATE_FEE';

export type BillActionCategory = 'PAYMENT' | 'LINE' | 'APPROVAL' | 'LIFECYCLE';

export type BillBlockingReason =
  | 'status_not_allowed'
  | 'bill_purpose_not_match'
  | 'bill_is_a_reversal'
  | 'pending_approval_blocks'
  | 'not_paid_in_full'
  | 'permission_denied'
  // CANCEL_CLOSED_DAY day-close guards (mig 953+954). The three lifecycle verbs
  // are mutually exclusive: a bill's day is either closed (only CANCEL_CLOSED_DAY)
  // or not (only CANCEL_BILL/VOID_BILL), and a reversed bill blocks all of them.
  | 'day_closed'
  | 'day_not_closed'
  | 'bill_already_reversed'
  // WAIVE_LATE_FEE guards (mig 1159): not a late-fee bill / nothing unpaid left to waive
  | 'charge_type_not_match'
  | 'nothing_remaining'
  // Previous-day guards (mig 1213). fn_bill_cancel has always refused a PAID bill
  // while the branch's earlier day was still open; now the evaluator says so up
  // front instead of letting the click fail. Two distinct cases:
  //   previous_day_not_closed — the bill is today's; close `unclosed_date` and retry
  //   previous_day_bill       — the bill itself belongs to that still-open earlier
  //                             day; the shop can never cancel it, a system admin must
  | 'previous_day_not_closed'
  | 'previous_day_bill';

/** Facts behind a blocking reason, for interpolation into its message.
 *  Populated only for the mig-1213 previous-day reasons; `null` otherwise. */
export interface BillBlockingParams {
  bill_date?: string;
  unclosed_date?: string;
  today?: string;
  // Open-ended: a later migration can add facts to a reason without this type
  // having to know them, and the message just interpolates whatever arrives.
  [key: string]: unknown;
}

export interface BillAction {
  action_code: BillActionCode;
  category: BillActionCategory;
  rpc_name: string;
  is_available: boolean;
  blocking_reason: BillBlockingReason | null;
  blocking_params: BillBlockingParams | null;
  require_pin: boolean;
  creates_credit_note: boolean;
  target_status: string | null;
  sort_order: number;
  required_permission?: string | null;
}

export interface BillActionsResponse {
  bill_id: number;
  code_display: string;
  status: string;
  bill_purpose: string;
  total_amount: number;
  paid_amount: number;
  has_pending_approval: boolean;
  pending_approval_count: number;
  pending_approval_total: number;
  remaining_amount: number;
  role_code: string;
  actions: BillAction[];
}

const STALE_TIME = 30 * 1000;

export function useBillActions(billId: number | null) {
  const query = useQuery({
    queryKey: ['bill-actions', billId],
    queryFn: () => apiClient.rpc<BillActionsResponse>('fn_bill_available_actions', {
      p_bill_id: billId,
    }),
    enabled: billId != null,
    staleTime: STALE_TIME,
  });

  const getAction = (code: BillActionCode): BillAction | undefined =>
    query.data?.actions.find(a => a.action_code === code);

  const isAvailable = (code: BillActionCode): boolean =>
    getAction(code)?.is_available ?? false;

  return {
    ...query,
    getAction,
    isAvailable,
  };
}
