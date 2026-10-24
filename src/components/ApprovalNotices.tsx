import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from 'tsp-form';
import { ChevronRight, ClipboardCheck, Minus, X } from 'lucide-react';
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
// Shaped like the chat dock: a panel that drags by its header and shrinks to a
// bubble with a count. A new notice opens the panel again, so shrinking it
// never hides the next one.
//
// The trigger is the counters push the backend already sends on every request
// change. It carries no notice, so a push means "look at the unread list";
// anything new and approval-shaped there becomes a card. Never filter on the
// push's `reason`: the backend sends one push per change per branch, labelled
// with whichever write came first (a resubmit arrives as CONTRACT_STATE).

const CHECK_DEBOUNCE_MS = 1_500;
// Notices from just before the tab opened still count as new — a push can land
// while the page is loading.
const OPEN_GRACE_MS = 60_000;

/** Pointer travel (px) past which a press counts as a drag, not a click. */
const DRAG_THRESHOLD = 4;
const EDGE_MARGIN = 8;
const PANEL_WIDTH = 360;
const BUBBLE_SIZE = 48;
/** Just under the page header, right edge — where it first appears. */
const DEFAULT_POSITION: DockPos = { right: 12, top: 52 };
const STORAGE_KEY = 'approval-notices-position';

/**
 * Distance from the RIGHT and TOP edges: the panel starts top-right, so a
 * window resize keeps it where it was rather than drifting off-screen.
 */
interface DockPos { right: number; top: number }

function loadPosition(): DockPos {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as DockPos;
      if (typeof p.right === 'number' && typeof p.top === 'number') return p;
    }
  } catch { /* storage unavailable — use the default */ }
  return DEFAULT_POSITION;
}

/** Keep the whole box on screen, measured at its current size. */
function clamp(pos: DockPos, size: { width: number; height: number }): DockPos {
  const maxRight = Math.max(EDGE_MARGIN, window.innerWidth - size.width - EDGE_MARGIN);
  const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - size.height - EDGE_MARGIN);
  return {
    right: Math.min(Math.max(pos.right, EDGE_MARGIN), maxRight),
    top: Math.min(Math.max(pos.top, EDGE_MARGIN), maxTop),
  };
}

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
  const [expanded, setExpanded] = useState(true);
  const [position, setPositionState] = useState<DockPos>(loadPosition);
  const [dragging, setDragging] = useState(false);

  const openedAt = useRef(Date.now() - OPEN_GRACE_MS);
  const seen = useRef(new Set<number>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const boxRef = useRef<HTMLDivElement>(null);

  const channel = ownCountersChannel(user);

  // Newest on top; only the latest word on a contract stays up — "sent back"
  // replaces an earlier "approved" for the same contract instead of
  // contradicting it. Anything new opens the panel again.
  const addNotices = useCallback((rows: NotificationRow[]) => {
    const latestPerContract = rows.filter((r, i) => {
      const cid = contractIdOf(r);
      return cid == null || rows.findIndex(o => contractIdOf(o) === cid) === i;
    });
    if (!latestPerContract.length) return;
    const replaced = new Set(latestPerContract.map(contractIdOf).filter((c): c is number => c != null));
    setNotices(prev => [
      ...latestPerContract,
      ...prev.filter(p => { const cid = contractIdOf(p); return cid == null || !replaced.has(cid); }),
    ]);
    setExpanded(true);
  }, []);

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
    addNotices(fresh.filter(r => !onScreen(r)));
  }, [queryClient, addNotices]);

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
    const onPreview = (e: Event) => addNotices((e as CustomEvent<NotificationRow[]>).detail ?? []);
    window.addEventListener('dev:approval-notices', onPreview);
    return () => window.removeEventListener('dev:approval-notices', onPreview);
  }, [addNotices]);

  // Logging out (or another user logging in) starts clean.
  useEffect(() => {
    if (!isAuthenticated) setNotices([]);
  }, [isAuthenticated]);

  // ── Position ────────────────────────────────────────────────────────────
  const measure = () => {
    const r = boxRef.current?.getBoundingClientRect();
    return r ? { width: r.width, height: r.height } : { width: PANEL_WIDTH, height: BUBBLE_SIZE };
  };

  const setPosition = useCallback((next: DockPos) => setPositionState(clamp(next, measure())), []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(position)); } catch { /* not saved — fine */ }
  }, [position]);

  // Re-clamp when the window shrinks, the panel opens/shrinks or the list
  // grows — each changes the footprint, and the box must stay reachable.
  useEffect(() => {
    if (!notices.length) return;
    setPositionState(prev => clamp(prev, measure()));
    const onResize = () => setPositionState(prev => clamp(prev, measure()));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [expanded, notices.length]);

  // Same gesture as the chat dock: measure from where the press began, never
  // step by step, and keep the handlers on a plain <div> (pointer capture on a
  // button swallows its click). A press that never passes the threshold is a
  // click — on the bubble it opens the panel.
  const positionRef = useRef(position);
  positionRef.current = position;
  const dragIntent = useRef<{ startX: number; startY: number; originRight: number; originTop: number; moved: boolean } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const hit = (e.target as HTMLElement).closest('button,[role="button"],a,input,textarea');
    if (hit && hit !== e.currentTarget) return;
    dragIntent.current = {
      startX: e.clientX,
      startY: e.clientY,
      originRight: positionRef.current.right,
      originTop: positionRef.current.top,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const intent = dragIntent.current;
    if (!intent) return;
    const dx = e.clientX - intent.startX;
    const dy = e.clientY - intent.startY;
    if (!intent.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!intent.moved) {
      intent.moved = true;
      setDragging(true);
    }
    setPosition({ right: intent.originRight - dx, top: intent.originTop + dy });
  }, [setPosition]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const intent = dragIntent.current;
    dragIntent.current = null;
    setDragging(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (intent && !intent.moved && !expanded) setExpanded(true);
  }, [expanded]);

  // ── Cards ───────────────────────────────────────────────────────────────
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

  const grab = dragging ? 'cursor-grabbing' : 'cursor-grab';
  const mdGrab = dragging ? 'md:cursor-grabbing' : 'md:cursor-grab';
  // Phones have no room to move a box around: pinned under the header, full width.
  const placeCls = 'fixed z-[60] max-md:top-16! max-md:left-3! max-md:right-3!';

  if (!expanded) {
    return (
      <div
        ref={boxRef}
        className={placeCls + ' max-md:left-auto!'}
        style={{ right: position.right, top: position.top }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(true); } }}
          aria-label={t('approvalNotice.expand')}
          className={`relative flex items-center justify-center rounded-full bg-primary text-primary-contrast shadow-lg transition-transform hover:scale-105 ${grab}`}
          style={{ width: BUBBLE_SIZE, height: BUBBLE_SIZE }}
        >
          <ClipboardCheck size={20} />
          <span className="absolute -top-1 -right-1 pointer-events-none">
            <Badge size="xs" color="danger">{notices.length}</Badge>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      className={`${placeCls} md:w-[22.5rem] flex flex-col max-h-[min(32rem,calc(100dvh-5rem))] rounded-xl border border-line bg-bg shadow-lg overflow-hidden`}
      style={{ right: position.right, top: position.top }}
      role="region"
      aria-label={t('approvalNotice.region')}
    >
      {/* Header doubles as the drag handle, like the chat dock's. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={`flex-none flex items-center gap-2 pl-3 pr-1.5 py-1.5 border-b border-line bg-surface select-none ${mdGrab}`}
      >
        <ClipboardCheck size={16} className="shrink-0 text-subtle" />
        <span className="flex-1 min-w-0 text-sm font-medium truncate">{t('approvalNotice.region')}</span>
        <Badge size="xs" color="danger">{notices.length}</Badge>
        <Button
          variant="ghost"
          size="sm"
          className="btn-icon-sm"
          startIcon={<Minus size={14} />}
          onClick={() => setExpanded(false)}
          aria-label={t('approvalNotice.collapse')}
        />
        <Button
          variant="ghost"
          size="sm"
          className="btn-icon-sm"
          startIcon={<X size={14} />}
          onClick={() => setNotices([])}
          aria-label={t('approvalNotice.dismissAll')}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto better-scroll">
        {notices.map(row => {
          const to = deeplinkFor(row);
          const code = contractCodeOf(row);
          const customer = customerNameOf(row);
          const detail = detailFor(row, t);
          const body = (
            <>
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
          const cardCls = 'flex w-full text-left px-3 py-2.5 no-underline text-inherit';
          return (
            <div key={row.notification_id} className="relative border-b border-line last:border-b-0">
              {to ? (
                <Link
                  to={to}
                  className={`${cardCls} hover:bg-item-hover-bg`}
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
      </div>
    </div>
  );
}
