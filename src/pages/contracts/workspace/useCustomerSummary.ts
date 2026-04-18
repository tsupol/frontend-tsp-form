import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../../lib/api';

// ── Types ───────────────────────────────────────────────────────────────

export interface CustomerSummary {
  dateOfBirth: string | null;
  addresses: { home: boolean; work: boolean; shipping: boolean };
  contactCount: number;
  referenceCount: number;
  hasIdPhoto: boolean;
}

// ── Query key ───────────────────────────────────────────────────────────

export const customerQueryKey = (customerId: number | null) =>
  ['workspace-customer', customerId] as const;

// ── Hook ────────────────────────────────────────────────────────────────

export function useCustomerSummary(customerId: number | null) {
  return useQuery({
    queryKey: customerQueryKey(customerId),
    queryFn: async (): Promise<CustomerSummary> => {
      const [addrs, contacts, refs, custs, idCards] = await Promise.all([
        apiClient.get<Array<{ address_type: string }>>(
          `/v_customer_addresses?customer_id=eq.${customerId}&select=address_type`
        ),
        apiClient.get<Array<{ id: number }>>(
          `/v_customer_contacts?customer_id=eq.${customerId}&select=id`
        ),
        apiClient.get<Array<{ id: number }>>(
          `/v_customer_references?customer_id=eq.${customerId}&select=id`
        ),
        apiClient.get<Array<{ date_of_birth: string | null }>>(
          `/v_customers?id=eq.${customerId}&select=date_of_birth`
        ),
        apiClient.get<Array<{ id: number }>>(
          `/v_customer_documents?customer_id=eq.${customerId}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true&select=id`
        ),
      ]);
      return {
        dateOfBirth: custs[0]?.date_of_birth ?? null,
        addresses: {
          home: addrs.some(a => a.address_type === 'HOME'),
          work: addrs.some(a => a.address_type === 'WORK'),
          shipping: addrs.some(a => a.address_type === 'SHIPPING'),
        },
        contactCount: contacts.length,
        referenceCount: refs.length,
        hasIdPhoto: idCards.length > 0,
      };
    },
    enabled: !!customerId,
    staleTime: 0,
  });
}

// ── Invalidation helper ─────────────────────────────────────────────────

export function useInvalidateCustomer() {
  const qc = useQueryClient();
  return useCallback(
    (customerId: number | null) => {
      if (customerId) {
        qc.invalidateQueries({ queryKey: customerQueryKey(customerId) });
      }
    },
    [qc]
  );
}
