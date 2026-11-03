import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { X } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { baht, bangkokYearMonth, compactBaht, monthStart, type CollectionMonth, type SimBranch } from './simulationTypes';

// The collection window (156 §7): 3 months back, this month, 2 ahead for one branch.
// It floats instead of being a Modal because it must stay open while another
// branch is picked — the window follows the selection.
const EXPECT_FILL = '#a3a9ae';
const COLLECT_FILL = '#2a78d6';
const CW = 560;
const CH = 230;
const CL = 56;
const CR = 12;
const CT = 24;
const CB = 30;
const BAR = 22;

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return (Math.ceil((v / p) * 2) / 2) * p;
}

function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const pctText = (p: number | null) => (p == null ? '—' : `${p.toFixed(1)}%`);

export function SimulationCollection({ branch, generatedAt, onClose }: { branch: SimBranch; generatedAt: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<CollectionMonth[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const { year, month } = bangkokYearMonth(generatedAt);
  const thisMonth = monthStart(year, month, 0);
  const from = monthStart(year, month, -3);
  const to = monthStart(year, month, 2);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    setHover(null);
    apiClient.rpc<CollectionMonth[]>('fn_installments_collection_monthly', { p_month_from: from, p_month_to: to, p_branch_id: branch.id })
      .then(r => { if (alive) setRows(r); })
      .catch(err => { if (alive) setError(translateApiError(err, t)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch.id, from, to]);

  const locale = i18n.language === 'th' ? 'th-TH' : 'en-GB';
  const monthLabel = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00`).toLocaleDateString(locale, { month: 'short', year: '2-digit' });
  const isFuture = (m: CollectionMonth) => m.month.slice(0, 10) > thisMonth;
  const isCurrent = (m: CollectionMonth) => m.month.slice(0, 10) === thisMonth;
  const tag = (m: CollectionMonth) => (isCurrent(m) ? ' *' : isFuture(m) ? ' ↗' : '');

  const months = useMemo(() => rows ?? [], [rows]);
  const top = niceMax(Math.max(0, ...months.map(m => Math.max(m.expected_total, m.collected_total))));
  const band = (CW - CL - CR) / Math.max(1, months.length);
  const yOf = (v: number) => CT + (CH - CT - CB) * (1 - v / top);
  const hv = hover == null ? null : months[hover];
  const firstFuture = months.findIndex(isFuture);
  const hasAny = months.some(m => m.expected_total > 0);

  return (
    <div className="sim__card sim__collect" role="dialog" aria-label={`${t('simulation.collection.title')} ${branch.name}`}>
      <div className="sim__card-head">
        <h3>
          {t('simulation.collection.title')} · {branch.name}
          <small>{t('simulation.collection.subtitle')}</small>
        </h3>
        <Button variant="ghost" size="sm" className="sim__close" startIcon={<X size={14} />} aria-label={t('common.close')} onClick={onClose} />
      </div>

      {!rows && !error && <p className="sim__muted">{t('common.loading')}</p>}
      {error && <div className="alert alert-danger">{error}</div>}
      {rows && !error && !hasAny && <p className="sim__muted">{t('simulation.collection.empty')}</p>}
      {rows && !error && hasAny && (
        <>
          <div className="sim__legend-row">
            <span><i style={{ background: EXPECT_FILL }} />{t('simulation.collection.expected')}</span>
            <span><i style={{ background: COLLECT_FILL }} />{t('simulation.collection.collected')}</span>
            <span><i className="sim__swatch-future" />{t('simulation.collection.futureLegend')}</span>
          </div>
          <div className="sim__chart better-scroll">
            <svg width={CW} height={CH} viewBox={`0 0 ${CW} ${CH}`} onPointerLeave={e => e.pointerType === 'mouse' && setHover(null)}>
              {[0, 0.5, 1].map(k => (
                <g key={k}>
                  <line x1={CL} x2={CW - CR} y1={yOf(top * k)} y2={yOf(top * k)} stroke="var(--color-line)" />
                  <text x={CL - 6} y={yOf(top * k) + 4} textAnchor="end" className="sim__axis">{compactBaht(top * k)}</text>
                </g>
              ))}
              {firstFuture > 0 && (
                <g>
                  <line x1={CL + band * firstFuture} x2={CL + band * firstFuture} y1={CT - 14} y2={yOf(0)} stroke="var(--color-subtler)" strokeDasharray="4 3" />
                  <text x={CL + band * firstFuture + 6} y={CT - 6} className="sim__axis">{t('simulation.collection.future')}</text>
                </g>
              )}
              {months.map((m, i) => {
                const cx = CL + band * i + band / 2;
                const future = isFuture(m);
                const got = m.collected_total;
                return (
                  <g key={m.month} style={{ cursor: 'pointer' }} data-month={m.month}
                    onPointerEnter={e => e.pointerType === 'mouse' && setHover(i)}
                    onPointerUp={e => e.pointerType !== 'mouse' && setHover(h => (h === i ? null : i))}>
                    <rect x={CL + band * i} y={CT - 18} width={band} height={CH - CT - CB + 18} fill={hover === i ? 'rgba(42,120,214,.08)' : 'transparent'} />
                    {m.expected_total > 0 && (
                      <path d={barPath(cx - BAR - 1, yOf(m.expected_total), BAR, yOf(0) - yOf(m.expected_total))} fill={EXPECT_FILL}
                        fillOpacity={future ? 0.4 : 1} stroke={future ? EXPECT_FILL : 'none'} strokeDasharray={future ? '3 2' : undefined} />
                    )}
                    {got > 0 && <path d={barPath(cx + 1, yOf(got), BAR, yOf(0) - yOf(got))} fill={COLLECT_FILL} />}
                    {future
                      ? m.expected_total > 0 && <text x={cx - 1 - BAR / 2} y={yOf(m.expected_total) - 6} textAnchor="middle" className="sim__pct">{compactBaht(m.expected_total)}</text>
                      : m.collection_pct != null && <text x={cx + 1 + BAR / 2} y={yOf(got) - 6} textAnchor="middle" className="sim__pct">{pctText(m.collection_pct)}</text>}
                    <text x={cx} y={CH - 10} textAnchor="middle" className="sim__axis">{monthLabel(m.month)}{tag(m)}</text>
                  </g>
                );
              })}
            </svg>
            {hv && hover != null && (
              <div className="sim__tip" style={{ left: Math.min(CW - 190, Math.max(0, CL + band * hover + band / 2 - 95)) }}>
                <b>{monthLabel(hv.month)}{isFuture(hv) ? ` · ${t('simulation.collection.future')}` : ''}</b>
                <span><i style={{ background: EXPECT_FILL }} />{isFuture(hv) ? t('simulation.collection.toCollect') : t('simulation.collection.expected')} {baht(hv.expected_total)}</span>
                <span><i style={{ background: COLLECT_FILL }} />{isFuture(hv) ? t('simulation.collection.paidAhead') : t('simulation.collection.collected')} {baht(hv.collected_total)}{isFuture(hv) ? '' : ` (${pctText(hv.collection_pct)})`}</span>
                {!isFuture(hv) && <small>{t('simulation.collection.onTime')} {baht(hv.collected_on_time)} · {t('simulation.collection.late')} {baht(hv.collected_late)}</small>}
                <small>{isFuture(hv)
                  ? t('simulation.collection.futureCount', { due: hv.installments_due, paid: hv.installments_paid })
                  : t('simulation.collection.paidCount', { due: hv.installments_due, paid: hv.installments_paid })}</small>
              </div>
            )}
          </div>
          <table className="sim__days">
            <thead className="table-header">
              <tr className="table-row">
                <th className="table-head">{t('simulation.collection.month')}</th>
                <th className="table-head">{t('simulation.collection.expected')}</th>
                <th className="table-head">{t('simulation.collection.collected')}</th>
                <th className="table-head">{t('simulation.collection.onTime')}</th>
                <th className="table-head">{t('simulation.collection.late')}</th>
                <th className="table-head">%</th>
              </tr>
            </thead>
            <tbody>
              {months.map(m => {
                const future = isFuture(m);
                return (
                  <tr key={m.month} className={future ? 'sim__row-future' : undefined}>
                    <td>{monthLabel(m.month)}{tag(m)}</td>
                    <td>{baht(m.expected_total)}</td>
                    <td>{baht(m.collected_total)}</td>
                    <td>{future ? '—' : baht(m.collected_on_time)}</td>
                    <td>{future ? '—' : baht(m.collected_late)}</td>
                    <td>{future ? '—' : pctText(m.collection_pct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="sim__muted">{t('simulation.collection.note')}</p>
        </>
      )}
    </div>
  );
}
