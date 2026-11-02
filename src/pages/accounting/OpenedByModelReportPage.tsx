import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Select, InputDateRangePicker } from 'tsp-form';
import { ArrowRightFromLine, Package, Keyboard } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  fmtCurrency, toLocalDateStr, parseLocalDate, makeDateRangePickerFormat,
} from '../../lib/format';
import { HBarReport, HBarLegend, type HBarRow } from '../../components/HBarReport';
import {
  COLOR_DOWN,
  COLOR_FINANCED,
  OpenedMetricStrip,
  addOpenedRow,
  emptyOpenedMoney,
  openedMetricCells,
  type OpenedRow,
} from '../../components/ContractsOpenedChart';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานเปิดสัญญาตามรุ่น — opened contracts ranked by product model.
 * Horizontal bar per model. Each bar is 2 segments: financed + down, in the
 * same colours as รายงานเปิดสัญญา; bar length = financed + down. End label = count · ฿financed · down %.
 * A branch-tier caller gets `down_total` = null → one-segment bars, no %.
 * Order (opened vs financed) is a header toggle → p_order_by; render as-is.
 * Data: POST /rpc/fn_contracts_opened_by_model. Scope is JWT-bound; the
 * company/branch dropdowns only narrow inside what the JWT already permits.
 * Summary cells come from the shared OPENED_METRICS table (null = hidden),
 * with this report's own labels and its ราคาตกลงรวม cell (work order §4.3).
 * Spec: UI_FEEDBACK/2026-07-28_IMPLEMENT_report_opened_by_model_chart.md
 *     + UI_FEEDBACK/2026-11-02_IMPLEMENT_report_contracts_opened_money_tiers.md
 * ─────────────────────────────────────────────────────────────────────────── */

const TOP_N = 15;

// This report's words for the shared figures. It keeps its own "รวม" labels.
const SUMMARY_LABELS: Record<string, string> = {
  contracts: 'openedByModel.sumContracts',
  financed: 'openedByModel.sumFinanced',
  down: 'openedByModel.sumDown',
};

interface ModelRow extends OpenedRow {
  model_id: number | null;
  product_display_name: string;
}

/** Bar length: the money in the contract (financed) plus the down payment
 *  when this caller may see it. Never `agreed_total` — that is null for a
 *  branch, which drew empty bars. */
const barValue = (r: OpenedRow) => Number(r.financed_total) + (Number(r.down_total) || 0);

interface Branch { id: number; name: string; company_id: number }
interface Company { id: number; name: string }

type OrderBy = 'opened' | 'financed';

function monthStartIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function parseDate8(digits: string): Date | null {
  if (digits.length !== 8) return null;
  const day = parseInt(digits.slice(0, 2), 10);
  const month = parseInt(digits.slice(2, 4), 10);
  let year = parseInt(digits.slice(4, 8), 10);
  if (year > 2400) year -= 543;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function OpenedByModelReportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isHoldingScope = !user?.company_id && !user?.branch_id;
  const isCompanyScope = !!user?.company_id && !user?.branch_id;

  const now = new Date();
  const [fromDate, setFromDate] = useState(monthStartIso(now));
  const [toDate, setToDate] = useState(toLocalDateStr(now));
  const [companyId, setCompanyId] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');
  const [orderBy, setOrderBy] = useState<OrderBy>('opened');
  const [isTypingRange, setIsTypingRange] = useState(false);

  // HOLDING scope may pick a company; the branch list follows that choice.
  // COMPANY scope's branches are already limited to its own company by RLS.
  const { data: companies = [] } = useQuery({
    queryKey: ['companies-active'],
    queryFn: () => apiClient.get<Company[]>('/v_companies?select=id,name&order=name'),
    enabled: isHoldingScope,
  });

  const branchScopeParam = companyId ? `?company_id=eq.${companyId}&is_active=is.true&order=name` : '?is_active=is.true&order=name';
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active', companyId || 'all'],
    queryFn: () => apiClient.get<Branch[]>(`/v_branches${branchScopeParam}`),
    enabled: isHoldingScope || isCompanyScope,
  });

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['opened-by-model', fromDate, toDate, companyId, branchId, orderBy],
    queryFn: () => apiClient.rpc<ModelRow[]>('fn_contracts_opened_by_model', {
      p_date_from: fromDate || null,
      p_date_to: toDate || null,
      p_branch_id: branchId ? Number(branchId) : null,
      p_company_id: companyId ? Number(companyId) : null,
      p_order_by: orderBy,
    }),
  });

  const totals = useMemo(() => rows.reduce(addOpenedRow, emptyOpenedMoney()), [rows]);

  const summaryCells = useMemo(() => {
    const cells = openedMetricCells(totals, t).map((c) => (
      SUMMARY_LABELS[c.key] ? { ...c, label: t(SUMMARY_LABELS[c.key]), hint: undefined } : c
    ));
    if (totals.agreed != null) {
      const afterDown = cells.findIndex((c) => c.key === 'down') + 1;
      cells.splice(afterDown || cells.length, 0, {
        key: 'agreed',
        label: t('openedByModel.sumAgreed'),
        value: `฿${fmtCurrency(totals.agreed)}`,
      });
    }
    return cells;
  }, [totals, t]);

  // Show top-N by the RPC's own order, roll the long tail into one "others" bar.
  const barRows = useMemo<HBarRow[]>(() => {
    const head = rows.slice(0, TOP_N);
    const tail = rows.slice(TOP_N);
    const out: HBarRow[] = head.map((r) => ({
      key: r.model_id ?? 'none',
      label: r.model_id == null ? t('openedByModel.noModel') : r.product_display_name,
      value: barValue(r),
      segments: [
        { value: Number(r.financed_total) || 0, color: COLOR_FINANCED, label: t('openedByModel.financed') },
        { value: Number(r.down_total) || 0, color: COLOR_DOWN, label: t('openedByModel.down') },
      ],
      endLabel: (
        <span>
          {t('openedByModel.contractsN', { count: r.opened_contracts })}
          {' · '}฿{fmtCurrency(r.financed_total)}
          {r.down_pct != null && <span className="text-subtler"> · {t('openedByModel.downPct', { pct: r.down_pct })}</span>}
        </span>
      ),
    }));
    if (tail.length > 0) {
      const agg = tail.reduce(addOpenedRow, emptyOpenedMoney());
      out.push({
        key: '__others__',
        label: t('openedByModel.others', { count: tail.length }),
        value: (agg.financed ?? 0) + (agg.down ?? 0),
        segments: [
          { value: agg.financed ?? 0, color: COLOR_FINANCED },
          { value: agg.down ?? 0, color: COLOR_DOWN },
        ],
        endLabel: (
          <span>
            {t('openedByModel.contractsN', { count: agg.contracts })}
            {' · '}฿{fmtCurrency(agg.financed ?? 0)}
          </span>
        ),
      });
    }
    return out;
  }, [rows, t]);

  const hasData = rows.length > 0;

  const companyOptions = companies.map((c) => ({ value: String(c.id), label: c.name }));
  const branchOptions = branches.map((b) => ({ value: String(b.id), label: b.name }));

  const dateRangePicker = (
    <InputDateRangePicker
      fromDate={parseLocalDate(fromDate)}
      toDate={parseLocalDate(toDate)}
      onFromDateChange={(d) => setFromDate(toLocalDateStr(d))}
      onToDateChange={(d) => setToDate(toLocalDateStr(d))}
      dateFormat={makeDateRangePickerFormat(i18n.language)}
      size="sm"
      locale={i18n.language}
      calendar="gregorian"
      endIcon={<Keyboard size={14} />}
      onEndIconClick={() => setIsTypingRange((v) => !v)}
      typingMode={isTypingRange}
      onTypingModeChange={setIsTypingRange}
      typingMask="##/##/#### - ##/##/####"
      typingPlaceholder="DD/MM/YYYY - DD/MM/YYYY"
      parseTypedDates={(raw) => ({
        from: parseDate8(raw.slice(0, 8)),
        to: raw.length >= 16 ? parseDate8(raw.slice(8, 16)) : null,
      })}
    />
  );

  const companyPicker = isHoldingScope && (
    <Select
      options={companyOptions}
      value={companyId || null}
      onChange={(v) => { setCompanyId((v as string) ?? ''); setBranchId(''); }}
      placeholder={t('openedByModel.allCompanies')}
      size="sm"
      clearable
      showChevron
    />
  );

  const branchPicker = (isHoldingScope || isCompanyScope) && (
    <Select
      options={branchOptions}
      value={branchId || null}
      onChange={(v) => setBranchId((v as string) ?? '')}
      placeholder={t('openedByModel.allBranches')}
      size="sm"
      clearable
      showChevron
    />
  );

  // h-7 = tsp-form's form-control-sm height, matching the date range and branch
  // pickers sitting beside it in the header row.
  const orderToggle = (
    <div className="input-group h-7">
      {(['opened', 'financed'] as OrderBy[]).map((key, i) => (
        <button
          key={key}
          type="button"
          onClick={() => setOrderBy(key)}
          className={`px-3 text-xs cursor-pointer border-none whitespace-nowrap transition-colors ${
            orderBy === key ? 'bg-item-active-bg text-item-active-fg font-medium' : 'bg-transparent text-subtle hover:text-fg'
          } ${i > 0 ? 'border-l border-line' : ''}`}
        >
          {t(key === 'opened' ? 'openedByModel.byCount' : 'openedByModel.byFinanced')}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-dvh">
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
          {t('openedByModel.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      {/* Desktop header — title + pickers + order toggle */}
      <div className="flex-none px-4 py-2.5 border-b border-line flex flex-col gap-2 max-md:hidden">
        <h1 className="heading-2 whitespace-nowrap">{t('openedByModel.title')}</h1>
        {/* Two sides: filters (left, elastic) + order toggle (right, fixed).
            The filters share the leftover width via flex-1 with a max cap, so
            they take up the slack instead of leaving a gap in the middle; the
            toggle keeps its intrinsic width and stays pinned right. */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex-[2] min-w-0">{dateRangePicker}</div>
            {companyPicker && <div className="flex-1 min-w-0">{companyPicker}</div>}
            {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
          </div>
          <div className="shrink-0">{orderToggle}</div>
        </div>
      </div>

      {/* Mobile pickers */}
      <div className="flex-none p-2 border-b border-line flex flex-col gap-2 md:hidden">
        <div className="w-full">{dateRangePicker}</div>
        <div className="flex items-center gap-2">
          {companyPicker && <div className="flex-1 min-w-0">{companyPicker}</div>}
          {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
        </div>
        <div className="self-start">{orderToggle}</div>
      </div>

      {/* Summary strip — the tier's visible figures; a hidden (null) one has no cell. */}
      <div className="flex-none">
        <OpenedMetricStrip cells={summaryCells} />
      </div>

      {/* Bars */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll p-4 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-subtler">
            <Package size={32} strokeWidth={1.5} />
            <span className="text-sm">{t('openedByModel.noData')}</span>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            <div className="mb-4">
              <HBarLegend items={[
                { color: COLOR_FINANCED, label: t('openedByModel.financed') },
                ...(totals.down == null ? [] : [{ color: COLOR_DOWN, label: t('openedByModel.down') }]),
              ]} />
            </div>
            <HBarReport rows={barRows} isMuted={(r) => r.key === '__others__'} />
          </div>
        )}
      </div>
    </div>
  );
}
