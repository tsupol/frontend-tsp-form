import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  MobileHeader, DataTable, Select, Badge, Input, InputDateRangePicker,
} from 'tsp-form';
import {
  ArrowRightFromLine, Keyboard, ExternalLink, Search, Truck, Building2,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { FilterBar, type FilterBarItem } from '../../components/FilterBar';
import {
  fmtCurrency, toLocalDateStr, parseLocalDate, makeDateRangePickerFormat,
} from '../../lib/format';
import type { Branch, ReconcileItemResult, ReconcileItemRow } from './accountingTypes';

type OwnerType = 'HOLDING' | 'COMPANY';
const TYPE_VALUES = ['INVOICE', 'CREDIT_NOTE'] as const;
const TYPE_COLOR: Record<string, 'primary' | 'danger' | 'warning'> = {
  INVOICE: 'primary',
  CREDIT_NOTE: 'danger',
  JOURNAL: 'warning',
};

function defaultRange() {
  const today = new Date();
  const to = toLocalDateStr(today);
  const fromD = new Date(today);
  fromD.setDate(fromD.getDate() - 6);
  return { from: toLocalDateStr(fromD), to };
}

/* รายการชำระ — the flat, filterable line list (restores the retired Remittance
   page's capability: scan every remittable line over a date range, filter by
   owner / bill-type / charge-type, search bill/customer/contract). Sourced from
   fn_reconcile_by_item (VOIDED-excluded, remit_amount shaped) — NOT raw revenue
   views. The RPC returns the full scoped set in one call (bounded by branch +
   date range), so owner/type/charge/search filtering + paging happen client-side,
   same single-call model as the ยอดนำส่ง page. */
export function PaymentListPage() {
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
  const ownerFilter = (searchParams.get('owner') as OwnerType | null) ?? '';
  const typeFilter = searchParams.get('type') ?? '';
  const chargeParam = searchParams.get('charge') ?? '';
  const chargeFilter = useMemo(
    () => (chargeParam ? chargeParam.split(',').filter(Boolean) : []),
    [chargeParam],
  );
  const search = searchParams.get('q') ?? '';

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [isTypingRange, setIsTypingRange] = useState(false);

  const pendingPatchRef = useRef<Record<string, string> | null>(null);
  const updateFilters = useCallback((patch: Partial<{ branch_id: string; from: string; to: string; owner: string; type: string; charge: string; q: string }>) => {
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
    setPageIndex(0);
  }, [setSearchParams]);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  // Charge types from the ref view — labels stay localized, new codes appear
  // without a deploy.
  const { data: chargeTypes = [] } = useQuery({
    queryKey: ['ref-charge-types'],
    queryFn: () =>
      apiClient.get<{ code: string; name_th: string; name_en: string }[]>(
        '/v_ref_charge_types?select=code,name_th,name_en&order=name_th',
      ),
    staleTime: 60 * 60 * 1000,
  });

  // RPC is per-company: company comes from the chosen branch. branch_id=null →
  // company-all mode (only meaningful once a branch/company is picked).
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

  // Apply owner / type / charge / search client-side over the scoped rows.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows ?? []).filter(r => {
      if (ownerFilter && r.owner_type !== ownerFilter) return false;
      if (typeFilter && r.bill_type !== typeFilter) return false;
      if (chargeFilter.length && !chargeFilter.includes(r.charge_type)) return false;
      if (q) {
        const hay = `${r.bill_code} ${r.customer_name} ${r.contract_code ?? ''} ${r.charge_name_th} ${r.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data?.rows, ownerFilter, typeFilter, chargeFilter, search]);

  // Totals of the filtered subset (live).
  const totals = useMemo(() => {
    let holding = 0, company = 0;
    for (const r of filtered) {
      if (r.owner_type === 'HOLDING') holding += Number(r.remit_amount) || 0;
      else company += Number(r.remit_amount) || 0;
    }
    return { holding, company, total: holding + company, count: filtered.length };
  }, [filtered]);

  // Client-side page slice.
  const pageRows = useMemo(
    () => filtered.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize),
    [filtered, pageIndex, pageSize],
  );

  const activeFilterCount =
    (ownerFilter ? 1 : 0) + (typeFilter ? 1 : 0) + (chargeFilter.length ? 1 : 0) +
    (search.trim() ? 1 : 0) + (!isBranchUser && branchId && !allBranches ? 1 : 0);

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
  const searchNode: ReactNode = (
    <Input
      value={search}
      onChange={(e) => updateFilters({ q: e.target.value })}
      placeholder={t('accounting.paymentList.searchPlaceholder')}
      startIcon={<Search size={14} />}
      size="sm"
      className="w-full"
    />
  );
  const ownerNode: ReactNode = (
    <Select
      value={ownerFilter || null}
      onChange={(v) => updateFilters({ owner: (v as string) ?? '' })}
      options={(['HOLDING', 'COMPANY'] as OwnerType[]).map(o => ({ value: o, label: t(`accounting.reconcile.owner_${o}`) }))}
      size="sm"
      showChevron
      placeholder={t('accounting.paymentList.allOwners')}
      clearable
    />
  );
  const typeNode: ReactNode = (
    <Select
      value={typeFilter || null}
      onChange={(v) => updateFilters({ type: (v as string) ?? '' })}
      options={TYPE_VALUES.map(v => ({ value: v, label: t(`accounting.bills.typeLabel.${v}`) }))}
      size="sm"
      showChevron
      placeholder={t('accounting.paymentList.allTypes')}
      clearable
    />
  );
  const chargeNode: ReactNode = (
    <Select
      multiple
      value={chargeFilter}
      onChange={(v) => updateFilters({ charge: (v as string[]).join(',') })}
      options={chargeTypes.map(c => ({
        value: c.code,
        label: i18n.language === 'th' ? c.name_th : c.name_en,
      }))}
      size="sm"
      showChevron
      placeholder={t('accounting.paymentList.allCharges')}
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
    { key: 'search', width: 208, node: searchNode, priority: 70 },
    { key: 'charge', width: 208, node: chargeNode, priority: 60 },
    { key: 'type', width: 168, node: typeNode, priority: 50 },
    { key: 'owner', width: 160, node: ownerNode, priority: 40 },
    { key: 'branch', width: 176, node: branchNode, priority: 10 },
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
          {t('accounting.paymentList.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="flex flex-col h-dvh">
        <div className="flex-none px-4 py-2.5 border-b border-line items-center gap-4 max-md:hidden flex">
          <h1 className="heading-2 shrink-0">{t('accounting.paymentList.title')}</h1>
        </div>

        <FilterBar
          className="flex-none p-2 border-b border-line"
          leading={dateFilter}
          leadingMinWidth={224}
          leadingMaxWidth={240}
          items={filterItems}
          activeCount={activeFilterCount}
        />

        {/* Summary — filtered subset totals (holding / company / total) */}
        <div className="flex-none px-4 py-3 border-b border-line">
          <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
            <Stat
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Truck size={13} className="text-primary-fg" />
                  {t('accounting.reconcile.owner_HOLDING')}
                </span>
              }
              value={fmtCurrency(totals.holding)}
            />
            <Stat
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Building2 size={13} className="text-secondary-fg" />
                  {t('accounting.reconcile.owner_COMPANY')}
                </span>
              }
              value={fmtCurrency(totals.company)}
            />
            <Stat
              label={<span className="font-medium">{t('accounting.paymentList.total', { count: totals.count })}</span>}
              value={fmtCurrency(totals.total)}
              emphasis
            />
          </dl>
        </div>

        {/* Line items — flat, client-paginated */}
        <DataTable<ReconcileItemRow>
          data={pageRows}
          renderRow={(row) => {
            const r = row.original;
            return (
              <div key={r.line_id} className="w-full px-4 py-3 flex flex-col gap-1">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/accounting/bills/${r.bill_id}`)}
                    className="font-mono text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer truncate"
                  >
                    {r.bill_code}
                    <ExternalLink size={11} />
                  </button>
                  <Badge color={TYPE_COLOR[r.bill_type] ?? 'default'} size="sm">
                    {t(`accounting.bills.typeLabel.${r.bill_type}`, { defaultValue: r.bill_type })}
                  </Badge>
                  <Badge color="secondary" size="sm">{r.charge_name_th || r.charge_type}</Badge>
                  {!r.is_remittable && (
                    <Badge color="warning" size="xs">{t('accounting.reconcile.notCounted')}</Badge>
                  )}
                  <span className={`ml-auto text-sm font-medium tabular-nums shrink-0 ${r.remit_amount < 0 ? 'text-danger' : ''}`}>
                    {fmtCurrency(r.remit_amount)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-subtle min-w-0">
                  <span className="truncate inline-flex items-center gap-1.5 min-w-0">
                    {[
                      r.customer_name?.trim() ? <span key="cust" className="truncate">{r.customer_name}</span> : null,
                      r.contract_code ? (
                        <button
                          key="contract"
                          type="button"
                          onClick={() => r.contract_id && navigate(`/admin/contracts/search/${r.contract_id}`)}
                          className="font-mono text-primary-fg hover:underline inline-flex items-center gap-0.5 bg-transparent border-none p-0 cursor-pointer"
                        >
                          {r.contract_code}
                          <ExternalLink size={10} />
                        </button>
                      ) : null,
                      r.description ? <span key="desc" className="truncate">{r.description}</span> : null,
                      !isBranchUser && r.branch_name ? <span key="branch">{r.branch_name}</span> : null,
                    ]
                      .filter(Boolean)
                      .map((node, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 min-w-0">
                          {i > 0 && <span className="text-subtler">·</span>}
                          {node}
                        </span>
                      ))}
                  </span>
                  <span className="ml-auto text-subtler shrink-0">
                    <DateTime value={r.bill_date} showTime={false} />
                  </span>
                </div>
              </div>
            );
          }}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[25, 50, 100]}
          rowCount={totals.count}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
          className={`flex-1 min-h-0 padded-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-subtler">
              {!branchId ? t('accounting.reconcile.pickBranch') : t('accounting.empty')}
            </div>
          }
        />
      </div>
    </>
  );
}

function Stat({ label, value, emphasis }: { label: ReactNode; value: ReactNode; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={`tabular-nums font-semibold ${emphasis ? 'text-base text-primary-fg' : 'text-sm'}`}>{value}</dd>
    </div>
  );
}
