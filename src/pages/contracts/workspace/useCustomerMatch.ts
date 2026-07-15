import { useState, useCallback } from 'react';
import { apiClient } from '../../../lib/api';

/*
 * Dedupe check before opening a contract / attaching a customer (migs 623/624).
 * Doc: UI_FEEDBACK/2026-07-14_DELIVERY_fn_customer_match_dedupe.md
 *
 * The old "check customer" did `id_number.ilike` on v_customers — but that view
 * MASKS the CID (1-****-****0-00-0), so an ID search always returned 0 rows and
 * staff silently created duplicates. Worse, fn_customer_register_or_update keys
 * purely on id_number: a mistyped CID that collides with a real customer
 * OVERWRITES that person's name+phone and returns ok:true.
 *
 * fn_customer_match searches holding-wide on the UNMASKED id, returns a verdict
 * and full (unmasked) CIDs so staff can compare against the physical card.
 * ID_MATCH_NAME_MISMATCH must block the register call entirely.
 */
export type MatchVerdict =
  | 'ID_EXACT_MATCH'
  | 'ID_MATCH_NAME_MISMATCH'
  | 'NAME_EXACT_MATCH'
  | 'PARTIAL_MATCH'
  | 'NO_MATCH';

export interface MatchedCustomer {
  id: number;
  prefix: string | null;
  first_name: string;
  last_name: string;
  full_name: string;
  id_type: 'CITIZEN_ID' | 'PASSPORT';
  id_number: string;                 // full, unmasked
  tel: string | null;
  tel2: string | null;
  branch_id: number | null;
  is_active: boolean;
  match_tier: 'ID_EXACT' | 'NAME_EXACT' | 'PARTIAL';
  matched: { id_number: boolean; first_name: boolean; last_name: boolean };
  name_mismatch: boolean;
  contracts: { count: number; active_count: number };
}

export interface MatchResult {
  verdict: MatchVerdict;
  count: number;
  customers: MatchedCustomer[];
}

export function useCustomerMatch() {
  const [result, setResult] = useState<MatchResult | null>(null);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState('');

  const runMatch = useCallback(async (input: { idNumber?: string; firstName?: string; lastName?: string }) => {
    setMatching(true);
    setError('');
    try {
      const res = await apiClient.rpc<MatchResult>('fn_customer_match', {
        p_id_number: input.idNumber?.trim() || null,
        p_first_name: input.firstName?.trim() || null,
        p_last_name: input.lastName?.trim() || null,
      });
      setResult(res);
      return res;
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setMatching(false);
    }
  }, []);

  const reset = useCallback(() => { setResult(null); setError(''); }, []);

  // The CID collides with a different-named customer — must not register/overwrite.
  const blocked = result?.verdict === 'ID_MATCH_NAME_MISMATCH';

  return { result, matching, error, runMatch, reset, blocked };
}
