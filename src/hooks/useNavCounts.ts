import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { wsClient } from '../lib/api/ws';
import { useAuth } from '../contexts/AuthContext';
import { defaultScopeFor, scopeCounterParams, scopeCountersChannel, scopeKey } from '../lib/scope';

// Shared count queries powering badges in both the global AppSideNav and the
// per-section page sub-nav strips (ContractsLayout, etc.). Query keys match
// across consumers so React Query dedupes to a single fetch.
//
// Side-menu badges always use the user's default scope (independent of any
// dashboard scope picker).
//
// All 16 counters come from ONE RPC (`fn_branch_dashboard_counters`, mig 1067).
// This replaced 15 separate `Prefer: count=exact` view queries — each of which
// ran its view twice with no cap. Do not add a badge by fetching a view here;
// ask BE to add a key to the RPC.
// See UI_FEEDBACK/2026-08-11_DELIVERY_counters_rpc_confirmed_filters.md.

// Badges render "99+" past this (AppSideNav.iconWithCount), so counts only need
// to be exact below it. The RPC caps every value at 100 server-side ("≥100").
export const NAV_COUNT_CAP = 99;

// Rule 1 of the WS contract: an event says "something changed", never what. Wait
// this long, drop events arriving mid-wait, then refetch once. This is the shield
// against a busy branch hour turning every write into a request.
const WS_REFETCH_DEBOUNCE_MS = 3_000;

// Rule 4: the poll stays as a fallback, just slower. Some badges change with the
// clock and not with any write (midnight rollover, deposit deadlines passing,
// overnight dunning assignment) — no event can ever cover those.
const FALLBACK_POLL_MS = 300_000;

interface CountersResponse {
  capped_at: number;
  counters: Record<string, number>;
}

export function useNavCounts() {
  const { user } = useAuth();
  const role = user?.role_code ?? '';
  const isBranchUser = role === 'BRANCH_STAFF' || role === 'BRANCH_MANAGER';

  const scope = defaultScopeFor(user);
  const sk = scopeKey(scope);
  const queryClient = useQueryClient();
  const queryKey = ['nav', 'counters', sk];

  const { data } = useQuery({
    queryKey,
    queryFn: () => apiClient.rpc<CountersResponse>(
      'fn_branch_dashboard_counters',
      scopeCounterParams(scope),
    ),
    refetchInterval: FALLBACK_POLL_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // WS-driven refetch. The channel matches the scope tier the user belongs to;
  // SYSTEM_DEV unscoped has no channel and rides the fallback poll alone.
  const channel = scopeCountersChannel(scope);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;

    const refetch = () => { void queryClient.invalidateQueries({ queryKey: ['nav', 'counters', sk] }); };

    // Rule 1: coalesce a burst into one refetch. An event already pending means
    // this one needs no timer of its own — the truth is in the RPC either way.
    const onEvent = () => {
      if (timerRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        refetch();
      }, WS_REFETCH_DEBOUNCE_MS);
    };

    // Rule 3: events fired while the socket was down are gone — nothing replays
    // them. Refetch once on every reconnect to close the gap.
    const unsubHello = wsClient.onHello(refetch);
    const unsubEvent = channel ? wsClient.subscribe(channel, onEvent) : undefined;

    return () => {
      unsubHello();
      unsubEvent?.();
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
    // Rule 2 is a non-rule here by construction: we never read `reason` off the
    // payload, so there is no way to refetch a subset by accident.
  }, [user, channel, sk, queryClient]);

  const c = data?.counters;
  const n = (key: string) => c?.[key] ?? 0;

  // `unclosed_days` was split into two keys (mig 1067) because one number can't
  // serve both readings: branch users count their own unclosed DAYS, everyone
  // above counts BRANCHES that have any. Reading the retired single key here
  // would silently yield 0, not an error.
  const unclosedCount = isBranchUser ? n('unclosed_day_count') : n('unclosed_branch_count');

  return {
    pendingApprovals: n('pending_approvals'),
    pendingSlips: n('payment_submissions'),
    unclosedCount,
    pendingPairingCount: n('device_bind_delivery'),
    pendingSignCount: n('pending_sign'),
    savingContractsCount: n('saving_active'),
    draftContractsCount: n('saving_draft'),
    pendingPaymentCount: n('contracts_pending_pay_sign'),
    depositOverdueCount: n('deposited'),
    pausedContractsCount: n('paused'),
    unreadChatCount: n('chat_unread'),
    callCenterMineCount: n('my_book'),
    unassignedNoCollectorCount: n('unassigned'),
    legalWaitCount: n('repo_pool'),
    unreadNotifCount: n('notifications'),
  };
}
