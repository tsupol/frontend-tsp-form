import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';
import type { BuybackDraft, CardStatus, BuybackLine } from './types';
import { CONDITION_KEYS } from './types';

const QUERY_KEY = (poId: number | null) => ['buyback-draft', poId];

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
    // The list page caches buyback rows under ['buyback-orders', ...] — bust
    // it so newly-created drafts (and status changes) show up immediately.
    queryClient.invalidateQueries({ queryKey: ['buyback-orders'] });
  };
  return { ...query, invalidate };
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
): CardStatus {
  if (!draft) return 'locked';
  if (draft.status !== 'DRAFT') return 'complete';
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
