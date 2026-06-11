import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  MobileHeader, DataTable, Select, Badge, InputDateRangePicker, Button, PopOver,
} from 'tsp-form';
import {
  ArrowRightFromLine, Keyboard, SlidersHorizontal,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import {
  fmtCurrency, toLocalDateStr, parseLocalDate, makeDateRangePickerFormat,
} from '../../lib/format';
import type { Branch, PaymentRow } from './accountingTypes';

const METHODS = ['CASH', 'TRANSFER', 'SAVING_WALLET', 'CREDIT_WALLET', 'INSURANCE_WALLET', 'WAIVE', 'HOLDING_BUDGET'] as const;

const METHOD_COLOR: Record<string, 'success' | 'primary' | 'secondary' | 'info' | 'warning' | 'default'> = {
  CASH: 'success',
  TRANSFER: 'primary',
  SAVING_WALLET: 'secondary',
  CREDIT_WALLET: 'secondary',
  INSURANCE_WALLET: 'secondary',
  WAIVE: 'info',
  HOLDING_BUDGET: 'info',
};

const TYPE_VALUES = ['INVOICE', 'CREDIT_NOTE', 'JOURNAL'] as const;

const BADGE_TEXT_COLOR: Record<string, string> = {
  success: 'text-success',
  primary: 'text-primary-fg',
  danger: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
  secondary: 'text-secondary-fg',
  default: 'text-fg',
};

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

export function PaymentsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
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
  const typeFilter = searchParams.get('type') ?? '';

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [isTypingRange, setIsTypingRange] = useState(false);

  const pendingPatchRef = useRef<Record<string, string> | null>(null);
  const updateFilters = useCallback((patch: Partial<{ branch_id: string; from: string; to: string; method: string; type: string }>) => {
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
  if (typeFilter) params.set('bill_type', `eq.${typeFilter}`);
  params.set('order', 'bill_date.desc,payment_id.desc');

  const { data: pageData, isFetching } = useQuery({
    queryKey: ['accounting', 'payments', branchId, fromDate, toDate, methodFilter, typeFilter, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<PaymentRow>(
      `/v_payments?${params.toString()}`,
      { page: pageIndex + 1, pageSize }
    ),
    placeholderData: keepPreviousData,
  });
  const rows = pageData?.data ?? [];
  const totalCount = pageData?.totalCount ?? 0;

  const summaryParams = new URLSearchParams();
  if (branchId) summaryParams.set('branch_id', `eq.${branchId}`);
  if (fromDate) summaryParams.set('bill_date', `gte.${fromDate}`);
  if (toDate) summaryParams.append('bill_date', `lt.${toExclusive}`);
  summaryParams.set('select', 'method,bill_type,amount');
  const { data: summaryRows = [] } = useQuery({
    queryKey: ['accounting', 'payments-summary', branchId, fromDate, toDate],
    queryFn: () => apiClient.get<{ method: string; bill_type: string; amount: number }[]>(
      `/v_payments?${summaryParams.toString()}`,
    ),
  });
  const summary = useMemo(() => {
    const byMethod = new Map<string, { count: number; amount: number }>();
    const byType = new Map<string, { count: number; amount: number }>();
    let totalAmount = 0;
    for (const r of summaryRows) {
      const m = byMethod.get(r.method) ?? { count: 0, amount: 0 };
      m.count += 1; m.amount += Number(r.amount) || 0; byMethod.set(r.method, m);
      const tt = byType.get(r.bill_type) ?? { count: 0, amount: 0 };
      tt.count += 1; tt.amount += Number(r.amount) || 0; byType.set(r.bill_type, tt);
      totalAmount += Number(r.amount) || 0;
    }
    return { byMethod, byType, totalAmount, totalCount: summaryRows.length };
  }, [summaryRows]);

  const visibleMethods = METHODS.filter(m => (summary.byMethod.get(m)?.count ?? 0) > 0);

  const [filterOpen, setFilterOpen] = useState(false);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  // Branch filter is the only one not always on screen — methodFilter/typeFilter/date
  // are reflected by default ranges, so the "active extras" count is just optional ones.
  const activeFilterCount =
    (methodFilter ? 1 : 0) + (typeFilter ? 1 : 0) + (!isBranchUser && branchId ? 1 : 0);

  const renderDateFilter = (wrapperClass: string): ReactNode => (
    <div className={wrapperClass}>
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
    </div>
  );
  const renderMethodFilter = (wrapperClass: string): ReactNode => (
    <div className={wrapperClass}>
      <Select
        value={methodFilter || null}
        onChange={(v) => updateFilters({ method: (v as string) ?? '' })}
        options={METHODS.map(m => ({ value: m, label: t(`accounting.payments.m_${m}`) }))}
        size="sm"
        showChevron
        placeholder={t('accounting.payments.allMethods')}
        clearable
      />
    </div>
  );
  const renderTypeFilter = (wrapperClass: string): ReactNode => (
    <div className={wrapperClass}>
      <Select
        value={typeFilter || null}
        onChange={(v) => updateFilters({ type: (v as string) ?? '' })}
        options={TYPE_VALUES.map(v => ({ value: v, label: t(`accounting.bills.typeLabel.${v}`) }))}
        size="sm"
        showChevron
        placeholder={t('accounting.payments.allTypes')}
        clearable
      />
    </div>
  );
  const renderBranchFilter = (wrapperClass: string): ReactNode => (
    <div className={wrapperClass}>
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
    </div>
  );

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

        {/* Filters — visibility depends on breakpoint; overflow goes into a popover */}
        <div className="flex-none flex items-center p-2 border-b border-line gap-2">
          {/* Date: always inline */}
          <div className="flex-1 sm:flex-none sm:w-56">
            {renderDateFilter('w-full')}
          </div>
          {/* Method: inline at sm+ */}
          <div className="hidden sm:block sm:w-44">
            {renderMethodFilter('w-full')}
          </div>
          {/* Type: inline at md+ */}
          <div className="hidden md:block md:w-44">
            {renderTypeFilter('w-full')}
          </div>
          {/* Branch: inline at lg+ */}
          <div className="hidden lg:block lg:w-44">
            {renderBranchFilter('w-full')}
          </div>

          {/* Overflow button: visible below lg */}
          <div className="lg:hidden relative shrink-0 ml-auto">
            <Button
              ref={filterTriggerRef}
              variant="outline"
              size="sm"
              startIcon={<SlidersHorizontal size={16} />}
              aria-label={t('common.filters', { defaultValue: 'Filters' })}
              onClick={() => setFilterOpen(v => !v)}
            />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[1rem] h-4 px-1 rounded-full bg-primary-fg text-white text-[10px] leading-4 text-center font-semibold pointer-events-none">
                {activeFilterCount}
              </span>
            )}
          </div>
          <PopOver
            isOpen={filterOpen}
            onClose={() => setFilterOpen(false)}
            triggerRef={filterTriggerRef}
            placement="bottom"
            align="end"
            maxWidth="20rem"
          >
            <div className="flex flex-col gap-3 p-3 min-w-[16rem]">
              <div className="sm:hidden">
                {renderMethodFilter('w-full')}
              </div>
              <div className="md:hidden">
                {renderTypeFilter('w-full')}
              </div>
              {renderBranchFilter('w-full')}
            </div>
          </PopOver>
        </div>

        {/* Channel breakdown */}
        <div className="flex-none px-4 py-3 border-b border-line">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
            {t('accounting.payments.channelTitle')}
          </h3>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
            {visibleMethods.map(m => {
              const s = summary.byMethod.get(m) ?? { count: 0, amount: 0 };
              return (
                <Stat
                  key={m}
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`font-medium ${BADGE_TEXT_COLOR[METHOD_COLOR[m] ?? 'default']}`}>
                        {t(`accounting.payments.m_${m}`)}
                      </span>
                      <span>{s.count} {t('accounting.payments.paymentCount')}</span>
                    </span>
                  }
                  value={fmtCurrency(s.amount)}
                />
              );
            })}
            <Stat
              label={<span className="font-medium">{t('accounting.payments.totalAmount')}</span>}
              value={fmtCurrency(summary.totalAmount)}
              emphasis
            />
          </dl>
        </div>

        {/* Payments list */}
        <DataTable<PaymentRow>
          data={rows}
          renderRow={(row) => {
            const p = row.original;
            return (
              <div
                key={p.payment_id}
                className="w-full px-4 py-3 border-b border-line flex flex-col gap-1"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-sm font-medium truncate">{p.code_display}</span>
                  <Badge color={METHOD_COLOR[p.method] ?? 'default'} size="sm">
                    {t(`accounting.payments.m_${p.method}`, { defaultValue: p.method })}
                  </Badge>
                  <Badge color={TYPE_COLOR[p.bill_type] ?? 'default'} size="sm">{t(`accounting.bills.typeLabel.${p.bill_type}`, { defaultValue: p.bill_type })}</Badge>
                  {p.is_reversal && <Badge color="danger" size="sm">VOID</Badge>}
                  <span className="ml-auto text-sm font-medium tabular-nums shrink-0">
                    {fmtCurrency(p.amount)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-subtle min-w-0">
                  <span className="truncate">
                    <span className="font-mono">{p.bill_code_display}</span>
                    {p.bank_name && <> · <span>{p.bank_name} {p.account_number}</span></>}
                    {p.payer_name && <> · <span>{p.payer_name}</span></>}
                  </span>
                  <span className="ml-auto text-fg/50 shrink-0">
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

function Stat({ label, value, emphasis }: { label: React.ReactNode; value: React.ReactNode; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={`tabular-nums font-semibold ${emphasis ? 'text-base text-primary-fg' : 'text-sm'}`}>{value}</dd>
    </div>
  );
}
