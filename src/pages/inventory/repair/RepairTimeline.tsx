import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from 'tsp-form';
import { History, StickyNote } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { DateTime } from '../../../components/DateTime';
import { fmtCurrency } from '../../../lib/format';
import type { RepairTimelineEvent } from '../repairTypes';

/**
 * Repair history — reads v_repair_timeline ordered by log_id (NEVER event_at
 * alone: same-transaction events share event_at exactly). event_code is
 * FE-translated. *_CHANGED rows carry detail.from/to (the only place the old
 * value survives — the main table was overwritten). Payment/refund rows show a
 * "(cancelled)" tag when their bill was voided. is_backfilled rows get a badge.
 */
export function RepairTimeline({
  repairOrderId, updatedAt, onAddNote,
}: {
  repairOrderId: number;
  updatedAt: string;          // in the query key so it refetches after any action
  onAddNote: () => void;
}) {
  const { t } = useTranslation();

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['repair-timeline', repairOrderId, updatedAt],
    queryFn: () => apiClient.get<RepairTimelineEvent[]>(
      `/v_repair_timeline?repair_order_id=eq.${repairOrderId}&order=log_id.asc`,
    ),
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="text-xs font-semibold text-subtle uppercase tracking-wider inline-flex items-center gap-1.5">
          <History size={13} />{t('repair.history')}
        </div>
        <Button variant="outline" size="sm" className="ml-auto" startIcon={<StickyNote size={14} />} onClick={onAddNote}>
          {t('repair.addNote')}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-subtler">{t('common.loading')}</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-subtler">{t('repair.timelineEmpty')}</p>
      ) : (
        <ol className="relative flex flex-col gap-3 pl-4 border-l border-line">
          {events.map(ev => (
            <li key={ev.log_id} className="relative">
              <span className="absolute -left-[1.28rem] top-1.5 w-2 h-2 rounded-full bg-line" />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{t(`repair.event_${ev.event_code}`)}</span>
                {ev.bill_status === 'VOIDED' && (
                  <Badge size="xs" color="danger">{t('repair.billVoided')}</Badge>
                )}
                {ev.is_backfilled && (
                  <Badge size="xs" color="default">{t('repair.backfilled')}</Badge>
                )}
                <span className="ml-auto text-xs text-subtler shrink-0"><DateTime value={ev.event_at} /></span>
              </div>
              <EventDetail ev={ev} />
              <div className="text-xs text-subtle mt-0.5">{ev.actor_name ?? '—'}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// The one interesting line per event — from→to for *_CHANGED, the charge/payment
// amount, or the free note. Kept terse; the label above already names the event.
function EventDetail({ ev }: { ev: RepairTimelineEvent }) {
  const { t } = useTranslation();
  const d = ev.detail ?? {};
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));

  // NOTE rows carry the text on `note`.
  if (ev.event_code === 'NOTE' && ev.note) {
    return <p className="text-sm whitespace-pre-wrap mt-0.5">{ev.note}</p>;
  }

  // from → to changes (cost / cost-note / pickup-days). The old value lives ONLY here.
  if (ev.event_code === 'COST_CHANGED') {
    return <div className="text-sm text-subtle tabular-nums mt-0.5">{fmtCurrency(num(d.from) || 0)} → {fmtCurrency(num(d.to) || 0)}</div>;
  }
  if (ev.event_code === 'PICKUP_DAYS_CHANGED') {
    return <div className="text-sm text-subtle mt-0.5">{String(d.from ?? '—')} → {String(d.to ?? '—')} {t('repair.pickupDays').toLowerCase()}</div>;
  }
  if (ev.event_code === 'NOTE_CHANGED') {
    return <div className="text-sm text-subtle mt-0.5">{String(d.from ?? '—')} → {String(d.to ?? '—')}</div>;
  }

  // Charge / payment / refund — show amount + description if present.
  if (ev.event_code === 'CHARGE_ADD' || ev.event_code === 'PAYMENT' || ev.event_code === 'REFUND') {
    const amt = num(d.amount);
    if (!Number.isNaN(amt)) {
      return (
        <div className="text-sm text-subtle mt-0.5">
          <span className="tabular-nums">{fmtCurrency(amt)}</span>
          {typeof d.description === 'string' && d.description ? <span> · {d.description}</span> : null}
        </div>
      );
    }
  }

  // COMPLETED / UNCOMPLETED carry the result / reason.
  if (ev.event_code === 'COMPLETED' && typeof d.result === 'string') {
    return <div className="text-sm text-subtle mt-0.5">{t(`repair.result_${d.result}`, { defaultValue: String(d.result) })}</div>;
  }
  if (ev.event_code === 'UNCOMPLETED' && typeof d.reason === 'string') {
    return <div className="text-sm text-subtle mt-0.5">{d.reason}</div>;
  }

  return null;
}
