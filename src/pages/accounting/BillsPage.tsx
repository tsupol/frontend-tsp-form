import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTable, PopOver, Tooltip,
  Select, Badge, Button, Input, MaskedInput, Modal, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowRightFromLine, ArrowLeft, Plus, Trash2, XCircle, CheckCircle, Ban, Printer,
  Wrench, ChevronDown, Copy,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { BranchPinInput } from '../../components/BranchPinInput';
import { fmtCurrency } from '../../lib/format';
import { buildBillActionToast, hasBill, type StandardBillResponse } from '../../lib/billActionToast';
import { type Branch, type BillRow, type BillDetail } from './accountingTypes';
import { useBillActions, type BillAction, type BillActionCode } from '../../hooks/useBillActions';
import { BillReceipt } from '../contracts/workspace/BillReceipt';

/* ── Types ── */

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
  const navigate = useNavigate();
  const { billId: billIdParam } = useParams<{ billId?: string }>();
  const selectedBillId = billIdParam ? Number(billIdParam) : null;

  const setSelectedBillId = useCallback((id: number | null) => {
    if (id) navigate(`/admin/accounting/bills/${id}`, { replace: true });
    else navigate('/admin/accounting/bills', { replace: true });
  }, [navigate]);

  const [branchId, setBranchId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  // Build query params
  const params = new URLSearchParams();
  if (branchId) params.set('branch_id', `eq.${branchId}`);
  params.set('order', 'created_at.desc');
  if (statusFilter) params.set('status', `eq.${statusFilter}`);
  if (typeFilter) params.set('bill_type', `eq.${typeFilter}`);

  const { data: billsData, isFetching } = useQuery({
    queryKey: ['accounting', 'bills', branchId, statusFilter, typeFilter, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<BillRow>(
      `/v_bills?${params.toString()}`,
      { page: pageIndex + 1, pageSize }
    ),
    placeholderData: keepPreviousData,
  });
  const bills = billsData?.data ?? [];
  const totalCount = billsData?.totalCount ?? 0;

  // Pending count for the header badge
  const { data: pendingData } = useQuery({
    queryKey: ['accounting', 'bills-pending-count', branchId],
    queryFn: () => apiClient.get<BillRow[]>(
      `/v_bills_pending?${branchId ? `branch_id=eq.${branchId}&` : ''}select=id`,
    ),
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
    <PageNav panels={['list', 'detail']} defaultPanel={selectedBillId ? 'detail' : undefined} className="h-dvh">
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
              <p className="text-sm text-subtle truncate">{t('accounting.bills.description')}</p>
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
                        ? 'border-primary-fg text-primary-fg'
                        : 'border-transparent text-fg'
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
              <div className="flex-none flex items-center p-2 border-b border-line gap-2">
                <div className="flex-1 min-w-0">
                  <Select
                    value={branchId || null}
                    onChange={(v) => { setBranchId((v as string) ?? ''); setPageIndex(0); }}
                    placeholder={t('accounting.branch')}
                    options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <Select
                    value={typeFilter || null}
                    onChange={(v) => { setTypeFilter((v as string) ?? ''); setPageIndex(0); }}
                    options={TYPE_OPTIONS}
                    size="sm"
                    showChevron
                    placeholder={t('accounting.bills.type')}
                    clearable
                  />
                </div>
              </div>

              {/* Bill list */}
              <DataTable<BillRow>
                data={bills}
                renderRow={(row) => {
                  const b = row.original;
                  const isSelected = selectedBillId === b.id;
                  const cancelled = b.is_cancelled || b.status === 'VOIDED';
                  const statusColor = cancelled
                    ? 'default'
                    : b.status === 'PAID' ? 'success' : b.status === 'OPEN' ? 'danger' : b.status === 'PARTIAL' ? 'warning' : 'default';
                  const typeColor = b.bill_type === 'INVOICE' ? 'primary' : b.bill_type === 'CREDIT_NOTE' ? 'danger' : 'warning';
                  return (
                    <button
                      key={b.id}
                      className={`w-full text-left px-4 py-3 border-b border-line flex flex-col gap-1 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => selectBill(b.id, isMobile ? goTo : undefined)}
                    >
                      {/* Line 1: code + badges ............... amount */}
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-sm font-medium truncate">{b.code_display}</span>
                        <Badge color={typeColor} size="sm">{b.bill_type}</Badge>
                        <Badge color={statusColor} size="sm">{cancelled ? 'VOIDED' : b.status}</Badge>
                        <span className="ml-auto text-sm font-medium tabular-nums shrink-0">{fmtCurrency(b.total_amount)}</span>
                      </div>
                      {/* Line 2: purpose · customer · contract ........... date */}
                      <div className="flex items-center gap-1.5 text-xs text-subtle min-w-0">
                        <span className="truncate">
                          <span className="text-primary-fg">
                            {t(`accounting.bills.purposeLabel.${b.bill_purpose}`, { defaultValue: b.bill_purpose.replace(/_/g, ' ') })}
                          </span>
                          {b.customer_name && <> · <span className="text-fg">{b.customer_name}</span></>}
                          {b.contract_code && <> · <span className="font-mono">{b.contract_code}</span></>}
                        </span>
                        <span className="ml-auto text-fg/50 shrink-0"><DateTime value={b.bill_date} showTime={false} /></span>
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

            {/* Right panel — bill detail (flex column so detail's footer can be flex-none sticky) */}
            <PageNavPanel id="detail" className="flex-1 min-h-0 flex flex-col">
              {!selectedBillId && (
                <div className="flex-1 h-full flex items-center justify-center text-subtler p-8">
                  {t('accounting.bills.selectToView')}
                </div>
              )}
              {selectedBillId && (
                <BillDetailPanel
                  billId={selectedBillId}
                  onBillChanged={(message) => {
                    queryClient.invalidateQueries({ queryKey: ['accounting'] });
                    addSnackbar({
                      message: message ?? <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('accounting.bills.actionSuccess')}</span></div>,
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

function BillDetailPanel({ billId, onBillChanged }: { billId: number; onBillChanged: (message?: ReactNode) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  // Detail query
  const { data: details, isLoading } = useQuery({
    queryKey: ['accounting', 'bill-detail', billId],
    queryFn: () => apiClient.get<BillDetail[]>(`/v_bill_detail?bill_id=eq.${billId}`),
  });

  // Available actions (drives button visibility — replaces local isOpen heuristic)
  const { isAvailable: isActionAvailable, data: actionsData } = useBillActions(billId);
  const allActions = actionsData?.actions ?? [];

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

  // Print: render receipt off-screen in this page and call window.print().
  // No modal — tsp-form Modal portals into a fixed/overflow-hidden container
  // that doesn't translate to the @page box, so the receipt gets clipped.
  const [printReady, setPrintReady] = useState(false);
  const handlePrint = useCallback(async () => {
    // Warm both queries the receipt depends on before mounting it, so the
    // printable content is already painted when we open the print dialog.
    try {
      const billRows = await queryClient.fetchQuery({
        queryKey: ['bill-detail', billId],
        queryFn: () => apiClient.get<BillDetail[]>(`/v_bill_detail?bill_id=eq.${billId}`).then(rows => rows[0] ?? null),
      });
      const branchId = (billRows as BillDetail | null)?.branch_id;
      if (branchId != null) {
        await queryClient.fetchQuery({
          queryKey: ['branch-info', branchId],
          queryFn: () => apiClient.get(`/v_branches?id=eq.${branchId}&select=id,name,address`).then((rows: unknown) => (rows as unknown[])[0] ?? null),
        });
      }
    } catch {
      // Fall through — receipt will show its loading state and still print empty if data fails.
    }
    setPrintReady(true);
    // Two RAFs to let React commit + browser paint, then open the print dialog.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.print();
      setPrintReady(false);
    }));
  }, [billId, queryClient]);

  const copyBillCode = useCallback((code: string) => {
    navigator.clipboard?.writeText(code).then(
      () => addSnackbar({ message: t('common.copied', { defaultValue: 'Copied' }) }),
      () => {},
    );
  }, [addSnackbar, t]);

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
  const isCancelled = detail.is_voided || detail.status === 'VOIDED';
  const displayStatus = isCancelled ? 'VOIDED' : detail.status;
  const statusColor = isCancelled
    ? 'default'
    : detail.status === 'PAID' ? 'success' : detail.status === 'OPEN' ? 'danger' : 'warning';

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
      queryClient.invalidateQueries({ queryKey: ['bill-actions', billId] });
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
      const result = await apiClient.rpc<Partial<StandardBillResponse>>('fn_bill_cancel', {
        p_bill_id: billId,
        p_reason: voidReason.trim(),
        p_pin: voidPin,
        p_branch_id: detail.branch_id,
      });
      setVoidOpen(false);
      setVoidReason('');
      setVoidPin('');
      queryClient.invalidateQueries({ queryKey: ['accounting', 'bill-detail', billId] });
      queryClient.invalidateQueries({ queryKey: ['bill-actions', billId] });
      // If a CREDIT_NOTE was minted (cancelling a PAID bill), surface its code in the toast.
      const enriched = hasBill(result) && result.bill_type === 'CREDIT_NOTE'
        ? buildBillActionToast(result, t)
        : undefined;
      onBillChanged(enriched);
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

  // BE evaluator currently still reports VOID_BILL/REVERSE_BILL as available on already-cancelled
  // bills (it doesn't check is_voided). Gate FE-side defensively to avoid double-cancel attempts.
  // Used by BillActionBar to suppress lifecycle actions on already-voided bills.
  const suppressLifecycle = isCancelled;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Desktop header strip — code + status badge + secondary meta */}
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        <span className="font-semibold font-mono">{detail.bill_code_display}</span>
        <button
          type="button"
          className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer text-subtle hover:text-fg"
          onClick={() => copyBillCode(detail.bill_code_display)}
          aria-label={t('common.copy', { defaultValue: 'Copy' })}
          title={t('common.copy', { defaultValue: 'Copy' })}
        >
          <Copy size={14} />
        </button>
        <Badge color={statusColor} size="sm">{displayStatus}</Badge>
        <span className="text-xs text-subtle">
          {t(`accounting.bills.typeLabel.${detail.bill_type}`, { defaultValue: detail.bill_type })}
          {' · '}
          {t(`accounting.bills.purposeLabel.${detail.bill_purpose}`, { defaultValue: detail.bill_purpose.replace(/_/g, ' ') })}
        </span>
      </div>

      {/* Cancellation banner — visible when bill is voided */}
      {isCancelled && detail.cancel_info && (
        <div className="flex-none px-4 py-2 border-b border-line bg-fg/5">
          <div className="text-xs text-subtle flex items-center gap-2 flex-wrap">
            <Ban size={12} />
            <span>{t('accounting.bills.voidedAt', { defaultValue: 'Voided at' })}:</span>
            <DateTime value={detail.cancel_info.cancelled_at} showTime />
            <span>·</span>
            <span>{t('accounting.bills.creditNote', { defaultValue: 'Credit note' })}:</span>
            <span className="font-mono">{detail.cancel_info.credit_note_code}</span>
          </div>
        </div>
      )}
      {isCancelled && !detail.cancel_info && detail.ref_bill_id && (
        <div className="flex-none px-4 py-2 border-b border-line bg-fg/5">
          <div className="text-xs text-subtle flex items-center gap-2 flex-wrap">
            <Ban size={12} />
            <span>{t('accounting.bills.linkedTo', { defaultValue: 'Linked to' })}:</span>
            <span className="font-mono">{detail.ref_bill_code ?? `#${detail.ref_bill_id}`}</span>
          </div>
        </div>
      )}

      {/* Customer / contract info block */}
      {(detail.customer_name || detail.contract_code) && (
        <div className="flex-none px-4 py-3 border-b border-line bg-surface">
          {detail.customer_name && (
            <div className="font-semibold text-sm">{detail.customer_name}</div>
          )}
          {detail.contract_code && (
            <div className="text-xs font-mono text-subtle mt-0.5">{detail.contract_code}</div>
          )}
        </div>
      )}

      {/* Financial summary — 3-col key/value grid */}
      <div className="flex-none grid grid-cols-3 gap-3 px-4 py-3 border-b border-line">
        <div>
          <div className="text-xs text-subtle">{t('accounting.bills.totalCharged')}</div>
          <div className="font-semibold text-sm tabular-nums">{fmtCurrency(detail.total_amount)}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('accounting.bills.totalPaid')}</div>
          <div className="font-semibold text-sm tabular-nums">{fmtCurrency(detail.paid_amount)}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('accounting.bills.remaining')}</div>
          <div className={`font-semibold text-sm tabular-nums ${detail.remaining > 0 ? 'text-danger' : ''}`}>
            {fmtCurrency(detail.remaining)}
          </div>
        </div>
      </div>

      {/* Reconciliation strip */}
      <div className={`flex-none px-4 py-2 border-b border-line text-xs ${balanced ? 'text-success' : 'text-danger'}`}>
        {t('accounting.bills.charged')} {fmtCurrency(lineTotal)} ={' '}
        {t('accounting.bills.paid')} {fmtCurrency(existingPayTotal)}{' '}
        {balanced ? '✅' : '❌'}
      </div>

      {/* Scrollable content — line items, payments, pay form */}
      <div className="flex-1 overflow-auto better-scroll p-4 flex flex-col gap-5">
        {/* Line items */}
        <div>
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
            {t('accounting.bills.lineItems')} ({lines.length})
          </h3>
          <div className="flex flex-col">
            {lines.map((line) => (
              <div key={line.line_id} className="flex items-center gap-2 text-sm py-1.5 border-b border-line last:border-b-0">
                <Badge color={LINE_TYPE_COLOR[line.line_type] ?? 'default'} size="sm">
                  {line.line_type}
                </Badge>
                <span className="flex-1 min-w-0 truncate">{line.description}</span>
                <span className="tabular-nums font-medium shrink-0">
                  {fmtCurrency(line.amount)}
                </span>
                <span className={`text-xs shrink-0 font-medium ${line.owner_type === 'HOLDING' ? 'text-primary-fg' : 'text-warning-fg'}`}>
                  {line.owner_type === 'HOLDING' ? '→H' : '→C'}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-line text-sm font-semibold flex justify-between">
            <span>{t('accounting.bills.totalCharged')}</span>
            <span className="tabular-nums">{fmtCurrency(lineTotal)}</span>
          </div>
        </div>

        {/* Payments */}
        <div>
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
            {t('accounting.bills.payments')} ({existingPayments.length})
          </h3>
          {existingPayments.length === 0 ? (
            <div className="text-sm text-subtler italic">{t('accounting.bills.noPayments')}</div>
          ) : (
            <div className="flex flex-col">
              {existingPayments.map((pay) => (
                <div key={pay.id} className="flex items-center gap-2 text-sm py-1.5 border-b border-line last:border-b-0">
                  <Badge color={METHOD_COLOR[pay.method] ?? 'default'} size="sm">
                    {pay.method}
                  </Badge>
                  <span className="flex-1 min-w-0 truncate text-subtle">
                    {pay.bank_name ? `${pay.bank_name} ${pay.account_number ?? ''}` : pay.code_display}
                  </span>
                  <span className="tabular-nums font-medium shrink-0">
                    {fmtCurrency(pay.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {existingPayments.length > 0 && (
            <div className="mt-2 pt-2 border-t border-line text-sm font-semibold flex justify-between">
              <span>{t('accounting.bills.totalPaid')}</span>
              <span className="tabular-nums">{fmtCurrency(existingPayTotal)}</span>
            </div>
          )}
        </div>

      {/* ── Pay form (when BE says payment can be added) ── */}
      {isActionAvailable('ADD_PAYMENT') && (
        <div className="mt-6 pt-6 border-t border-line">
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
            <span className={`font-semibold tabular-nums ${isPayBalanced ? 'text-success' : 'text-warning-fg'}`}>
              {fmtCurrency(totalPayment)} / {fmtCurrency(remaining)}
            </span>
          </div>

          <div className="flex items-center gap-3 justify-end">
            <Button
              color="primary"
              onClick={handlePay}
              disabled={!isPayBalanced || paying || !isActionAvailable('CONFIRM_PAYMENT')}
              startIcon={<CheckCircle size={16} />}
            >
              {paying ? t('common.loading') : t('accounting.bills.confirmPay')}
            </Button>
          </div>
        </div>
      )}

      </div>{/* /scroll content */}

      {/* ── Sticky BE-driven action footer (PAYMENT/LINE/APPROVAL/LIFECYCLE + Print) ── */}
      <BillActionBar
        actions={allActions}
        suppressLifecycle={suppressLifecycle}
        onPrint={handlePrint}
        onVoidOrCancel={() => { setVoidOpen(true); setVoidError(''); setVoidReason(''); setVoidPin(''); }}
      />

      {/* ── Print render — portaled into body so no panel ancestor becomes the
           positioning context for .bill-receipt (the print rule sets it to
           position:absolute and expects the page as its containing block).
           Hidden on screen via .print-only-receipt rule in app.css. */}
      {printReady && createPortal(
        <div className="print-only-receipt" aria-hidden>
          <BillReceipt billId={billId} hidePrintButton />
        </div>,
        document.body,
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
            <BranchPinInput value={voidPin} onChange={setVoidPin} label={t('accounting.bills.pin')} required />
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

/* ── Action Bar ─────────────────────────────────────────────────────────────
   Mirrors AssetActionBar: BE-driven primary buttons + grouped-secondary
   PopOver. Print is a permanent FE-only entry slotted under a synthetic
   PRINT category. Wired actions today: VOID_BILL, CANCEL_BILL (open the
   void modal). Everything else gets the "not yet wired" Wrench icon and
   tooltip — capability is visible, behaviour is clearly TODO. */

const BILL_CATEGORY_ORDER = ['PAYMENT', 'LINE', 'APPROVAL', 'LIFECYCLE', 'PRINT'];

// Per-status: which actions get rendered as primary buttons (first row).
// The rest collapse under "More". Empty array → everything goes under More.
const PRIMARY_BY_STATUS: Record<string, BillActionCode[]> = {
  OPEN: ['CANCEL_BILL'],
  PARTIAL: ['CANCEL_BILL'],
  PAID: ['VOID_BILL', 'REVERSE_BILL'],
  VOIDED: [],
};

// Action codes that are actually wired in this page right now.
// Anything else listed by the BE renders disabled with a Wrench tooltip.
const WIRED_ACTIONS: ReadonlySet<BillActionCode> = new Set<BillActionCode>([
  'CANCEL_BILL',
  'VOID_BILL',
]);

interface BillActionBarProps {
  actions: BillAction[];
  suppressLifecycle: boolean;
  onPrint: () => void;
  onVoidOrCancel: () => void;
}

function BillActionBar({ actions, suppressLifecycle, onPrint, onVoidOrCancel }: BillActionBarProps) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  // Filter BE actions: hide permission_denied (don't tease the user with things
  // they can't do at all), and suppress LIFECYCLE on already-voided bills.
  const visibleBeActions = actions
    .filter(a => a.blocking_reason !== 'permission_denied')
    .filter(a => !(suppressLifecycle && a.category === 'LIFECYCLE'))
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  // Synthetic PRINT entry — not from BE, always available.
  const printAction: BillAction & { __synthetic: true } = {
    action_code: 'PRINT' as BillActionCode,
    category: 'PRINT' as never, // synthetic category
    rpc_name: '',
    is_available: true,
    blocking_reason: null,
    require_pin: false,
    creates_credit_note: false,
    target_status: null,
    sort_order: 999,
    __synthetic: true,
  };

  const allEntries: BillAction[] = [...visibleBeActions, printAction];

  // Determine current status from actions (if any action's required_statuses
  // didn't match → we're not in that state). Easier: use the first available
  // LIFECYCLE-category action's predicate. Actually simplest: derive from the
  // BE response's is_available across known status-keyed actions. We just need
  // a key into PRIMARY_BY_STATUS — fall back to OPEN if we can't tell.
  const inferredStatus =
    actions.find(a => a.action_code === 'CONFIRM_PAYMENT' && a.is_available) ? 'PARTIAL'
    : actions.find(a => a.action_code === 'VOID_BILL' && a.is_available) ? 'PAID'
    : actions.find(a => a.action_code === 'CANCEL_BILL' && a.is_available) ? 'OPEN'
    : 'VOIDED';

  const primaryCodes = new Set<string>(['PRINT', ...(PRIMARY_BY_STATUS[inferredStatus] ?? [])]);
  const primaryActions = allEntries.filter(a => primaryCodes.has(a.action_code));
  const secondaryActions = allEntries.filter(a => !primaryCodes.has(a.action_code));

  const groupedSecondary = secondaryActions.reduce<Record<string, BillAction[]>>((acc, a) => {
    (acc[a.category] ||= []).push(a);
    return acc;
  }, {});
  const sortedCategories = Object.keys(groupedSecondary).sort((a, b) => {
    const ai = BILL_CATEGORY_ORDER.indexOf(a);
    const bi = BILL_CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  if (allEntries.length === 0) return null;

  const handleClick = (a: BillAction) => {
    setMoreOpen(false);
    if (a.action_code === ('PRINT' as BillActionCode)) {
      onPrint();
      return;
    }
    if (a.action_code === 'VOID_BILL' || a.action_code === 'CANCEL_BILL') {
      onVoidOrCancel();
      return;
    }
    // Other actions: not wired yet — buttons are disabled, this never fires.
  };

  const renderActionButton = (a: BillAction, primary = false) => {
    const isSynthetic = a.action_code === ('PRINT' as BillActionCode);
    const wired = isSynthetic || WIRED_ACTIONS.has(a.action_code);
    const label = t(`accounting.bills.actionLabel.${a.action_code}`, {
      defaultValue: a.action_code,
    });

    let endIcon: React.ReactNode = undefined;
    const lines: string[] = [label];
    if (!wired) {
      endIcon = <Wrench size={12} />;
      lines.push(t('accounting.bills.notWired'));
    }
    if (!a.is_available && a.blocking_reason) {
      lines.push(t(`blockingReason.${a.blocking_reason}`, { ns: 'apiErrors', defaultValue: a.blocking_reason }));
    }

    const tooltipContent: React.ReactNode = lines.length === 1
      ? lines[0]
      : (
        <div className="flex flex-col gap-0.5">
          {lines.map((line, i) => (
            <div key={i} className={i === 0 ? 'font-medium' : 'text-xs opacity-90'}>{line}</div>
          ))}
        </div>
      );

    // Color: lifecycle danger actions render danger; print is plain.
    const isDanger = a.action_code === 'VOID_BILL' || a.action_code === 'CANCEL_BILL' || a.action_code === 'REVERSE_BILL';
    const isPrint = isSynthetic;
    const startIcon = isPrint ? <Printer size={14} /> : isDanger ? <Ban size={14} /> : undefined;

    return (
      <Tooltip key={a.action_code} content={tooltipContent} placement="top">
        <Button
          variant={primary && !isDanger ? undefined : 'outline'}
          size="sm"
          color={isDanger ? 'danger' : undefined}
          disabled={!a.is_available || !wired}
          startIcon={startIcon}
          endIcon={endIcon}
          onClick={() => handleClick(a)}
        >
          {label}
        </Button>
      </Tooltip>
    );
  };

  return (
    <div className="flex-none px-4 py-3 border-t border-line flex flex-wrap items-center gap-2">
      {primaryActions.map(a => renderActionButton(a, true))}
      {secondaryActions.length > 0 && (
        <Button
          ref={moreTriggerRef}
          variant="outline"
          size="sm"
          endIcon={<ChevronDown size={14} />}
          onClick={() => setMoreOpen(v => !v)}
        >
          {t('accounting.bills.moreActions')}
        </Button>
      )}
      <PopOver
        isOpen={moreOpen}
        onClose={() => setMoreOpen(false)}
        triggerRef={moreTriggerRef}
        placement="top"
        align="end"
        maxWidth="32rem"
        maxHeight="60vh"
      >
        <div className="flex flex-col gap-3 p-3">
          {sortedCategories.map(cat => {
            const items = groupedSecondary[cat];
            if (!items || items.length === 0) return null;
            return (
              <div key={cat} className="flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                  {t(`accounting.bills.category.${cat}`, { defaultValue: cat })}
                </div>
                <div className="flex flex-wrap gap-2">
                  {items.map(a => renderActionButton(a))}
                </div>
              </div>
            );
          })}
        </div>
      </PopOver>
    </div>
  );
}
