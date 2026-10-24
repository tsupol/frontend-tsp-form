import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ClipboardCheck, X } from 'lucide-react';
import { apiClient } from '../lib/api';
import { wsClient } from '../lib/api/ws';
import { ownCountersChannel } from '../lib/scope';
import { useAuth } from '../contexts/AuthContext';
import {
  contractCodeOf, customerNameOf, deeplinkFor, detailFor, resolveCategory, titleFor,
  type ListResponse, type NotificationRow,
} from './NotificationMenu';

// Approval notices people missed in the bell (Ohm 2026-10-24): a request that
// needs approving, was approved or was sent back stays on screen until someone
// opens it or closes it. It never blocks the page — a cashier mid-payment
// keeps working and deals with it after.
//
// The trigger is the counters push the backend already sends on every request
// change. It carries no notice, so a push means "look at the unread list";
// anything new and approval-shaped there becomes a card. Never filter on the
// push's `reason`: the backend sends one push per change per branch, labelled
// with whichever write came first (a resubmit arrives as CONTRACT_STATE).

const CHECK_DEBOUNCE_MS = 1_500;
const MAX_VISIBLE = 3;
// Notices from just before the tab opened still count as new — a push can land
// while the page is loading.
const OPEN_GRACE_MS = 60_000;

function isApprovalNotice(row: NotificationRow): boolean {
  return resolveCategory(row.event_type, row.category) === 'approval';
}

function contractIdOf(row: NotificationRow): number | null {
  return row.payload?.contract_id ?? row.contract_ids?.[0] ?? null;
}

export function ApprovalNotices() {
  const { t } = useTranslation();
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [notices, setNotices] = useState<NotificationRow[]>([]);

  const openedAt = useRef(Date.now() - OPEN_GRACE_MS);
  const seen = useRef(new Set<number>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const channel = ownCountersChannel(user);

  const check = useCallback(async () => {
    let res: ListResponse;
    try {
      res = await apiClient.rpc<ListResponse>('fn_staff_list_notifications', {
        p_category: null,
        p_unread_only: true,
        p_limit: 20,
        p_offset: 0,
      });
    } catch {
      return;
    }
    const fresh = (res.items ?? []).filter(r =>
      !r.is_read
      && !seen.current.has(r.notification_id)
      && isApprovalNotice(r)
      && new Date(r.created_at).getTime() >= openedAt.current,
    );
    if (!fresh.length) return;
    fresh.forEach(r => seen.current.add(r.notification_id));
    queryClient.invalidateQueries({ queryKey: ['notif', 'panel-list'] });
    queryClient.invalidateQueries({ queryKey: ['nav', 'notif-unread-summary'] });

    // Someone already looking at that contract sees it change in place.
    const onScreen = (r: NotificationRow) => {
      const cid = contractIdOf(r);
      return cid != null && new RegExp(`/${cid}(/|$)`).test(pathRef.current);
    };
    const show = fresh.filter(r => !onScreen(r));
    // Only the latest word on a contract stays up: "sent back" replaces an
    // earlier "approved" for the same contract instead of contradicting it.
    const latestPerContract = show.filter((r, i) => {
      const cid = contractIdOf(r);
      return cid == null || show.findIndex(o => contractIdOf(o) === cid) === i;
    });
    if (!latestPerContract.length) return;
    const replaced = new Set(latestPerContract.map(contractIdOf).filter((c): c is number => c != null));
    setNotices(prev => [
      ...latestPerContract,
      ...prev.filter(p => { const cid = contractIdOf(p); return cid == null || !replaced.has(cid); }),
    ]);
  }, [queryClient]);

  useEffect(() => {
    if (!isAuthenticated || !channel) return;

    const onEvent = () => {
      if (timerRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void check();
      }, CHECK_DEBOUNCE_MS);
    };

    const unsubHello = wsClient.onHello(() => { void check(); });
    const unsubEvent = wsClient.subscribe(channel, onEvent);
    return () => {
      unsubHello();
      unsubEvent();
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [isAuthenticated, channel, check]);

  // Dev only: preview the stack with real rows (DEV rarely has several live
  // requests at once). window.dispatchEvent(new CustomEvent('dev:approval-notices', { detail: rows }))
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onPreview = (e: Event) => {
      const rows = (e as CustomEvent<NotificationRow[]>).detail ?? [];
      setNotices(prev => [...rows, ...prev]);
    };
    window.addEventListener('dev:approval-notices', onPreview);
    return () => window.removeEventListener('dev:approval-notices', onPreview);
  }, []);

  // Logging out (or another user logging in) starts clean.
  useEffect(() => {
    if (!isAuthenticated) setNotices([]);
  }, [isAuthenticated]);

  const remove = (id: number) => setNotices(prev => prev.filter(n => n.notification_id !== id));

  const open = (row: NotificationRow) => {
    remove(row.notification_id);
    apiClient.rpc('fn_staff_mark_notification_read', { p_notification_id: row.notification_id })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['notif', 'panel-list'] });
        queryClient.invalidateQueries({ queryKey: ['nav', 'notif-unread-summary'] });
      })
      .catch(() => {});
  };

  if (!notices.length) return null;

  const visible = notices.slice(0, MAX_VISIBLE);
  const hidden = notices.length - visible.length;

  return (
    <div
      // Below the page header, so its buttons stay reachable; the bottom is
      // worse — that's where a detail panel keeps its action footer.
      className="fixed z-[60] top-16 md:top-[3.25rem] right-3 left-3 md:left-auto md:w-[22rem] flex flex-col gap-2"
      role="region"
      aria-label={t('approvalNotice.region')}
    >
      {visible.map(row => {
        const to = deeplinkFor(row);
        const code = contractCodeOf(row);
        const customer = customerNameOf(row);
        const detail = detailFor(row, t);
        const body = (
          <>
            <span className="flex-none mt-0.5 w-7 h-7 rounded-full bg-primary-soft text-primary-fg flex items-center justify-center">
              <ClipboardCheck size={14} />
            </span>
            <span className="min-w-0 flex-1 flex flex-col gap-0.5 pr-6">
              <span className="font-medium text-sm">{titleFor(row, t)}</span>
              {(customer || code) && (
                <span className="text-xs text-subtle truncate">
                  {[customer, code].filter(Boolean).join(' · ')}
                </span>
              )}
              {detail && <span className="text-xs">{detail}</span>}
              {to && (
                <span className="mt-1 text-xs font-medium text-primary-fg inline-flex items-center gap-0.5">
                  {t('approvalNotice.open')}
                  <ChevronRight size={12} />
                </span>
              )}
            </span>
          </>
        );
        const cardCls = 'flex gap-3 w-full text-left px-3 py-3 no-underline text-inherit';
        return (
          <div
            key={row.notification_id}
            className="relative rounded-lg border border-line bg-surface-elevated shadow-lg"
          >
            {to ? (
              <Link
                to={to}
                className={`${cardCls} rounded-lg hover:bg-item-hover-bg`}
                onClick={() => open(row)}
                onAuxClick={(e) => { if (e.button === 1) open(row); }}
              >
                {body}
              </Link>
            ) : (
              <div className={cardCls}>{body}</div>
            )}
            <button
              type="button"
              className="absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center text-subtle hover:bg-item-hover-bg hover:text-fg cursor-pointer"
              aria-label={t('common.dismiss')}
              onClick={() => remove(row.notification_id)}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
      {hidden > 0 && (
        <div className="rounded-lg border border-line bg-surface-elevated shadow-lg px-3 py-2 text-xs text-subtle">
          {t('approvalNotice.more', { count: hidden })}
        </div>
      )}
    </div>
  );
}
