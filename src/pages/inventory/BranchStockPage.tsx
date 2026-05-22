import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Badge, Select, Input } from 'tsp-form';
import { Boxes, Search, ArrowRightFromLine, ShoppingCart, Smartphone } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { fmtNum } from './inventoryUtils';
import { useMediaQuery } from '../../hooks/useMediaQuery';

// ============================================================================
// Branch Stock — two views of "what's on the shelf at branch X":
//   Retail (v_branch_sellable_stock)   — lot-based, is_contractable=false
//   Lease  (v_branch_contractable_stock) — asset-based, is_contractable=true
// Tabs at the top swap the data source; everything else (branch filter,
// search) is shared.
// ============================================================================

interface SellableRow {
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  variant_id: number;
  model_id: number;
  brand_name: string | null;
  model_name: string;
  variant_name: string;
  full_name: string;
  bucket: string;
  qty: number;
  avg_cost: number | null;
  total_value: number | null;
  updated_at: string;
}

interface ContractableRow {
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  variant_id: number;
  model_id: number;
  brand_name: string | null;
  family_name: string | null;
  model_name: string;
  variant_name: string;
  full_name: string;
  condition: 'NEW' | 'USED';
  asset_count: number;
  total_cost: number | null;
  avg_cost: number | null;
  updated_at: string;
}

interface Branch {
  id: number;
  name: string;
}

type Tab = 'retail' | 'lease';

export function BranchStockPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  const tabParam = searchParams.get('tab');
  const initialTab: Tab = tabParam === 'lease' ? 'lease' : 'retail';
  const initialBranchId = searchParams.get('branch_id')
    ? Number(searchParams.get('branch_id'))
    : defaultBranchId;

  const [tab, setTab] = useState<Tab>(initialTab);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(initialBranchId);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const tm = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(tm);
  }, [search]);

  // Sync from URL on every searchParams change (side-nav shortcut click,
  // browser back, etc.)
  useEffect(() => {
    const tp = searchParams.get('tab');
    if (tp === 'lease' || tp === 'retail') setTab(tp);
    const b = searchParams.get('branch_id');
    if (b) setFilterBranchId(Number(b));
  }, [searchParams]);

  const writeTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
  });

  const branchOptions = useMemo(
    () => (branches ?? []).map(b => ({ value: String(b.id), label: b.name })),
    [branches],
  );

  // Both queries always run so the count badges in both tabs are accurate
  // regardless of which tab is active.
  const { data: retailRows, isFetching: retailFetching } = useQuery({
    queryKey: ['branch-stock', 'retail', filterBranchId, debouncedSearch],
    queryFn: () => {
      let url = '/v_branch_sellable_stock?order=full_name';
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (debouncedSearch) {
        url += `&or=(full_name.ilike.*${encodeURIComponent(debouncedSearch)}*,model_name.ilike.*${encodeURIComponent(debouncedSearch)}*,variant_name.ilike.*${encodeURIComponent(debouncedSearch)}*)`;
      }
      return apiClient.get<SellableRow[]>(url);
    },
    staleTime: 30 * 1000,
  });

  const { data: leaseRows, isFetching: leaseFetching } = useQuery({
    queryKey: ['branch-stock', 'lease', filterBranchId, debouncedSearch],
    queryFn: () => {
      let url = '/v_branch_contractable_stock?order=full_name,condition';
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (debouncedSearch) {
        url += `&or=(full_name.ilike.*${encodeURIComponent(debouncedSearch)}*,model_name.ilike.*${encodeURIComponent(debouncedSearch)}*,variant_name.ilike.*${encodeURIComponent(debouncedSearch)}*)`;
      }
      return apiClient.get<ContractableRow[]>(url);
    },
    staleTime: 30 * 1000,
  });

  // Pill counts — total qty / asset_count across the visible scope.
  const retailTotal = useMemo(
    () => (retailRows ?? []).reduce((sum, r) => sum + (r.qty ?? 0), 0),
    [retailRows],
  );
  const leaseTotal = useMemo(
    () => (leaseRows ?? []).reduce((sum, r) => sum + (r.asset_count ?? 0), 0),
    [leaseRows],
  );

  const isMobile = useMediaQuery('(max-width: 767px)');
  const isFetching = tab === 'retail' ? retailFetching : leaseFetching;

  const branchName = (id: number) => branches?.find(b => b.id === id)?.name ?? '';

  return (
    <div className="flex flex-col h-dvh">
      {isMobile ? (
        <MobileHeader className="mobile-header-bordered">
          <div className="mobile-header-start">
            <button
              className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
              onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
            >
              <ArrowRightFromLine size={18} />
            </button>
          </div>
          <div className="mobile-header-title mobile-header-title-truncate">
            {t('nav.branchStock', { defaultValue: 'Branch Stock' })}
          </div>
          <div className="mobile-header-end w-nav" />
        </MobileHeader>
      ) : (
        <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
          <h1 className="heading-2 shrink-0 flex items-center gap-2">
            <Boxes size={18} />
            {t('nav.branchStock', { defaultValue: 'Branch Stock' })}
          </h1>
        </div>
      )}

      {/* Tabs */}
      <div className="flex-none px-2 pt-2 border-b border-line flex items-center gap-1">
        <button
          type="button"
          onClick={() => { setTab('retail'); writeTab('retail'); }}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-md border-b-2 transition-colors cursor-pointer bg-transparent ${
            tab === 'retail'
              ? 'border-primary-fg text-primary-fg font-medium'
              : 'border-transparent text-subtle hover:bg-surface-hover'
          }`}
        >
          <ShoppingCart size={14} />
          <span>{t('branchStock.retailTab', { defaultValue: 'Retail' })}</span>
          <Badge size="xs" color={tab === 'retail' ? 'primary' : 'default'}>
            {fmtNum(retailTotal)}
          </Badge>
        </button>
        <button
          type="button"
          onClick={() => { setTab('lease'); writeTab('lease'); }}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-md border-b-2 transition-colors cursor-pointer bg-transparent ${
            tab === 'lease'
              ? 'border-primary-fg text-primary-fg font-medium'
              : 'border-transparent text-subtle hover:bg-surface-hover'
          }`}
        >
          <Smartphone size={14} />
          <span>{t('branchStock.leaseTab', { defaultValue: 'Lease' })}</span>
          <Badge size="xs" color={tab === 'lease' ? 'primary' : 'default'}>
            {fmtNum(leaseTotal)}
          </Badge>
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex-none p-2 border-b border-line flex items-center gap-2">
        <div className="flex-1 min-w-0 max-w-64">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('branchStock.search', { defaultValue: 'Search by name, model, variant' })}
            size="sm"
            startIcon={<Search size={16} />}
          />
        </div>
        <div className="flex-1 min-w-0 max-w-64">
          <Select
            options={branchOptions}
            value={filterBranchId !== null ? String(filterBranchId) : null}
            onChange={(val) => setFilterBranchId(val ? Number(val) : null)}
            placeholder={t('inventory.allBranches')}
            size="sm"
            showChevron
            clearable
          />
        </div>
      </div>

      {/* List */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {tab === 'retail' && (
          <RetailList
            rows={retailRows ?? []}
            branchName={branchName}
            isFetching={retailFetching}
            t={t}
          />
        )}
        {tab === 'lease' && (
          <LeaseList
            rows={leaseRows ?? []}
            branchName={branchName}
            isFetching={leaseFetching}
            t={t}
          />
        )}
      </div>
    </div>
  );
}

function RetailList({
  rows,
  branchName,
  isFetching,
  t,
}: {
  rows: SellableRow[];
  branchName: (id: number) => string;
  isFetching: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (!isFetching && rows.length === 0) {
    return (
      <div className="p-8 text-center text-subtler">
        {t('common.noData')}
      </div>
    );
  }
  return (
    <div className="flex flex-col pb-8">
      {rows.map((row) => (
        <div
          key={`${row.branch_id}-${row.variant_id}`}
          className="w-full px-4 py-2.5 border-b border-line flex items-center gap-3"
        >
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{row.full_name}</div>
            <div className="text-xs text-subtle truncate">
              {[row.brand_name, row.model_name, row.variant_name].filter(Boolean).join(' · ')}
            </div>
            <div className="text-[11px] text-subtler truncate mt-0.5">{branchName(row.branch_id)}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-medium tabular-nums">
              {fmtNum(row.qty)}<span className="text-subtle text-xs"> {t('lot.units', { defaultValue: 'units' })}</span>
            </div>
            <div className="text-xs text-subtle tabular-nums">{fmtCurrency(row.total_value ?? 0)}</div>
            <div className="text-[11px] text-subtler tabular-nums">{fmtCurrency(row.avg_cost ?? 0)} {t('branchStock.each', { defaultValue: 'each' })}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LeaseList({
  rows,
  branchName,
  isFetching,
  t,
}: {
  rows: ContractableRow[];
  branchName: (id: number) => string;
  isFetching: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (!isFetching && rows.length === 0) {
    return (
      <div className="p-8 text-center text-subtler">
        {t('common.noData')}
      </div>
    );
  }
  return (
    <div className="flex flex-col pb-8">
      {rows.map((row) => {
        const params = new URLSearchParams();
        params.set('variant_id', String(row.variant_id));
        params.set('branch_id', String(row.branch_id));
        params.set('bucket', 'ON_HAND_AVAILABLE');
        params.set('condition', row.condition);
        return (
          <Link
            key={`${row.branch_id}-${row.variant_id}-${row.condition}`}
            to={`/admin/inventory/assets?${params.toString()}`}
            className="w-full px-4 py-2.5 border-b border-line flex items-center gap-3 hover:bg-surface-hover transition-colors no-underline text-current"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-sm truncate">{row.full_name}</span>
                <Badge size="xs" color={row.condition === 'NEW' ? 'success' : 'warning'}>
                  {row.condition}
                </Badge>
              </div>
              <div className="text-xs text-subtle truncate">
                {[row.brand_name, row.family_name, row.model_name, row.variant_name].filter(Boolean).join(' · ')}
              </div>
              <div className="text-[11px] text-subtler truncate mt-0.5">{branchName(row.branch_id)}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-medium tabular-nums">
                {fmtNum(row.asset_count)}<span className="text-subtle text-xs"> {t('branchStock.units', { defaultValue: 'units' })}</span>
              </div>
              <div className="text-xs text-subtle tabular-nums">{fmtCurrency(row.total_cost ?? 0)}</div>
              <div className="text-[11px] text-subtler tabular-nums">{fmtCurrency(row.avg_cost ?? 0)} {t('branchStock.each', { defaultValue: 'each' })}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
