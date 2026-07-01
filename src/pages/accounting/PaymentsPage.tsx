import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  MobileHeader, DataTable, Select, Badge, InputDateRangePicker, Button,
} from 'tsp-form';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightFromLine, Keyboard, ArrowLeftRight,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { FilterBar, type FilterBarItem } from '../../components/FilterBar';
import {
  fmtCurrency, toLocalDateStr, parseLocalDate, makeDateRangePickerFormat,
} from '../../lib/format';
import type { Branch, PaymentRow } from './accountingTypes';
import { PaymentChannelCorrectModal } from './PaymentChannelCorrectModal';

interface BankAccountOption {
  id: number;
  branch_id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_active: boolean;
}

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
  const { user, can } = useAuth();
  const queryClient = useQueryClient();
  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const userBranchId = isBranchUser && user?.branch_id ? String(user.branch_id) : '';
  const canCorrectChannel = can('PAYMENT.CHANNEL_CORRECT');

  const [correctPayment, setCorrectPayment] = useState<PaymentRow | null>(null);

  const initial = defaultRange();
  const [searchParams, setSearchParams] = useSearchParams();
  const branchId = searchParams.get('branch_id') ?? userBranchId;
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const fromDate = fromParam === null ? initial.from : fromParam;
  const toDate = toParam === null ? initial.to : toParam;
  const methodFilter = searchParams.get('method') ?? '';
  const typeFilter = searchParams.get('type') ?? '';
  const bankAccountFilter = searchParams.get('bank_account_id') ?? '';

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [isTypingRange, setIsTypingRange] = useState(false);

  const pendingPatchRef = useRef<Record<string, string> | null>(null);
  const updateFilters = useCallback((patch: Partial<{ branch_id: string; from: string; to: string; method: string; type: string; bank_account_id: string }>) => {
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

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts-active', branchId],
    queryFn: () => apiClient.get<BankAccountOption[]>(
      branchId
        ? `/v_bank_accounts?is_active=is.true&branch_id=eq.${branchId}&order=is_default.desc,bank_name`
        : '/v_bank_accounts?is_active=is.true&order=bank_name',
    ),
    staleTime: 5 * 60 * 1000,
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
  if (bankAccountFilter) params.set('bank_account_id', `eq.${bankAccountFilter}`);
  params.set('order', 'bill_date.desc,payment_id.desc');

  const { data: pageData, isFetching } = useQuery({
    queryKey: ['accounting', 'payments', branchId, fromDate, toDate, methodFilter, typeFilter, bankAccountFilter, pageIndex, pageSize],
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
  if (bankAccountFilter) summaryParams.set('bank_account_id', `eq.${bankAccountFilter}`);
  summaryParams.set('select', 'method,bill_type,amount');
  const { data: summaryRows = [] } = useQuery({
    queryKey: ['accounting', 'payments-summary', branchId, fromDate, toDate, bankAccountFilter],
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

  const activeFilterCount =
    (methodFilter ? 1 : 0) + (typeFilter ? 1 : 0) + (!isBranchUser && branchId ? 1 : 0) + (bankAccountFilter ? 1 : 0);

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
  // Channel select — merges method + bank account into one control.
  // Bank accounts only matter for method=TRANSFER, so they live under the Transfer group.
  // Value encoding (Select side only; URL stays split as method / bank_account_id):
  //   ''                       → no filter
  //   'CASH' / 'WAIVE' / …     → method only
  //   'TRANSFER'               → method=TRANSFER, no bank filter
  //   'TRANSFER:<id>'          → method=TRANSFER, bank_account_id=<id>
  const channelValue =
    methodFilter === 'TRANSFER' && bankAccountFilter
      ? `TRANSFER:${bankAccountFilter}`
      : methodFilter || null;

  const channelOptions = [
    ...METHODS
      .filter(m => m !== 'TRANSFER')
      .map(m => ({ value: m, label: t(`accounting.payments.m_${m}`) })),
    { value: 'TRANSFER', label: t('accounting.payments.m_TRANSFER') },
    ...bankAccounts.map(b => ({
      value: `TRANSFER:${b.id}`,
      label: `${b.bank_name} · ${b.account_number}`,
    })),
  ];

  const bankById = new Map(bankAccounts.map(b => [b.id, b]));
  const renderChannelOption = (opt: { value: string; label: string }) => {
    if (opt.value.startsWith('TRANSFER:')) {
      const id = Number(opt.value.slice('TRANSFER:'.length));
      const b = bankById.get(id);
      if (b) {
        return (
          <div className="flex flex-col leading-tight py-0.5 min-w-0">
            <div className="text-sm truncate">
              {t('accounting.payments.m_TRANSFER')}
              <span className="text-subtle"> · {b.bank_name}</span>
            </div>
            <div className="text-xs text-subtle truncate">{b.account_number}</div>
          </div>
        );
      }
    }
    return <span className="text-sm">{opt.label}</span>;
  };

  const onChannelChange = (raw: string | string[] | null | undefined) => {
    const v = (raw as string) ?? '';
    if (!v) {
      updateFilters({ method: '', bank_account_id: '' });
      return;
    }
    if (v.startsWith('TRANSFER:')) {
      updateFilters({ method: 'TRANSFER', bank_account_id: v.slice('TRANSFER:'.length) });
      return;
    }
    updateFilters({ method: v, bank_account_id: '' });
  };

  const methodNode: ReactNode = (
    <Select
      value={channelValue}
      onChange={onChannelChange}
      options={channelOptions}
      renderOption={renderChannelOption}
      size="sm"
      showChevron
      placeholder={t('accounting.payments.allMethods')}
      clearable
      searchable
    />
  );
  const typeNode: ReactNode = (
    <Select
      value={typeFilter || null}
      onChange={(v) => updateFilters({ type: (v as string) ?? '' })}
      options={TYPE_VALUES.map(v => ({ value: v, label: t(`accounting.bills.typeLabel.${v}`) }))}
      size="sm"
      showChevron
      placeholder={t('accounting.payments.allTypes')}
      clearable
    />
  );
  const branchNode: ReactNode = (
    <Select
      value={branchId || null}
      onChange={(v) => updateFilters({ branch_id: (v as string) ?? '', bank_account_id: '' })}
      placeholder={t('accounting.branch')}
      options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
      size="sm"
      showChevron
      clearable={!isBranchUser}
      disabled={isBranchUser}
    />
  );
  // Priority: higher = inlined first / dropped last.
  const filterItems: FilterBarItem[] = [
    { key: 'method', width: 224, node: methodNode, priority: 50 },
    { key: 'type', width: 176, node: typeNode, priority: 30 },
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
            const correctable = canCorrectChannel && !p.is_reversal && (p.method === 'CASH' || p.method === 'TRANSFER');
            return (
              <div
                key={p.payment_id}
                className="w-full px-4 py-3 flex flex-col gap-1"
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
                  {correctable && (
                    <Button
                      variant="ghost"
                      className="btn-icon-sm shrink-0"
                      startIcon={<ArrowLeftRight size={15} />}
                      title={t('accounting.payments.correct.title')}
                      aria-label={t('accounting.payments.correct.title')}
                      onClick={() => setCorrectPayment(p)}
                    />
                  )}
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

      <PaymentChannelCorrectModal
        open={!!correctPayment}
        payment={correctPayment}
        onClose={() => setCorrectPayment(null)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['accounting', 'payments'] });
          queryClient.invalidateQueries({ queryKey: ['accounting', 'payments-summary'] });
        }}
      />
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
