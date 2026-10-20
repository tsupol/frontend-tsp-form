import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, PopOver, Tooltip } from 'tsp-form';
import {
  Bell, MessageSquare, FileText, CreditCard, AlertTriangle, CheckCheck,
  ClipboardCheck, Info,
} from 'lucide-react';
import clsx from 'clsx';
import { apiClient } from '../lib/api';
import { fmtCurrency } from '../lib/format';

// ── Types ───────────────────────────────────────────────────────────────────

type NotifCategory = 'contract' | 'chat' | 'payment' | 'approval' | 'system';

type NotificationRow = {
  notification_id: number;
  event_type: string;
  // Top-level variant discriminator (mig 27). NULL until Phase A2 wires
  // producers — fall back to plain event_type when missing.
  event_variant: string | null;
  category: NotifCategory | string;
  // title/body/deeplink kept until Phase B; we ignore them on in-app rendering.
  title: string | null;
  body: string | null;
  payload: {
    contract_id?: number;
    contract_code?: string;        // canonical, always formatted (mig 27)
    customer_full_name?: string;   // canonical (mig 27)
    signing_id?: number;
    new_lessee_name?: string;
    bill_code?: string;
    amount?: number | string;
    staff_name?: string;
    // Buyback approval (PART_022 mig 100) — routes to /admin/approvals.
    po_id?: number;
    po_type?: string;
    po_code?: string;
    branch_name?: string;
    requested_by_name?: string;
    // ABM enrollment OTP relay (UI_SUMMARY/137). otp_code is empty when the
    // SMS couldn't be parsed — the title must still render.
    otp_code?: string;
    login_email?: string;
    // Shop credit request (mig 1449). reason_text is "reason name — note",
    // only on a returned request.
    case_id?: number;
    reason_text?: string;
    // Shop close-out request (mig 1471). net_amount_text only on a submit;
    // the return reason + note only on a return.
    settlement_id?: number;
    settlement_code?: string;
    net_amount_text?: string;
    return_reason_name?: string;
    return_note?: string;
  } | null;
  contract_ids: number[] | null;
  created_at: string;
  is_read: boolean;
};

type ListResponse = {
  items: NotificationRow[];
  total: number;
  limit: number;
  offset: number;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(t: ReturnType<typeof useTranslation>['t'], iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMin = Math.floor((Date.now() - then) / 60_000);
  if (diffMin < 1) return t('notifCenter.time.justNow');
  if (diffMin < 60) return t('notifCenter.time.minAgo', { n: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('notifCenter.time.hrAgo', { n: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return t('notifCenter.time.dayAgo', { n: diffDay });
  const diffWk = Math.floor(diffDay / 7);
  return t('notifCenter.time.weekAgo', { n: diffWk });
}

// Map event_type to category for tab filtering + icon. The BE `category` field
// is unreliable (chat_status_attention currently ships as `system`).
function resolveCategory(evt: string, fallback: string): NotifCategory | string {
  if (evt.startsWith('chat_')) return 'chat';
  if (evt.startsWith('signing_') || evt.startsWith('bind_') || evt.startsWith('contract_')) return 'contract';
  if (evt.startsWith('bill_') || evt === 'slip_uploaded') return 'payment';
  if (evt.endsWith('_approval_required_staff') || evt.startsWith('buyback_') || evt.startsWith('partner_case_') || evt.startsWith('partner_settlement_')) return 'approval';
  return fallback;
}

function iconForCategory(category: string) {
  switch (category) {
    case 'contract': return <FileText size={14} />;
    case 'chat':     return <MessageSquare size={14} />;
    case 'payment': return <CreditCard size={14} />;
    case 'approval': return <ClipboardCheck size={14} />;
    // Informational system events (e.g. ABM OTP) — a warning triangle would
    // overstate them, so only genuinely unknown rows keep it.
    case 'system':   return <Info size={14} />;
    default:         return <AlertTriangle size={14} />;
  }
}

// BE canonical fields (mig 27): contract_code is always formatted via
// sale.format_business_code; customer_full_name is the canonical name.
function contractCodeOf(row: NotificationRow): string | null {
  return row.payload?.contract_code ?? null;
}

function customerNameOf(row: NotificationRow): string | null {
  return row.payload?.customer_full_name ?? null;
}

// FE owns deeplinks. event_type + payload → route.
function deeplinkFor(row: NotificationRow): string | null {
  const evt = row.event_type;
  // Buyback approval (PART_022 mig 100) — no contract_id; the approval lives on
  // the Approvals page (BUYBACK type). Routed before the contract_id guard below.
  if (evt === 'buyback_approval_required_staff' || row.payload?.po_type === 'BUYBACK') {
    return '/admin/approvals';
  }
  // ABM enrollment OTP — not contract-related; the full SMS lives on the
  // ABM account OTP screen (UI_SUMMARY/137).
  if (evt === 'abm_otp_received') return '/admin/company/abm-otp';
  // Shop credit request (mig 1449): the credit desk lands on the case itself;
  // the shop lands on the contract in the stage it has just moved to.
  if (evt === 'partner_case_submitted_staff' && row.payload?.case_id) {
    return `/admin/partner-cases/${row.payload.case_id}`;
  }
  const pcid = row.payload?.contract_id;
  if (evt === 'partner_case_approved_staff' && pcid) return `/admin/contracts/pending-payment/${pcid}`;
  if (evt === 'partner_case_returned_staff' && pcid) return `/admin/contracts/approval-returned/${pcid}`;
  // Shop close-out (mig 1471): fund finance lands on the request to review it;
  // the shop lands on the contract in its close-out menu, where it fixes and resubmits.
  if (evt === 'partner_settlement_submitted_staff' && row.payload?.settlement_id) {
    return `/admin/partner-settlements/${row.payload.settlement_id}`;
  }
  if (evt === 'partner_settlement_returned_staff' && pcid) return `/admin/contracts/settlement-close/${pcid}`;
  const cid = row.payload?.contract_id ?? row.contract_ids?.[0];
  if (!cid) return null;
  if (evt.startsWith('chat_')) return `/admin/chat?contract=${cid}`;
  if (evt.startsWith('signing_')) return `/admin/contracts/search/${cid}?tab=signing`;
  if (evt.startsWith('bill_') || evt === 'slip_uploaded') return `/admin/contracts/search/${cid}?tab=money`;
  return `/admin/contracts/search/${cid}`;
}

// Events that are not about a contract, so the "customer · contract code"
// subtitle never applies to them even though the FE does have a title template.
const NON_CONTRACT_EVENTS = new Set(['abm_otp_received']);

// True when the contract-shaped subtitle (customer · contract code) applies.
// Events with no FE template at all, and events known not to concern a
// contract, render the feed's server-side body instead — see
// subtitleFallbackOf. Without this, they show two empty [placeholders].
function usesContractSubtitle(row: NotificationRow, t: ReturnType<typeof useTranslation>['t']): boolean {
  const evt = row.event_type;
  if (NON_CONTRACT_EVENTS.has(evt)) return false;
  if (row.event_variant && t(`notifCenter.event.${evt}.${row.event_variant}`, { defaultValue: '' })) {
    return true;
  }
  return !!t(`notifCenter.event.${evt}`, { defaultValue: '' });
}

// Title resolution. Prefers top-level row.event_variant (mig 27); falls back
// to event_type alone. Until Phase A2 wires producers, event_variant is NULL
// for every row and the title falls back to the per-event default.
//
// Last resort is the feed's own `title`, which the server renders in the
// recipient's language for EVERY event — only if that is missing too do we
// show the raw event_type. Without this, any event the FE doesn't know about
// (e.g. abm_otp_received) renders its internal name to the user.
function titleFor(row: NotificationRow, t: ReturnType<typeof useTranslation>['t']): string {
  const evt = row.event_type;
  // ABM OTP: the code is only meaningful next to the account it belongs to —
  // several people can be enrolling at once (UI_SUMMARY/137 §4). A missing
  // code still renders; the user reads the full SMS on the OTP screen.
  if (evt === 'abm_otp_received') {
    const code = row.payload?.otp_code?.trim();
    return code
      ? t('notifCenter.event.abm_otp_received', { code })
      : t('notifCenter.event.abm_otp_received_nocode');
  }
  if (row.event_variant) {
    const k = `notifCenter.event.${evt}.${row.event_variant}`;
    const hit = t(k, { defaultValue: '' });
    if (hit) return hit;
  }
  return t(`notifCenter.event.${evt}`, { defaultValue: '' }) || row.title || evt;
}

// Subtitle for events with no FE template. The contract-shaped subtitle
// (customer · contract code) is meaningless for events that aren't about a
// contract — it renders as two empty [placeholders]. The feed's `body` is
// server-rendered per event and per language, so it always says something true.
function subtitleFallbackOf(row: NotificationRow): string | null {
  // ABM OTP: the account the code belongs to. Prefer the payload field over
  // the feed body so the pairing holds even if the body wording changes.
  if (row.event_type === 'abm_otp_received') {
    return row.payload?.login_email?.trim() || row.body?.trim() || null;
  }
  return row.body?.trim() || null;
}

// Visible placeholder for a missing payload field. Renders "[field_name]" with
// a tooltip explaining what's missing. Style is muted-warning so the gap is
// obvious but not alarming.
function MissingField({ field }: { field: string }) {
  const { t } = useTranslation();
  return (
    <Tooltip content={t('notifCenter.missingFieldTooltip', { field })}>
      <span className="text-[11px] text-warning bg-warning-soft rounded px-1 py-0 inline-flex items-center align-middle border border-warning/30">
        [{field}]
      </span>
    </Tooltip>
  );
}

// One row of the list. A real link when it leads somewhere, so ctrl/middle
// click opens it in a new tab; a plain click marks it read and closes the list.
function RowShell({ to, onOpen, children }: {
  to: string | null;
  onOpen: (newTab: boolean) => void;
  children: React.ReactNode;
}) {
  const cls = 'block w-full text-left px-3 py-2.5 transition-colors border-b border-line/60 last:border-b-0 no-underline text-inherit';
  if (!to) return <div className={cls}>{children}</div>;
  return (
    <Link
      to={to}
      className={clsx(cls, 'hover:bg-item-hover-bg cursor-pointer')}
      onClick={(e) => onOpen(e.ctrlKey || e.metaKey || e.shiftKey)}
      onAuxClick={(e) => { if (e.button === 1) onOpen(true); }}
    >
      {children}
    </Link>
  );
}

// The line under the contract: what to do next, or why it came back. One
// line per event, so the title stays a short name for what happened.
function detailFor(row: NotificationRow, t: ReturnType<typeof useTranslation>['t']): string | null {
  switch (row.event_type) {
    case 'partner_case_approved_staff': return t('notifCenter.detail.partner_case_approved_staff');
    case 'partner_case_returned_staff': return row.payload?.reason_text?.trim() || null;
    case 'partner_case_submitted_staff': return row.payload?.branch_name?.trim() || null;
    case 'partner_settlement_submitted_staff': {
      const net = row.payload?.net_amount_text?.trim();
      return net ? t('notifCenter.detail.partner_settlement_submitted_staff', { amount: net }) : null;
    }
    case 'partner_settlement_returned_staff':
      return [row.payload?.return_reason_name?.trim(), row.payload?.return_note?.trim()]
        .filter(Boolean).join(' — ') || null;
    default: return null;
  }
}

// ── Collapse rule ───────────────────────────────────────────────────────────

type DisplayItem =
  | { kind: 'row'; row: NotificationRow }
  | { kind: 'group'; contractId: number; contractDisplay: string | null; customerDisplay: string | null; rows: NotificationRow[] };

// Collapse ≥3 consecutive chat-category rows for the same contract_id.
function collapseRows(items: NotificationRow[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  let i = 0;
  while (i < items.length) {
    const head = items[i];
    const cid = head.payload?.contract_id ?? head.contract_ids?.[0];
    if (resolveCategory(head.event_type, head.category) === 'chat' && cid) {
      let j = i + 1;
      while (
        j < items.length
        && resolveCategory(items[j].event_type, items[j].category) === 'chat'
        && (items[j].payload?.contract_id ?? items[j].contract_ids?.[0]) === cid
      ) j++;
      const span = items.slice(i, j);
      if (span.length >= 3) {
        const contractDisplay = span.map(contractCodeOf).find(Boolean) ?? null;
        const customerDisplay = span.map(customerNameOf).find(Boolean) ?? null;
        out.push({
          kind: 'group',
          contractId: cid,
          contractDisplay,
          customerDisplay,
          rows: span,
        });
        i = j;
        continue;
      }
    }
    out.push({ kind: 'row', row: head });
    i++;
  }
  return out;
}

// ── Component ───────────────────────────────────────────────────────────────

type Props = {
  collapsed: boolean;
  isMobile: boolean;
  unreadCount: number;
};

export function NotificationMenuItem({ collapsed, isMobile, unreadCount }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['notif', 'panel-list'],
    queryFn: () => apiClient.rpc<ListResponse>('fn_staff_list_notifications', {
      p_category: null,
      p_unread_only: false,
      p_limit: 20,
      p_offset: 0,
    }),
    enabled: open,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => apiClient.rpc('fn_staff_mark_notification_read', { p_notification_id: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notif', 'panel-list'] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'notif-unread-summary'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => apiClient.rpc('fn_staff_mark_all_read', { p_category: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notif', 'panel-list'] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'notif-unread-summary'] });
    },
  });

  // The row's link does the navigating; this marks it read, and closes the
  // list unless it opened in a new tab.
  const openRows = (rows: NotificationRow[], newTab: boolean) => {
    rows.forEach(r => { if (!r.is_read) markRead.mutate(r.notification_id); });
    if (!newTab) setOpen(false);
  };

  const items = useMemo(() => collapseRows(data?.items ?? []), [data?.items]);

  const label = unreadCount > 99 ? '99+' : String(unreadCount);
  const showCollapsedDot = collapsed && !isMobile && unreadCount > 0;

  return (
    <>
      <button
        ref={triggerRef}
        className={clsx('side-menu-item', open && 'active')}
        onClick={() => setOpen(o => !o)}
        aria-label={t('nav.notifications')}
      >
        <span className="side-menu-item-icon relative inline-flex">
          <Bell size="1rem" />
          {showCollapsedDot && (
            <span
              className="absolute -top-1.5 -right-2 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 pt-px rounded-full text-[9px] font-semibold tabular-nums ring-1 ring-bg"
              style={{
                background: 'var(--color-badge-warning-bg, color-mix(in srgb, var(--color-warning) 20%, var(--color-surface)))',
                color: 'var(--color-badge-warning-fg, var(--color-warning-fade, var(--color-warning)))',
              }}
              aria-label={`${label} unread`}
            >
              {label}
            </span>
          )}
        </span>
        {!collapsed && <span className="side-menu-item-label">{t('nav.notifications')}</span>}
        {!collapsed && unreadCount > 0 && <Badge color="warning" size="xs">{label}</Badge>}
      </button>
      <PopOver
        isOpen={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        placement="right"
        align="start"
        offset={4}
        minWidth="320px"
        maxWidth="420px"
        maxHeight="70dvh"
      >
        <div className="flex flex-col">
          <div className="px-3 py-2 flex items-center justify-between border-b border-line">
            <span className="text-sm font-semibold">{t('notifCenter.title')}</span>
            <button
              type="button"
              className="text-xs text-primary-fg hover:underline disabled:opacity-50 inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending || unreadCount === 0}
            >
              <CheckCheck size={12} />
              {t('notifCenter.markAllRead')}
            </button>
          </div>

          <div className="overflow-y-auto better-scroll" style={{ maxHeight: '52dvh' }}>
            {isLoading && (
              <div className="px-3 py-6 text-sm text-subtle text-center">{t('notifCenter.loading')}</div>
            )}
            {isError && (
              <div className="px-3 py-6 text-sm text-danger text-center">{t('notifCenter.error')}</div>
            )}
            {!isLoading && !isError && items.length === 0 && (
              <div className="px-3 py-8 text-sm text-subtle text-center">{t('notifCenter.empty')}</div>
            )}

            {items.map((item) => {
              if (item.kind === 'group') {
                const anyUnread = item.rows.some(r => !r.is_read);
                const latest = item.rows[0];
                return (
                  <RowShell
                    key={`group-${item.contractId}-${latest.notification_id}`}
                    to={`/admin/chat?contract=${item.contractId}`}
                    onOpen={(newTab) => openRows(item.rows, newTab)}
                  >
                    <div className="flex items-start gap-2">
                      <span className={clsx('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', anyUnread ? 'bg-primary' : 'bg-line')} />
                      <span className="mt-0.5 text-subtle shrink-0"><MessageSquare size={14} /></span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={clsx('text-sm leading-snug truncate min-w-0', anyUnread ? 'text-fg font-medium' : 'text-subtle')}>
                            {t('notifCenter.chatGroupTitle', { n: item.rows.length })}
                          </span>
                          <span className="text-[11px] text-subtle shrink-0 ml-auto tabular-nums">{relativeTime(t, latest.created_at)}</span>
                        </div>
                        <div className="text-xs leading-snug truncate mt-0.5 inline-flex items-center gap-1.5 min-w-0 flex-wrap">
                          {item.customerDisplay ? <span className="text-subtle truncate">{item.customerDisplay}</span> : <MissingField field="customer_full_name" />}
                          <span className="text-subtle">·</span>
                          {item.contractDisplay ? (
                            <span className="text-primary-fg shrink-0">{item.contractDisplay}</span>
                          ) : (
                            <MissingField field="contract_code" />
                          )}
                        </div>
                      </div>
                    </div>
                  </RowShell>
                );
              }

              const row = item.row;
              const dotClass = row.is_read ? 'bg-line' : 'bg-primary';
              const titleClass = row.is_read ? 'text-subtle' : 'text-fg font-medium';
              const code = contractCodeOf(row);
              const customer = customerNameOf(row);
              const cat = resolveCategory(row.event_type, row.category);
              const title = titleFor(row, t);
              const templated = usesContractSubtitle(row, t);
              const subtitleFallback = subtitleFallbackOf(row);

              // Event-specific extras (composed FE-side from payload fields).
              const extras: React.ReactNode[] = [];
              // Signing variant label — comes from top-level event_variant
              // (mig 27, populated in Phase A2). Until producers wire it,
              // event_variant is NULL and no label renders.
              if (row.event_type.startsWith('signing_') && row.event_variant) {
                const label = t(`notifCenter.signingType.${row.event_variant}`, { defaultValue: '' });
                if (label) extras.push(<span key="sig-type" className="text-subtle">({label})</span>);
              }
              if (row.event_type === 'signing_sealed_primary_swap_staff' && row.payload?.new_lessee_name && row.payload.new_lessee_name !== '-') {
                extras.push(<span key="new-lessee" className="text-subtle truncate">→ {row.payload.new_lessee_name}</span>);
              }
              const actor = row.payload?.staff_name;
              const detail = detailFor(row, t);
              // Every message about a contract reads the same: what happened,
              // then whose contract it is, then (if any) what to do next.
              const contractShaped = row.event_type.startsWith('partner_case_') || (templated && cat !== 'approval');

              return (
                <RowShell
                  key={row.notification_id}
                  to={deeplinkFor(row)}
                  onOpen={(newTab) => openRows([row], newTab)}
                >
                  <div className="flex items-start gap-2">
                    <span className={clsx('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', dotClass)} />
                    <span className="mt-0.5 text-subtle shrink-0">{iconForCategory(cat)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={clsx('text-sm leading-snug truncate min-w-0', titleClass)}>
                          {title}
                        </span>
                        <span className="text-[11px] text-subtle shrink-0 ml-auto tabular-nums">
                          {relativeTime(t, row.created_at)}
                        </span>
                      </div>
                      {contractShaped ? (
                        <div className="text-xs leading-snug truncate mt-0.5 inline-flex items-center gap-1.5 min-w-0 max-w-full">
                          {customer ? <span className="text-subtle truncate">{customer}</span> : <MissingField field="customer_full_name" />}
                          <span className="text-subtle">·</span>
                          {code ? <span className="text-primary-fg shrink-0">{code}</span> : <MissingField field="contract_code" />}
                          {extras}
                        </div>
                      ) : cat === 'approval' ? (
                        <div className="text-xs leading-snug truncate mt-0.5 inline-flex items-center gap-1.5 min-w-0 flex-wrap">
                          {row.payload?.po_code && <span className="text-primary-fg truncate">{row.payload.po_code}</span>}
                          {row.payload?.settlement_code && (
                            <><span className="text-primary-fg shrink-0">{row.payload.settlement_code}</span>
                              {code && <><span className="text-subtle">·</span><span className="text-subtle truncate">{code}</span></>}</>
                          )}
                          {row.payload?.branch_name && (
                            <><span className="text-subtle">·</span><span className="text-subtle truncate">{row.payload.branch_name}</span></>
                          )}
                          {row.payload?.amount != null && (
                            <><span className="text-subtle">·</span><span className="text-subtle tabular-nums shrink-0">฿{fmtCurrency(Number(row.payload.amount))}</span></>
                          )}
                        </div>
                      ) : (
                        // No FE template — the contract-shaped subtitle doesn't
                        // apply, so show the server-rendered body (or nothing).
                        subtitleFallback && (
                          <div className="text-xs leading-snug truncate mt-0.5 text-subtle min-w-0">
                            {subtitleFallback}
                          </div>
                        )
                      )}
                      {detail && (
                        <div className="text-xs leading-snug text-subtle mt-0.5 line-clamp-2">{detail}</div>
                      )}
                      {actor && (
                        <div className="text-[11px] text-subtle mt-0.5 truncate">
                          {t('notifCenter.actorBy', { name: actor })}
                        </div>
                      )}
                    </div>
                  </div>
                </RowShell>
              );
            })}
          </div>
        </div>
      </PopOver>
    </>
  );
}
