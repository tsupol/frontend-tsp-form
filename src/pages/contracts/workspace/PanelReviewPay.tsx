import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Select, MaskedInput } from 'tsp-form';
import {
  Plus, Trash2, XCircle, Loader2, CheckCircle,
  ChevronsRight, Link2, FileText, Printer, PenLine,
} from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../../../lib/format';
import { printWithMarker } from '../../../lib/printDoc';
import { useWorkspace } from './WorkspaceContext';
import type { PaymentMethod, PaymentLine, BillOpenResult } from './WorkspaceTypes';
import { ERROR_TO_MODAL } from './WorkspaceTypes';
import { BranchPaymentAccountField, useBranchPaymentAccount } from '../../../components/BranchPaymentAccountField';
import { BillReceipt, type BillDetail } from './BillReceipt';
import { BillCart, type DraftCartLine } from './BillCart';
import { signContractOpenParties } from './signContractOpenParties';

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

const BASE_PAYMENT_METHOD_VALUES = ['CASH', 'TRANSFER'] as const;

interface ReadinessResult {
  ready: boolean;
  errors: Array<{ code: string; detail?: Record<string, unknown> }>;
}

export function PanelReviewPay({ onClose: _onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, updateData, contract, invalidateContract, setOpenModal } = useWorkspace();

  const savingBalance = contract?.saving_balance ?? 0;

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

  // FIN2 with no down payment collects only the insurance fund at contract open.
  // If it's left at 0 the whole bill is 0 — nothing to charge, so activation
  // can't proceed. Surface this as a clear blocker pointing at the Insurance
  // step. (Reacts to FIN2/insurance changes via the contract query: editing the
  // insurance deposit invalidates the contract and recomputes totalAmount here.)
  const isFin2 = contract?.commercial_model === 'FIN2';
  const needsInsuranceFund = isFin2 && totalAmount <= 0;

  // ── Payment rows ─────────────────────────────────────────────────────
  const paymentMethodOptions = useMemo(() => {
    const opts = BASE_PAYMENT_METHOD_VALUES.map(v => ({ value: v as string, label: t(`paymentMethod.${v}`) }));
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

  // Single override-aware receiving account for this (own) branch. Used to
  // label the printed receipt's TRANSFER lines; the picker auto-selects it.
  const { data: paymentAccount = null } = useBranchPaymentAccount();

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

  // Commission owner moved to its own step (CardCommissionOwner /
  // PanelCommissionOwner) — block below Customer in the left summary.

  // ── Unofficial invoice print ─────────────────────────────────────────
  // No bill exists in DRAFT, so we print the staged cart through the SAME
  // BillReceipt + print isolation used everywhere else (BillsPage pattern:
  // mount the receipt off-screen via a body portal, then window.print()).
  // The receipt is fed a pre-built BillDetail — header shows the contract
  // code, not a bill number. There is no on-screen receipt and exactly one
  // .bill-receipt node at print time, so print isolation is unchanged.
  const draftBill = useMemo<BillDetail | null>(() => {
    if (!contract) return null;
    const lineItems = [
      ...systemLines.map((l, i) => ({
        line_id: -1 - i,
        description: l.description,
        charge_type: l.key,
        amount: l.amount,
        quantity: 1,
      })),
      ...cartLines.map((l, i) => ({
        line_id: 1000 + i,
        description: l.description,
        charge_type: l.charge_type,
        amount: l.as_gift ? 0 : l.amount,
        quantity: l.quantity,
      })),
    ];
    const billPayments = payments
      .filter(p => p.amount > 0)
      .map((p, i) => {
        const bank = p.bank_account_id != null && p.bank_account_id === paymentAccount?.account_id
          ? paymentAccount
          : null;
        return {
          id: i,
          code_display: '',
          method: p.method,
          amount: p.amount,
          bank_name: bank?.bank_name ?? null,
          account_number: bank?.account_number_display ?? bank?.account_number ?? null,
          reference: null,
        };
      });
    const paid = billPayments.reduce((s, p) => s + p.amount, 0);
    return {
      bill_id: -1,
      bill_code: '',
      bill_code_display: '—',
      bill_type: 'INVOICE',
      bill_purpose: 'CONTRACT_OPEN',
      ref_bill_id: null,
      ref_bill_code: null,
      branch_id: contract.branch_id,
      branch_name: contract.branch_name,
      customer_id: contract.customer_id,
      customer_name: contract.customer_name,
      customer_tel: null,
      contract_id: contract.id,
      contract_code: contract.code_display ?? contract.code,
      total_amount: totalAmount,
      paid_amount: paid,
      change_amount: 0,
      status: 'OPEN',
      is_voided: false,
      bill_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      created_by_name: null,
      line_items: lineItems,
      payments: billPayments,
      cancel_info: null,
    };
  }, [contract, systemLines, cartLines, payments, paymentAccount, totalAmount]);

  const [printReady, setPrintReady] = useState(false);
  const handlePrintInvoice = useCallback(() => {
    if (!draftBill) return;
    setPrintReady(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      printWithMarker('bill');
      setPrintReady(false);
    }));
  }, [draftBill]);

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

      // 3. Bind the STAFF signatures (LESSOR + WITNESS) on the auto-created
      //    CONTRACT_OPEN snapshot. Opening the bill creates a COLLECTING
      //    FULL_CONTRACT snapshot whose parties (LESSEE + co-lessees + lessor +
      //    2 witnesses) all start unsigned. We bind only the pre-registered
      //    staff signatures here; the customer parties (LESSEE/CO_LESSEE) stay
      //    COLLECTING and sign later on the capture bridge (iPad QR). So the
      //    contract does NOT activate at confirm — it sits at PENDING_SIGN until
      //    the customer signs. (UI_FEEDBACK signing-bridge GUIDE §6.1.)
      const signRes = await signContractOpenParties(data.contractId);
      if (signRes.unsigned.length > 0) {
        const who = signRes.unsigned
          .map(u => u.name || t(`signing.role_${u.role}`, { defaultValue: u.role }))
          .join(', ');
        throw new Error(
          t('wizard.signMissingStaffSignatures', {
            defaultValue: 'Cannot proceed — branch signatory not set for: {{who}}',
            who,
          }),
        );
      }

      // 4. Record payments.
      for (const payment of payments) {
        await apiClient.rpc('fn_bill_payment_add', {
          p_bill_id: bill.bill_id,
          p_method: payment.method,
          p_amount: payment.amount,
          p_bank_account_id: payment.method === 'TRANSFER' ? payment.bank_account_id : null,
        });
      }

      // 5. Confirm payment. Contract moves to PENDING_SIGN (paid, awaiting the
      //    customer signature on the bridge) — it activates only after the
      //    snapshot seals once the customer has signed.
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
            rowAction={
              <Button
                size="sm"
                variant="outline"
                startIcon={<Printer size={14} />}
                onClick={handlePrintInvoice}
              >
                {t('workspace.previewInvoice', { defaultValue: 'Print invoice' })}
              </Button>
            }
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
                    <BranchPaymentAccountField
                      active={payment.method === 'TRANSFER'}
                      onResolve={(id) => updatePayment(idx, { bank_account_id: id })}
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
            isBalanced ? 'border-success-border bg-success-soft' : 'border-warning-border bg-warning-soft'
          }`}>
            <span className="text-sm">{t('wizard.totalPayment')}</span>
            <span className={`font-semibold tabular-nums ${isBalanced ? 'text-success' : 'text-warning-fg'}`}>
              {fmtCurrency(totalPayment)}
            </span>
          </div>
        </div>

        {/* Confidence score moved to the Documents step (it's a readiness
            prerequisite, surfaced there with the other missing-field items). */}

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
        {needsInsuranceFund && (
          <>
            <div className="px-4 py-2">
              <div className="alert alert-danger">
                <XCircle size={16} />
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <button
                    type="button"
                    className="text-left bg-transparent border-none p-0 text-danger hover:underline cursor-pointer text-sm"
                    onClick={() => setOpenModal('insurance')}
                  >
                    {t('wizard.fin2NeedsInsuranceFund')}
                  </button>
                </div>
              </div>
            </div>
            <div className="border-t border-line" />
          </>
        )}
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

      {/* Unofficial invoice print — same off-screen body portal + isolation
          as BillsPage. Exactly one .bill-receipt node, only at print time. */}
      {printReady && draftBill && createPortal(
        <div className="print-only-receipt" aria-hidden>
          <BillReceipt bill={draftBill} hidePrintButton unofficial />
        </div>,
        document.body,
      )}
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
      printWithMarker('bill');
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
            {t('wizard.bill_confirmed_body_signing', { defaultValue: 'The bill has been recorded. Next, have the customer sign on the Signing tab.' })}
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-line bg-bg px-4 py-3 flex justify-end gap-2 print:hidden">
        <Button variant="outline" startIcon={<Printer size={16} />} onClick={handlePrint}>
          {t('wizard.receipt_print')}
        </Button>
        {needsBindDevice && contractId != null && (
          <Button
            variant="outline"
            startIcon={<Link2 size={16} />}
            onClick={() => onNavigate(`/admin/contracts/pending-pairing/${contractId}?tab=device`)}
          >
            {t('wizard.action_bindDevice')}
          </Button>
        )}
        {contractId != null && (
          <Button
            variant="outline"
            startIcon={<FileText size={16} />}
            onClick={() => onNavigate(`/admin/contracts/search/${contractId}`)}
          >
            {t('wizard.action_viewInContract')}
          </Button>
        )}
        {contractId != null && (
          <Button
            color="primary"
            startIcon={<PenLine size={16} />}
            onClick={() => onNavigate(`/admin/contracts/search/${contractId}?tab=signing`)}
          >
            {t('wizard.action_goToSigning', { defaultValue: 'Go to signing' })}
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
