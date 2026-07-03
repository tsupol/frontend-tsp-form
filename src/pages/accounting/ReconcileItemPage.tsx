import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  MobileHeader, Select, Badge, InputDateRangePicker,
} from 'tsp-form';
import {
  ArrowRightFromLine, Keyboard, ChevronRight, ChevronDown, ExternalLink, Truck, Building2,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { FilterBar, type FilterBarItem } from '../../components/FilterBar';
import {
  fmtCurrency, toLocalDateStr, parseLocalDate, makeDateRangePickerFormat,
} from '../../lib/format';
import type { Branch, ReconcileItemResult, ReconcileItemRow } from './accountingTypes';

type OwnerType = 'HOLDING' | 'COMPANY';

function defaultRange() {
  const today = new Date();
  const to = toLocalDateStr(today);
  const fromD = new Date(today);
  fromD.setDate(fromD.getDate() - 6);
  return { from: toLocalDateStr(fromD), to };
}

// One bill's worth of lines, pre-summed for the bill-level row.
interface BillGroup {
  bill_id: number;
  bill_code: string;
  contract_id: number | null;
  contract_code: string | null;
  customer_name: string;
  bill_type: string;
  remit: number;
  lines: ReconcileItemRow[];
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
  const [expandedOwners, setExpandedOwners] = useState<Set<OwnerType>>(new Set());
  const [expandedBills, setExpandedBills] = useState<Set<number>>(new Set());

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

  // The RPC is per-company: company_id comes from the chosen branch. branch_id=null
  // → company-all mode (only meaningful once a branch — hence a company — is picked).
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

  // Group flat rows → owner → bill. Bill row = Σ remit_amount of its lines.
  const byOwner = useMemo(() => {
    const map: Record<OwnerType, Map<number, BillGroup>> = {
      HOLDING: new Map(),
      COMPANY: new Map(),
    };
    for (const r of data?.rows ?? []) {
      const bucket = map[r.owner_type];
      let g = bucket.get(r.bill_id);
      if (!g) {
        g = {
          bill_id: r.bill_id,
          bill_code: r.bill_code,
          contract_id: r.contract_id,
          contract_code: r.contract_code,
          customer_name: r.customer_name,
          bill_type: r.bill_type,
          remit: 0,
          lines: [],
        };
        bucket.set(r.bill_id, g);
      }
      g.remit += Number(r.remit_amount) || 0;
      g.lines.push(r);
    }
    return map;
  }, [data?.rows]);

  const toggleOwner = (o: OwnerType) => setExpandedOwners(prev => {
    const next = new Set(prev);
    next.has(o) ? next.delete(o) : next.add(o);
    return next;
  });
  const toggleBill = (id: number) => setExpandedBills(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

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

  const owners: OwnerType[] = ['HOLDING', 'COMPANY'];

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
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="flex flex-col h-dvh">
        <div className="flex-none px-4 py-2.5 border-b border-line items-center gap-4 max-md:hidden flex">
          <h1 className="heading-2 shrink-0">{t('accounting.reconcile.itemTitle')}</h1>
        </div>

        <FilterBar
          className="flex-none p-2 border-b border-line"
          leading={dateFilter}
          leadingMinWidth={224}
          items={filterItems}
          activeCount={0}
        />

        <div className={`flex-1 min-h-0 overflow-auto better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          {!branchId && (
            <div className="p-8 text-center text-subtler">{t('accounting.reconcile.pickBranch')}</div>
          )}
          {branchId && (data?.rows.length ?? 0) === 0 && (
            <div className="p-8 text-center text-subtler">{t('accounting.reconcile.noData')}</div>
          )}
          {branchId && (data?.rows.length ?? 0) > 0 && (
            <div className="max-w-3xl mx-auto p-4">
              {owners.map(owner => {
                const bills = [...byOwner[owner].values()];
                if (bills.length === 0) return null;
                const ownerTotal = owner === 'HOLDING' ? (data?.holding_total ?? 0) : (data?.company_total ?? 0);
                const open = expandedOwners.has(owner);
                return (
                  <div key={owner} className="border-b border-line">
                    {/* Owner row */}
                    <button
                      type="button"
                      onClick={() => toggleOwner(owner)}
                      className="w-full flex items-center gap-2 py-3 text-left bg-transparent border-none cursor-pointer"
                    >
                      {open ? <ChevronDown size={16} className="text-subtle" /> : <ChevronRight size={16} className="text-subtle" />}
                      {owner === 'HOLDING' ? <Truck size={16} className="text-primary-fg" /> : <Building2 size={16} className="text-secondary-fg" />}
                      <span className="font-medium">{t(`accounting.reconcile.owner_${owner}`)}</span>
                      <span className="ml-auto tabular-nums font-semibold">{fmtCurrency(ownerTotal)}</span>
                    </button>

                    {/* Bills under this owner */}
                    {open && (
                      <div className="pb-2">
                        {bills.map(bill => {
                          const billOpen = expandedBills.has(bill.bill_id);
                          return (
                            <div key={bill.bill_id} className="pl-6">
                              <div className="flex items-center gap-2 py-2 border-t border-line">
                                <button
                                  type="button"
                                  onClick={() => toggleBill(bill.bill_id)}
                                  className="shrink-0 bg-transparent border-none cursor-pointer p-0 text-subtle"
                                  aria-label="expand"
                                >
                                  {billOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                                <div className="flex flex-col min-w-0 flex-1">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <button
                                      type="button"
                                      onClick={() => navigate(`/admin/accounting/bills/${bill.bill_id}`)}
                                      className="font-mono text-sm text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer truncate"
                                    >
                                      {bill.bill_code}
                                      <ExternalLink size={11} />
                                    </button>
                                    {bill.bill_type === 'CREDIT_NOTE' && (
                                      <Badge color="danger" size="sm">{t('accounting.reconcile.refund')}</Badge>
                                    )}
                                  </div>
                                  {(bill.customer_name.trim() || bill.contract_code) && (
                                    <div className="flex items-center gap-1.5 text-xs text-subtle min-w-0">
                                      {bill.customer_name.trim() && <span className="truncate">{bill.customer_name}</span>}
                                      {bill.contract_code && (
                                        <>
                                          {bill.customer_name.trim() && <span>·</span>}
                                          <button
                                            type="button"
                                            onClick={() => bill.contract_id && navigate(`/admin/contracts/search/${bill.contract_id}`)}
                                            className="font-mono text-primary-fg hover:underline inline-flex items-center gap-0.5 bg-transparent border-none p-0 cursor-pointer"
                                          >
                                            {bill.contract_code}
                                            <ExternalLink size={10} />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                                <span className={`shrink-0 text-sm tabular-nums font-medium ${bill.remit < 0 ? 'text-danger' : ''}`}>
                                  {fmtCurrency(bill.remit)}
                                </span>
                              </div>

                              {/* Charge lines under this bill */}
                              {billOpen && (
                                <div className="pl-6 pb-1">
                                  {bill.lines.map(line => (
                                    <div key={line.line_id} className="flex items-center gap-2 py-1.5 border-t border-line/60">
                                      <div className="flex flex-col min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <span className="text-xs text-subtle truncate">
                                            {line.charge_name_th || line.charge_type}
                                          </span>
                                          {!line.is_remittable && (
                                            <Badge color="warning" size="xs">{t('accounting.reconcile.notCounted')}</Badge>
                                          )}
                                        </div>
                                        <span className="text-xs text-subtler truncate">
                                          {line.description}
                                          {line.quantity > 1 && <> · {fmtCurrency(line.amount)} × {line.quantity}</>}
                                        </span>
                                      </div>
                                      <span className={`shrink-0 text-xs tabular-nums ${line.remit_amount < 0 ? 'text-danger' : line.is_remittable ? '' : 'text-subtler'}`}>
                                        {fmtCurrency(line.remit_amount)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Grand total */}
              <div className="flex items-center justify-between py-3 mt-1">
                <span className="font-semibold">{t('accounting.reconcile.totalRemit')}</span>
                <span className="text-lg font-bold tabular-nums text-primary-fg">
                  {fmtCurrency(data?.total_amount ?? 0)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
