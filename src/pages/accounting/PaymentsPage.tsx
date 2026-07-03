import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  MobileHeader, DataTable, Select, Badge, InputDateRangePicker,
} from 'tsp-form';
import {
  ArrowRightFromLine, Keyboard, ExternalLink, Wallet, HandCoins,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { FilterBar, type FilterBarItem } from '../../components/FilterBar';
import {
  fmtCurrency, toLocalDateStr, parseLocalDate, makeDateRangePickerFormat,
} from '../../lib/format';
import type { Branch, SettlementTenderLine } from './accountingTypes';

// Methods that can appear in v_settlement_tender_lines, grouped under their tender_class.
const PHYSICAL_METHODS = ['CASH', 'TRANSFER'] as const;
const WALLET_METHODS = ['SAVING_WALLET', 'CREDIT_WALLET', 'INSURANCE_WALLET'] as const;
const ALL_METHODS = [...PHYSICAL_METHODS, ...WALLET_METHODS] as const;

const METHOD_COLOR: Record<string, 'success' | 'primary' | 'secondary'> = {
  CASH: 'success',
  TRANSFER: 'primary',
  SAVING_WALLET: 'secondary',
  CREDIT_WALLET: 'secondary',
  INSURANCE_WALLET: 'secondary',
};

const BADGE_TEXT_COLOR: Record<string, string> = {
  success: 'text-success',
  primary: 'text-primary-fg',
  secondary: 'text-secondary-fg',
};

function defaultRange() {
  const today = new Date();
  const to = toLocalDateStr(today);
  const fromD = new Date(today);
  fromD.setDate(fromD.getDate() - 6);
  return { from: toLocalDateStr(fromD), to };
}

export function PaymentsPage() {
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
  const methodFilter = searchParams.get('method') ?? '';

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [isTypingRange, setIsTypingRange] = useState(false);

  const pendingPatchRef = useRef<Record<string, string> | null>(null);
  const updateFilters = useCallback((patch: Partial<{ branch_id: string; from: string; to: string; method: string }>) => {
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

  const toExclusive = useMemo(() => {
    const d = parseLocalDate(toDate);
    if (!d) return toDate;
    d.setDate(d.getDate() + 1);
    return toLocalDateStr(d);
  }, [toDate]);

  const params = new URLSearchParams();
  if (branchId) params.set('branch_id', `eq.${branchId}`);
  if (fromDate) params.set('bill_date', `gte.${fromDate}`);
  if (toDate) params.append('bill_date', `lt.${toExclusive}`);
  if (methodFilter) params.set('method', `eq.${methodFilter}`);
  params.set('order', 'created_at.desc');

  const { data: pageData, isFetching } = useQuery({
    queryKey: ['accounting', 'settlement-tender', branchId, fromDate, toDate, methodFilter, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<SettlementTenderLine>(
      `/v_settlement_tender_lines?${params.toString()}`,
      { page: pageIndex + 1, pageSize }
    ),
    placeholderData: keepPreviousData,
  });
  const rows = pageData?.data ?? [];
  const totalCount = pageData?.totalCount ?? 0;

  // Summary — fetch the amount+method+tender_class of every row in range (no method
  // filter so all channels always show) and roll up net per method client-side.
  const summaryParams = new URLSearchParams();
  if (branchId) summaryParams.set('branch_id', `eq.${branchId}`);
  if (fromDate) summaryParams.set('bill_date', `gte.${fromDate}`);
  if (toDate) summaryParams.append('bill_date', `lt.${toExclusive}`);
  summaryParams.set('select', 'method,tender_class,direction,amount');
  const { data: summaryRows = [] } = useQuery({
    queryKey: ['accounting', 'settlement-tender-summary', branchId, fromDate, toDate],
    queryFn: () => apiClient.get<Pick<SettlementTenderLine, 'method' | 'tender_class' | 'direction' | 'amount'>[]>(
      `/v_settlement_tender_lines?${summaryParams.toString()}`,
    ),
  });

  // amount is already signed (OUT/CREDIT_NOTE negative) → net = Σ amount.
  const summary = useMemo(() => {
    const byMethod = new Map<string, { net: number; hasRefund: boolean }>();
    let physicalNet = 0;
    let walletNet = 0;
    for (const r of summaryRows) {
      const amt = Number(r.amount) || 0;
      const slot = byMethod.get(r.method) ?? { net: 0, hasRefund: false };
      slot.net += amt;
      if (r.direction === 'OUT') slot.hasRefund = true;
      byMethod.set(r.method, slot);
      if (r.tender_class === 'PHYSICAL') physicalNet += amt;
      else walletNet += amt;
    }
    return { byMethod, physicalNet, walletNet, total: physicalNet + walletNet };
  }, [summaryRows]);

  const activeFilterCount = (methodFilter ? 1 : 0) + (!isBranchUser && branchId ? 1 : 0);

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
  const methodNode: ReactNode = (
    <Select
      value={methodFilter || null}
      onChange={(v) => updateFilters({ method: (v as string) ?? '' })}
      options={ALL_METHODS.map(m => ({ value: m, label: t(`accounting.payments.m_${m}`) }))}
      size="sm"
      showChevron
      placeholder={t('accounting.payments.allMethods')}
      clearable
    />
  );
  const branchNode: ReactNode = (
    <Select
      value={branchId || null}
      onChange={(v) => updateFilters({ branch_id: (v as string) ?? '' })}
      placeholder={t('accounting.branch')}
      options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
      size="sm"
      showChevron
      clearable={!isBranchUser}
      disabled={isBranchUser}
    />
  );
  const filterItems: FilterBarItem[] = [
    { key: 'method', width: 200, node: methodNode, priority: 50 },
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
          {t('accounting.payments.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="flex flex-col h-dvh">
        <div className="flex-none px-4 py-2.5 border-b border-line items-center gap-4 max-md:hidden flex">
          <h1 className="heading-2 shrink-0">{t('accounting.payments.title')}</h1>
        </div>

        {/* Filters — overflow-aware, measures the bar (not the viewport) */}
        <FilterBar
          className="flex-none p-2 border-b border-line"
          leading={dateFilter}
          leadingMinWidth={224}
          items={filterItems}
          activeCount={activeFilterCount}
        />

        {/* Channel breakdown — grouped by tender_class → method, net per method */}
        <div className="flex-none px-4 py-3 border-b border-line">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
            {t('accounting.payments.channelTitle')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            <TenderGroup
              icon={<HandCoins size={15} className="text-success" />}
              label={t('accounting.payments.tc_PHYSICAL')}
              net={summary.physicalNet}
              methods={PHYSICAL_METHODS}
              byMethod={summary.byMethod}
            />
            <TenderGroup
              icon={<Wallet size={15} className="text-secondary-fg" />}
              label={t('accounting.payments.tc_WALLET')}
              net={summary.walletNet}
              methods={WALLET_METHODS}
              byMethod={summary.byMethod}
            />
          </div>
          <div className="mt-3 pt-2 border-t border-line flex items-center justify-between">
            <span className="text-sm font-medium">{t('accounting.payments.totalAmount')}</span>
            <span className="text-base font-semibold tabular-nums text-primary-fg">
              {fmtCurrency(summary.total)}
            </span>
          </div>
        </div>

        {/* Tender lines */}
        <DataTable<SettlementTenderLine>
          data={rows}
          renderRow={(row) => {
            const p = row.original;
            const isRefund = p.direction === 'OUT';
            return (
              <div
                key={p.payment_id}
                className="w-full px-4 py-3 flex items-center gap-3"
              >
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/accounting/bills/${p.bill_id}`)}
                      className="font-mono text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer truncate"
                    >
                      {p.bill_code}
                      <ExternalLink size={12} />
                    </button>
                    <Badge color={METHOD_COLOR[p.method] ?? 'default'} size="sm">
                      {t(`accounting.payments.m_${p.method}`, { defaultValue: p.method })}
                    </Badge>
                    {isRefund && <Badge color="danger" size="sm">{t('accounting.payments.refundTag')}</Badge>}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-subtle min-w-0">
                    <span className="truncate">
                      {p.customer_name?.trim() && <span>{p.customer_name}</span>}
                      {p.contract_code && (
                        <> · <button
                          type="button"
                          onClick={() => p.contract_id && navigate(`/admin/contracts/search/${p.contract_id}`)}
                          className="font-mono text-primary-fg hover:underline inline-flex items-center gap-0.5 bg-transparent border-none p-0 cursor-pointer"
                        >
                          {p.contract_code}
                          <ExternalLink size={11} />
                        </button></>
                      )}
                      {p.bank_name && <> · <span>{p.bank_name} {p.account_number_display}</span></>}
                      {p.payer_name && <> · <span>{p.payer_name}</span></>}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end shrink-0">
                  <span className={`text-sm font-medium tabular-nums ${isRefund ? 'text-danger' : ''}`}>
                    {fmtCurrency(p.amount)}
                  </span>
                  <span className="text-xs text-subtler">
                    <DateTime value={p.bill_date} showTime={false} />
                  </span>
                </div>
              </div>
            );
          }}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[25, 50, 100]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
          className={`flex-1 min-h-0 padded-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={<div className="p-8 text-center text-subtler">{t('accounting.empty')}</div>}
        />
      </div>
    </>
  );
}

function TenderGroup({
  icon, label, net, methods, byMethod,
}: {
  icon: ReactNode;
  label: string;
  net: number;
  methods: readonly string[];
  byMethod: Map<string, { net: number; hasRefund: boolean }>;
}) {
  const { t } = useTranslation();
  const visible = methods.filter(m => byMethod.has(m));
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {label}
        </span>
        <span className="text-sm font-semibold tabular-nums">{fmtCurrency(net)}</span>
      </div>
      <dl className="pl-6 flex flex-col gap-1">
        {visible.length === 0 && (
          <span className="text-xs text-subtler">—</span>
        )}
        {visible.map(m => {
          const s = byMethod.get(m)!;
          const color = METHOD_COLOR[m] ?? 'secondary';
          return (
            <div key={m} className="flex items-center justify-between">
              <dt className={`text-xs ${BADGE_TEXT_COLOR[color] ?? 'text-fg'}`}>
                {t(`accounting.payments.m_${m}`)}
              </dt>
              <dd className={`text-xs tabular-nums ${s.net < 0 ? 'text-danger' : ''}`}>
                {fmtCurrency(s.net)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
