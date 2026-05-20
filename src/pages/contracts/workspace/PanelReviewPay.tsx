import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Select, MaskedInput } from 'tsp-form';
import { Star, Plus, Trash2, XCircle, Loader2, CheckCircle, AlertTriangle, ChevronsRight, Link2, FileText, CreditCard, Clock } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import type { PaymentMethod, PaymentLine, BankAccount, BillOpenResult } from './WorkspaceTypes';
import { ERROR_TO_MODAL } from './WorkspaceTypes';
import { BillReceipt } from './BillReceipt';
import { BillCart } from './BillCart';

const BASE_PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'TRANSFER', label: 'Bank Transfer' },
];

const SCORE_TOOLTIPS: Record<number, string> = {
  1: 'workspace.score1',
  2: 'workspace.score2',
  3: 'workspace.score3',
  4: 'workspace.score4',
  5: 'workspace.score5',
};

interface ReadinessResult {
  ready: boolean;
  errors: Array<{ code: string; detail?: Record<string, unknown> }>;
}

export function PanelReviewPay({ onClose: _onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, updateData, contract, invalidateContract, setOpenModal } = useWorkspace();
  const savingBalance = contract?.saving_balance ?? 0;
  const score = contract?.staff_confidence_score ?? null;

  // Confirm-payment state (declared early — auto-open effect below references readinessErrors)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [readinessErrors, setReadinessErrors] = useState<Array<{ code: string }>>([]);

  // Bill preview from contract pricing — used only before bill is opened.
  const downPayment = contract?.down_payment ?? 0;
  const insuranceDeposit = contract?.insurance_deposit ?? 0;
  const previewTotal = downPayment + insuranceDeposit;

  // Live bill (after fn_bill_contract_open) — gives us the canonical total
  // including any user-added accessory/gift lines.
  const queryClient = useQueryClient();
  const { data: liveBill } = useQuery({
    queryKey: ['bill-detail', data.billId],
    queryFn: () => apiClient.get<Array<{ bill_id: number; total_amount: number; status: string }>>(
      `/v_bill_detail?bill_id=eq.${data.billId}&select=bill_id,total_amount,status`,
    ).then(rows => rows[0] ?? null),
    enabled: data.billId != null && data.billId > 0,
    staleTime: 0,
  });

  const totalAmount = liveBill?.total_amount ?? previewTotal;

  // Read-only readiness check — surfaces missing items before user clicks Activate.
  // bill_open itself re-validates server-side, so this is purely UX.
  const { data: readiness } = useQuery({
    queryKey: ['contract-readiness', data.contractId],
    queryFn: () => apiClient.rpc<ReadinessResult>('fn_contract_validate_ready', {
      p_contract_id: data.contractId,
    }),
    enabled: !!data.contractId && !data.billId && !data.billConfirmed,
    staleTime: 0,
  });
  useEffect(() => {
    if (readiness && !readiness.ready) setReadinessErrors(readiness.errors);
    else if (readiness?.ready) setReadinessErrors([]);
  }, [readiness]);

  // ── Manual activate — opens the CONTRACT_OPEN bill on explicit user click.
  // Doc 33: bill_open transitions DRAFT → PENDING_PAYMENT and creates the
  // canonical bill. After this, contract is financially locked until pay or void.
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState('');
  const activate = async (): Promise<boolean> => {
    if (!data.contractId) return false;
    setActivating(true);
    setActivateError('');
    setReadinessErrors([]);
    try {
      const bill = await apiClient.rpc<BillOpenResult>('fn_bill_contract_open', {
        p_contract_id: data.contractId,
      });
      updateData({ billId: bill.bill_id, billCode: bill.bill_code, billData: bill });
      invalidateContract();
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setActivateError(tr || err.message);
        // If backend returned a readiness-style error, also surface it inline so
        // the user can jump to the relevant card.
        if (err.code && ERROR_TO_MODAL[err.code]) {
          setReadinessErrors([{ code: err.code }]);
        }
      } else {
        setActivateError(err instanceof Error ? err.message : String(err));
      }
      return false;
    } finally {
      setActivating(false);
    }
  };

  const handleActivatePayLater = async () => {
    const ok = await activate();
    if (ok && data.contractId) {
      // Pay-later: leave contract in PENDING_PAYMENT and exit to the contract page,
      // where the existing "continue payment" modal handles payment.
      navigate(`/admin/contracts/search/${data.contractId}`);
    }
  };

  // ── Confidence score ────────────────────────────────────────────────
  const [scoreSaving, setScoreSaving] = useState(false);
  const [scoreError, setScoreError] = useState('');
  const [hoverStar, setHoverStar] = useState(0);

  const handleSetScore = async (n: number) => {
    if (!data.contractId) return;
    setScoreSaving(true);
    setScoreError('');
    try {
      await apiClient.rpc('fn_contract_set_staff_confidence_score', {
        p_contract_id: data.contractId,
        p_score: n,
      });
      invalidateContract();
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setScoreError(tr || err.message);
      } else {
        setScoreError(String(err));
      }
    } finally {
      setScoreSaving(false);
    }
  };

  // ── Payment methods ─────────────────────────────────────────────────
  const paymentMethodOptions = useMemo(() => {
    const opts = [...BASE_PAYMENT_METHODS];
    if (savingBalance > 0) {
      opts.push({ value: 'SAVING_WALLET', label: `${t('workspace.savingWallet')} (${fmtCurrency(savingBalance)})` });
    }
    return opts;
  }, [savingBalance, t]);

  const [payments, setPayments] = useState<PaymentLine[]>(() => {
    const defaultMethod: PaymentMethod = savingBalance > 0 && savingBalance >= totalAmount ? 'SAVING_WALLET' : 'CASH';
    return [{ method: defaultMethod, amount: totalAmount, bank_account_id: null }];
  });
  // Track whether the user has manually edited the payment row(s). While
  // untouched, we keep the single default line's amount in sync with the live
  // bill total — so adding accessories/gifts in the cart auto-rebalances.
  const userEditedPayments = useRef(false);
  useEffect(() => {
    if (userEditedPayments.current) return;
    if (payments.length !== 1) return;
    if (payments[0].amount === totalAmount) return;
    setPayments([{ ...payments[0], amount: totalAmount }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalAmount]);

  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts-active'],
    queryFn: () => apiClient.get<BankAccount[]>('/v_bank_accounts?is_active=is.true&order=bank_name'),
    staleTime: 5 * 60 * 1000,
  });

  const bankOptions = (bankAccounts ?? []).map(b => ({
    value: String(b.id),
    label: `${b.bank_name} - ${b.account_number} (${b.account_name})`,
  }));

  const totalPayment = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const isBalanced = totalAmount > 0 && Math.abs(totalPayment - totalAmount) < 0.01;

  const updatePayment = (idx: number, updates: Partial<PaymentLine>) => {
    userEditedPayments.current = true;
    setPayments(prev => prev.map((p, i) => {
      if (i !== idx) return p;
      const merged = { ...p, ...updates };
      // Cap SAVING_WALLET amount at available balance
      if (merged.method === 'SAVING_WALLET') {
        merged.amount = Math.min(merged.amount, savingBalance);
      }
      // When switching to SAVING_WALLET, also cap; when switching away, restore remaining
      if (updates.method === 'SAVING_WALLET' && !('amount' in updates)) {
        merged.amount = Math.min(p.amount, savingBalance);
      }
      return merged;
    }));
  };

  // ── Confirm Payment ─────────────────────────────────────────────────
  const canConfirm = !!score && isBalanced && totalAmount > 0 && data.billId != null && data.billId > 0;

  const handleConfirm = async () => {
    if (!canConfirm || !data.contractId || !data.billId) return;
    setLoading(true);
    setError('');

    try {
      // Bill is already open (auto-opened on entry); just record payments and confirm.
      for (const payment of payments) {
        await apiClient.rpc('fn_bill_payment_add', {
          p_bill_id: data.billId,
          p_method: payment.method,
          p_amount: payment.amount,
          p_bank_account_id: payment.method === 'TRANSFER' ? payment.bank_account_id : null,
        });
      }

      // Confirm → activate (server cascades activation; see CT-2605-000015-2 trace)
      await apiClient.rpc('fn_bill_payment_confirm', {
        p_bill_id: data.billId,
        p_contract_id: data.contractId,
      });

      updateData({ billConfirmed: true });
      invalidateContract();
      // Stay on panel — user previews / prints the receipt before pairing the device.
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Post-confirm: section state IS the printable receipt. ─────────────
  // Footer buttons are conditional navigation (no auto-redirect).
  if (data.billConfirmed && data.billId) {
    // 1st-hand catalog (NEW path) leaves the contract ACTIVE without a device.
    // USED auto-binds in fn_bill_contract_open, so it lands here with device_id set.
    const needsBindDevice = contract != null && contract.device_id == null;

    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto better-scroll p-4">
          <BillReceipt billId={data.billId} />
        </div>
        <div className="shrink-0 border-t border-line bg-bg px-4 py-3 flex justify-end gap-2 print:hidden">
          {needsBindDevice && data.contractId && (
            <Button
              color="primary"
              startIcon={<Link2 size={16} />}
              onClick={() => navigate(`/admin/contracts/pending-pairing/${data.contractId}`)}
            >
              {t('wizard.action_bindDevice')}
            </Button>
          )}
          {data.contractId && (
            <Button
              variant={needsBindDevice ? 'outline' : 'solid'}
              color={needsBindDevice ? undefined : 'primary'}
              startIcon={<FileText size={16} />}
              onClick={() => navigate(`/admin/contracts/search/${data.contractId}`)}
            >
              {t('wizard.action_viewInContract')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-2xl">
      <div className="flex-1 overflow-y-auto better-scroll p-4 flex flex-col gap-5">

        {/* ── Section 1: Staff Confidence Score ─────────────────── */}
        <div>
          <div className="text-sm font-medium mb-3">{t('workspace.confidenceLabel')}</div>

          <div className="flex items-center gap-1" onMouseLeave={() => setHoverStar(0)}>
            {[1, 2, 3, 4, 5].map(n => {
              const filled = n <= (hoverStar || score || 0);
              return (
                <button
                  key={n}
                  className="p-1 cursor-pointer bg-transparent border-none transition-transform hover:scale-110"
                  onClick={() => handleSetScore(n)}
                  onMouseEnter={() => setHoverStar(n)}
                  disabled={scoreSaving}
                  title={t(SCORE_TOOLTIPS[n])}
                >
                  <Star size={28} className={filled ? 'text-warning-fg fill-warning' : 'text-fg/20'} />
                </button>
              );
            })}
            {scoreSaving && <Loader2 size={16} className="animate-spin text-subtle ml-2" />}
          </div>

          {(hoverStar > 0 || score) && (
            <div className="text-xs text-subtle mt-1.5">
              {t(SCORE_TOOLTIPS[hoverStar || score || 3])}
            </div>
          )}

          {scoreError && (
            <div className="alert alert-danger mt-2">
              <XCircle size={14} />
              <span>{scoreError}</span>
            </div>
          )}

          {!score && (
            <div className="flex items-center gap-1.5 text-xs text-warning-fg mt-2">
              <AlertTriangle size={12} />
              <span>{t('workspace.confidenceRequired')}</span>
            </div>
          )}
        </div>

        {/* ── Section 2: Cart / Preview ────────────────────────── */}
        <div>
          <label className="form-label">{t('workspace.billPreview')}</label>
          {data.billId && data.billId > 0 ? (
            <BillCart
              billId={data.billId}
              branchId={contract?.branch_id ?? null}
              onChange={() => queryClient.invalidateQueries({ queryKey: ['bill-detail', data.billId] })}
            />
          ) : (
            <div className="border border-line rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {downPayment > 0 && (
                    <tr>
                      <td className="px-3 py-2">{t('contract.downPayment')}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(downPayment)}</td>
                    </tr>
                  )}
                  {insuranceDeposit > 0 && (
                    <tr>
                      <td className="px-3 py-2">{t('contract.insuranceDeposit')}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(insuranceDeposit)}</td>
                    </tr>
                  )}
                  <tr className="bg-surface font-medium">
                    <td className="px-3 py-2">{t('workspace.total')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(previewTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Section 3: Payment Methods (only after bill is opened) ── */}
        {data.billId && data.billId > 0 && (
        <div>
          <label className="form-label">{t('wizard.paymentMethods')}</label>
          <div className="flex flex-col gap-3">
            {payments.map((payment, idx) => (
              <div key={idx} className="border border-line rounded-lg p-3 flex flex-col gap-3">
                <div className="flex gap-3 items-end">
                  <div className="flex flex-col" style={{ width: '10rem' }}>
                    <label className="form-label text-xs">{t('wizard.method')}</label>
                    <Select
                      options={paymentMethodOptions}
                      value={payment.method}
                      onChange={(val) => updatePayment(idx, { method: val as PaymentMethod, bank_account_id: null })}
                      size="sm"
                    />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <label className="form-label text-xs">{t('contract.amount')}</label>
                    <MaskedInput
                      mask="number"
                      decimalScale={2}
                      value={String(payment.amount || '')}
                      onChange={(raw) => updatePayment(idx, { amount: parseFloat(raw) || 0 })}
                      size="sm"
                      className="w-full"
                      endIcon={<ChevronsRight size={14} />}
                      onEndIconClick={() => {
                        const otherTotal = payments.reduce((sum, p, i) => i === idx ? sum : sum + (p.amount || 0), 0);
                        const remaining = Math.max(0, totalAmount - otherTotal);
                        const fill = payment.method === 'SAVING_WALLET'
                          ? Math.min(savingBalance, remaining)
                          : remaining;
                        updatePayment(idx, { amount: fill });
                      }}
                    />
                  </div>
                  {payments.length > 1 && (
                    <Button size="sm" className="btn-icon-sm shrink-0" onClick={() => { userEditedPayments.current = true; setPayments(prev => prev.filter((_, i) => i !== idx)); }}>
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
                {payment.method === 'TRANSFER' && (
                  <div className="flex flex-col">
                    <label className="form-label text-xs">{t('wizard.bankAccount')}</label>
                    <Select
                      options={bankOptions}
                      value={payment.bank_account_id ? String(payment.bank_account_id) : null}
                      onChange={(val) => updatePayment(idx, { bank_account_id: val ? Number(val) : null })}
                      placeholder={t('wizard.selectBankAccount')}
                      size="sm"
                      showChevron
                      searchable
                    />
                  </div>
                )}
              </div>
            ))}
            <Button size="sm" onClick={() => {
              const remaining = totalAmount - totalPayment;
              userEditedPayments.current = true;
              setPayments(prev => [...prev, { method: 'CASH', amount: remaining > 0 ? remaining : 0, bank_account_id: null }]);
            }} startIcon={<Plus size={14} />}>
              {t('wizard.addPayment')}
            </Button>
          </div>

          {/* Total check */}
          <div className={`flex justify-between items-center p-3 rounded-lg border mt-3 ${
            isBalanced ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
          }`}>
            <span className="text-sm">{t('wizard.totalPayment')}</span>
            <span className={`font-semibold tabular-nums ${isBalanced ? 'text-success' : 'text-warning-fg'}`}>
              {fmtCurrency(totalPayment)}
            </span>
          </div>
        </div>
        )}

        {/* ── Pre-bill: activate consequence callout ───────────── */}
        {!data.billId && (
          <div className="alert alert-warning">
            <AlertTriangle size={16} />
            <span className="text-xs">{t('wizard.activateConsequence')}</span>
          </div>
        )}

        {/* ── Readiness errors ─────────────────────────────────── */}
        {readinessErrors.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {readinessErrors.map((err, i) => {
              const targetModal = ERROR_TO_MODAL[err.code];
              return (
                <button
                  key={i}
                  className={`flex items-center gap-2 text-sm text-left w-full ${
                    targetModal ? 'text-danger hover:underline cursor-pointer' : 'text-danger cursor-default'
                  }`}
                  onClick={targetModal ? () => { setOpenModal(targetModal); } : undefined}
                  disabled={!targetModal}
                >
                  <XCircle size={14} className="shrink-0" />
                  <span>{t(err.code, { ns: 'apiErrors', defaultValue: err.code })}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Activate error (non-readiness backend error) ─────── */}
        {activateError && !readinessErrors.length && (
          <div className="alert alert-danger">
            <XCircle size={16} />
            <div><div className="alert-description">{activateError}</div></div>
          </div>
        )}

        {/* ── Pay / confirm error ──────────────────────────────── */}
        {error && (
          <div className="alert alert-danger">
            <XCircle size={16} />
            <div><div className="alert-description">{error}</div></div>
          </div>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-line bg-bg px-4 py-3 flex justify-end gap-2">
        {!data.billId ? (
          <>
            <Button
              onClick={handleActivatePayLater}
              disabled={!score || activating}
              startIcon={activating ? <Loader2 size={16} className="animate-spin" /> : <Clock size={16} />}
            >
              {t('wizard.activatePayLater')}
            </Button>
            <Button
              color="primary"
              onClick={activate}
              disabled={!score || activating}
              startIcon={activating ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
            >
              {activating ? t('wizard.activating') : t('wizard.activateAndPay')}
            </Button>
          </>
        ) : (
          <Button
            color="primary"
            onClick={handleConfirm}
            disabled={!canConfirm || loading}
            startIcon={loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
          >
            {loading ? t('common.loading') : t('wizard.confirmPayment')}
          </Button>
        )}
      </div>
    </div>
  );
}
