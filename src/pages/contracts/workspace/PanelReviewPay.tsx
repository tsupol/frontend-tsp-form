import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Select, MaskedInput } from 'tsp-form';
import {
  Star, Plus, Trash2, XCircle, Loader2, CheckCircle, AlertTriangle,
  ChevronsRight, Link2, FileText,
} from 'lucide-react';
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
  const queryClient = useQueryClient();

  const savingBalance = contract?.saving_balance ?? 0;

  // ── Confidence score ─────────────────────────────────────────────────
  // Optimistic local override so the stars react immediately while the RPC
  // is still in flight; cleared once the server echoes back the new value.
  const [pendingScore, setPendingScore] = useState<number | null>(null);
  const serverScore = contract?.staff_confidence_score ?? null;
  const score = pendingScore ?? serverScore;
  useEffect(() => {
    if (serverScore != null && serverScore === pendingScore) setPendingScore(null);
  }, [serverScore, pendingScore]);

  const [scoreSaving, setScoreSaving] = useState(false);
  const [scoreError, setScoreError] = useState('');
  const [hoverStar, setHoverStar] = useState(0);

  const handleSetScore = async (n: number) => {
    if (!data.contractId) return;
    setScoreSaving(true);
    setScoreError('');
    setPendingScore(n);
    try {
      await apiClient.rpc('fn_contract_set_staff_confidence_score', {
        p_contract_id: data.contractId,
        p_score: n,
      });
      invalidateContract();
    } catch (err) {
      setPendingScore(null);
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

  // ── Bill preview / live bill ─────────────────────────────────────────
  const downPayment = contract?.down_payment ?? 0;
  const insuranceDeposit = contract?.insurance_deposit ?? 0;
  const previewTotal = downPayment + insuranceDeposit;

  const { data: liveBill } = useQuery({
    queryKey: ['bill-detail', data.billId],
    queryFn: () => apiClient.get<Array<{ bill_id: number; total_amount: number; status: string }>>(
      `/v_bill_detail?bill_id=eq.${data.billId}&select=bill_id,total_amount,status`,
    ).then(rows => rows[0] ?? null),
    enabled: data.billId != null && data.billId > 0,
    staleTime: 0,
  });

  const totalAmount = liveBill?.total_amount ?? previewTotal;

  // ── Readiness + auto-open bill ───────────────────────────────────────
  // Once the contract is validate-ready and the confidence score is set, we
  // auto-open the CONTRACT_OPEN bill (DRAFT/SAVING → PENDING_PAYMENT). The
  // ref guards against the effect re-firing on every render.
  const [readinessErrors, setReadinessErrors] = useState<Array<{ code: string }>>([]);
  const [autoOpenError, setAutoOpenError] = useState('');
  const autoOpenInFlight = useRef(false);

  useEffect(() => {
    if (data.billConfirmed) return;
    if (data.billId != null && data.billId > 0) return;
    if (!data.contractId) return;
    if (autoOpenInFlight.current) return;
    autoOpenInFlight.current = true;
    (async () => {
      try {
        const readiness = await apiClient.rpc<ReadinessResult>('fn_contract_validate_ready', {
          p_contract_id: data.contractId,
        });
        if (!readiness.ready) {
          setReadinessErrors(readiness.errors);
          autoOpenInFlight.current = false;
          return;
        }
        setReadinessErrors([]);
        const bill = await apiClient.rpc<BillOpenResult>('fn_bill_contract_open', {
          p_contract_id: data.contractId,
        });
        updateData({ billId: bill.bill_id, billCode: bill.bill_code, billData: bill });
        invalidateContract();
      } catch (err) {
        if (err instanceof ApiError) {
          const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
            || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
          setAutoOpenError(tr || err.message);
        } else {
          setAutoOpenError(err instanceof Error ? err.message : String(err));
        }
        autoOpenInFlight.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.contractId, data.billId, data.billConfirmed]);

  // ── Payment rows ─────────────────────────────────────────────────────
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
  // While the user hasn't touched the payment rows, keep the single default
  // row's amount in sync with the live bill total — so adding accessories or
  // gifts in the cart auto-rebalances the row.
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
      if (merged.method === 'SAVING_WALLET') {
        merged.amount = Math.min(merged.amount, savingBalance);
      }
      if (updates.method === 'SAVING_WALLET' && !('amount' in updates)) {
        merged.amount = Math.min(p.amount, savingBalance);
      }
      return merged;
    }));
  };

  // ── Confirm payment → server cascades activation ─────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canConfirm = !!score && isBalanced && totalAmount > 0 && data.billId != null && data.billId > 0;

  const handleConfirm = async () => {
    if (!canConfirm || !data.contractId || !data.billId) return;
    setLoading(true);
    setError('');
    try {
      for (const payment of payments) {
        await apiClient.rpc('fn_bill_payment_add', {
          p_bill_id: data.billId,
          p_method: payment.method,
          p_amount: payment.amount,
          p_bank_account_id: payment.method === 'TRANSFER' ? payment.bank_account_id : null,
        });
      }
      await apiClient.rpc('fn_bill_payment_confirm', {
        p_bill_id: data.billId,
        p_contract_id: data.contractId,
      });
      updateData({ billConfirmed: true });
      invalidateContract();
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

  // ── Post-confirm: section IS the printable receipt + footer actions ──
  if (data.billConfirmed && data.billId) {
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
            <div className="alert alert-warning mt-2">
              <AlertTriangle size={16} />
              <span>{t('workspace.confidenceRequired')}</span>
            </div>
          )}
        </div>

        {/* ── Section 2: Bill / Cart ────────────────────────────── */}
        <div>
          <label className="form-label">{t('workspace.billPreview')}</label>
          {data.billId && data.billId > 0 ? (
            <BillCart
              billId={data.billId}
              branchId={contract?.branch_id ?? null}
              onChange={() => queryClient.invalidateQueries({ queryKey: ['bill-detail', data.billId] })}
            />
          ) : autoOpenError ? (
            <div className="alert alert-danger">
              <XCircle size={14} />
              <span>{autoOpenError}</span>
            </div>
          ) : readinessErrors.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-subtle p-3 border border-line rounded-md">
              <Loader2 size={14} className="animate-spin" />
              <span>{t('workspace.openingBill')}</span>
            </div>
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

        {/* ── Section 3: Payment Methods (only once bill is open) ── */}
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
                      <Button
                        size="sm"
                        className="btn-icon-sm shrink-0"
                        onClick={() => {
                          userEditedPayments.current = true;
                          setPayments(prev => prev.filter((_, i) => i !== idx));
                        }}
                      >
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
              <Button
                size="sm"
                onClick={() => {
                  const remaining = totalAmount - totalPayment;
                  userEditedPayments.current = true;
                  setPayments(prev => [...prev, { method: 'CASH', amount: remaining > 0 ? remaining : 0, bank_account_id: null }]);
                }}
                startIcon={<Plus size={14} />}
              >
                {t('wizard.addPayment')}
              </Button>
            </div>

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

        {/* ── Confirm error ────────────────────────────────────── */}
        {error && (
          <div className="alert alert-danger">
            <XCircle size={16} />
            <div><div className="alert-description">{error}</div></div>
          </div>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-line bg-bg px-4 py-3 flex justify-end gap-2">
        <Button
          color="primary"
          onClick={handleConfirm}
          disabled={!canConfirm || loading}
          startIcon={loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
        >
          {loading ? t('common.loading') : t('wizard.confirmPayment')}
        </Button>
      </div>
    </div>
  );
}
