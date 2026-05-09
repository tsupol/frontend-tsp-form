import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTable, Select, Badge, Button,
  Modal, MaskedInput, TextArea, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowRightFromLine, ArrowLeft, Plus, Wallet, Ban, AlertCircle, CheckCircle, XCircle, ChevronsRight,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { BranchPinInput } from '../../components/BranchPinInput';
import { fmtCurrency } from '../../lib/format';
import { buildBillActionToast, hasBill, type StandardBillResponse } from '../../lib/billActionToast';
import { CreateRetailBillModal } from './CreateRetailBillModal';
import { useBillActions, type BillAction, type BillBlockingReason } from '../../hooks/useBillActions';

interface Branch {
  id: number;
  name: string;
}

interface RetailBillRow {
  id: number;
  code_display: string;
  branch_id: number;
  branch_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  total_amount: number;
  paid_amount: number;
  cash_amount: number;
  transfer_amount: number;
  status: string;
  bill_date: string;
  created_at: string;
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
  approval_status: string;
}

interface BillPayment {
  id: number;
  method: string;
  amount: number;
  bank_name: string | null;
  account_number: string | null;
  reference: string | null;
}

interface BillDetail {
  bill_id: number;
  branch_id: number;
  bill_code_display: string;
  status: string;
  total_amount: number;
  paid_amount: number;
  remaining: number;
  customer_name: string | null;
  bill_date: string | null;
  created_at: string | null;
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

const METHOD_COLOR: Record<string, 'success' | 'primary' | 'secondary' | 'info' | 'default'> = {
  CASH: 'success',
  TRANSFER: 'primary',
};

const STATUS_VALUES = ['OPEN', 'PAID', 'VOIDED'] as const;

export function RetailBillsPage() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const queryClient = useQueryClient();
  const canCreate = can('BILL.CREATE');
  const [branchId, setBranchId] = useState<string>(user?.branch_id ? String(user.branch_id) : '');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selectedBillId, setSelectedBillId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const params = new URLSearchParams();
  params.set('bill_purpose', 'eq.RETAIL');
  if (branchId) params.set('branch_id', `eq.${branchId}`);
  if (statusFilter) params.set('status', `eq.${statusFilter}`);
  params.set('order', 'created_at.desc');

  const { data: billsData, isFetching } = useQuery({
    queryKey: ['retail', 'bills', branchId, statusFilter, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<RetailBillRow>(
      `/v_bills?${params.toString()}`,
      { page: pageIndex + 1, pageSize }
    ),
    placeholderData: keepPreviousData,
  });

  const bills = billsData?.data ?? [];
  const totalCount = billsData?.totalCount ?? 0;

  const detailTitle = selectedBillId
    ? bills.find(b => b.id === selectedBillId)?.code_display ?? t('retail.bills.title')
    : t('retail.bills.title');

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
                {isRoot ? t('retail.bills.title') : detailTitle}
              </div>
              <div className="mobile-header-end w-nav">
                {isRoot && canCreate ? (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label={t('retail.bills.newBill')}
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus size={20} />
                  </button>
                ) : null}
              </div>
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('retail.bills.title')}</h1>
              <p className="text-sm text-subtle truncate flex-1">{t('retail.bills.description')}</p>
              {canCreate && (
                <Button
                  color="primary"
                  size="sm"
                  startIcon={<Plus size={14} />}
                  onClick={() => setCreateOpen(true)}
                >
                  {t('retail.bills.newBill')}
                </Button>
              )}
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
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
                    value={statusFilter || null}
                    onChange={(v) => { setStatusFilter((v as string) ?? ''); setPageIndex(0); }}
                    placeholder={t('retail.bills.statusFilter')}
                    options={STATUS_VALUES.map(s => ({ label: t(`retail.bills.tab_${s}`), value: s }))}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
              </div>

              <DataTable<RetailBillRow>
                data={bills}
                renderRow={(row) => {
                  const b = row.original;
                  const isSelected = selectedBillId === b.id;
                  const statusColor = b.status === 'PAID' ? 'success' : b.status === 'VOIDED' ? 'default' : 'warning';
                  return (
                    <button
                      key={b.id}
                      className={`w-full text-left px-4 py-3 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => {
                        setSelectedBillId(b.id);
                        if (isMobile) goTo('detail');
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-mono text-sm font-medium">{b.code_display}</span>
                          <Badge color={statusColor} size="sm">{b.status}</Badge>
                        </div>
                        <div className="text-xs text-subtle truncate">
                          {b.customer_name || t('retail.walkIn')}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium tabular-nums">{fmtCurrency(b.total_amount)}</div>
                        <div className="text-xs text-fg/50">
                          <DateTime value={b.bill_date} showTime={false} />
                        </div>
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
                noResults={<div className="p-8 text-center text-subtler">{t('retail.bills.empty')}</div>}
              />
            </PageNavPanel>

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 flex flex-col min-h-0'}>
              {!selectedBillId && (
                <div className="flex-1 h-full flex items-center justify-center text-subtler p-8">
                  {t('retail.bills.selectToView')}
                </div>
              )}
              {selectedBillId && <RetailBillDetail billId={selectedBillId} isMobile={isMobile} />}
            </PageNavPanel>
          </div>

          <CreateRetailBillModal
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['retail', 'bills'] });
              setPageIndex(0);
            }}
          />
        </>
      )}
    </PageNav>
  );
}

function RetailBillDetail({ billId, isMobile }: { billId: number; isMobile: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  const { data: details, isLoading } = useQuery({
    queryKey: ['retail', 'bill-detail', billId],
    queryFn: () => apiClient.get<BillDetail[]>(`/v_bill_detail?bill_id=eq.${billId}`),
  });

  const { data: actionsData, getAction } = useBillActions(billId);

  if (isLoading) return <div className="p-6 text-sm text-subtler">{t('common.loading')}</div>;
  const detail = details?.[0];
  if (!detail) return <div className="p-6 text-sm text-subtler">—</div>;

  const lines = detail.line_items ?? [];
  const payments = detail.payments ?? [];
  const statusColor = detail.status === 'PAID' ? 'success' : detail.status === 'VOIDED' ? 'default' : 'warning';

  const addPaymentAction = getAction('ADD_PAYMENT');
  const cancelBillAction = getAction('CANCEL_BILL');
  const showPayBtn = !!addPaymentAction?.is_available;
  const showVoidBtn = !!cancelBillAction?.is_available;

  const onMutationSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['retail', 'bill-detail', billId] });
    queryClient.invalidateQueries({ queryKey: ['retail', 'bills'] });
    queryClient.invalidateQueries({ queryKey: ['bill-actions', billId] });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Desktop header — thin status row with code + badge + actions */}
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold font-mono">{detail.bill_code_display}</span>
          <Badge color={statusColor} size="sm">{detail.status}</Badge>
          <div className="flex-1" />
          {showPayBtn && (
            <Button
              size="sm"
              color="primary"
              startIcon={<Wallet size={14} />}
              onClick={() => setPayOpen(true)}
            >
              {t('retail.bills.takePayment')}
            </Button>
          )}
          {showVoidBtn && (
            <Button
              size="sm"
              variant="outline"
              color="danger"
              startIcon={<Ban size={14} />}
              onClick={() => setVoidOpen(true)}
            >
              {t('retail.bills.void')}
            </Button>
          )}
        </div>
      )}

      {/* Summary stats */}
      <div className="flex-none grid grid-cols-3 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs text-subtle">{t('retail.bills.customer')}</div>
          <div className="font-semibold text-sm truncate">
            {detail.customer_name || t('retail.walkIn')}
          </div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('retail.bills.totalCharged')}</div>
          <div className="font-semibold text-sm tabular-nums">{fmtCurrency(detail.total_amount)}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('retail.bills.totalPaid')}</div>
          <div className="font-semibold text-sm tabular-nums">{fmtCurrency(detail.paid_amount)}</div>
        </div>
      </div>

      {/* Timestamps */}
      <div className="flex-none px-4 py-2 border-b border-line flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle">
        <span>{t('retail.bills.billDate')}: <DateTime value={detail.bill_date ?? detail.created_at} showTime={false} /></span>
        {detail.created_at && (
          <span>{t('retail.bills.createdAt')}: <DateTime value={detail.created_at} /></span>
        )}
      </div>

      {/* Mobile action row */}
      {isMobile && (showPayBtn || showVoidBtn) && (
        <div className="flex-none flex gap-2 px-4 py-3 border-b border-line">
          {showPayBtn && (
            <Button
              size="sm"
              color="primary"
              className="flex-1"
              startIcon={<Wallet size={14} />}
              onClick={() => setPayOpen(true)}
            >
              {t('retail.bills.takePayment')}
            </Button>
          )}
          {showVoidBtn && (
            <Button
              size="sm"
              variant="outline"
              color="danger"
              className="flex-1"
              startIcon={<Ban size={14} />}
              onClick={() => setVoidOpen(true)}
            >
              {t('retail.bills.void')}
            </Button>
          )}
        </div>
      )}

      {/* Blocked-action hint — show why ADD_PAYMENT or CANCEL_BILL is unavailable.
          status_not_allowed is suppressed: status alone is already obvious from the badge. */}
      {actionsData && (
        <BlockedActionHints
          actions={[addPaymentAction, cancelBillAction].filter((a): a is BillAction =>
            !!a && !a.is_available && !!a.blocking_reason && a.blocking_reason !== 'status_not_allowed'
          )}
          pendingCount={actionsData.pending_approval_count}
          pendingTotal={actionsData.pending_approval_total}
          remaining={actionsData.remaining_amount}
        />
      )}

      {/* Body: lines + payments stacked */}
      <div className="flex-1 overflow-auto better-scroll">
        {/* Line items */}
        <div className="px-4 pt-3 pb-1">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
            {t('retail.bills.lineItems')} ({lines.length})
          </h3>
        </div>
        {lines.length === 0 ? (
          <div className="p-8 text-center text-subtler">{t('common.noData')}</div>
        ) : (
          lines.map((line) => (
            <div key={line.line_id} className="px-4 py-2.5 border-b border-line flex items-center gap-3">
              <Badge size="sm" color="default">{line.charge_type}</Badge>
              <span className="flex-1 min-w-0 truncate text-sm">{line.description}</span>
              <span className="tabular-nums font-medium shrink-0 text-sm">
                {fmtCurrency(line.amount)}
              </span>
            </div>
          ))
        )}

        {/* Payments */}
        <div className="px-4 pt-4 pb-1">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
            {t('retail.bills.payments')} ({payments.length})
          </h3>
        </div>
        {payments.length === 0 ? (
          <div className="px-4 py-3 text-sm text-subtler italic">{t('retail.bills.noPayments')}</div>
        ) : (
          payments.map((pay) => (
            <div key={pay.id} className="px-4 py-2.5 border-b border-line flex items-center gap-3">
              <Badge color={METHOD_COLOR[pay.method] ?? 'default'} size="sm">{pay.method}</Badge>
              <span className="flex-1 min-w-0 truncate text-sm text-subtle">
                {pay.bank_name ? `${pay.bank_name} ${pay.account_number ?? ''}` : '—'}
              </span>
              <span className="tabular-nums font-medium shrink-0 text-sm">
                {fmtCurrency(pay.amount)}
              </span>
            </div>
          ))
        )}
      </div>

      <TakePaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        billId={detail.bill_id}
        remaining={detail.remaining}
        onSuccess={() => { setPayOpen(false); onMutationSuccess(); }}
      />
      <VoidBillModal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        billId={detail.bill_id}
        branchId={detail.branch_id}
        onSuccess={() => { setVoidOpen(false); onMutationSuccess(); }}
      />
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Take Payment Modal
 * ─────────────────────────────────────────────────────────────────────────── */

function TakePaymentModal({
  open, onClose, billId, remaining, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  billId: number;
  remaining: number;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amountStr, setAmountStr] = useState('');
  const [bankAccountId, setBankAccountId] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open) {
      setMethod('CASH');
      setAmountStr(String(remaining));
      setBankAccountId(null);
      setReference('');
      setErrorMessage('');
    }
  }, [open, remaining]);

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts-active'],
    queryFn: () => apiClient.get<BankAccount[]>('/v_bank_accounts?is_active=is.true&order=bank_name'),
    staleTime: 5 * 60 * 1000,
  });

  const amount = parseFloat(amountStr) || 0;
  const change = amount > remaining ? amount - remaining : 0;
  const valid =
    amount >= remaining &&
    (method === 'CASH' || (method === 'TRANSFER' && bankAccountId != null));

  const mutation = useMutation({
    mutationFn: async () => {
      await apiClient.rpc('fn_bill_payment_add', {
        p_bill_id: billId,
        p_method: method,
        p_amount: amount,
        p_bank_account_id: method === 'TRANSFER' ? bankAccountId : null,
        p_reference: reference.trim() || null,
      });
      await apiClient.rpc('fn_bill_payment_confirm', { p_bill_id: billId });
    },
    onSuccess: () => {
      addSnackbar({
        type: 'success',
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span className="alert-description">
              {t('retail.bills.paymentSuccess', { change: fmtCurrency(change) })}
            </span>
          </div>
        ),
      });
      onSuccess();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(String(err));
      }
    },
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%" ariaLabel="Take Payment">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('retail.bills.takePayment')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('retail.bills.amountDue')}</label>
            <div className="text-base font-semibold tabular-nums">{fmtCurrency(remaining)}</div>
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('retail.bills.paymentMethod')}</label>
            <div className="input-group">
              <div className="w-28 shrink-0">
                <Select
                  value={method}
                  onChange={(v) => { setMethod((v as PaymentMethod) ?? 'CASH'); setBankAccountId(null); }}
                  options={[
                    { label: t('paymentMethod.CASH', { defaultValue: 'CASH' }), value: 'CASH' },
                    { label: t('paymentMethod.TRANSFER', { defaultValue: 'TRANSFER' }), value: 'TRANSFER' },
                  ]}
                  size="sm"
                  searchable={false}
                />
              </div>
              <div className="input-group-divider" />
              <MaskedInput
                mask="number"
                decimalScale={2}
                value={amountStr}
                onChange={(raw) => setAmountStr(raw)}
                placeholder={t('retail.create.amountPlaceholder')}
                size="sm"
                className="w-full"
                endIcon={<ChevronsRight size={14} />}
                onEndIconClick={() => setAmountStr(String(remaining))}
              />
            </div>
          </div>
          {method === 'TRANSFER' && (
            <div className="flex flex-col">
              <label className="form-label">{t('retail.create.selectBank')}</label>
              <Select
                value={bankAccountId ? String(bankAccountId) : null}
                onChange={(v) => setBankAccountId(v ? Number(v) : null)}
                options={bankAccounts.map(b => ({
                  label: `${b.bank_name} - ${b.account_number}`,
                  value: String(b.id),
                }))}
                placeholder={t('retail.create.selectBank')}
                size="sm"
                showChevron
              />
            </div>
          )}
          {amount > remaining && (
            <div className="flex justify-between text-sm">
              <span className="text-subtle">{t('retail.create.change')}</span>
              <span className="font-medium tabular-nums text-success">{fmtCurrency(change)}</span>
            </div>
          )}
          {errorMessage && (
            <div className="alert alert-danger">
              <XCircle size={16} />
              <div className="alert-description">{errorMessage}</div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button onClick={onClose} disabled={mutation.isPending}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t('retail.bills.confirmPayment')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Void Bill Modal
 * ─────────────────────────────────────────────────────────────────────────── */

function VoidBillModal({
  open, onClose, billId, branchId, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  billId: number;
  branchId: number;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setPin('');
      setErrorMessage('');
    }
  }, [open]);

  const valid = reason.trim().length > 0 && pin.length === 6;

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<Partial<StandardBillResponse>>('fn_bill_cancel', {
      p_bill_id: billId,
      p_branch_id: branchId,
      p_pin: pin,
      p_reason: reason.trim(),
    }),
    onSuccess: (result) => {
      // Retail void on a PAID bill mints a CREDIT_NOTE — surface its code if so.
      const message = hasBill(result) && result.bill_type === 'CREDIT_NOTE'
        ? buildBillActionToast(result, t)
        : (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span className="alert-description">{t('retail.bills.voidSuccess')}</span>
          </div>
        );
      addSnackbar({ type: 'success', message });
      onSuccess();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(String(err));
      }
    },
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%" ariaLabel="Void Bill">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('retail.bills.void')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content form-grid">
          <div className="alert alert-warning">
            <AlertCircle size={16} />
            <div className="alert-description">{t('retail.bills.voidWarning')}</div>
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('retail.bills.voidReason')}</label>
            <TextArea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('retail.bills.voidReasonPlaceholder')}
              size="sm"
              rows={2}
              className="w-full"
            />
          </div>
          <BranchPinInput value={pin} onChange={setPin} required />
          {errorMessage && (
            <div className="alert alert-danger">
              <XCircle size={16} />
              <div className="alert-description">{errorMessage}</div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button onClick={onClose} disabled={mutation.isPending}>{t('common.cancel')}</Button>
          <Button
            color="danger"
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t('retail.bills.confirmVoid')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Blocked Action Hints — explains *why* an action button is hidden
 * ─────────────────────────────────────────────────────────────────────────── */

function BlockedActionHints({
  actions, pendingCount, pendingTotal, remaining,
}: {
  actions: BillAction[];
  pendingCount: number;
  pendingTotal: number;
  remaining: number;
}) {
  const { t } = useTranslation();
  if (actions.length === 0) return null;

  const reasonInterp = (reason: BillBlockingReason): Record<string, string | number> => {
    switch (reason) {
      case 'pending_approval_blocks':
        return { count: pendingCount, total: fmtCurrency(pendingTotal) };
      case 'not_paid_in_full':
        return { remaining: fmtCurrency(remaining) };
      default:
        return {};
    }
  };

  return (
    <div className="flex-none px-4 py-3 border-b border-line flex flex-col gap-2">
      {actions.map(a => (
        <div key={a.action_code} className="alert alert-warning">
          <AlertCircle size={16} />
          <div className="alert-description">
            <span className="font-medium">{t(a.action_code, { ns: 'billActions' })}: </span>
            {t(`blockingReason.${a.blocking_reason}`, {
              ns: 'apiErrors',
              ...reasonInterp(a.blocking_reason as BillBlockingReason),
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
