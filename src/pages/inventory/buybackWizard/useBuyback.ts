import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';
import type { BuybackDraft, CardStatus, BuybackLine } from './types';
import { CONDITION_KEYS } from './types';

const QUERY_KEY = (poId: number | null) => ['buyback-draft', poId];
const ACTIONS_KEY = (poId: number | null) => ['buyback-actions', poId];

export interface BuybackActionsResponse {
  po_id: number;
  po_type: string;
  status: string;
  branch_id: number | null;
  auto_reject_after: string | null;
  auto_rejected: boolean;
  validate_ready: boolean | null;
  validate_failing_checks: string[];
  actions: Array<{
    action_code: string;
    rpc_name: string;
    category: string;
    is_available: boolean;
    blocking_reason: string | null;
    require_pin: boolean;
    sort_order: number;
    target_line_id: number | null;
  }>;
}

export function useBuybackDraft(poId: number | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY(poId),
    queryFn: async () => {
      if (!poId) return null;
      const rows = await apiClient.get<BuybackDraft[]>(`/v_buyback_detail?po_id=eq.${poId}&limit=1`);
      return rows[0] ?? null;
    },
    enabled: poId !== null,
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY(poId) });
    // Photos count + actions queries also depend on this row's state.
    queryClient.invalidateQueries({ queryKey: ['buyback-photos-count', poId] });
    queryClient.invalidateQueries({ queryKey: ACTIONS_KEY(poId) });
    // The list page caches buyback rows under ['buyback-orders', ...] — bust
    // it so newly-created drafts (and status changes) show up immediately.
    queryClient.invalidateQueries({ queryKey: ['buyback-orders'] });
  };
  return { ...query, invalidate };
}

// Backend-driven action catalog + validate_ready flag (mig 114, 2026-05-27).
export function useBuybackActions(poId: number | null) {
  return useQuery({
    queryKey: ACTIONS_KEY(poId),
    queryFn: () => apiClient.rpc<BuybackActionsResponse>('fn_buyback_available_actions', { p_po_id: poId }),
    enabled: poId !== null,
    staleTime: 30 * 1000,
  });
}

// Buyback is always single-line per spec.
export function getLine(draft: BuybackDraft | null | undefined): BuybackLine | null {
  return draft?.lines?.[0] ?? null;
}

export function getSetupStatus(draft: BuybackDraft | null | undefined): CardStatus {
  if (!draft) return 'empty';
  const line = getLine(draft);
  if (!line) return 'empty';
  const hasModel = !!line.model_id && !!line.variant_id;
  const hasPrice = (line.buyback_price ?? 0) > 0;
  const hasSeller = !!draft.supplier_name?.trim();
  if (hasModel && hasPrice && hasSeller) return 'complete';
  if (hasModel || hasPrice || hasSeller) return 'partial';
  return 'empty';
}

export function getConditionStatus(draft: BuybackDraft | null | undefined): CardStatus {
  if (!draft) return 'locked';
  const line = getLine(draft);
  if (!line) return 'locked';
  if (!line.item_condition) return 'empty';
  const snap = (line.condition_snapshot ?? {}) as Record<string, unknown>;
  const filled = CONDITION_KEYS.filter(k => snap[k] && String(snap[k]).trim().length > 0);
  if (filled.length === CONDITION_KEYS.length) return 'complete';
  if (filled.length > 0) return 'partial';
  return 'empty';
}

export function getPhotosStatus(draft: BuybackDraft | null | undefined): CardStatus {
  if (!draft) return 'locked';
  const line = getLine(draft);
  if (!line) return 'locked';
  const n = Array.isArray(line.images) ? line.images.length : 0;
  if (n >= 4) return 'complete';
  if (n > 0) return 'partial';
  return 'empty';
}

export function getSubmitStatus(
  draft: BuybackDraft | null | undefined,
  setup: CardStatus,
  condition: CardStatus,
  actions?: BuybackActionsResponse | null,
): CardStatus {
  if (!draft) return 'locked';
  if (draft.status !== 'DRAFT') return 'complete';
  // Prefer the server-authoritative validate_ready when available. The doc
  // notes that during DRAFT browsing the 3 identifier checks always fail
  // because identifiers haven't been scanned yet, so we OR with the FE
  // heuristic: if setup+condition cards are complete, treat as ready-to-scan.
  if (actions && actions.validate_ready === true) return 'empty';
  if (setup !== 'complete' || condition !== 'complete') return 'locked';
  return 'empty';
}

// Matches the colors used by SummaryCard's STATUS_ICON.
export function statusIconColor(status: CardStatus): string {
  switch (status) {
    case 'complete': return 'text-success';
    case 'partial':  return 'text-warning-fg';
    case 'locked':   return 'text-fg/20';
    case 'empty':
    default:         return 'text-fg/40';
  }
}
