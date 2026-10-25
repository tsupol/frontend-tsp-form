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

// Notices someone is waiting on stay on screen until that person presses them
// (owner 2026-10-25, UI_SUMMARY/153): a shop waiting for approval walks away,
// comes back, and the answer is still there — the same for the fund's desk
// when a shop submits or withdraws. It never blocks the page — a cashier
// mid-payment keeps working and deals with it after.
//
// What shows is decided by the unread list alone, every unread notice the
// backend marks `dismissible: false` — including ones from before this page
// opened, and on every reload, until it is acknowledged. The counters push and
// a slow poll only say "look again": push is best-effort (web-push needs a
// per-browser opt-in), so it can never be what puts a card up. Never filter on
// the push's `reason`: the backend sends one push per change per branch,
// labelled with whichever write came first.

const CHECK_DEBOUNCE_MS = 1_500;
const POLL_MS = 60_000;
const MAX_VISIBLE = 3;

/** Stays until pressed. Rows from before mig 1502 carried no flag; for those,
 *  the approval category was the old rule. */
function mustStay(row: NotificationRow): boolean {
  if (row.dismissible != null) return row.dismissible === false;
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
  // Every unread must-stay notice, newest first, as the backend last said.
  const [pending, setPending] = useState<NotificationRow[]>([]);
  // Pressed here but the acknowledgement may not have landed yet — hidden so a
  // check racing the request doesn't bring the card back.
  const [acked, setAcked] = useState<Set<number>>(() => new Set());

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countRef = useRef(0);

  const channel = ownCountersChannel(user);

  const check = useCallback(async () => {
    let res: ListResponse;
    try {
      res = await apiClient.rpc<ListResponse>('fn_staff_list_notifications', {
        p_category: null,
        p_unread_only: true,
        p_limit: 50,
        p_offset: 0,
      });
    } catch {
      return;
    }
    const rows = (res.items ?? []).filter(r => !r.is_read && mustStay(r));
    if (rows.length !== countRef.current) {
      countRef.current = rows.length;
      queryClient.invalidateQueries({ queryKey: ['notif', 'panel-list'] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'notif-unread-summary'] });
    }
    setPending(rows);
  }, [queryClient]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void check();
    const poll = setInterval(() => { void check(); }, POLL_MS);
    if (!channel) return () => clearInterval(poll);

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
      clearInterval(poll);
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
      setPending(prev => [...rows, ...prev]);
    };
    window.addEventListener('dev:approval-notices', onPreview);
    return () => window.removeEventListener('dev:approval-notices', onPreview);
  }, []);

  // Logging out (or another user logging in) starts clean.
  useEffect(() => {
    if (!isAuthenticated) { setPending([]); setAcked(new Set()); countRef.current = 0; }
  }, [isAuthenticated]);

  // Someone already looking at that contract sees it change in place; the
  // card waits (still unread) and shows once they leave the page.
  const onScreen = (r: NotificationRow) => {
    const cid = contractIdOf(r);
    return cid != null && new RegExp(`/${cid}(/|$)`).test(location.pathname);
  };
  const live = pending.filter(r => !acked.has(r.notification_id));
  const shown = live.filter(r => !onScreen(r));
  // Only the latest word on a contract shows: "sent back" replaces an earlier
  // "approved" for the same contract instead of contradicting it.
  const notices = shown.filter((r, i) => {
    const cid = contractIdOf(r);
    return cid == null || shown.findIndex(o => contractIdOf(o) === cid) === i;
  });

  // Pressing a card (open or ×) is the acknowledgement. It also covers the
  // older notices it replaced for the same contract — the user has seen the
  // latest word, and the earlier one would otherwise come back on reload.
  const acknowledge = (row: NotificationRow) => {
    const cid = contractIdOf(row);
    const ids = cid == null
      ? [row.notification_id]
      : live.filter(r => r.notification_id === row.notification_id || contractIdOf(r) === cid).map(r => r.notification_id);
    setAcked(prev => new Set([...prev, ...ids]));
    Promise.all(ids.map(id => apiClient.rpc('fn_staff_ack_notification', { p_notification_id: id })))
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['notif', 'panel-list'] });
        queryClient.invalidateQueries({ queryKey: ['nav', 'notif-unread-summary'] });
        void check();
      })
      // Not recorded — let the card come back rather than lose the notice.
      .catch(() => setAcked(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next; }));
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
                onClick={() => acknowledge(row)}
                onAuxClick={(e) => { if (e.button === 1) acknowledge(row); }}
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
              onClick={() => acknowledge(row)}
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
