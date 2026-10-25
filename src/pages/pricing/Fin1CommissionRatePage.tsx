// "เรทดอกเบี้ยตามค่าคอม" — the FIN1 rate at every commission level a shop can
// pick, per term, and the fund's lever for each term.
// IMPLEMENT 2026-10-26 adjustable commission §5.
//
// Rows are terms, columns are commission levels; each cell is what a shop gets
// at that level — every figure from fn_fin1_commission_rate_table, so this page
// shows exactly the installment a shop is quoted on its plan step, to the baht.
// A sample price + down adds the baht figures (installment, commission, the
// effect on the fund); without them the table shows rates only.
//
// The lever (how much more the fund takes off per point the shop gives up, in
// two slopes either side of `knee_pts`) is editable per term by holders of
// PRICING.FIN1_RATE_MANAGE. It changes the next plan every shop in the holding
// sets — never a contract already priced — so the window says that first.
// R and the knee are shown only (set by migration).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Badge, Button, DataTable, MaskedInput, MobileHeader, Modal, Tooltip, type ColumnDef,
} from 'tsp-form';
import { AlertTriangle, ArrowRightFromLine, Pencil } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency } from '../../lib/format';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCommissionPct } from '../contracts/workspace/Fin1PlanEditor';

// ── Response (fn_fin1_commission_rate_table) ─────────────────────────────────

interface LevelCell {
  commission_pct: number;
  /** False = a level the system doesn't take yet (negative commission today). */
  available: boolean;
  cut_pts: number;
  multiplier: number;
  shop_part: number;
  fund_part: number;
  interest_total_pct: number;
  flat_monthly_pct: number;
  // Only with a sample price + down:
  installment_amount?: number;
  last_installment_amount?: number;
  total_effective?: number;
  commission_amount?: number;
  /** Against the full-commission deal; negative = the fund gives it up. */
  fund_effect_amount?: number;
}

interface TermRow {
  term_months: number;
  base_multiplier: number;
  lever_fund_top: number;
  lever_fund_low: number;
  levels: LevelCell[];
}

interface RateTable {
  plan: { plan_code: string; name_th: string; ceiling_pct: number; min_pct: number; plan_min_pct: number; step_pct: number };
  policy: { exchange_r: number; knee_pts: number; rounding_unit: number };
  sample: { price: number; down: number; financed_amount: number } | null;
  levels: number[];
  terms: TermRow[];
}

/** The sample deal the owner's own rate sheet (nnf-rate) starts from. */
const DEFAULT_PRICE = '27000';
const DEFAULT_DOWN = '5400';

const fmtFactor = (n: number, dp = 4) => String(Number(n.toFixed(dp)));

export function Fin1CommissionRatePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // A per-user grant (v_my_permissions), not the role capability list —
  // fund credit staff and admins receive it one by one (work order §5.2).
  const { hasPermission } = useMyPermissions();
  const canManage = hasPermission('PRICING.FIN1_RATE_MANAGE');

  const [priceStr, setPriceStr] = useState(DEFAULT_PRICE);
  const [downStr, setDownStr] = useState(DEFAULT_DOWN);
  // The table re-reads once typing pauses, not on every keystroke.
  const [sample, setSample] = useState<{ price: number; down: number } | null>(
    { price: Number(DEFAULT_PRICE), down: Number(DEFAULT_DOWN) },
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      const price = priceStr === '' ? null : Number(priceStr);
      const down = downStr === '' ? null : Number(downStr);
      // Price and down go as a pair or not at all (else FIN1_INPUT).
      setSample(price != null && down != null && price > 0 ? { price, down } : null);
    }, 400);
    return () => clearTimeout(timer);
  }, [priceStr, downStr]);
  const halfSample = (priceStr === '') !== (downStr === '');

  const { data, isFetching, error } = useQuery({
    queryKey: ['fin1-commission-rate-table', sample?.price ?? null, sample?.down ?? null],
    queryFn: () => apiClient.rpc<RateTable>('fn_fin1_commission_rate_table',
      sample ? { p_price: sample.price, p_down: sample.down } : {}),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });

  const [leverFor, setLeverFor] = useState<TermRow | null>(null);
  const hasBaht = !!data?.sample;

  const columns = useMemo<ColumnDef<TermRow>[]>(() => {
    if (!data) return [];
    const levelCols: ColumnDef<TermRow>[] = data.levels.map((lvl, i) => {
      const open = data.terms[0]?.levels[i]?.available ?? true;
      return {
        id: `lvl-${i}`,
        header: () => (
          <div className="flex flex-col items-end leading-tight">
            <span className={open ? '' : 'text-subtler'}>
              {t('fin1CommissionRates.levelHeader', { pct: fmtCommissionPct(lvl) })}
            </span>
            {lvl === data.plan.ceiling_pct && (
              <span className="text-[11px] font-normal text-subtle">{t('fin1CommissionRates.fullCommission')}</span>
            )}
            {!open && <Badge size="xs">{t('fin1CommissionRates.notOpenYet')}</Badge>}
          </div>
        ),
        cell: ({ row }) => <LevelCellView cell={row.original.levels[i]} hasBaht={hasBaht} t={t} />,
        className: 'text-right',
      };
    });
    return [
      {
        accessorKey: 'term_months',
        header: () => t('fin1CommissionRates.term'),
        cell: ({ row }) => (
          <span className="text-sm font-medium tabular-nums whitespace-nowrap">
            {t('fin1Plan.months', { count: row.original.term_months })}
          </span>
        ),
        className: 'w-20',
      },
      ...levelCols,
      {
        id: 'lever',
        header: () => (
          <div className="flex flex-col leading-tight">
            <span>{t('fin1CommissionRates.lever')}</span>
            <span className="text-[11px] font-normal text-subtle">
              {t('fin1CommissionRates.leverSlopes', { knee: fmtCommissionPct(data.policy.knee_pts) })}
            </span>
          </div>
        ),
        cell: ({ row }) => (
          // justify-between: the edit button sits at one x on every row, however
          // long the figures beside it are.
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm tabular-nums whitespace-nowrap">
              {fmtFactor(row.original.lever_fund_top)} / {fmtFactor(row.original.lever_fund_low)}
            </span>
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                startIcon={<Pencil size={14} />}
                aria-label={t('fin1CommissionRates.editLever')}
                onClick={() => setLeverFor(row.original)}
              />
            )}
          </div>
        ),
        className: 'w-44',
      },
    ];
  }, [data, hasBaht, canManage, t]);

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('fin1CommissionRates.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex flex-col gap-1 mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('fin1CommissionRates.title')}</h1>
          {data && <span className="text-sm text-subtle">{data.plan.name_th}</span>}
        </div>

        <div className="flex-1 min-h-0 overflow-auto better-scroll pb-8 flex flex-col gap-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex flex-col w-36">
              <label className="form-label text-xs">{t('fin1CommissionRates.samplePrice')}</label>
              <MaskedInput mask="number" size="sm" decimalScale={0} value={priceStr} onChange={(raw) => setPriceStr(raw)} />
            </div>
            <div className="flex flex-col w-36">
              <label className="form-label text-xs">{t('fin1CommissionRates.sampleDown')}</label>
              <MaskedInput mask="number" size="sm" decimalScale={0} value={downStr} onChange={(raw) => setDownStr(raw)} />
            </div>
            <div className="text-xs text-subtle pb-2 tabular-nums">
              {/* A refused sample leaves no table to describe — the red band says why. */}
              {error ? null : halfSample
                ? t('fin1CommissionRates.samplePair')
                : data?.sample
                  ? t('fin1CommissionRates.sampleFinanced', { amount: fmtCurrency(data.sample.financed_amount) })
                  : t('fin1CommissionRates.noSample')}
            </div>
          </div>

          {data && (
            <div className="text-xs text-subtle tabular-nums">
              {t('fin1CommissionRates.policyLine', {
                r: fmtFactor(data.policy.exchange_r, 2),
                knee: fmtCommissionPct(data.policy.knee_pts),
                unit: data.policy.rounding_unit,
              })}
            </div>
          )}

          {error && (
            <div className="alert alert-danger">
              <AlertTriangle size={16} />
              <span>{translateApiError(error, t)}</span>
            </div>
          )}

          <DataTable<TermRow>
            outlined
            data={data?.terms ?? []}
            columns={columns}
            className={`${isFetching ? 'opacity-60' : ''} transition-opacity`}
            noResults={<div className="p-8 text-center text-subtler">{t('common.noData')}</div>}
          />
        </div>
      </div>

      <LeverModal
        row={leverFor}
        kneePts={data?.policy.knee_pts ?? null}
        onClose={() => setLeverFor(null)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['fin1-commission-rate-table'] })}
      />
    </>
  );
}

// ── One cell: what a shop gets at this term and commission ──────────────────

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function LevelCellView({ cell, hasBaht, t }: { cell: LevelCell | undefined; hasBaht: boolean; t: TFn }) {
  if (!cell) return <span className="text-subtler">—</span>;
  const dim = !cell.available;
  const lines: string[] = [
    t('fin1CommissionRates.tipMultiplier', { value: fmtFactor(cell.multiplier) }),
    t('fin1CommissionRates.tipShopPart', { value: fmtFactor(cell.shop_part) }),
    t('fin1CommissionRates.tipFundPart', { value: fmtFactor(cell.fund_part) }),
  ];
  if (cell.commission_amount != null) {
    lines.push(t('fin1CommissionRates.tipCommission', { amount: fmtCurrency(cell.commission_amount) }));
  }
  if (cell.fund_effect_amount != null) {
    lines.push(t('fin1CommissionRates.tipFundEffect', { amount: fmtCurrency(cell.fund_effect_amount) }));
  }
  if (cell.last_installment_amount != null && cell.last_installment_amount !== cell.installment_amount) {
    lines.push(t('fin1CommissionRates.tipLast', { amount: fmtCurrency(cell.last_installment_amount) }));
  }
  if (dim) lines.push(t('fin1CommissionRates.notOpenYet'));

  return (
    <Tooltip
      content={
        <div className="flex flex-col gap-0.5">
          {lines.map((l, i) => <div key={i} className="text-xs">{l}</div>)}
        </div>
      }
    >
      <div className={`flex flex-col items-end leading-tight tabular-nums ${dim ? 'text-subtler' : ''}`}>
        {hasBaht && cell.installment_amount != null ? (
          <>
            <span className="text-sm font-semibold">{fmtCurrency(cell.installment_amount)}</span>
            <span className={`text-[11px] ${dim ? '' : 'text-subtle'}`}>
              {t('fin1CommissionRates.perMonthPct', { pct: fmtFactor(cell.flat_monthly_pct, 2) })}
            </span>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold">
              {t('fin1CommissionRates.perMonthPct', { pct: fmtFactor(cell.flat_monthly_pct, 2) })}
            </span>
            <span className={`text-[11px] ${dim ? '' : 'text-subtle'}`}>×{fmtFactor(cell.multiplier)}</span>
          </>
        )}
      </div>
    </Tooltip>
  );
}

// ── Lever edit window ───────────────────────────────────────────────────────

interface LeverResult {
  term_months: number;
  lever_fund_top: number;
  lever_fund_low: number;
}

function LeverModal({ row: rowProp, kneePts, onClose, onSaved }: {
  /** Null = closed. The Modal itself stays mounted. */
  row: TermRow | null;
  kneePts: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const open = rowProp !== null;
  // Keep the last row through the close transition.
  const lastRow = useRef(rowProp);
  if (rowProp) lastRow.current = rowProp;
  const row = rowProp ?? lastRow.current;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [top, setTop] = useState('');
  const [low, setLow] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LeverResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open || !rowProp) return;
    setView('form');
    setTop(String(rowProp.lever_fund_top));
    setLow(String(rowProp.lever_fund_low));
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open, rowProp?.term_months]);

  const isDirty = row != null && (top !== String(row.lever_fund_top) || low !== String(row.lever_fund_low));

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (saving) return;
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (!row || top === '' || low === '') return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<LeverResult>('fn_fin1_lever_set', {
        p_term_months: row.term_months,
        p_fund_top: Number(top),
        p_fund_low: Number(low),
      });
      setResult(res);
      setView('done');
      onSaved();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const knee = kneePts != null ? fmtCommissionPct(kneePts) : '—';

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%" ariaLabel={t('fin1CommissionRates.editLever')}>
        {view === 'form' ? (
          <>
            <div className="modal-header">
              <h2 className="modal-title">{t('fin1CommissionRates.editLever')}</h2>
              <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
            </div>
            <div className="modal-content flex flex-col gap-3">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{row ? t('fin1Plan.months', { count: row.term_months }) : '—'}</div>
                {row && (
                  <div className="text-xs text-subtle tabular-nums">
                    {t('fin1CommissionRates.baseMultiplier', { value: fmtFactor(row.base_multiplier, 3) })}
                  </div>
                )}
              </div>
              <div className="alert alert-warning">
                <AlertTriangle size={16} className="shrink-0" />
                <div className="alert-description text-xs">{t('fin1CommissionRates.leverWarning')}</div>
              </div>
              <div className="form-grid pb-0">
                <div className="flex flex-col">
                  <label className="form-label">{t('fin1CommissionRates.leverTop', { knee })}</label>
                  <div className="w-36">
                    <MaskedInput mask="number" size="sm" decimalScale={4} value={top} onChange={(raw) => setTop(raw)} className="w-full" />
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('fin1CommissionRates.leverLow', { knee })}</label>
                  <div className="w-36">
                    <MaskedInput mask="number" size="sm" decimalScale={4} value={low} onChange={(raw) => setLow(raw)} className="w-full" />
                  </div>
                </div>
              </div>
              <span className="text-xs text-subtle">{t('fin1CommissionRates.leverHint')}</span>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={submit} disabled={saving || !isDirty || top === '' || low === ''}>
                {t('common.save')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('fin1CommissionRates.leverSaved')}
            contractCode={t('fin1Plan.months', { count: result.term_months })}
            detailRows={[
              { label: t('fin1CommissionRates.leverTop', { knee }), value: fmtFactor(result.lever_fund_top) },
              { label: t('fin1CommissionRates.leverLow', { knee }), value: fmtFactor(result.lever_fund_low) },
            ]}
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
