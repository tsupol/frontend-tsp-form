import { useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { Button, PopOver } from 'tsp-form';
import { Flag, UserRound } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { collectorColor, situationColor, situationText } from '../../lib/situation';
import { contractStateLabel } from './chatStatus';
import type { ChatInboxRow } from './chatTypes';

const baht = (n: number | null | undefined) => `${fmtCurrency(n ?? 0)} ฿`;

/**
 * The customer-situation flag at the start of a chat row (owner 11-11, UI 66 §5b):
 * every row has one, green included, so staff see at a glance which room needs
 * focus. Pressing it opens a box saying what the colour means and the figures
 * behind it. The row itself stays the "open this room" target — the flag stops
 * the click from reaching it.
 */
export function ChatSituationFlag({ row, t }: { row: ChatInboxRow; t: TFunction }) {
  const [open, setOpen] = useState(false);
  const code = row.situation_code ?? null;
  const color = situationColor(code);
  const label = situationText(t, code, row.overdue_days);

  return (
    <PopOver
      isOpen={open}
      onClose={() => setOpen(false)}
      placement="bottom"
      align="start"
      maxWidth="300px"
      trigger={
        <Button
          variant="ghost"
          size="xs"
          className="shrink-0 -ml-1"
          startIcon={<Flag color={color} fill={color} />}
          aria-label={label}
          aria-expanded={open}
          data-situation={code ?? 'NONE'}
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          onKeyDown={(e) => e.stopPropagation()}
        />
      }
    >
      {/* Clicks inside the box must not open the room underneath. */}
      <div className="p-3 flex flex-col gap-2 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5 font-medium">
          <Flag size={14} color={color} fill={color} className="shrink-0" />
          <span>{label}</span>
        </div>
        <p className="text-xs text-subtle">{t(`situation.desc.${code ?? 'NONE'}`)}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <SituationFacts row={row} t={t} />
          {row.collector_name && (
            <Fact label={t('situation.fact.collector')}>
              <span className="inline-flex items-center gap-1" style={{ color: collectorColor(code) }}>
                <UserRound size={12} className="shrink-0" />{row.collector_name}
              </span>
            </Fact>
          )}
        </dl>
      </div>
    </PopOver>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-subtle">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** The figures that explain each colour (UI 66 §5b table, last column). Missing values are skipped. */
function SituationFacts({ row, t }: { row: ChatInboxRow; t: TFunction }) {
  const lastPaid = row.last_payment_date
    ? <Fact label={t('situation.fact.lastPaid')}><DateTime value={row.last_payment_date} showTime={false} /></Fact>
    : null;
  switch (row.situation_code) {
    case 'CURRENT':
      return (
        <>
          {row.next_due_date && (
            <Fact label={t('situation.fact.nextDue')}>
              <DateTime value={row.next_due_date} showTime={false} /> · {baht(row.next_due_amount)}
            </Fact>
          )}
          {lastPaid}
        </>
      );
    case 'DUE_TODAY':
      return (
        <>
          <Fact label={t('situation.fact.dueToday')}>{baht(row.next_due_amount)}</Fact>
          {lastPaid}
        </>
      );
    case 'IN_GRACE':
    case 'OVERDUE':
      return (
        <>
          <Fact label={t('situation.fact.overdue')}>
            {t('situation.fact.installments', { count: row.overdue_count ?? 0 })} · {baht(row.overdue_amount)}
          </Fact>
          {row.next_due_date && (
            <Fact label={t('situation.fact.since')}><DateTime value={row.next_due_date} showTime={false} /></Fact>
          )}
          {row.appointment_date && (
            <Fact label={t('situation.fact.appointment')}><DateTime value={row.appointment_date} showTime={false} /></Fact>
          )}
          {lastPaid}
        </>
      );
    case 'PAUSED':
      return row.next_due_date
        ? <Fact label={t('situation.fact.nextDue')}><DateTime value={row.next_due_date} showTime={false} /></Fact>
        : null;
    case 'COMPLETED':
      return lastPaid;
    default:
      return row.contract_state
        ? <Fact label={t('situation.fact.contractState')}>{contractStateLabel(row.contract_state, t)}</Fact>
        : null;
  }
}
