import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Select, MaskedInput, Input, Badge, PopOver } from 'tsp-form';
import { Plus, Trash2, XCircle, AlertCircle, ChevronsRight, Loader2, CheckCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { BranchPaymentAccountField } from '../../components/BranchPaymentAccountField';
import { ActionDoneView, type ActionDoneDetailRow } from './ActionDoneView';
import { translateApiError } from '../../lib/apiErrors';

/* ─────────────────────────────────────────────────────────────────────────────
   Contract Fee (CONTRACT_FEE) — เปิดบิลค่าปรับ/บริการ on an ACTIVE contract.

   3-step cart flow (doc 37 §4), reachable from the contract action grid as the
   SERVICE_CHARGE action. Data-driven throughout:
     • charge types  ← v_bill_line_addable_by_purpose?bill_purpose=eq.CONTRACT_FEE&is_user_addable=eq.true
     • owner_type    ← auto-bound per charge row (never user-picked, doc 37 §13.1)
     • methods       ← v_purpose_allowed_methods?bill_purpose=eq.CONTRACT_FEE&is_active=eq.true

   Server sequence on Confirm (no batch RPC — loop like PanelReviewPay/RETAIL):
     fn_bill_create(CONTRACT_FEE, lines) → loop fn_bill_payment_add → fn_bill_payment_confirm
   The backend splits revenue per line owner_type and (for wallet methods) creates
   the JOURNAL companion bill itself at confirm.
   ──────────────────────────────────────────────────────────────────────────── */

interface ContractForFee {
  id: number;
  code: string;
  code_display: string | null;
  state: string;
  branch_id: number;
  company_id?: number | null;
  holding_id: number;
  customer_id?: number | null;
  saving_balance: number | null;
  credit_balance: number | null;
  insurance_balance: number | null;
}

interface AddableChargeRow {
  charge_type: string;
  owner_type: 'COMPANY' | 'HOLDING';
  name_th: string;
  name_en: string;
  sort_order: number;
  is_user_addable: boolean;
}

interface AllowedMethodRow {
  method: PaymentMethod;
  is_wallet: boolean;
  is_active: boolean;
}

type PaymentMethod = 'CASH' | 'TRANSFER' | 'SAVING_WALLET' | 'CREDIT_WALLET' | 'INSURANCE_WALLET';

const WALLET_BALANCE_FIELD: Partial<Record<PaymentMethod, keyof ContractForFee>> = {
  SAVING_WALLET: 'saving_balance',
  CREDIT_WALLET: 'credit_balance',
  INSURANCE_WALLET: 'insurance_balance',
};

let lineIdCounter = 0;
const nextLineId = () => `cfee-${++lineIdCounter}`;

interface CartLine {
  id: string;
  charge_type: string;
  owner_type: 'COMPANY' | 'HOLDING';
  description: string;
  amount: number;
}

interface PaymentRow {
  method: PaymentMethod;
  amount: number;
  bank_account_id: number | null;
}

interface BillCreateResult {
  bill_id: number;
  code_display?: string;
  bill_code?: string;
  status?: string;
}

export function ContractFeeModal({ open, contract, onClose, onSuccess }: {
  open: boolean;
  contract: ContractForFee | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: 'CASH', amount: 0, bank_account_id: null }]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ billId: number; code: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // Add-line composer state
  const [addOpen, setAddOpen] = useState(false);
  const [draftCharge, setDraftCharge] = useState<AddableChargeRow | null>(null);
  const [draftDesc, setDraftDesc] = useState('');
  const [draftAmount, setDraftAmount] = useState('');

  const resetForm = () => {
    setView('form');
    setLines([]);
    setPayments([{ method: 'CASH', amount: 0, bank_account_id: null }]);
    setError('');
    setSubmitting(false);
    setResult(null);
    setConfirmClose(false);
    setAddOpen(false);
    setDraftCharge(null);
    setDraftDesc('');
    setDraftAmount('');
  };

  useEffect(() => {
    if (open) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Data-driven charge types (doc 37 §13.4) — only is_user_addable rows.
  const { data: chargeTypes = [] } = useQuery({
    queryKey: ['contract-fee-charge-types'],
    queryFn: () => apiClient.get<AddableChargeRow[]>(
      '/v_bill_line_addable_by_purpose?bill_purpose=eq.CONTRACT_FEE&is_user_addable=eq.true&order=sort_order',
    ),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  // Data-driven payment methods (doc 37 §13.4).
  const { data: methodRows = [] } = useQuery({
    queryKey: ['contract-fee-methods'],
    queryFn: () => apiClient.get<AllowedMethodRow[]>(
      '/v_purpose_allowed_methods?bill_purpose=eq.CONTRACT_FEE&is_active=eq.true',
    ),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const chargeLabel = (row: { name_th: string; name_en: string; charge_type: string }) =>
    (i18n.language === 'th' ? row.name_th : row.name_en) || row.charge_type;

  const methodOptions = useMemo(
    () => methodRows.map(m => ({ value: m.method, label: t(`paymentMethod.${m.method}`, { defaultValue: m.method }) })),
    [methodRows, t],
  );
  const walletMethods = useMemo(
    () => new Set(methodRows.filter(m => m.is_wallet).map(m => m.method)),
    [methodRows],
  );

  // ── Totals + owner subtotals (doc 37 §13.2 preview) ─────────────────────
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const holdingSubtotal = lines.filter(l => l.owner_type === 'HOLDING').reduce((s, l) => s + l.amount, 0);
  const companySubtotal = lines.filter(l => l.owner_type === 'COMPANY').reduce((s, l) => s + l.amount, 0);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const isBalanced = total > 0 && Math.abs(totalPaid - total) < 0.01;

  const isDirty = lines.length > 0 || payments.some(p => p.amount > 0);

  // ── Add / remove lines ──────────────────────────────────────────────────
  const handlePickCharge = (row: AddableChargeRow) => {
    setAddOpen(false);
    setDraftCharge(row);
    setDraftDesc(chargeLabel(row));
    setDraftAmount('');
  };

  const handleAddLine = () => {
    if (!draftCharge) return;
    const amount = parseFloat(draftAmount) || 0;
    if (!draftDesc.trim() || amount <= 0) return;
    setLines(prev => [...prev, {
      id: nextLineId(),
      charge_type: draftCharge.charge_type,
      owner_type: draftCharge.owner_type,
      description: draftDesc.trim(),
      amount,
    }]);
    setDraftCharge(null);
    setDraftDesc('');
    setDraftAmount('');
  };

  const removeLine = (id: string) => setLines(prev => prev.filter(l => l.id !== id));

  // ── Payments ────────────────────────────────────────────────────────────
  const updatePayment = (idx: number, patch: Partial<PaymentRow>) => {
    setPayments(prev => prev.map((p, i) => {
      if (i !== idx) return p;
      const merged = { ...p, ...patch };
      // Cap wallet payments at the contract's balance (fast client check, doc 37 §13.3).
      const field = WALLET_BALANCE_FIELD[merged.method];
      if (field && contract) {
        const bal = (contract[field] as number | null) ?? 0;
        merged.amount = Math.min(merged.amount, bal);
      }
      return merged;
    }));
  };

  const addPaymentRow = () => {
    const remaining = Math.max(0, total - totalPaid);
    setPayments(prev => [...prev, { method: 'CASH', amount: remaining, bank_account_id: null }]);
  };

  const removePaymentRow = (idx: number) =>
    setPayments(prev => prev.filter((_, i) => i !== idx));

  const walletBalance = (m: PaymentMethod): number | null => {
    const field = WALLET_BALANCE_FIELD[m];
    if (!field || !contract) return null;
    return (contract[field] as number | null) ?? 0;
  };

  // ── Validation ──────────────────────────────────────────────────────────
  // displayReasons surface only the non-obvious blockers (bank account, wallet
  // funds). Empty-cart and unbalanced are already obvious from the cart + the
  // running paid/total box, so we don't nag about them — the button just stays
  // disabled. The server re-validates balance on confirm (BILL_PAYMENT.AMOUNT_MISMATCH).
  const displayReasons: string[] = [];
  payments.forEach(p => {
    if (p.method === 'TRANSFER' && p.amount > 0 && !p.bank_account_id) {
      displayReasons.push(t('contractFee.blockNoBank'));
    }
    const bal = walletBalance(p.method);
    if (bal != null && p.amount > bal) {
      displayReasons.push(t('contractFee.blockWalletInsufficient', { method: t(`paymentMethod.${p.method}`) }));
    }
  });
  const canSubmit = lines.length > 0 && isBalanced && displayReasons.length === 0 && !submitting && !!contract;

  // ── Confirm — full server sequence ──────────────────────────────────────
  const handleConfirm = async () => {
    if (!canSubmit || !contract) return;
    setSubmitting(true);
    setError('');
    try {
      // 1. Open bill with all lines (mixed owner OK).
      const created = await apiClient.rpc<BillCreateResult>('fn_bill_create', {
        p_branch_id: contract.branch_id,
        p_customer_id: contract.customer_id ?? null,
        p_contract_id: contract.id,
        p_bill_purpose: 'CONTRACT_FEE',
        p_line_items: lines.map(l => ({
          charge_type: l.charge_type,
          description: l.description,
          amount: l.amount,
          owner_type: l.owner_type,
          owner_id: l.owner_type === 'HOLDING' ? contract.holding_id : (contract.company_id ?? user?.company_id ?? null),
          ref_type: 'CONTRACT',
          ref_id: contract.id,
          quantity: 1,
        })),
        p_created_by: user?.user_id ?? null,
      });
      const billId = created.bill_id;

      // 2. Record each payment. Wallet methods must carry p_contract_id.
      for (const p of payments) {
        if (p.amount <= 0) continue;
        await apiClient.rpc('fn_bill_payment_add', {
          p_bill_id: billId,
          p_method: p.method,
          p_amount: p.amount,
          p_bank_account_id: p.method === 'TRANSFER' ? p.bank_account_id : null,
          p_added_by: user?.user_id ?? null,
          p_contract_id: walletMethods.has(p.method) ? contract.id : null,
        });
      }

      // 3. Confirm — server splits revenue + builds wallet JOURNAL companion.
      await apiClient.rpc('fn_bill_payment_confirm', {
        p_bill_id: billId,
        p_contract_id: contract.id,
        p_confirmed_by: user?.user_id ?? null,
      });

      setResult({ billId, code: created.code_display ?? created.bill_code ?? String(billId) });
      setView('done');
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Close handling (write-modal checklist rule 3) ───────────────────────
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const contractCode = contract?.code_display ?? contract?.code ?? '';

  const doneDetailRows: ActionDoneDetailRow[] = result ? [
    { label: t('contractFee.total'), value: fmtCurrency(total), emphasis: true },
    ...(holdingSubtotal > 0 ? [{ label: t('contractFee.holdingSubtotal'), value: fmtCurrency(holdingSubtotal) }] : []),
    ...(companySubtotal > 0 ? [{ label: t('contractFee.companySubtotal'), value: fmtCurrency(companySubtotal) }] : []),
  ] : [];

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="40rem" width="100%" ariaLabel="Contract Fee">
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('contractFee.title')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={t('contractFee.done')}
              contractCode={contractCode}
              billId={result.billId}
              detailRows={doneDetailRows}
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content flex flex-col gap-4">
                {/* Contract target */}
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                  {contract?.state && (
                    <div className="text-xs text-subtle">
                      {t(`contract.state_${contract.state}`, { defaultValue: contract.state })}
                    </div>
                  )}
                </div>

                {/* ── Cart ──────────────────────────────────────────── */}
                <div className="flex flex-col gap-2">
                  <label className="form-label">{t('contractFee.linesLabel')}</label>
                  <div className="border border-line rounded-md overflow-hidden">
                    {lines.length === 0 ? (
                      <div className="py-8 text-center text-subtler text-sm">{t('contractFee.emptyCart')}</div>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-line">
                          {lines.map(line => (
                            <tr key={line.id}>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <Badge size="sm" color={line.owner_type === 'HOLDING' ? 'warning' : 'default'}>
                                    {t(`contractFee.owner_${line.owner_type}`)}
                                  </Badge>
                                  <span className="truncate">{line.description}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{fmtCurrency(line.amount)}</td>
                              <td className="px-3 py-2 w-10">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="btn-icon-sm"
                                  startIcon={<Trash2 size={14} />}
                                  onClick={() => removeLine(line.id)}
                                  aria-label="Remove"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <PopOver
                    isOpen={addOpen}
                    onClose={() => setAddOpen(false)}
                    trigger={
                      <Button
                        size="sm"
                        color="primary"
                        startIcon={<Plus size={14} />}
                        onClick={() => setAddOpen(v => !v)}
                        className="self-start"
                      >
                        {t('contractFee.addLine')}
                      </Button>
                    }
                    placement="bottom"
                    align="start"
                    minWidth="16rem"
                  >
                    <div className="flex flex-col py-1">
                      {chargeTypes.map(row => (
                        <button
                          key={row.charge_type}
                          type="button"
                          className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-left bg-transparent border-none cursor-pointer hover:bg-surface-hover"
                          onClick={() => handlePickCharge(row)}
                        >
                          <span>{chargeLabel(row)}</span>
                          <Badge size="sm" color={row.owner_type === 'HOLDING' ? 'warning' : 'default'}>
                            {t(`contractFee.owner_${row.owner_type}`)}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  </PopOver>

                  {/* Owner subtotals preview (doc 37 §13.2) */}
                  {lines.length > 0 && (holdingSubtotal > 0 && companySubtotal > 0) && (
                    <div className="flex flex-col gap-0.5 text-xs text-subtle pl-1">
                      <div className="flex justify-between"><span>{t('contractFee.companySubtotal')}</span><span className="tabular-nums">{fmtCurrency(companySubtotal)}</span></div>
                      <div className="flex justify-between"><span>{t('contractFee.holdingSubtotal')}</span><span className="tabular-nums">{fmtCurrency(holdingSubtotal)}</span></div>
                    </div>
                  )}
                </div>

                {/* ── Payments ──────────────────────────────────────── */}
                <div className="flex flex-col gap-2">
                  <label className="form-label">{t('contractFee.paymentsLabel')}</label>
                  <div className="flex flex-col gap-3">
                    {payments.map((p, idx) => {
                      const bal = walletBalance(p.method);
                      return (
                        <div key={idx} className="border border-line rounded-lg p-3 flex flex-col gap-3">
                          <div className="flex gap-3 items-end">
                            <div className="flex flex-col" style={{ width: '11rem' }}>
                              <label className="form-label text-xs">{t('wizard.method')}</label>
                              <Select
                                options={methodOptions}
                                value={p.method}
                                onChange={(v) => updatePayment(idx, { method: (v as PaymentMethod) ?? 'CASH', bank_account_id: null })}
                                size="sm"
                                searchable={false}
                              />
                            </div>
                            <div className="flex flex-col flex-1 min-w-0">
                              <label className="form-label text-xs">{t('contract.amount')}</label>
                              <MaskedInput
                                mask="number"
                                decimalScale={2}
                                value={p.amount ? String(p.amount) : ''}
                                onChange={(raw) => updatePayment(idx, { amount: parseFloat(raw) || 0 })}
                                size="sm"
                                className="w-full"
                                placeholder="0.00"
                                endIcon={<ChevronsRight size={14} />}
                                onEndIconClick={() => {
                                  const others = payments.reduce((s, q, i) => i === idx ? s : s + (q.amount || 0), 0);
                                  const remaining = Math.max(0, total - others);
                                  const fill = bal != null ? Math.min(bal, remaining) : remaining;
                                  updatePayment(idx, { amount: fill });
                                }}
                              />
                            </div>
                            {payments.length > 1 && (
                              <Button
                                size="sm"
                                className="shrink-0"
                                startIcon={<Trash2 size={14} />}
                                onClick={() => removePaymentRow(idx)}
                                aria-label="Remove payment"
                              />
                            )}
                          </div>
                          {bal != null && (
                            <span className="text-[11px] text-subtle -mt-1 tabular-nums">
                              {t('contractFee.balance')}: {fmtCurrency(bal)}
                            </span>
                          )}
                          {p.method === 'TRANSFER' && (
                            <BranchPaymentAccountField
                              active={p.method === 'TRANSFER'}
                              onResolve={(id) => updatePayment(idx, { bank_account_id: id })}
                            />
                          )}
                        </div>
                      );
                    })}
                    <Button size="sm" startIcon={<Plus size={14} />} onClick={addPaymentRow} className="self-start">
                      {t('wizard.addPayment')}
                    </Button>
                  </div>

                  <div className={`flex justify-between items-center p-3 rounded-lg border mt-1 ${
                    isBalanced ? 'border-success-border bg-success-soft' : 'border-warning-border bg-warning-soft'
                  }`}>
                    <span className="text-sm">
                      {t('contractFee.paid')} / {t('contractFee.total')}
                    </span>
                    <span className={`font-semibold tabular-nums ${isBalanced ? 'text-success' : 'text-warning-fg'}`}>
                      {fmtCurrency(totalPaid)} / {fmtCurrency(total)}
                    </span>
                  </div>
                </div>

                {error && (
                  <div className="alert alert-danger">
                    <XCircle size={16} />
                    <div className="alert-description">{error}</div>
                  </div>
                )}
              </div>

              <div className="modal-footer flex-col items-stretch gap-2">
                {displayReasons.length > 0 && (
                  <div className="alert alert-warning">
                    <AlertCircle size={16} />
                    <ul className="list-disc pl-4 text-sm space-y-0.5">
                      {[...new Set(displayReasons)].map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                  <Button
                    color="primary"
                    disabled={!canSubmit}
                    startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                    onClick={handleConfirm}
                  >
                    {submitting ? t('common.loading') : t('contractFee.confirm')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Add-line free-form composer */}
        <Modal open={draftCharge != null} onClose={() => setDraftCharge(null)} maxWidth="24rem" width="100%">
          <div className="modal-header">
            <h2 className="modal-title">{draftCharge ? chargeLabel(draftCharge) : ''}</h2>
            <button type="button" className="modal-close-btn" onClick={() => setDraftCharge(null)} aria-label="Close">×</button>
          </div>
          <div className="modal-content">
            <div className="form-grid">
              <div className="flex flex-col">
                <label className="form-label">{t('contractFee.lineDescription')}</label>
                <Input size="sm" className="w-full" value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('contract.amount')}</label>
                <MaskedInput
                  mask="number"
                  decimalScale={2}
                  value={draftAmount}
                  onChange={setDraftAmount}
                  size="sm"
                  className="w-full"
                  placeholder="0.00"
                  autoFocus
                />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <Button variant="outline" onClick={() => setDraftCharge(null)}>{t('common.cancel')}</Button>
            <Button
              color="primary"
              startIcon={<Plus size={14} />}
              disabled={!draftDesc.trim() || !(parseFloat(draftAmount) > 0)}
              onClick={handleAddLine}
            >
              {t('common.add')}
            </Button>
          </div>
        </Modal>
      </Modal>

      {/* Discard-confirm sub-modal (always mounted) */}
      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
