import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  MobileHeader, Select, Badge, InputDateRangePicker, Button,
} from 'tsp-form';
import {
  ArrowRightFromLine, Keyboard, ChevronRight, ChevronDown, ExternalLink, Truck, Building2, FileSpreadsheet, Loader2,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { FilterBar, type FilterBarItem } from '../../components/FilterBar';
import { DateTime } from '../../components/DateTime';
import {
  fmtCurrency, toLocalDateStr, parseLocalDate, makeDateRangePickerFormat,
} from '../../lib/format';
import type { Branch, ReconcileItemResult, ReconcileItemGroup, ReconcileItemRow } from './accountingTypes';
import { exportReconcileItems } from './dayCloseExport';
import { MiniPager } from './MiniPager';

type OwnerType = 'HOLDING' | 'COMPANY';

const ROWS_PER_PAGE = 10;

// Identity of a rendered group. HOLDING_INSTALLMENT is split into two (front/back)
// by from_slip, so the key folds from_slip in; every other bucket has from_slip=null
// and keys on subgroup alone.
const groupKey = (subgroup: string, fromSlip: boolean | null): string =>
  fromSlip === null ? subgroup : `${subgroup}:${fromSlip ? 'slip' : 'front'}`;

function defaultRange() {
  // Time-aware: a fresh day has no data yet, so default to the last 7 days
  // rather than today-only (which renders empty at the start of the day).
  const today = new Date();
  const to = toLocalDateStr(today);
  const fromD = new Date(today);
  fromD.setDate(fromD.getDate() - 6);
  return { from: toLocalDateStr(fromD), to };
}

export function ReconcileItemPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const userBranchId = isBranchUser && user?.branch_id ? String(user.branch_id) : '';

  const initial = defaultRange();
  const [searchParams, setSearchParams] = useSearchParams();
  const branchId = searchParams.get('branch_id') ?? userBranchId;
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const fromDate = fromParam === null ? initial.from : fromParam;
  const toDate = toParam === null ? initial.to : toParam;

  const [isTypingRange, setIsTypingRange] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const pendingPatchRef = useRef<Record<string, string> | null>(null);
  const updateFilters = useCallback((patch: Partial<{ branch_id: string; from: string; to: string }>) => {
    if (pendingPatchRef.current) {
      Object.assign(pendingPatchRef.current, patch);
      return;
    }
    pendingPatchRef.current = { ...patch } as Record<string, string>;
    queueMicrotask(() => {
      const merged = pendingPatchRef.current ?? {};
      pendingPatchRef.current = null;
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(merged)) {
          if (v) next.set(k, v);
          else if (k === 'from' || k === 'to') next.set(k, '');
          else next.delete(k);
        }
        return next;
      }, { replace: true });
    });
  }, [setSearchParams]);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const selectedBranch = branches.find(b => String(b.id) === branchId);
  const companyId = selectedBranch?.company_id ?? null;
  const allBranches = branchId === '__ALL__';

  const { data, isFetching } = useQuery({
    queryKey: ['accounting', 'reconcile-item', branchId, companyId, fromDate, toDate],
    queryFn: () => apiClient.rpc<ReconcileItemResult>('fn_reconcile_by_item', {
      p_company_id: companyId,
      p_branch_id: allBranches ? null : (branchId ? Number(branchId) : null),
      p_date_from: fromDate,
      p_date_to: toDate,
    }),
    enabled: !!branchId && (allBranches ? !!companyId : !!selectedBranch),
    placeholderData: keepPreviousData,
  });

  const groups = data?.groups ?? [];
  // rows already ordered (owner → subgroup → time) by the RPC; bucket by
  // subgroup + from_slip. HOLDING_INSTALLMENT arrives as two groups (front/back)
  // that share a subgroup but differ on from_slip — keying on subgroup alone would
  // merge them, so the composite key keeps each side's rows under its own header.
  const rowsBySubgroup = useMemo(() => {
    const m = new Map<string, ReconcileItemRow[]>();
    for (const r of data?.rows ?? []) {
      const key = groupKey(r.subgroup, r.from_slip);
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    return m;
  }, [data?.rows]);

  const owners: OwnerType[] = ['HOLDING', 'COMPANY'];

  const handleExport = async () => {
    if (!data || groups.length === 0) return;
    setExporting(true);
    try {
      const branchLabel = selectedBranch?.name ?? (allBranches ? 'all' : branchId);
      await exportReconcileItems(
        data.groups,
        data.rows,
        t,
        `remit_${branchLabel}_${fromDate}_${toDate}`,
      );
    } finally {
      setExporting(false);
    }
  };
  const canExport = !!data && groups.length > 0 && !exporting;

  const dateFilter: ReactNode = (
    <InputDateRangePicker
      fromDate={parseLocalDate(fromDate)}
      toDate={parseLocalDate(toDate)}
      onFromDateChange={(d) => updateFilters({ from: toLocalDateStr(d) })}
      onToDateChange={(d) => updateFilters({ to: toLocalDateStr(d) })}
      dateFormat={makeDateRangePickerFormat(i18n.language)}
      size="sm"
      locale={i18n.language}
      calendar="gregorian"
      endIcon={<Keyboard size={14} />}
      onEndIconClick={() => setIsTypingRange(v => !v)}
      typingMode={isTypingRange}
      onTypingModeChange={setIsTypingRange}
      typingMask="##/##/#### - ##/##/####"
      typingPlaceholder="DD/MM/YYYY - DD/MM/YYYY"
      parseTypedDates={(raw) => {
        const parse = (digits: string) => {
          if (digits.length !== 8) return null;
          const day = parseInt(digits.slice(0, 2), 10);
          const month = parseInt(digits.slice(2, 4), 10);
          let year = parseInt(digits.slice(4, 8), 10);
          if (year > 2400) year -= 543;
          if (month < 1 || month > 12 || day < 1 || day > 31) return null;
          const d = new Date(year, month - 1, day);
          if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
          return d;
        };
        return {
          from: parse(raw.slice(0, 8)),
          to: raw.length >= 16 ? parse(raw.slice(8, 16)) : null,
        };
      }}
    />
  );
  const branchNode: ReactNode = (
    <Select
      value={branchId || null}
      onChange={(v) => updateFilters({ branch_id: (v as string) ?? '' })}
      placeholder={t('accounting.reconcile.pickBranch')}
      options={[
        ...(isBranchUser ? [] : [{ label: t('accounting.reconcile.allBranches'), value: '__ALL__' }]),
        ...branches.map(b => ({ label: b.name, value: String(b.id) })),
      ]}
      size="sm"
      showChevron
      clearable={false}
      disabled={isBranchUser}
    />
  );
  const filterItems: FilterBarItem[] = [
    { key: 'branch', width: 200, node: branchNode, priority: 10 },
  ];

  return (
    <>
      <MobileHeader className="mobile-header-scrolled-shadow md:hidden">
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
          {t('accounting.reconcile.itemTitle')}
        </div>
        <div className="mobile-header-end w-nav flex items-center justify-center">
          <Button
            size="sm"
            variant="ghost"
            className="btn-icon-sm"
            startIcon={exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            onClick={handleExport}
            disabled={!canExport}
            aria-label={t('accounting.reconcile.export')}
          />
        </div>
      </MobileHeader>

      <div className="flex flex-col h-dvh">
        <div className="flex-none px-4 py-2.5 border-b border-line items-center gap-4 max-md:hidden flex">
          <h1 className="heading-2 shrink-0">{t('accounting.reconcile.itemTitle')}</h1>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            startIcon={exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            onClick={handleExport}
            disabled={!canExport}
          >
            {exporting ? t('accounting.reconcile.exporting') : t('accounting.reconcile.export')}
          </Button>
        </div>

        <FilterBar
          className="flex-none p-2 border-b border-line"
          leading={dateFilter}
          leadingMinWidth={224}
          items={filterItems}
          activeCount={0}
        />

        {/* Scope totals — remit total + holding/company split */}
        {branchId && (groups.length > 0) && (
          <div className="flex-none px-4 py-3 border-b border-line flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <span className="text-sm">
              <span className="text-subtle">{t('accounting.reconcile.totalRemit')}: </span>
              <span className="text-lg font-bold tabular-nums text-primary-fg">{fmtCurrency(data?.total_amount ?? 0)}</span>
            </span>
            <span className="text-sm text-subtle inline-flex items-center gap-1.5">
              <Truck size={14} className="text-primary-fg" />{t('accounting.reconcile.owner_HOLDING')}
              <span className="tabular-nums font-medium text-fg">{fmtCurrency(data?.holding_total ?? 0)}</span>
            </span>
            <span className="text-sm text-subtle inline-flex items-center gap-1.5">
              <Building2 size={14} className="text-secondary-fg" />{t('accounting.reconcile.owner_COMPANY')}
              <span className="tabular-nums font-medium text-fg">{fmtCurrency(data?.company_total ?? 0)}</span>
            </span>
          </div>
        )}

        <div className={`flex-1 min-h-0 overflow-auto better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          {!branchId && (
            <div className="p-8 text-center text-subtler">{t('accounting.reconcile.pickBranch')}</div>
          )}
          {branchId && groups.length === 0 && (
            <div className="p-8 text-center text-subtler">{t('accounting.reconcile.noData')}</div>
          )}
          {branchId && groups.length > 0 && (
            <div className="max-w-3xl mx-auto">
              {/* Sub-group header row (columns) — mirrors GroupRow exactly */}
              <div className="flex items-center pr-4 py-2 text-[11px] font-semibold text-subtle uppercase tracking-wider border-b border-line">
                <span className="w-8 shrink-0" />
                <span className="flex-1 min-w-0">{t('accounting.reconcile.group')}</span>
                <span className="w-24 text-right">{t('accounting.reconcile.sales')}</span>
                <span className="w-24 text-right">{t('accounting.reconcile.refund')}</span>
                <span className="w-24 text-right">{t('accounting.reconcile.net')}</span>
              </div>

              {owners.map(owner => {
                const ownerGroups = groups.filter(g => g.owner_type === owner);
                if (ownerGroups.length === 0) return null;
                return (
                  <div key={owner}>
                    {/* Owner section header — icon sits in the chevron column, label aligns with group labels */}
                    <div className="flex items-center pr-4 py-2 bg-surface-soft border-b border-line">
                      <span className="w-8 shrink-0 flex items-center justify-center">
                        {owner === 'HOLDING'
                          ? <Truck size={15} className="text-primary-fg" />
                          : <Building2 size={15} className="text-secondary-fg" />}
                      </span>
                      <span className="font-semibold text-sm">{t(`accounting.reconcile.owner_${owner}`)}</span>
                    </div>
                    {ownerGroups.map(g => {
                      const key = groupKey(g.subgroup, g.from_slip);
                      return (
                        <GroupRow
                          key={key}
                          group={g}
                          rows={rowsBySubgroup.get(key) ?? []}
                          open={openGroup === key}
                          onToggle={() => setOpenGroup(o => o === key ? null : key)}
                          navigate={navigate}
                          t={t}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* One subgroup: folded header (name · count · ขาย/คืน/สุทธิ), expand → its rows. */
function GroupRow({
  group, rows, open, onToggle, navigate, t,
}: {
  group: ReconcileItemGroup;
  rows: ReconcileItemRow[];
  open: boolean;
  onToggle: () => void;
  navigate: ReturnType<typeof useNavigate>;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const baseLabel = t(`accounting.reconcile.subgroup.${group.subgroup}`, { defaultValue: group.name_th });
  // HOLDING_INSTALLMENT arrives as two groups; suffix the channel so the closer sees
  // "ค่างวด (หน้าร้าน)" vs "ค่างวด (หลังร้าน)". Other buckets (from_slip null) keep the plain name.
  const label = group.from_slip === null
    ? baseLabel
    : `${baseLabel} ${t(group.from_slip ? 'accounting.reconcile.channelBackSuffix' : 'accounting.reconcile.channelFrontSuffix')}`;
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(rows.length / ROWS_PER_PAGE);
  useEffect(() => { if (!open) setPage(1); }, [open]);
  const pageRows = rows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);
  return (
    <div>
      {/* Only the leading chevron is interactive; the row body is not hoverable. */}
      <div className="flex items-center pr-4 min-h-11 border-b border-line text-sm">
        <button
          type="button"
          onClick={onToggle}
          className="w-8 shrink-0 self-stretch flex items-center justify-center text-subtle hover:text-fg cursor-pointer bg-transparent border-none transition-colors"
          aria-label={t('accounting.reconcile.expand', { defaultValue: 'Expand' })}
        >
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <span className="flex-1 inline-flex items-baseline gap-2 min-w-0">
          <span className="font-medium truncate">{label}</span>
          <span className="text-xs text-subtler shrink-0">{group.count} {t('accounting.reconcile.items')}</span>
        </span>
        <span className="w-24 text-right tabular-nums">{fmtCurrency(group.sales)}</span>
        <span className={`w-24 text-right tabular-nums ${group.refund !== 0 ? 'text-warning-fg' : 'text-subtle'}`}>
          {group.refund === 0 ? '—' : fmtCurrency(group.refund)}
        </span>
        <span className="w-24 text-right tabular-nums font-semibold">{fmtCurrency(group.total)}</span>
      </div>

      {open && (
        <div className="bg-surface-soft border-b border-line">
          {pageRows.map(r => (
            <div key={r.line_id} className="flex items-center gap-2 pl-8 pr-4 py-2 border-t border-line/60 text-xs">
              <span className="text-subtler shrink-0 tabular-nums w-28">
                <DateTime value={r.bill_created_at} />
              </span>
              <button
                type="button"
                onClick={() => navigate(`/admin/accounting/bills/${r.bill_id}`)}
                className="font-mono text-primary-fg hover:underline inline-flex items-center gap-0.5 bg-transparent border-none p-0 cursor-pointer shrink-0"
              >
                {r.bill_code}
                <ExternalLink size={10} />
              </button>
              <span className="flex-1 min-w-0 truncate text-subtle">
                {r.customer_name?.trim() && <>{r.customer_name} · </>}
                {r.charge_name_th || r.charge_type}
                {!r.is_remittable && (
                  <Badge color="warning" size="xs">{t('accounting.reconcile.notCounted')}</Badge>
                )}
              </span>
              <span className={`shrink-0 tabular-nums ${r.remit_amount < 0 ? 'text-danger' : ''}`}>
                {fmtCurrency(r.remit_amount)}
              </span>
            </div>
          ))}
          <MiniPager page={page} totalPages={totalPages} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
