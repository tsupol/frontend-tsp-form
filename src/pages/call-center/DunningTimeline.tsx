// Dunning history as a timeline (nnf RECOMMEND 2026-11-12 §5–§6): newest first,
// a header per Bangkok day, one line per event with its time, result, who and the
// note / promise date / new summary. The summary note sits on top in its own box —
// it is the current conclusion, not an event. 30 at a time + "ดูเพิ่ม".
// Events that do not help decide what to say (flag/stage changes, notification
// sent/delivered) are left out unless the switch is on.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Badge, Button, LabeledCheckbox } from 'tsp-form';
import {
  ArrowRightLeft, Banknote, Car, Clock, Flag, Lock, LockOpen, MapPin,
  NotebookPen, Phone, RotateCw, Send, Users, XCircle,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { bangkokDaysAgo, bangkokTime } from '../../lib/format';
import { ccKeys, type TimelineRow } from './callCenterApi';
import { LaneIcon } from './queue/LaneIcon';
import './dunningTimeline.css';

const PAGE = 30;
const NOISE = ['FLAG_CHANGED', 'STAGE_CHANGED', 'SENT', 'DELIVERED'];

const base = (contractId: number, withSystem: boolean) =>
  `/v_contract_dunning_timeline?contract_id=eq.${contractId}`
  + (withSystem ? '' : `&event_type=not.in.(${NOISE.join(',')})`)
  + '&order=created_at.desc,id.desc';

// ── result colour (RECOMMEND §5) ────────────────────────────────────────────
const GOOD = new Set(['REACHED_WILL_PAY', 'REACHED', 'MET', 'SUCCESS', 'DONE']);
const BAD = new Set(['WRONG_NUMBER', 'REACHED_REFUSED', 'REFUSED', 'MOVED', 'ADDR_UNREACHABLE', 'FAILED']);
const resultColor = (r: string) => (GOOD.has(r) ? 'success' : BAD.has(r) ? 'danger' : 'warning');

/** Hand-over, money and end-of-case events: shown, but as a small grey line. */
const isMinor = (e: TimelineRow) => e.event_class === 'SYSTEM' && e.event_type !== 'SUMMARY_UPDATED';

function EventIcon({ type }: { type: string }) {
  const s = 14;
  switch (type) {
    case 'CALL': return <Phone size={s} />;
    case 'TOLD_REFERENCE': return <Users size={s} />;
    case 'FIELD_VISIT': case 'REPO_ATTEMPT': return <Car size={s} />;
    case 'REPO_NOTE': return <MapPin size={s} />;
    case 'PROMISE_TO_PAY': return <LaneIcon mark="promise" size={s} />;
    case 'SUMMARY_UPDATED': case 'NOTE': case 'CORRECTION': return <NotebookPen size={s} />;
    case 'LOST_MODE_ON': return <Lock size={s} />;
    case 'LOST_MODE_OFF': return <LockOpen size={s} />;
    case 'ASSIGNED': case 'RELEASED': case 'TRADE_OFFERED': case 'TRADE_ACCEPTED':
    case 'TRADE_REJECTED': case 'TRADE_CANCELLED': return <ArrowRightLeft size={s} />;
    case 'PAYMENT': return <Banknote size={s} />;
    case 'SENT': case 'DELIVERED': return <Send size={s} />;
    default: return <Flag size={s} />;
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

/** Lines of the new summary that were not in the old one (null when none were added). */
function addedLines(from: string | null, to: string | null): string | null {
  if (!to) return null;
  const before = new Set((from ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean));
  const fresh = to.split(/\r?\n/).map(l => l.trim()).filter(l => l && !before.has(l));
  return fresh.length ? fresh.join('\n') : null;
}

function EventLine({ e, compact }: { e: TimelineRow; compact?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const p = (e.payload ?? {}) as Record<string, unknown>;
  // "ระบบ" only when the DB says so. A blank name on a person's entry means this
  // viewer may not read that user (RLS on auth.users) — still a person (§6.3).
  const actor = e.is_system ? t('callCenter.systemActor') : (e.actor_username || t('callCenter.staffActor'));
  const minor = isMinor(e);

  let detail: ReactNode = null;
  if (e.event_type === 'PROMISE_TO_PAY') {
    const date = str(p.promise_date);
    detail = (
      <>
        {date && <span className="font-medium">{t('callCenter.timelinePromise')} <DateTime value={date} showTime={false} /></span>}
        {date && str(p.note) ? ' · ' : ''}{str(p.note)}
      </>
    );
  } else if (e.event_type === 'SUMMARY_UPDATED') {
    // A summary can run to 40+ lines and most edits add one dated line to it, so its
    // start is the same every time: the lines this edit added are what tell entries
    // apart. Whole text and the version it replaced one press away (RECOMMEND §5e).
    const to = str(p.to), from = str(p.from);
    const added = addedLines(from, to);
    const shown = open ? to : (added ?? to);
    const long = !!to && (to.split(/\r?\n/).length > 3 || to.length > 160);
    detail = (
      <>
        <span className={`whitespace-pre-line${open || compact ? '' : ' line-clamp-3'}`}>{shown ?? '—'}</span>
        {!compact && (long || from) && (
          <button type="button" className="cc-tl-link mt-0.5" onClick={() => setOpen(v => !v)}>
            {open ? t('callCenter.timelineCollapse') : t('callCenter.timelineExpand')}
          </button>
        )}
        {open && from && (
          <span className="block mt-1 pl-2 border-l-2 border-line text-subtler">
            <span className="block text-xs">{t('callCenter.timelineBefore')}</span>
            <span className="whitespace-pre-line">{from}</span>
          </span>
        )}
      </>
    );
  } else if (e.event_type === 'STATUS_CHANGED') {
    const from = str(p.from), to = str(p.to);
    detail = (
      <>
        {from && to && `${t(`callCenter.dunningStatus.${from}`, { defaultValue: from })} → ${t(`callCenter.dunningStatus.${to}`, { defaultValue: to })}`}
        {str(p.reason) ? ` · ${str(p.reason)}` : ''}
      </>
    );
  } else if (str(p.note)) {
    detail = str(p.note);
  }

  return (
    <li className={`cc-tl-item${minor ? ' cc-tl-item--minor' : ''}`} data-event={e.event_type}>
      <span className="cc-tl-dot"><EventIcon type={e.event_type} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap">
          <span className="text-xs text-subtle tabular-nums">{bangkokTime(e.created_at)}</span>
          <span className={minor ? 'text-xs text-subtle' : 'text-sm font-medium'}>
            {t(`callCenter.event.${e.event_type}`, { defaultValue: e.event_type })}
          </span>
          {e.result_code && (
            <Badge size="sm" color={resultColor(e.result_code)}>
              {t(`callCenter.result_code.${e.result_code}`, { defaultValue: e.result_code })}
            </Badge>
          )}
          <span className="text-xs text-subtler">{actor}</span>
        </div>
        {detail && <div className={`${minor || compact ? 'text-xs' : 'text-sm'} text-subtle mt-0.5 break-words${compact ? ' line-clamp-2' : ''}`}>{detail}</div>}
      </div>
    </li>
  );
}

function DayHeader({ at }: { at: string }) {
  const { t } = useTranslation();
  const ago = bangkokDaysAgo(at);
  return (
    <li className="cc-tl-day">
      {ago === 0 ? t('callCenter.today') : ago === 1 ? t('callCenter.yesterday') : <DateTime value={at} showTime={false} />}
    </li>
  );
}

/** Where the list starts: the summary note, pinned. */
/** The summary note in its yellow box, showing only its LAST 4 lines until opened.
 *  Some collectors keep a diary in it (up to 35 lines) and add each day's line at
 *  the bottom (243 edits on real data vs 12 at the top) — so the end is the news,
 *  and the old part is cut off above with a fade. "ดูทั้งหมด" sits on the title row. */
export function useSummaryTail(text: string | null | undefined) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  /** Wraps the text: 4 lines, bottom showing, old part faded off the top. */
  const tailProps = { ref, className: open ? '' : `cc-sum-tail${cut ? ' cc-sum-tail--cut' : ''}` };
  /** "ดูทั้งหมด" / "ย่อ" — only when something is cut off (or it is open). */
  const toggle = (cut || open) ? (
    <button type="button" className="cc-tl-link" data-summary-toggle onClick={() => setOpen(v => !v)}>
      {open ? t('callCenter.timelineCollapse') : t('callCenter.timelineShowAll')}
    </button>
  ) : null;
  return { tailProps, toggle };
}

export function SummaryBox({ title, text, children, ...rest }: {
  title: string; text: string; children?: ReactNode; [data: `data-${string}`]: boolean | undefined;
}) {
  const { tailProps, toggle } = useSummaryTail(text);
  return (
    <div className="bg-warning-soft border border-warning-border rounded-md px-3 py-2" {...rest}>
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <span className="text-xs text-subtle">{title}</span>
        {toggle}
      </div>
      <div {...tailProps}>
        <div className="text-sm whitespace-pre-line">{text}</div>
      </div>
      {children}
    </div>
  );
}

export function PinnedSummary({ text, by, at }: { text: string | null; by?: string | null; at: string | null }) {
  const { t } = useTranslation();
  if (!text) {
    return (
      <div className="bg-warning-soft border border-warning-border rounded-md px-3 py-2" data-pinned-summary>
        <div className="text-xs text-subtle mb-0.5">{t('callCenter.summaryLatest')}</div>
        <div className="text-sm text-subtler italic">{t('callCenter.summaryNone')}</div>
      </div>
    );
  }
  return (
    <SummaryBox title={t('callCenter.summaryLatest')} text={text} data-pinned-summary>
      {at && (
        <div className="text-xs text-subtle mt-1 flex items-center gap-1 flex-wrap">
          <Clock size={11} className="shrink-0" />
          {by && <span>{by} ·</span>}
          <DateTime value={at} />
        </div>
      )}
    </SummaryBox>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="alert alert-danger" data-timeline-error>
      <XCircle size={16} />
      <span className="flex-1">{t('callCenter.timelineLoadFailed')}</span>
      <Button size="xs" variant="outline" startIcon={<RotateCw size={12} />} onClick={onRetry}>{t('common.retry')}</Button>
    </div>
  );
}

function Rows({ rows, compact }: { rows: TimelineRow[]; compact?: boolean }) {
  return (
    <ol className="cc-tl">
      {rows.map((e, i) => {
        const prev = rows[i - 1];
        const newDay = !prev || bangkokDaysAgo(prev.created_at) !== bangkokDaysAgo(e.created_at);
        return [newDay && <DayHeader key={`d${e.id}`} at={e.created_at} />, <EventLine key={e.id} e={e} compact={compact} />];
      })}
    </ol>
  );
}

/** The full timeline: switch for system events, 30 at a time, "ดูเพิ่ม". */
export function DunningTimeline({ contractId, summary }: {
  contractId: number;
  summary?: { text: string | null; by?: string | null; at: string | null };
}) {
  const { t } = useTranslation();
  const [withSystem, setWithSystem] = useState(false);
  const q = useInfiniteQuery({
    queryKey: [...ccKeys.timeline(contractId), 'pages', withSystem],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiClient.get<TimelineRow[]>(
      base(contractId, withSystem) + `&limit=${PAGE}` + (pageParam ? `&created_at=lt.${encodeURIComponent(pageParam)}` : ''),
    ),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].created_at : null),
  });
  const rows = q.data?.pages.flat() ?? [];

  return (
    <div className="flex flex-col gap-3" data-timeline>
      {summary && <PinnedSummary {...summary} />}
      <LabeledCheckbox
        label={t('callCenter.timelineShowSystem')}
        checked={withSystem}
        onChange={(ev) => setWithSystem(ev.target.checked)}
      />
      {q.isLoading ? <div className="text-sm text-subtle">{t('common.loading')}</div>
        : q.isError && rows.length === 0 ? <LoadFailed onRetry={() => q.refetch()} />
          : rows.length === 0 ? <div className="text-sm text-subtler">{t('callCenter.noHistory')}</div>
            : <Rows rows={rows} />}
      {q.isError && rows.length > 0 && <LoadFailed onRetry={() => q.fetchNextPage()} />}
      {q.hasNextPage && !q.isError && (
        <Button size="sm" variant="outline" className="self-center" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          {q.isFetchingNextPage ? t('common.loading') : t('callCenter.timelineMore')}
        </Button>
      )}
    </div>
  );
}

/** The last three events + how many there are — for the queue panel, so the
 *  collector sees what happened last time before calling, without a click. */
export function useTimelinePeek(contractId: number) {
  return useQuery({
    queryKey: [...ccKeys.timeline(contractId), 'peek'],
    queryFn: () => apiClient.getPaginated<TimelineRow>(base(contractId, false), { page: 1, pageSize: 3 }),
  });
}

export function TimelinePeek({ contractId, onOpen }: { contractId: number; onOpen: () => void }) {
  const { t } = useTranslation();
  const q = useTimelinePeek(contractId);
  const n = q.data?.totalCount ?? 0;
  return (
    <section className="flex flex-col gap-2" data-timeline-peek>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{t('callCenter.timelineTitle')}</h4>
        <Button size="sm" variant="outline" startIcon={<Clock size={14} />} disabled={!q.data} onClick={onOpen} data-action="OPEN_HISTORY">
          {q.data ? t('callCenter.timelineOpenN', { n }) : t('callCenter.timelineOpen')}
        </Button>
      </div>
      {q.isLoading ? <div className="text-xs text-subtle">{t('common.loading')}</div>
        : q.isError ? <LoadFailed onRetry={() => q.refetch()} />
          : n === 0 ? <div className="text-xs text-subtler">{t('callCenter.noHistory')}</div>
            : <Rows rows={q.data!.data} compact />}
    </section>
  );
}
