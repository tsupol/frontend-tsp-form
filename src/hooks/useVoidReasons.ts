import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api';

/*
 * Void reason codes (mig 620) — the "why" a bill / payment was reversed.
 * Source: GET /v_ref_void_reasons. Only PAYMENT_RETURNED is customer-visible;
 * that gating is the backend's job (see UI_SUMMARY 2026-07-14 void_reason_code),
 * so the picker just offers all active codes and passes the chosen one to the
 * void RPC as p_reason_code. Not sending a code is allowed (the RPC defaults it
 * to null) but then the customer-facing PAYMENT_RETURNED signal never fires, so
 * every void flow should offer this picker.
 */
export interface VoidReason {
  code: string;
  name_th: string;
  name_en: string | null;
  description_th: string | null;
  is_customer_visible: boolean;
  sort_order: number;
}

export function useVoidReasons() {
  const { i18n } = useTranslation();
  const query = useQuery({
    queryKey: ['ref-void-reasons'],
    queryFn: () => apiClient.get<VoidReason[]>('/v_ref_void_reasons?order=sort_order'),
    staleTime: 60 * 60 * 1000,
  });

  const options = (query.data ?? []).map((r) => ({
    value: r.code,
    label: i18n.language === 'th' ? r.name_th : (r.name_en ?? r.name_th),
  }));

  return { options, ...query };
}
