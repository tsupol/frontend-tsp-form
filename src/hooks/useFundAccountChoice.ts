// State for the fund-account picker (FundAccountField): the fund's company
// accounts, with the usual one picked in advance.

import { useCallback, useEffect, useState } from 'react';
import { useFundSourceAccounts, type FundSourceAccount } from '../pages/fund-bills/useFundBills';

export interface FundAccountChoice {
  accounts: FundSourceAccount[];
  loading: boolean;
  /** The picked account id, '' while none. */
  accountId: string;
  setAccountId: (id: string) => void;
  /** Back to the usual account — call when the host modal opens. */
  reset: () => void;
  /** Picked something other than the account chosen in advance. */
  changed: boolean;
  /** Loaded, and the fund has no active company account. */
  empty: boolean;
}

export function useFundAccountChoice(companyId: number | null): FundAccountChoice {
  const { accounts, isLoading } = useFundSourceAccounts(companyId);
  const [accountId, setAccountId] = useState('');

  // The usual account; a fund with exactly one account has no real choice.
  const preset = accounts.find(a => a.is_default) ?? (accounts.length === 1 ? accounts[0] : null);
  const presetId = preset ? String(preset.id) : '';

  useEffect(() => {
    if (!accountId && presetId) setAccountId(presetId);
  }, [accountId, presetId]);

  const reset = useCallback(() => setAccountId(''), []);

  return {
    accounts,
    loading: isLoading,
    accountId,
    setAccountId,
    reset,
    changed: !!accountId && accountId !== presetId,
    empty: companyId != null && !isLoading && accounts.length === 0,
  };
}

