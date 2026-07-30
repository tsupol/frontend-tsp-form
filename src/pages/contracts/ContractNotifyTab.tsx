import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { DataTableFooter } from 'tsp-form';
import { BellOff, ChevronDown, ChevronRight, Inbox } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';

/* ───────────────────────────────────────────────────────────────────────────
 * Contract > "แจ้งเตือน" — the money-notification history the branch sees before
 * calling a customer. One question it answers: "has the customer heard this
 * already?" — so the call shifts from "letting you know" to "as we told you".
 *
 * Single endpoint, zero joins: GET /v_notify_contact_log?contract_id=eq.<id>.
 * The DB decides the delivery status (delivery_status) on the strongest-evidence
 * ladder — we NEVER recompute it from raw columns, and we never claim "delivered
 * to the customer" (no push system can prove that). Record is append-only, so it
 * doubles as proof to holding that the system did notify.
 * Spec: UI_SUMMARY/133_CONTRACT_NOTIFY_TAB.md.
 * ─────────────────────────────────────────────────────────────────────────── */

const PAGE_SIZE = 10;

// The 5 money-contact event types (i18n key = event_type). Others won't appear.
type EventType =
  | 'payment_due_soon_customer'
  | 'payment_overdue_customer'
  | 'promise_today'
  | 'promise_tomorrow_customer'
  | 'promise_missed_customer';

// DB-decided delivery status, strongest evidence → weakest. Used as the single
// per-row badge. NO_APP is the only one worth making prominent (staff must act:
// help install the app before dunning through a channel the customer lacks).
type DeliveryStatus =
  | 'ACKED_PAY' | 'ACKED' | 'OPENED' | 'READ'
  | 'ACCEPTED' | 'NO_APP' | 'FAILED' | 'UNKNOWN';

interface NotifyRow {
  id: number;
  contract_id: number;
  contract_code: string;
  event_type: EventType | string;
  stage_day: number | null;
  amount: number | null;
  overdue_days: number | null;
  body: string | null;
  delivery_status: DeliveryStatus | string;
  sent_at: string;
  opened_at: string | null;
  read_at: string | null;
  ack_at: string | null;
  cycle_key: string | null;
}

export function ContractNotifyTab({ contractId }: { contractId: number }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1); // 1-based for getPaginated

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['contract-notify', contractId, page],
    queryFn: () => apiClient.getPaginated<NotifyRow>(
      `/v_notify_contact_log?contract_id=eq.${contractId}&order=sent_at.desc,id.desc`,
      { page, pageSize: PAGE_SIZE },
    ),
  });

  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  if (isLoading) {
    return <div className="p-8 text-center text-subtle text-sm">{t('common.loading')}</div>;
  }
  if (isError) {
    return <div className="p-4"><div className="alert alert-danger"><span>{t('common.error')}</span></div></div>;
  }
  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-subtler py-16 px-4">
        <Inbox size={32} strokeWidth={1.5} />
        <span className="text-sm text-center">{t('notify.empty')}</span>
      </div>
    );
  }

  return (
    <div className={`p-4 flex flex-col gap-3 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
      <div className="flex flex-col divide-y divide-line border border-line rounded-md overflow-hidden">
        {rows.map(row => <NotifyRowItem key={row.id} row={row} />)}
      </div>
      {totalPages > 1 && (
        <DataTableFooter
          currentPage={page - 1}
          totalPages={totalPages}
          onPageChange={(p) => setPage(p + 1)}
          pageSize={PAGE_SIZE}
          pageSizeOptions={[PAGE_SIZE]}
          onPageSizeChange={() => {}}
          totalRows={totalCount}
          controlSize="sm"
        />
      )}
    </div>
  );
}

function NotifyRowItem({ row }: { row: NotifyRow }) {
  const { t, i18n } = useTranslation();
  const [showBody, setShowBody] = useState(false);

  // stage_day → human: negative = before due, positive = overdue. 0/null = neither.
  const stageLabel = useMemo(() => {
    if (row.stage_day == null || row.stage_day === 0) {
      return t(`notify.event.${row.event_type}`, { defaultValue: '' }) || null;
    }
    return row.stage_day < 0
      ? t('notify.dueSoon', { count: -row.stage_day })
      : t('notify.overdue', { count: row.stage_day });
  }, [row.stage_day, row.event_type, t]);

  // The one moment the customer responded, shown coarsely (a date, not seconds —
  // second-level tracking helps nothing and over-surveils the customer).
  const respondedAt = row.ack_at ?? row.opened_at ?? row.read_at ?? null;

  return (
    <div className="px-3 py-2.5 bg-surface">
      {/* Line 1 — when · what · amount. The whole question in one glance. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium tabular-nums">
            <DateTime value={row.sent_at} showTime />
          </div>
          {stageLabel && <div className="text-xs text-subtle mt-0.5">{stageLabel}</div>}
        </div>
        {row.amount != null && (
          <div className="text-sm font-medium tabular-nums shrink-0">
            {fmtCurrency(row.amount)} ฿
          </div>
        )}
      </div>

      {/* Line 2 — the single DB-decided status. */}
      <div className="mt-1.5">
        <StatusLabel status={row.delivery_status} respondedAt={respondedAt} />
      </div>

      {/* Collapsible — the exact text the customer saw. */}
      {row.body && (
        <div className="mt-1.5">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-subtle hover:text-fg bg-transparent border-none cursor-pointer p-0"
            onClick={() => setShowBody(v => !v)}
            aria-expanded={showBody}
          >
            {showBody ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {t('notify.showMessage')}
          </button>
          {showBody && (
            <div className="mt-1.5 rounded-md bg-bg border border-line px-3 py-2 text-sm whitespace-pre-line text-fg">
              {row.body}
            </div>
          )}
        </div>
      )}

      {row.cycle_key && (
        <div className="mt-1 text-[11px] text-subtler">
          {t('notify.cycle', { date: formatCycle(row.cycle_key, i18n.language) })}
        </div>
      )}
    </div>
  );
}

// Every status but NO_APP is neutral (owner: don't paint them red). NO_APP is the
// one that demands action, so it gets a warning treatment + icon.
function StatusLabel({ status, respondedAt }: { status: string; respondedAt: string | null }) {
  const { t } = useTranslation();
  const label = t(`notify.status.${status}`, { defaultValue: status });

  if (status === 'NO_APP') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning-fg bg-warning-soft border border-warning-border rounded-md px-2 py-1">
        <BellOff size={13} />
        {label}
      </span>
    );
  }

  const responded = status === 'OPENED' || status === 'READ' || status === 'ACKED' || status === 'ACKED_PAY';
  return (
    <span className={`text-xs ${responded ? 'text-success-fg font-medium' : 'text-subtle'}`}>
      {label}
      {responded && respondedAt && (
        <span className="text-subtler font-normal">
          {' · '}
          <DateTime value={respondedAt} showTime={false} />
        </span>
      )}
    </span>
  );
}

/** cycle_key is YYYYMMDD → localized "1 ส.ค." style short label. */
function formatCycle(cycleKey: string, lang: string): string {
  if (!/^\d{8}$/.test(cycleKey)) return cycleKey;
  const y = Number(cycleKey.slice(0, 4));
  const m = Number(cycleKey.slice(4, 6));
  const d = Number(cycleKey.slice(6, 8));
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short' });
}
