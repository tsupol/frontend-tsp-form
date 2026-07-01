import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge } from 'tsp-form';
import { ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { type BillRow, type BillDetail } from './accountingTypes';

const TYPE_FILTERS = ['', 'INVOICE', 'CREDIT_NOTE', 'JOURNAL'] as const;
const STATUS_FILTERS = ['', 'OPEN', 'PARTIAL', 'PAID', 'VOIDED'] as const;

const TYPE_COLOR: Record<string, 'primary' | 'danger' | 'warning' | 'default'> = {
  INVOICE: 'primary',
  CREDIT_NOTE: 'danger',
  JOURNAL: 'warning',
};

const STATUS_COLOR: Record<string, 'success' | 'danger' | 'warning' | 'default'> = {
  PAID: 'success',
  OPEN: 'danger',
  PARTIAL: 'warning',
  VOIDED: 'default',
};

const LINE_TYPE_COLOR: Record<string, 'primary' | 'success' | 'secondary' | 'info' | 'warning' | 'default'> = {
  CONTRACT: 'primary',
  RETAIL: 'success',
  GIFT: 'secondary',
  SERVICE: 'info',
  JOURNAL: 'warning',
};

const METHOD_COLOR: Record<string, 'success' | 'primary' | 'secondary' | 'info' | 'default'> = {
  CASH: 'success',
  TRANSFER: 'primary',
  SAVING_WALLET: 'secondary',
  CREDIT_WALLET: 'secondary',
  INSURANCE_WALLET: 'secondary',
  WAIVE: 'info',
  HOLDING_BUDGET: 'info',
};

interface Props {
  branchId: string;
  billDate: string;
}

export function BillReconcilePanel({ branchId, billDate }: Props) {
  const { t } = useTranslation();
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const params = new URLSearchParams();
  params.set('branch_id', `eq.${branchId}`);
  params.set('bill_date', `eq.${billDate}`);
  params.set('order', 'created_at.asc');
  if (typeFilter) params.set('bill_type', `eq.${typeFilter}`);
  if (statusFilter) params.set('status', `eq.${statusFilter}`);

  const { data: bills = [], isFetching } = useQuery({
    queryKey: ['accounting', 'reconcile-bills', branchId, billDate, typeFilter, statusFilter],
    queryFn: () => apiClient.get<BillRow[]>(`/v_bills?${params.toString()}`),
    enabled: !!branchId && !!billDate,
  });

  const counts = useQuery({
    queryKey: ['accounting', 'reconcile-bills-all', branchId, billDate],
    queryFn: () => apiClient.get<BillRow[]>(
      `/v_bills?branch_id=eq.${branchId}&bill_date=eq.${billDate}&select=id,bill_type,status,total_amount,paid_amount`
    ),
    enabled: !!branchId && !!billDate,
  });
  const allBills = counts.data ?? [];

  const typeCount = (type: string) => type ? allBills.filter(b => b.bill_type === type).length : allBills.length;
  const filteredByType = typeFilter ? allBills.filter(b => b.bill_type === typeFilter) : allBills;
  const statusCount = (status: string) => status ? filteredByType.filter(b => b.status === status).length : filteredByType.length;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Bill type chips */}
      <div className="flex-none flex border-b border-line">
        {TYPE_FILTERS.map(type => (
          <button
            key={type || '__all'}
            className={`flex-1 py-2 text-xs font-medium transition-colors cursor-pointer border-b-2 ${
              typeFilter === type
                ? 'border-primary-fg text-primary-fg'
                : 'border-transparent text-fg'
            }`}
            onClick={() => setTypeFilter(type)}
          >
            {type ? t(`accounting.bills.typeLabel.${type}`, { defaultValue: type }) : t('accounting.dayClose.billTypeAll')}
            <span className="ml-1 text-fg/40">({typeCount(type)})</span>
          </button>
        ))}
      </div>

      {/* Status chips */}
      <div className="flex-none flex flex-wrap gap-1.5 px-3 py-2 border-b border-line">
        {STATUS_FILTERS.map(status => {
          const active = statusFilter === status;
          const label = status
            ? t(`accounting.dayClose.billStatus${status.charAt(0) + status.slice(1).toLowerCase()}`)
            : t('accounting.dayClose.billStatusAll');
          return (
            <button
              key={status || '__all'}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer border ${
                active
                  ? 'bg-primary text-primary-contrast border-primary'
                  : 'border-line text-fg hover:bg-surface-hover'
              }`}
              onClick={() => setStatusFilter(status)}
            >
              {label} <span className={active ? '' : 'text-subtle'}>({statusCount(status)})</span>
            </button>
          );
        })}
      </div>

      {/* Bill rows */}
      <div className={`data-table-content better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {bills.length === 0 ? (
          <div className="p-8 text-center text-subtler text-sm">
            {t('accounting.dayClose.noBillsForDay')}
          </div>
        ) : (
          bills.map(b => (
            <BillRowItem
              key={b.id}
              bill={b}
              expanded={expandedId === b.id}
              onToggle={() => setExpandedId(expandedId === b.id ? null : b.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BillRowItem({ bill, expanded, onToggle }: { bill: BillRow; expanded: boolean; onToggle: () => void }) {
  const cancelled = bill.is_cancelled || bill.status === 'VOIDED';
  const displayStatus = cancelled ? 'VOIDED' : bill.status;
  const typeColor = TYPE_COLOR[bill.bill_type] ?? 'default';
  const statusColor = STATUS_COLOR[displayStatus] ?? 'default';

  return (
    <div className="border-b border-line">
      <div className="px-3 py-2.5 flex items-center gap-2 hover:bg-surface-hover transition-colors">
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 text-subtle cursor-pointer bg-transparent border-none p-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link
              to={`/admin/accounting/bills/${bill.id}`}
              className="font-mono text-xs font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
            >
              {bill.code_display}
              <ExternalLink size={11} />
            </Link>
            <Badge color={typeColor} size="sm">{bill.bill_type_label_short || bill.bill_type}</Badge>
            <Badge color={statusColor} size="sm">{displayStatus}</Badge>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="text-xs text-subtle truncate mt-0.5 block w-full text-left bg-transparent border-none p-0 cursor-pointer"
          >
            {bill.customer_name || bill.primary_description || '—'}
            {bill.contract_code && <span className="font-mono ml-1.5">· {bill.contract_code}</span>}
          </button>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="text-right shrink-0 text-sm tabular-nums bg-transparent border-none p-0 cursor-pointer"
        >
          {fmtCurrency(bill.total_amount)}
        </button>
      </div>

      {expanded && <BillExpand billId={bill.id} />}
    </div>
  );
}

function BillExpand({ billId }: { billId: number }) {
  const { t } = useTranslation();

  const { data: details, isLoading } = useQuery({
    queryKey: ['accounting', 'bill-detail', billId],
    queryFn: () => apiClient.get<BillDetail[]>(`/v_bill_detail?bill_id=eq.${billId}`),
  });
  const detail = details?.[0];

  if (isLoading || !detail) {
    return <div className="px-6 py-3 text-xs text-subtler">…</div>;
  }

  const lines = detail.line_items ?? [];
  const payments = detail.payments ?? [];
  const lineTotal = lines.reduce((s, l) => s + l.amount, 0);
  const payTotal = payments.reduce((s, p) => s + p.amount, 0);
  const balanced = Math.abs(lineTotal - payTotal) < 0.01;

  return (
    <div className="bg-surface/40 px-6 py-3 border-t border-line">
      {/* Line items */}
      <div className="mb-3">
        <div className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1.5">
          {t('accounting.dayClose.lineItems')} ({lines.length})
        </div>
        <div className="flex flex-col">
          {lines.map(l => (
            <div key={l.line_id} className="flex items-center gap-2 text-xs py-1">
              <Badge color={LINE_TYPE_COLOR[l.line_type] ?? 'default'} size="sm">{l.line_type}</Badge>
              <span className="flex-1 min-w-0 truncate">{l.description}</span>
              <span className="tabular-nums shrink-0">{fmtCurrency(l.amount)}</span>
              <span className={`text-[10px] shrink-0 font-medium ${l.owner_type === 'HOLDING' ? 'text-primary-fg' : 'text-warning-fg'}`}>
                {l.owner_type === 'HOLDING' ? '→H' : '→C'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Payments */}
      <div className="mb-3">
        <div className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1.5">
          {t('accounting.dayClose.payments')} ({payments.length})
        </div>
        {payments.length === 0 ? (
          <div className="text-xs text-subtler italic">{t('accounting.dayClose.noPayments')}</div>
        ) : (
          <div className="flex flex-col">
            {payments.map(p => (
              <div key={p.id} className="flex items-center gap-2 text-xs py-1">
                <Badge color={METHOD_COLOR[p.method] ?? 'default'} size="sm">{p.method}</Badge>
                <span className="flex-1 min-w-0 truncate text-subtle">
                  {p.bank_name ? `${p.bank_name} ${p.account_number ?? ''}` : p.code_display}
                </span>
                <span className="tabular-nums shrink-0">{fmtCurrency(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reconciliation strip */}
      <div className={`text-xs flex items-center gap-2 pt-2 border-t border-line ${balanced ? 'text-success' : 'text-danger'}`}>
        {balanced ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
        <span>
          {t('accounting.dayClose.charged')} <span className="font-semibold tabular-nums">{fmtCurrency(lineTotal)}</span>
          {' = '}
          {t('accounting.dayClose.paid')} <span className="font-semibold tabular-nums">{fmtCurrency(payTotal)}</span>
        </span>
        <span className="ml-auto font-medium">
          {balanced ? t('accounting.dayClose.matched') : t('accounting.dayClose.mismatch')}
        </span>
      </div>
    </div>
  );
}
