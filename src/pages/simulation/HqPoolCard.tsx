import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { X } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { ageText, baht, type HqCreditDay, type HqPayoutDay, type HqPool, type SimBranch, type SimHq } from './simulationTypes';

// The card a pool room opens in the company building (156 §6h): the room's numbers,
// its day table, the shops it serves and the documents it is holding. Every figure is
// the RPC's own (pools[] counts, never re-counted from cases/settlements).

export function HqPoolCard({ hq, pool, branches, canChat, onClose }: {
  hq: SimHq;
  pool: HqPool;
  branches: SimBranch[];
  canChat: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const nameOf = (id: number) => branches.find(b => b.id === id)?.name ?? `#${id}`;
  const today = hq.days[hq.days.length - 1] ?? '';
  const dayCell = (day: string) => (day ? <DateTime value={day} showTime={false} /> : t('simulation.hq.older'));

  const cases = hq.cases.filter(c => c.pool_id === pool.id && c.status === 'SUBMITTED');
  const held = hq.settlements.filter(s => s.pool_id === pool.id && (s.status === 'CLOSE_SUBMITTED' || s.status === 'IN_PAYOUT'));

  return (
    <div className="sim__card sim__detail better-scroll" data-testid="sim-hq-card">
      <div className="sim__card-head">
        <h3>{pool.name}<small>{t(`simulation.hq.kind_${pool.kind}`)}</small></h3>
        <Button variant="ghost" size="sm" className="sim__close" startIcon={<X size={14} />} aria-label={t('common.close')} onClick={onClose} />
      </div>
      <dl>
        {pool.kind === 'CREDIT' && (() => {
          const d = (pool.days as HqCreditDay[]).find(x => x.day === today);
          return (
            <>
              <dt>{t('simulation.hq.waitingCredit')}</dt><dd>{pool.waiting ?? 0}</dd>
              <dt>{t('simulation.hq.approvedToday')}</dt><dd>{d?.approved ?? 0}</dd>
              <dt>{t('simulation.hq.returnedToday')}</dt><dd>{d?.returned ?? 0}</dd>
            </>
          );
        })()}
        {pool.kind === 'PAYOUT' && (
          <>
            <dt>{t('simulation.hq.waitingPayout')}</dt><dd>{pool.waiting ?? 0}</dd>
            <dt>{t('simulation.hq.pending')}</dt><dd>{baht(pool.pending)}</dd>
            <dt>{t('simulation.hq.paidToday')}</dt><dd>{baht(pool.paid)}</dd>
          </>
        )}
        {pool.kind === 'CUSTOMER_SERVICE' && canChat && pool.unread != null && (
          <>
            <dt>{t('simulation.hq.unread')}</dt><dd>{pool.unread}</dd>
            <dt>{t('simulation.hq.threads')}</dt><dd>{pool.unread_threads ?? 0}</dd>
            {(pool.unread_threads ?? 0) > 0 && <><dt>{t('simulation.hq.oldest')}</dt><dd>{ageText(t, pool.oldest_unread_min ?? 0)}</dd></>}
          </>
        )}
        <dt>{t('simulation.hq.members')}</dt><dd>{t('simulation.hq.membersValue', { m: pool.members, a: pool.active_today })}</dd>
      </dl>

      {pool.kind === 'CREDIT' && pool.days.length > 0 && (
        <table className="sim__days">
          <thead className="table-header">
            <tr className="table-row">
              <th className="table-head">{t('simulation.hq.day')}</th>
              <th className="table-head">{t('simulation.hq.submitted')}</th>
              <th className="table-head">{t('simulation.hq.approved')}</th>
              <th className="table-head">{t('simulation.hq.returned')}</th>
            </tr>
          </thead>
          <tbody>
            {(pool.days as HqCreditDay[]).map(d => (
              <tr key={d.day}><td>{dayCell(d.day)}</td><td>{d.submitted}</td><td>{d.approved}</td><td>{d.returned}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {/* Two tables, not one: six columns (three counts + two baht figures) don't fit
          the 300px card — at ฿1,000,000+ the table ran ~110px past it and scrolled sideways. */}
      {pool.kind === 'PAYOUT' && pool.days.length > 0 && (
        <>
          <table className="sim__days" data-testid="sim-hq-payout-counts">
            <thead className="table-header">
              <tr className="table-row">
                <th className="table-head">{t('simulation.hq.submitDay')}</th>
                <th className="table-head">{t('simulation.hq.unchecked')}</th>
                <th className="table-head">{t('simulation.hq.checked')}</th>
                <th className="table-head">{t('simulation.hq.inPayout')}</th>
              </tr>
            </thead>
            <tbody>
              {(pool.days as HqPayoutDay[]).map(d => (
                <tr key={d.day || 'older'}>
                  <td>{dayCell(d.day)}</td><td>{d.unchecked}</td><td>{d.checked}</td><td>{d.in_payout}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="sim__days" data-testid="sim-hq-payout-money">
            <thead className="table-header">
              <tr className="table-row">
                <th className="table-head">{t('simulation.hq.submitDay')}</th>
                <th className="table-head">{t('simulation.pendingShort')}</th>
                <th className="table-head">{t('simulation.hq.paid')}</th>
              </tr>
            </thead>
            <tbody>
              {(pool.days as HqPayoutDay[]).map(d => (
                <tr key={d.day || 'older'}>
                  <td>{dayCell(d.day)}</td><td>{baht(d.pending)}</td><td>{baht(d.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {pool.kind === 'CREDIT' && (
        <>
          <h4 className="sim__sub">{t('simulation.hq.openCases')}</h4>
          {cases.length === 0 ? <div className="sim__waiter">{t('simulation.hq.none')}</div> : cases.map(c => (
            <div key={c.id} className="sim__waiter">
              {t('simulation.hq.caseRow', { code: c.code, seq: c.seq, age: ageText(t, c.age_min) })}
              <small className="sim__waiter-sub">{[nameOf(c.branch_id), c.product].filter(Boolean).join(' · ')}</small>
            </div>
          ))}
        </>
      )}
      {pool.kind === 'PAYOUT' && (
        <>
          <h4 className="sim__sub">{t('simulation.hq.openSettlements')}</h4>
          {held.length === 0 ? <div className="sim__waiter">{t('simulation.hq.none')}</div> : held.map(s => (
            <div key={s.id} className="sim__waiter">
              {s.code} · {baht(s.amount)} · {t(s.checked ? 'simulation.hq.settlementChecked' : 'simulation.hq.settlementUnchecked')}
              <small className="sim__waiter-sub">{nameOf(s.branch_id)} · {s.day ? <DateTime value={s.day} showTime={false} /> : ''}</small>
            </div>
          ))}
        </>
      )}

      <h4 className="sim__sub">{t('simulation.hq.shops')}</h4>
      <div className="sim__waiter">{pool.branch_ids.map(nameOf).join(' · ') || t('simulation.hq.none')}</div>
    </div>
  );
}
