import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTable,
  Select, Badge, Button, Input, MaskedInput, Modal, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowRightFromLine, ArrowLeft, Plus, Trash2, XCircle, CheckCircle, Ban,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { type Branch } from './accountingTypes';

/* ── Types ── */

interface BillRow {
  id: number;
  code: string;
  code_display: string;
  bill_type: string;
  bill_purpose: string;
  ref_bill_id: number | null;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  contract_id: number | null;
  contract_code: string | null;
  total_amount: number;
  paid_amount: number;
  cash_amount: number;
  transfer_amount: number;
  status: string;
  bill_date: string;
  created_by: number;
  created_at: string;
  is_cancelled: boolean;
}

interface BillLineItem {
  line_id: number;
  line_type: string;
  charge_type: string;
  description: string;
  amount: number;
  quantity: number;
  owner_type: string;
  variant_id: number | null;
  ref_code: string | null;
  ref_type: string | null;
  ref_id: number | null;
}

interface BillPayment {
  id: number;
  method: string;
  amount: number;
  bank_name: string | null;
  account_number: string | null;
  code_display: string;
  created_at: string;
  created_by: number;
  created_by_name: string | null;
  is_reversal: boolean;
  reference: string | null;
}

interface BillDetail {
  bill_id: number;
  bill_code_display: string;
  bill_type: string;
  bill_purpose: string;
  branch_id: number;
  status: string;
  total_amount: number;
  paid_amount: number;
  remaining: number;
  customer_name: string | null;
  contract_code: string | null;
  contract_id: number | null;
  line_items: BillLineItem[];
  payments: BillPayment[] | null;
}

interface BankAccount {
  id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
}

type PaymentMethod = 'CASH' | 'TRANSFER';

interface PaymentLine {
  method: PaymentMethod;
  amount: number;
  bank_account_id: number | null;
}

/* ── Constants ── */

const TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'INVOICE', label: 'Invoice' },
  { value: 'CREDIT_NOTE', label: 'Credit Note' },
  { value: 'JOURNAL', label: 'Journal' },
];

const LINE_TYPE_COLOR: Record<string, 'primary' | 'success' | 'secondary' | 'info' | 'warning'> = {
  CONTRACT: 'primary',
  RETAIL: 'success',
  GIFT: 'secondary',
  SERVICE: 'info',
  JOURNAL: 'warning',
};

const METHOD_COLOR: Record<string, 'success' | 'primary' | 'secondary' | 'info'> = {
  CASH: 'success',
  TRANSFER: 'primary',
  SAVING_WALLET: 'secondary',
  CREDIT_WALLET: 'secondary',
  INSURANCE_WALLET: 'secondary',
  WAIVE: 'info',
  HOLDING_BUDGET: 'info',
};

/* ── Component ── */

export function BillsPage() {
  const { t } = useTranslation();
  const [branchId, setBranchId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selectedBillId, setSelectedBillId] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const effectiveBranchId = branchId || (branches[0]?.id ? String(branches[0].id) : '');

  // Build query params
  const params = new URLSearchParams();
  params.set('branch_id', `eq.${effectiveBranchId}`);
  params.set('order', 'created_at.desc');
  if (statusFilter) params.set('status', `eq.${statusFilter}`);
  if (typeFilter) params.set('bill_type', `eq.${typeFilter}`);

  const { data: billsData, isFetching } = useQuery({
    queryKey: ['accounting', 'bills', effectiveBranchId, statusFilter, typeFilter, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<BillRow>(
      `/v_bills?${params.toString()}`,
      { page: pageIndex + 1, pageSize }
    ),
    enabled: !!effectiveBranchId,
    placeholderData: keepPreviousData,
  });
  const bills = billsData?.data ?? [];
  const totalCount = billsData?.totalCount ?? 0;

  // Pending count for the header badge
  const { data: pendingData } = useQuery({
    queryKey: ['accounting', 'bills-pending-count', effectiveBranchId],
    queryFn: () => apiClient.get<BillRow[]>(
      `/v_bills_pending?branch_id=eq.${effectiveBranchId}&select=id`,
    ),
    enabled: !!effectiveBranchId,
  });
  const pendingCount = pendingData?.length ?? 0;

  const STATUS_TABS = ['', 'OPEN', 'PAID', 'VOIDED'] as const;

  const selectBill = (id: number, goTo?: (panel: string) => void) => {
    setSelectedBillId(id);
    goTo?.('detail');
  };

  const detailTitle = selectedBillId
    ? bills.find(b => b.id === selectedBillId)?.code_display ?? t('accounting.bills.title')
    : t('accounting.bills.title');

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label="Open menu"
                    onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                  >
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    onClick={goBack}
                  >
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('accounting.bills.title') : detailTitle}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {/* Desktop header */}
          {!isMobile && (
            <div key="header" className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('accounting.bills.title')}</h1>
              {pendingCount > 0 && (
                <Badge color="danger" size="sm">{pendingCount} {t('accounting.bills.pendingLabel')}</Badge>
              )}
              <p className="text-sm text-fg/60 truncate">{t('accounting.bills.description')}</p>
            </div>
          )}

          <div key="panels" className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* Left panel — bill list */}
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              {/* Status tabs */}
              <div className="flex-none flex border-b border-line">
                {STATUS_TABS.map(s => (
                  <button
                    key={s || '__all'}
                    className={`flex-1 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
                      statusFilter === s
                        ? 'border-primary text-primary'
                        : 'border-transparent text-fg/50 hover:text-fg/80'
                    }`}
                    onClick={() => { setStatusFilter(s); setPageIndex(0); }}
                  >
                    {t(`accounting.bills.tab_${s || 'ALL'}`)}
                    {s === 'OPEN' && pendingCount > 0 && (
                      <Badge color="danger" size="sm" className="ml-1.5">{pendingCount}</Badge>
                    )}
                  </button>
                ))}
              </div>

              {/* Branch + type filter — 50/50 */}
              <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
                <div className="flex-1 min-w-0">
                  <Select
                    value={effectiveBranchId}
                    onChange={(v) => { setBranchId(v as string); setPageIndex(0); }}
                    placeholder={t('accounting.branch')}
                    options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
                    size="sm"
                    showChevron
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <Select
                    value={typeFilter}
                    onChange={(v) => { setTypeFilter(v as string); setPageIndex(0); }}
                    options={TYPE_OPTIONS}
                    size="sm"
                    showChevron
                    placeholder={t('accounting.bills.type')}
                  />
                </div>
              </div>

              {/* Bill list */}
              <DataTable<BillRow>
                data={bills}
                renderRow={(row) => {
                  const b = row.original;
                  const isSelected = selectedBillId === b.id;
                  const statusColor = b.status === 'PAID' ? 'success' : b.status === 'OPEN' ? 'danger' : b.status === 'PARTIAL' ? 'warning' : 'default';
                  const typeColor = b.bill_type === 'INVOICE' ? 'primary' : b.bill_type === 'CREDIT_NOTE' ? 'danger' : 'warning';
                  return (
                    <button
                      key={b.id}
                      className={`w-full text-left px-4 py-3 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => selectBill(b.id, isMobile ? goTo : undefined)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-mono text-sm font-medium">{b.code_display}</span>
                          <Badge color={typeColor} size="sm">{b.bill_type}</Badge>
                          <Badge color={statusColor} size="sm">{b.status}</Badge>
                        </div>
                        <div className="text-xs text-fg/60 flex items-center gap-1.5">
                          <span>{b.bill_purpose.replace(/_/g, ' ')}</span>
                          {b.customer_name && <span>· {b.customer_name}</span>}
                          {b.contract_code && <span className="font-mono">· {b.contract_code}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium tabular-nums">{fmtCurrency(b.total_amount)}</div>
                        <div className="text-xs text-fg/50"><DateTime value={b.bill_date} showTime={false} /></div>
                      </div>
                    </button>
                  );
                }}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[10, 25, 50]}
                rowCount={totalCount}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={<div className="p-8 text-center text-subtler">{t('accounting.empty')}</div>}
              />
            </PageNavPanel>

            {/* Right panel — bill detail */}
            <PageNavPanel id="detail" className="flex-1 overflow-y-auto better-scroll">
              {!selectedBillId && (
                <div className="flex-1 h-full flex items-center justify-center text-subtler p-8">
                  {t('accounting.bills.selectToView')}
                </div>
              )}
              {selectedBillId && (
                <BillDetailPanel
                  billId={selectedBillId}
                  onBillChanged={() => {
                    queryClient.invalidateQueries({ queryKey: ['accounting'] });
                    addSnackbar({
                      message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('accounting.bills.actionSuccess')}</span></div>,
                      type: 'success',
                    });
                  }}
                />
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}

/* ── Detail Panel ── */

const PAYMENT_METHOD_OPTIONS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'TRANSFER', label: 'Bank Transfer' },
];

function BillDetailPanel({ billId, onBillChanged }: { billId: number; onBillChanged: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Detail query
  const { data: details, isLoading } = useQuery({
    queryKey: ['accounting', 'bill-detail', billId],
    queryFn: () => apiClient.get<BillDetail[]>(`/v_bill_detail?bill_id=eq.${billId}`),
  });

  // Bank accounts for transfer
  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts-active'],
    queryFn: () => apiClient.get<BankAccount[]>('/v_bank_accounts?is_active=is.true&order=bank_name'),
    staleTime: 5 * 60 * 1000,
  });
  const bankOptions = (bankAccounts ?? []).map(b => ({
    value: String(b.id),
    label: `${b.bank_name} - ${b.account_number} (${b.account_name})`,
  }));

  // Pay state
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');

  // Void state
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidPin, setVoidPin] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState('');

  const detail = details?.[0];

  // Reset payment lines when bill changes
  const remaining = detail?.remaining ?? 0;
  const isOpen = detail?.status === 'OPEN' || detail?.status === 'PARTIAL';

  // Init payment lines when detail loads and bill is open
  if (payments.length === 0 && remaining > 0 && isOpen) {
    setPayments([{ method: 'CASH', amount: remaining, bank_account_id: null }]);
  }

  if (isLoading) return <div className="p-6 text-sm text-subtler">{t('common.loading')}</div>;
  if (!detail) return <div className="p-6 text-sm text-subtler">—</div>;

  const lines = detail.line_items ?? [];
  const existingPayments = detail.payments ?? [];
  const lineTotal = lines.reduce((s, l) => s + l.amount, 0);
  const existingPayTotal = existingPayments.reduce((s, p) => s + p.amount, 0);
  const balanced = Math.abs(lineTotal - existingPayTotal) < 0.01;
  const statusColor = detail.status === 'PAID' ? 'success' : detail.status === 'OPEN' ? 'danger' : detail.status === 'VOIDED' ? 'default' : 'warning';

  // Payment form helpers
  const totalPayment = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const isPayBalanced = Math.abs(totalPayment - remaining) < 0.01;

  const addPaymentLine = () => {
    const rem = remaining - totalPayment;
    setPayments(prev => [...prev, { method: 'CASH', amount: rem > 0 ? rem : 0, bank_account_id: null }]);
  };
  const removePaymentLine = (idx: number) => {
    setPayments(prev => prev.filter((_, i) => i !== idx));
  };
  const updatePayment = (idx: number, updates: Partial<PaymentLine>) => {
    setPayments(prev => prev.map((p, i) => i === idx ? { ...p, ...updates } : p));
  };

  const handlePay = async () => {
    if (!isPayBalanced) return;
    setPaying(true);
    setPayError('');
    try {
      for (const payment of payments) {
        await apiClient.rpc('fn_bill_payment_add', {
          p_bill_id: billId,
          p_method: payment.method,
          p_amount: payment.amount,
          p_bank_account_id: payment.method === 'TRANSFER' ? payment.bank_account_id : null,
        });
      }
      const confirmParams: Record<string, unknown> = { p_bill_id: billId };
      if (detail.contract_id) confirmParams.p_contract_id = detail.contract_id;
      await apiClient.rpc('fn_bill_payment_confirm', confirmParams);
      setPayments([]);
      queryClient.invalidateQueries({ queryKey: ['accounting', 'bill-detail', billId] });
      onBillChanged();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setPayError(translated || err.message);
      } else {
        setPayError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPaying(false);
    }
  };

  const handleVoid = async () => {
    if (!voidReason.trim() || !voidPin) return;
    setVoiding(true);
    setVoidError('');
    try {
      await apiClient.rpc('fn_bill_cancel', {
        p_bill_id: billId,
        p_reason: voidReason.trim(),
        p_pin: voidPin,
        p_branch_id: detail.branch_id,
      });
      setVoidOpen(false);
      setVoidReason('');
      setVoidPin('');
      queryClient.invalidateQueries({ queryKey: ['accounting', 'bill-detail', billId] });
      onBillChanged();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setVoidError(translated || err.message);
      } else {
        setVoidError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setVoiding(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <h2 className="heading-3 font-mono">{detail.bill_code_display}</h2>
        <Badge color={statusColor} size="sm">{detail.status}</Badge>
      </div>
      <div className="text-sm text-fg/60 mb-6 flex items-center gap-2 flex-wrap">
        <span>{detail.bill_type} · {detail.bill_purpose.replace(/_/g, ' ')}</span>
        {detail.customer_name && <span>· {detail.customer_name}</span>}
        {detail.contract_code && <span className="font-mono">· {detail.contract_code}</span>}
      </div>

      {/* Summary stats */}
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label={t('accounting.bills.totalCharged')} value={fmtCurrency(detail.total_amount)} />
        <Stat label={t('accounting.bills.totalPaid')} value={fmtCurrency(detail.paid_amount)} />
        <Stat
          label={t('accounting.bills.remaining')}
          value={fmtCurrency(detail.remaining)}
          tone={detail.remaining > 0 ? 'danger' : undefined}
        />
      </dl>

      {/* Two columns: line items + payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Line Items */}
        <div>
          <div className="text-xs font-semibold text-fg/60 uppercase mb-3">
            {t('accounting.bills.lineItems')} ({lines.length})
          </div>
          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.line_id} className="flex items-center gap-2 text-sm">
                <Badge color={LINE_TYPE_COLOR[line.line_type] ?? 'default'} size="sm">
                  {line.line_type}
                </Badge>
                <span className="flex-1 min-w-0 truncate">{line.description}</span>
                <span className="tabular-nums font-medium shrink-0">
                  {fmtCurrency(line.amount)}
                </span>
                <span className={`text-xs shrink-0 font-medium ${line.owner_type === 'HOLDING' ? 'text-primary' : 'text-warning'}`}>
                  {line.owner_type === 'HOLDING' ? '→H' : '→C'}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-line text-sm font-semibold flex justify-between">
            <span>{t('accounting.bills.totalCharged')}</span>
            <span className="tabular-nums">{fmtCurrency(lineTotal)}</span>
          </div>
        </div>

        {/* Right: Payments */}
        <div>
          <div className="text-xs font-semibold text-fg/60 uppercase mb-3">
            {t('accounting.bills.payments')} ({existingPayments.length})
          </div>
          {existingPayments.length === 0 ? (
            <div className="text-sm text-fg/40 italic">{t('accounting.bills.noPayments')}</div>
          ) : (
            <div className="space-y-2">
              {existingPayments.map((pay) => (
                <div key={pay.id} className="flex items-center gap-2 text-sm">
                  <Badge color={METHOD_COLOR[pay.method] ?? 'default'} size="sm">
                    {pay.method}
                  </Badge>
                  <span className="flex-1 min-w-0 truncate text-fg/60">
                    {pay.bank_name ? `${pay.bank_name} ${pay.account_number ?? ''}` : pay.code_display}
                  </span>
                  <span className="tabular-nums font-medium shrink-0">
                    {fmtCurrency(pay.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-line text-sm font-semibold flex justify-between">
            <span>{t('accounting.bills.totalPaid')}</span>
            <span className="tabular-nums">{fmtCurrency(existingPayTotal)}</span>
          </div>
        </div>
      </div>

      {/* Reconciliation check */}
      <div className={`mt-4 pt-4 border-t border-line text-sm font-medium ${balanced ? 'text-success' : 'text-danger'}`}>
        {t('accounting.bills.charged')} {fmtCurrency(lineTotal)} = {t('accounting.bills.paid')} {fmtCurrency(existingPayTotal)}{' '}
        {balanced ? '✅' : '❌'}
      </div>

      {/* ── Actions for OPEN/PARTIAL bills ── */}
      {isOpen && (
        <div className="mt-6 pt-6 border-t border-line">
          {/* Pay form */}
          <h3 className="text-base font-semibold mb-3">{t('accounting.bills.payTitle')}</h3>

          {payError && (
            <div className="alert alert-danger mb-4">
              <XCircle size={18} />
              <div><div className="alert-description">{payError}</div></div>
            </div>
          )}

          <div className="flex flex-col gap-3 mb-4">
            {payments.map((payment, idx) => (
              <div key={idx} className="border border-line rounded-lg p-3 flex flex-col gap-3">
                <div className="flex gap-3 items-end">
                  <div className="flex flex-col" style={{ width: '10rem' }}>
                    <label className="form-label text-xs">{t('accounting.bills.method')}</label>
                    <Select
                      options={PAYMENT_METHOD_OPTIONS}
                      value={payment.method}
                      onChange={(val) => updatePayment(idx, { method: val as PaymentMethod, bank_account_id: null })}
                      size="sm"
                    />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <label className="form-label text-xs">{t('accounting.bills.amount')}</label>
                    <MaskedInput
                      mask="number"
                      decimalScale={2}
                      value={String(payment.amount || '')}
                      onChange={(raw) => updatePayment(idx, { amount: parseFloat(raw) || 0 })}
                      size="sm"
                      className="w-full"
                    />
                  </div>
                  {payments.length > 1 && (
                    <Button size="sm" variant="outline" startIcon={<Trash2 size={14} />} onClick={() => removePaymentLine(idx)} />
                  )}
                </div>
                {payment.method === 'TRANSFER' && (
                  <div className="flex flex-col">
                    <label className="form-label text-xs">{t('accounting.bills.bankAccount')}</label>
                    <Select
                      options={bankOptions}
                      value={payment.bank_account_id ? String(payment.bank_account_id) : null}
                      onChange={(val) => updatePayment(idx, { bank_account_id: val ? Number(val) : null })}
                      placeholder={t('accounting.bills.selectBank')}
                      size="sm"
                      showChevron
                      searchable
                    />
                  </div>
                )}
              </div>
            ))}

            <Button size="sm" variant="outline" onClick={addPaymentLine} startIcon={<Plus size={14} />}>
              {t('accounting.bills.addPayment')}
            </Button>
          </div>

          {/* Total check */}
          <div className={`flex justify-between items-center p-3 rounded-lg border mb-4 ${
            isPayBalanced ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
          }`}>
            <span className="text-sm">{t('accounting.bills.payTotal')}</span>
            <span className={`font-semibold tabular-nums ${isPayBalanced ? 'text-success' : 'text-warning'}`}>
              {fmtCurrency(totalPayment)} / {fmtCurrency(remaining)}
            </span>
          </div>

          <div className="flex items-center gap-3 justify-end">
            <Button
              color="primary"
              onClick={handlePay}
              disabled={!isPayBalanced || paying}
              startIcon={<CheckCircle size={16} />}
            >
              {paying ? t('common.loading') : t('accounting.bills.confirmPay')}
            </Button>

            <Button
              color="danger"
              variant="outline"
              onClick={() => { setVoidOpen(true); setVoidError(''); setVoidReason(''); setVoidPin(''); }}
              startIcon={<Ban size={16} />}
            >
              {t('accounting.bills.voidBill')}
            </Button>
          </div>
        </div>
      )}

      {/* ── Void Modal ── */}
      <Modal open={voidOpen} onClose={() => !voiding && setVoidOpen(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('accounting.bills.voidBill')}</h2></div>
        <div className="modal-content">
          <div className="form-grid">
            {voidError && (
              <div className="alert alert-danger">
                <XCircle size={18} />
                <div><div className="alert-description">{voidError}</div></div>
              </div>
            )}
            <div className="flex flex-col">
              <label className="form-label">{t('accounting.bills.voidReason')} *</label>
              <Input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder={t('accounting.bills.voidReasonPlaceholder')}
                className="w-full"
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('accounting.bills.pin')} *</label>
              <Input
                type="password"
                value={voidPin}
                onChange={(e) => setVoidPin(e.target.value)}
                placeholder="••••••"
                maxLength={6}
                className="w-full"
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={() => setVoidOpen(false)} disabled={voiding}>{t('common.cancel')}</Button>
          <Button
            color="danger"
            onClick={handleVoid}
            disabled={!voidReason.trim() || !voidPin || voiding}
          >
            {voiding ? t('common.loading') : t('accounting.bills.confirmVoid')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'danger' | 'warning' }) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : '';
  return (
    <div>
      <dt className="text-xs text-fg/60">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}
