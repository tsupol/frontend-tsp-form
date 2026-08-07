import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Select } from 'tsp-form';
import { ArrowRightFromLine, Hourglass, Info } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';
import { HBarReport, type HBarRow } from '../../components/HBarReport';
import { useCollectionContext } from './useCollectionContext';
import { CollectionViewTabs } from './CollectionViewTabs';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานยอดค้างชำระ — overdue aging snapshot in 7 weekly buckets.
 * NOT a monthly report: there is no month picker, the numbers move every day
 * (a customer pays → their row leaves the report immediately).
 *
 * Three views, chosen by WHICH TAB the user pressed — never derived from role.
 * A branch manager who is also in a collection pool wears both hats and sees
 * all three, with DIFFERENT numbers in each. That is correct, not a bug:
 *   branch  = every overdue contract of the branch (incl. other people's + park)
 *   pool    = every pool member's book (can cross branches) + the park row
 *   my book = only what the caller holds (can cross branches)
 * ⛔ Never reconcile the tabs against each other, and never sum one from another.
 *
 * Buckets come pre-classified and pre-ordered from the DB (dense: always 7,
 * empty ones are zero rows, not missing). UI translates `bucket_code` and
 * renders in the given order — it must NOT sort or re-derive the bands.
 *
 * Data: POST /rpc/fn_overdue_aging_{summary,pool,my_book} + fn_my_collection_context
 * Spec: UI_FEEDBACK/2026-08-07_IMPLEMENT_report_overdue_aging.md
 * ─────────────────────────────────────────────────────────────────────────── */

// Bars count contracts (one unit, one colour). The money rides as an end
// label — it must never become a second segment, or the bar stops being a
// count and starts being an unreadable mixed-unit stack.
const COLOR_BAR = 'var(--chart-1)';
// 56 days ≈ two whole missed installments. That band gets the warning colour
// so the heavy end of the book is visible without reading the numbers.
const COLOR_BAR_SEVERE = 'var(--color-danger)';
const SEVERE_BUCKET = 'W_8_PLUS';

interface AgingRow {
  bucket_code: string;
  bucket_rank: number;
  contract_count: number;
  overdue_amount: number;
  slip_pending_count: number;
}

interface SummaryRow extends AgingRow {
  branch_id: number;
  branch_name: string;
  unassigned_count: number;
}

interface PoolRow extends AgingRow {
  pool_id: number;
  collector_user_id: number | null;
  display_name: string | null;
}

interface Branch { id: number; name: string; company_id: number }
interface Company { id: number; name: string }
interface Pool { pool_id: number; pool_name: string }

/** One rendered group of 7 bars (a branch, a pool member, or "my book"). */
interface AgingGroup {
  key: string;
  title: string | null;
  /** Marks the park row so it can be styled as the unassigned pile. */
  isPark?: boolean;
  buckets: AgingRow[];
  totalContracts: number;
  totalAmount: number;
  totalSlips: number;
}

function sumGroup(key: string, title: string | null, buckets: AgingRow[], isPark?: boolean): AgingGroup {
  return {
    key,
    title,
    isPark,
    buckets,
    totalContracts: buckets.reduce((s, b) => s + b.contract_count, 0),
    totalAmount: buckets.reduce((s, b) => s + (Number(b.overdue_amount) || 0), 0),
    totalSlips: buckets.reduce((s, b) => s + b.slip_pending_count, 0),
  };
}

export function OverdueAgingReportPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isHoldingScope = !user?.company_id && !user?.branch_id;
  const isCompanyScope = !!user?.company_id && !user?.branch_id;
  const canPickScope = isHoldingScope || isCompanyScope;

  const { context, view, setView, availableViews } = useCollectionContext();

  const [companyId, setCompanyId] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');
  const [poolId, setPoolId] = useState<string>('');

  const { data: companies = [] } = useQuery({
    queryKey: ['companies-active'],
    queryFn: () => apiClient.get<Company[]>('/v_companies?select=id,name&order=name'),
    enabled: isHoldingScope,
  });

  const branchScopeParam = companyId
    ? `?company_id=eq.${companyId}&is_active=is.true&order=name`
    : '?is_active=is.true&order=name';
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active', companyId || 'all'],
    queryFn: () => apiClient.get<Branch[]>(`/v_branches${branchScopeParam}`),
    enabled: canPickScope,
  });

  // Pool picker is only meaningful above branch scope — a BRANCH caller is
  // clamped to their own pool by the RPC and p_pool_id is ignored.
  const { data: pools = [] } = useQuery({
    queryKey: ['collection-pools-active'],
    queryFn: () => apiClient.get<Pool[]>('/v_collection_pools?select=pool_id,pool_name&is_active=is.true&order=pool_name'),
    enabled: canPickScope && view === 'pool',
  });

  const { data: summaryRows = [], isFetching: loadingSummary } = useQuery({
    queryKey: ['overdue-aging-summary', companyId, branchId],
    queryFn: () => apiClient.rpc<SummaryRow[]>('fn_overdue_aging_summary', {
      p_company_id: companyId ? Number(companyId) : null,
      p_branch_id: branchId ? Number(branchId) : null,
    }),
    enabled: view === 'branch',
  });

  const { data: poolRows = [], isFetching: loadingPool } = useQuery({
    queryKey: ['overdue-aging-pool', poolId],
    queryFn: () => apiClient.rpc<PoolRow[]>('fn_overdue_aging_pool', {
      p_pool_id: poolId ? Number(poolId) : null,
    }),
    enabled: view === 'pool',
  });

  const { data: myBookRows = [], isFetching: loadingMyBook } = useQuery({
    queryKey: ['overdue-aging-my-book'],
    queryFn: () => apiClient.rpc<AgingRow[]>('fn_overdue_aging_my_book', {}),
    enabled: view === 'my_book',
  });

  const isFetching = loadingSummary || loadingPool || loadingMyBook;

  // Group rows into renderable blocks. Rows arrive pre-ordered by the RPC
  // (branch name / member name, then bucket_rank) — preserve that order.
  const groups = useMemo<AgingGroup[]>(() => {
    if (view === 'my_book') {
      if (myBookRows.length === 0) return [];
      return [sumGroup('my_book', null, myBookRows)];
    }

    if (view === 'pool') {
      const byMember = new Map<string, PoolRow[]>();
      for (const r of poolRows) {
        const k = r.collector_user_id == null ? '__park__' : String(r.collector_user_id);
        const list = byMember.get(k) ?? [];
        list.push(r);
        byMember.set(k, list);
      }
      const out: AgingGroup[] = [];
      for (const [k, rows] of byMember) {
        if (k === '__park__') continue;
        out.push(sumGroup(k, rows[0].display_name ?? `#${k}`, rows));
      }
      // Park last but always rendered: work nobody holds is the easiest work
      // to lose sight of, so it gets its own labelled block rather than
      // being folded into a member or dropped when empty.
      const park = byMember.get('__park__');
      if (park) out.push(sumGroup('__park__', t('overdueAging.unassignedPile'), park, true));
      return out;
    }

    const byBranch = new Map<number, SummaryRow[]>();
    for (const r of summaryRows) {
      const list = byBranch.get(r.branch_id) ?? [];
      list.push(r);
      byBranch.set(r.branch_id, list);
    }
    const out: AgingGroup[] = [];
    for (const [id, rows] of byBranch) {
      const g = sumGroup(String(id), rows[0].branch_name, rows);
      // A branch with nothing overdue is noise on a "where is the work" screen.
      if (g.totalContracts > 0) out.push(g);
    }
    return out;
  }, [view, summaryRows, poolRows, myBookRows, t]);

  const totals = useMemo(() => groups.reduce(
    (acc, g) => {
      acc.contracts += g.totalContracts;
      acc.amount += g.totalAmount;
      acc.slips += g.totalSlips;
      return acc;
    },
    { contracts: 0, amount: 0, slips: 0 },
  ), [groups]);

  const unassigned = useMemo(() => {
    if (view === 'branch') return summaryRows.reduce((s, r) => s + r.unassigned_count, 0);
    if (view === 'pool') {
      return poolRows.reduce((s, r) => s + (r.collector_user_id == null ? r.contract_count : 0), 0);
    }
    return null;
  }, [view, summaryRows, poolRows]);

  const hasData = totals.contracts > 0;

  const companyOptions = companies.map((c) => ({ value: String(c.id), label: c.name }));
  const branchOptions = branches.map((b) => ({ value: String(b.id), label: b.name }));
  const poolOptions = pools.map((p) => ({ value: String(p.pool_id), label: p.pool_name }));

  const companyPicker = isHoldingScope && view === 'branch' && (
    <Select
      options={companyOptions}
      value={companyId || null}
      onChange={(v) => { setCompanyId((v as string) ?? ''); setBranchId(''); }}
      placeholder={t('overdueAging.allCompanies')}
      size="sm"
      clearable
      showChevron
    />
  );

  const branchPicker = canPickScope && view === 'branch' && (
    <Select
      options={branchOptions}
      value={branchId || null}
      onChange={(v) => setBranchId((v as string) ?? '')}
      placeholder={t('overdueAging.allBranches')}
      size="sm"
      clearable
      showChevron
    />
  );

  const poolPicker = canPickScope && view === 'pool' && (
    <Select
      options={poolOptions}
      value={poolId || null}
      onChange={(v) => setPoolId((v as string) ?? '')}
      placeholder={t('overdueAging.myPool')}
      size="sm"
      clearable
      showChevron
    />
  );

  const tabs = (
    <CollectionViewTabs
      views={availableViews}
      value={view}
      onChange={setView}
      poolName={context?.member_pool_name ?? null}
    />
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
          {t('overdueAging.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      {/* Desktop header — title + view tabs + scope pickers */}
      <div className="flex-none px-4 py-2.5 border-b border-line flex flex-col gap-2 max-md:hidden">
        <h1 className="heading-2 whitespace-nowrap">{t('overdueAging.title')}</h1>
        <div className="flex items-center gap-3">
          <div className="shrink-0">{tabs}</div>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {companyPicker && <div style={{ width: '12rem' }}>{companyPicker}</div>}
            {branchPicker && <div style={{ width: '12rem' }}>{branchPicker}</div>}
            {poolPicker && <div style={{ width: '14rem' }}>{poolPicker}</div>}
          </div>
        </div>
      </div>

      {/* Mobile header controls */}
      <div className="flex-none p-2 border-b border-line flex flex-col gap-2 md:hidden">
        <div className="overflow-x-auto hidden-scroll">{tabs}</div>
        <div className="flex items-center gap-2">
          {companyPicker && <div className="flex-1 min-w-0">{companyPicker}</div>}
          {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
          {poolPicker && <div className="flex-1 min-w-0">{poolPicker}</div>}
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex-none flex items-stretch divide-x divide-line border-b border-line">
        <SummaryCell label={t('overdueAging.sumContracts')} value={String(totals.contracts)} />
        <SummaryCell label={t('overdueAging.sumAmount')} value={`฿${fmtCurrency(totals.amount)}`} />
        <SummaryCell
          label={t('overdueAging.sumSlips')}
          value={String(totals.slips)}
          hint={t('overdueAging.slipHint')}
        />
        {unassigned != null && (
          <SummaryCell label={t('overdueAging.sumUnassigned')} value={String(unassigned)} />
        )}
      </div>

      {/* Bars */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll p-4 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-subtler">
            <Hourglass size={32} strokeWidth={1.5} />
            <span className="text-sm">{t('overdueAging.noData')}</span>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto flex flex-col gap-6">
            <p className="text-xs text-subtle flex items-start gap-1.5">
              <Info size={13} className="shrink-0 mt-0.5" />
              <span>{t('overdueAging.freshnessNote')}</span>
            </p>
            {groups.map((g) => (
              <AgingGroupBlock key={g.key} group={g} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgingGroupBlock({ group }: { group: AgingGroup }) {
  const { t } = useTranslation();

  const rows: HBarRow[] = group.buckets.map((b) => ({
    key: b.bucket_code,
    label: t(`overdueAging.bucket.${b.bucket_code}`),
    value: b.contract_count,
    segments: [{
      value: b.contract_count,
      color: b.bucket_code === SEVERE_BUCKET ? COLOR_BAR_SEVERE : COLOR_BAR,
    }],
    endLabel: (
      <span>
        {t('overdueAging.contractsN', { count: b.contract_count })}
        {' · '}฿{fmtCurrency(b.overdue_amount)}
        {b.slip_pending_count > 0 && (
          <span className="text-subtler"> · {t('overdueAging.slipsN', { count: b.slip_pending_count })}</span>
        )}
      </span>
    ),
  }));

  return (
    <div className="flex flex-col gap-2">
      {group.title && (
        <div className="flex items-baseline justify-between gap-3 border-b border-line pb-1">
          <span className={`text-sm font-medium ${group.isPark ? 'text-warning-fg' : ''}`}>
            {group.title}
          </span>
          <span className="text-xs text-subtle tabular-nums whitespace-nowrap">
            {t('overdueAging.contractsN', { count: group.totalContracts })}
            {' · '}฿{fmtCurrency(group.totalAmount)}
          </span>
        </div>
      )}
      {group.totalContracts === 0 ? (
        <p className="text-xs text-subtler italic">{t('overdueAging.groupEmpty')}</p>
      ) : (
        <HBarReport rows={rows} />
      )}
    </div>
  );
}

function SummaryCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex-1 px-4 py-2.5 min-w-0">
      <div className="text-xs text-subtle truncate">{label}</div>
      <div className="text-lg font-semibold tabular-nums truncate">{value}</div>
      {hint && <div className="text-[10px] text-subtler truncate">{hint}</div>}
    </div>
  );
}
