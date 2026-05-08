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
  | 'REVERSE_BILL';

export type BillActionCategory = 'PAYMENT' | 'LINE' | 'APPROVAL' | 'LIFECYCLE';

export type BillBlockingReason =
  | 'status_not_allowed'
  | 'bill_purpose_not_match'
  | 'pending_approval_blocks'
  | 'not_paid_in_full'
  | 'permission_denied';

export interface BillAction {
  action_code: BillActionCode;
  category: BillActionCategory;
  rpc_name: string;
  is_available: boolean;
  blocking_reason: BillBlockingReason | null;
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
