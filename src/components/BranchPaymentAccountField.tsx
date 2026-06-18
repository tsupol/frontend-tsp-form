import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge } from 'tsp-form';
import { Landmark, AlertCircle } from 'lucide-react';
import { apiClient } from '../lib/api';

/** v_branch_payment_account — the single override-aware receiving account
 *  resolved for the logged-in staff's own branch (JWT-scoped, 0 or 1 row). */
export interface BranchPaymentAccount {
  account_id: number;
  bank_name: string;
  account_number: string;
  account_number_display: string | null;
  account_name: string;
  source: 'OVERRIDE' | 'PRIMARY';
}

export function useBranchPaymentAccount(enabled = true) {
  return useQuery({
    queryKey: ['branch-payment-account'],
    queryFn: () =>
      apiClient
        .get<BranchPaymentAccount[]>('/v_branch_payment_account')
        .then(rows => rows[0] ?? null),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

interface Props {
  /** Called with the resolved account_id (or null) so the host can set its
   *  bank_account_id. Fires whenever the resolved account changes. */
  onResolve: (accountId: number | null) => void;
  /** Skip the query/render until the host actually needs it (e.g. method===TRANSFER). */
  active?: boolean;
}

/**
 * Read-only display of the branch's single override-aware receiving account.
 * Replaces the old "pick any bank account" dropdown for receive-side TRANSFER
 * flows. Auto-reports the resolved account_id via onResolve. Shows a warning
 * when the branch has no account configured.
 */
export function BranchPaymentAccountField({ onResolve, active = true }: Props) {
  const { t } = useTranslation();
  const { data: account = null, isSuccess } = useBranchPaymentAccount(active);

  // Report the resolved id to the host, but only when it actually changes —
  // onResolve is often an inline closure, so guarding by value (not identity)
  // prevents an update loop in per-line payment composers.
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;
  const lastReported = useRef<number | null | undefined>(undefined);
  const resolvedId = active ? account?.account_id ?? null : null;
  useEffect(() => {
    if (!active) {
      lastReported.current = undefined;
      return;
    }
    if (lastReported.current !== resolvedId) {
      lastReported.current = resolvedId;
      onResolveRef.current(resolvedId);
    }
  }, [active, resolvedId]);

  if (!active) return null;

  if (account) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
        <Landmark size={18} className="shrink-0 text-subtle" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate text-fg">{account.bank_name}</div>
          <div className="text-xs truncate">
            <span className="text-fg tabular-nums tracking-widest font-semibold">
              {account.account_number_display ?? account.account_number}
            </span>
            <span className="text-subtle"> · {account.account_name}</span>
          </div>
        </div>
        {account.source === 'OVERRIDE' && (
          <Badge color="warning" size="sm">{t('bankAccount.temporary')}</Badge>
        )}
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="alert alert-warning">
        <AlertCircle size={16} />
        <div className="alert-description">{t('bankAccount.noReceivingAccount')}</div>
      </div>
    );
  }

  return null;
}
