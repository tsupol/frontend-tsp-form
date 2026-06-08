import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Select, MaskedInput } from 'tsp-form';
import {
  Star, Plus, Trash2, XCircle, Loader2, CheckCircle,
  ChevronsRight, Link2, FileText, Printer,
} from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import type { PaymentMethod, PaymentLine, BankAccount, BillOpenResult } from './WorkspaceTypes';
import { ERROR_TO_MODAL } from './WorkspaceTypes';
import { BillReceipt } from './BillReceipt';
import { BillCart, type DraftCartLine } from './BillCart';

/* ─────────────────────────────────────────────────────────────────────────────
   ⚠️  ONE-GO ACTIVATION — DO NOT FIRE BILL/ACTIVATE RPCs ON MOUNT.

   The user only ever changes contract state by clicking "Confirm & Activate".
   Nothing in this panel may call:
     • fn_bill_contract_open  (DRAFT/SAVING → PENDING_PAYMENT)
     • fn_bill_line_item_add / _remove
     • fn_bill_payment_add / _confirm
     • fn_contract_activate
   …from a useEffect, on render, or from any "preview" path. They are all
   server-side state changes.

   The cart in <BillCart /> is purely client-side until Confirm runs the full
   sequence in this file. The previous version auto-opened the bill on mount,
   which silently flipped contracts to PENDING_PAYMENT just by viewing the
   screen — that is the bug we are NOT going back to.
   ──────────────────────────────────────────────────────────────────────── */

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

  // ── Confidence score (UI gate for Confirm only) ──────────────────────
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
      // Readiness check depends on the score — refetch it now so the
      // blocker alert + Confirm gate update immediately.
      queryClient.invalidateQueries({ queryKey: ['contract-readiness', data.contractId] });
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

  // ── Readiness check (read-only — DOES NOT open the bill) ─────────────
  // fn_contract_validate_ready is pure: it returns blockers and never
  // mutates state. We poll it so the user sees blockers inline before they
  // click Confirm — that click is the only thing that may change state.
  const { data: readiness, isFetching: readinessFetching } = useQuery({
    queryKey: ['contract-readiness', data.contractId],
    queryFn: () => apiClient.rpc<ReadinessResult>('fn_contract_validate_ready', {
      p_contract_id: data.contractId,
    }),
    enabled: !!data.contractId && !data.billConfirmed,
    staleTime: 0,
  });
  // While the readiness query is refetching after an action (score set, etc.)
  // we treat the result as "unknown" so the alert doesn't show stale blockers
  // and Confirm doesn't reactivate prematurely.
  const readinessErrors = !readiness || readinessFetching || readiness.ready ? [] : readiness.errors;
  const readinessKnown = !!readiness && !readinessFetching;
  const readinessReady = readinessKnown && readiness.ready;

  // ── System (auto) lines — shown read-only at the top of the cart ─────
  const downPayment = contract?.down_payment ?? 0;
  const insuranceDeposit = contract?.insurance_deposit ?? 0;
  const systemLines = useMemo(() => {
    const items: Array<{ key: string; description: string; amount: number }> = [];
    if (downPayment > 0) items.push({ key: 'down', description: t('contract.downPayment'), amount: downPayment });
    if (insuranceDeposit > 0) items.push({ key: 'insurance', description: t('contract.insuranceDeposit'), amount: insuranceDeposit });
    return items;
  }, [downPayment, insuranceDeposit, t]);

  // ── Draft cart (client-side only, until Confirm) ─────────────────────
  const [cartLines, setCartLines] = useState<DraftCartLine[]>([]);
  const cartChargeTotal = cartLines.reduce((sum, l) => sum + (l.as_gift ? 0 : l.amount), 0);
  const totalAmount = downPayment + insuranceDeposit + cartChargeTotal;

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
  // Auto-sync the single default payment row's amount to the cart total
  // until the user manually edits a row.
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

  // ── Confirm & Activate (the ONLY user action that mutates state) ─────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canConfirm = readinessReady
    && isBalanced
    && totalAmount > 0
    && !!data.contractId
    && !loading;

  const handleConfirm = async () => {
    if (!canConfirm || !data.contractId) return;
    setLoading(true);
    setError('');
    try {
      // 1. Open the bill — DRAFT/SAVING → PENDING_PAYMENT.
      const bill = await apiClient.rpc<BillOpenResult>('fn_bill_contract_open', {
        p_contract_id: data.contractId,
      });
      updateData({ billId: bill.bill_id, billCode: bill.bill_code, billData: bill });

      // 2. Add each cart line. GIFT entries are a two-step: add as
      //    ACCESSORY_SALE then convert. (The backend has no batch add.)
      for (const line of cartLines) {
        const added = await apiClient.rpc<{ line_item_id: number }>(
          'fn_bill_line_item_add',
          {
            p_bill_id: bill.bill_id,
            p_line_type: line.line_type,
            p_charge_type: line.charge_type,
            p_description: line.description,
            p_amount: line.amount,
            p_quantity: line.quantity,
            p_variant_id: line.variant_id,
          },
        );
        if (line.as_gift) {
          await apiClient.rpc('fn_bill_line_convert_to_gift', { p_line_id: added.line_item_id });
        }
      }

      // 3. Record payments.
      for (const payment of payments) {
        await apiClient.rpc('fn_bill_payment_add', {
          p_bill_id: bill.bill_id,
          p_method: payment.method,
          p_amount: payment.amount,
          p_bank_account_id: payment.method === 'TRANSFER' ? payment.bank_account_id : null,
        });
      }

      // 4. Confirm — server cascades to ACTIVE.
      await apiClient.rpc('fn_bill_payment_confirm', {
        p_bill_id: bill.bill_id,
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

  // ── Post-confirm: confirmation summary + direct print via portal ──
  // No on-screen receipt preview. Print goes through the same
  // createPortal(.print-only-receipt, body) pattern as BillsPage /
  // ContractDetailPanel so the 80mm @page resolves cleanly.
  if (data.billConfirmed && data.billId) {
    const needsBindDevice = contract != null && contract.device_id == null;
    return (
      <PostConfirmView
        billId={data.billId}
        contractId={data.contractId ?? null}
        needsBindDevice={needsBindDevice}
        onNavigate={navigate}
        t={t}
      />
    );
  }

  return (
    <div className="flex flex-col h-full max-w-2xl">
      <div className="flex-1 overflow-y-auto better-scroll p-4 flex flex-col gap-5">

        {/* ── Section 1: Bill / Cart ───────────────────────────── */}
        <div>
          <label className="form-label">{t('workspace.billPreview')}</label>
          <BillCart
            branchId={contract?.branch_id ?? null}
            systemLines={systemLines}
            lines={cartLines}
            onChange={setCartLines}
          />
        </div>

        {/* ── Section 2: Payment Methods ───────────────────────── */}
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
                      className="shrink-0"
                      startIcon={<Trash2 size={14} />}
                      onClick={() => {
                        userEditedPayments.current = true;
                        setPayments(prev => prev.filter((_, i) => i !== idx));
                      }}
                    />
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

        {/* ── Section 3: Confidence score (Confirm gate) ───────── */}
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
        </div>

        {/* ── Confirm error ────────────────────────────────────── */}
        {error && (
          <div className="alert alert-danger">
            <XCircle size={16} />
            <div><div className="alert-description">{error}</div></div>
          </div>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-line bg-bg flex flex-col">
        {readinessErrors.length > 0 && (
          <>
            <div className="px-4 py-2">
              <div className="alert alert-danger">
                <XCircle size={16} />
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  {readinessErrors.map((err, i) => {
                    const targetModal = ERROR_TO_MODAL[err.code];
                    const label = t(err.code, { ns: 'apiErrors', defaultValue: err.code });
                    return targetModal ? (
                      <button
                        key={i}
                        type="button"
                        className="text-left bg-transparent border-none p-0 text-danger hover:underline cursor-pointer text-sm"
                        onClick={() => setOpenModal(targetModal)}
                      >
                        {label}
                      </button>
                    ) : (
                      <span key={i} className="text-sm">{label}</span>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="border-t border-line" />
          </>
        )}
        <div className="px-4 py-3 flex justify-end gap-2">
          <Button
            color="primary"
            onClick={handleConfirm}
            disabled={!canConfirm}
            startIcon={loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
          >
            {loading ? t('common.loading') : t('wizard.confirmPayment')}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface PostConfirmViewProps {
  billId: number;
  contractId: number | null;
  needsBindDevice: boolean;
  onNavigate: (to: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
}

function PostConfirmView({ billId, contractId, needsBindDevice, onNavigate, t }: PostConfirmViewProps) {
  const queryClient = useQueryClient();
  const [printReady, setPrintReady] = useState(false);

  const handlePrint = useCallback(async () => {
    try {
      const billRows = await queryClient.fetchQuery({
        queryKey: ['bill-detail', billId],
        queryFn: () => apiClient.get<unknown[]>(`/v_bill_detail?bill_id=eq.${billId}`).then(rows => rows[0] ?? null),
      });
      const branchId = (billRows as { branch_id?: number } | null)?.branch_id;
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
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.print();
      setPrintReady(false);
    }));
  }, [billId, queryClient]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto better-scroll p-6 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <CheckCircle size={56} className="text-success" />
          <div className="text-lg font-semibold">{t('wizard.bill_confirmed_title', { defaultValue: 'Payment confirmed' })}</div>
          <div className="text-sm text-subtle">
            {t('wizard.bill_confirmed_body', { defaultValue: 'The bill has been recorded. Print the receipt or continue.' })}
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-line bg-bg px-4 py-3 flex justify-end gap-2 print:hidden">
        <Button variant="outline" startIcon={<Printer size={16} />} onClick={handlePrint}>
          {t('wizard.receipt_print')}
        </Button>
        {needsBindDevice && contractId != null && (
          <Button
            color="primary"
            startIcon={<Link2 size={16} />}
            onClick={() => onNavigate(`/admin/contracts/pending-pairing/${contractId}`)}
          >
            {t('wizard.action_bindDevice')}
          </Button>
        )}
        {contractId != null && (
          <Button
            variant={needsBindDevice ? 'outline' : 'solid'}
            color={needsBindDevice ? undefined : 'primary'}
            startIcon={<FileText size={16} />}
            onClick={() => onNavigate(`/admin/contracts/search/${contractId}`)}
          >
            {t('wizard.action_viewInContract')}
          </Button>
        )}
      </div>

      {printReady && createPortal(
        <div className="print-only-receipt" aria-hidden>
          <BillReceipt billId={billId} hidePrintButton />
        </div>,
        document.body,
      )}
    </div>
  );
}
