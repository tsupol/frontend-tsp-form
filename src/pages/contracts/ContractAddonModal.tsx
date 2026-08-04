import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Select, MaskedInput, NumberSpinner, PopOver } from 'tsp-form';
import { Plus, Trash2, XCircle, AlertCircle, ChevronsRight, Loader2, CheckCircle, Gift, ShoppingBag, Pencil } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { BranchPaymentAccountField } from '../../components/BranchPaymentAccountField';
import { ProductPickerModal, type SellableVariant } from '../../components/ProductPickerModal';
import { ActionDoneView, type ActionDoneDetailRow } from './ActionDoneView';

/* ─────────────────────────────────────────────────────────────────────────────
   Contract Add-on (CONTRACT_ADDON) — ขาย/แถมของภายหลัง on an ACTIVE contract.

   Doc 24 (UI_SUMMARY/24_CONTRACT_ADDON_FLOW.md). Two things a user can do:
     • ACCESSORY_SALE — customer buys an accessory after the contract is running
     • GIFT_LATE      — we give one away (compensation / service gesture)

   Server sequence on Confirm — all verified live against bill 4101/4102:

     fn_bill_create(CONTRACT_ADDON, p_line_items: [...all lines])
       → loop fn_bill_payment_add
       → fn_bill_payment_confirm

   Three things the flow depends on, each learned the hard way:

   1. p_line_items MUST be non-empty. fn_bill_create rejects [] with
      SALE.VALIDATION.LINE_ITEMS_REQUIRED, so there is no "open an empty bill then
      fill it" path — despite doc 24 §4.1 showing exactly that.

   2. GIFT_LATE goes straight into p_line_items. fn_bill_create auto-inserts the
      paired negative GIFT_LATE_DISCOUNT itself (net 0). The
      SALE.VALIDATION.USE_CONVERT_TO_GIFT guard that forces the add-then-convert
      dance lives in fn_bill_line_item_add — a DIFFERENT RPC this flow doesn't use.
      Calling fn_bill_line_convert_to_gift here would be wrong and unnecessary.

   3. p_amount is PER UNIT; the server multiplies it by quantity. Our cart tracks
      `amount` as the line total, so it must be divided before sending. Sending the
      total billed qty² — a 2× item at 500 total came back as a 1,000 bill.

   Gifts bill at catalog retail (the auto-paired discount cancels it), so a gift
   contributes 0 to what the customer owes but still moves stock and records its
   gross value for reporting.
   ──────────────────────────────────────────────────────────────────────────── */

interface ContractForAddon {
  id: number;
  code: string;
  code_display: string | null;
  state: string;
  branch_id: number;
  company_id?: number | null;
  holding_id: number;
  customer_id?: number | null;
}

interface AllowedMethodRow {
  method: PaymentMethod;
  is_wallet: boolean;
  is_active: boolean;
}

/** CONTRACT_ADDON allows CASH + TRANSFER only (v_purpose_allowed_methods, verified live). */
type PaymentMethod = 'CASH' | 'TRANSFER';

interface BillCreateResult {
  bill_id: number;
  code_display?: string;
  bill_code?: string;
}

let lineIdCounter = 0;
const nextLineId = () => `addon-${++lineIdCounter}`;

interface CartLine {
  id: string;
  description: string;
  /** Unit price × qty for a sale. Gift lines carry 0 — the customer pays nothing. */
  amount: number;
  quantity: number;
  variant_id: number;
  /** Add as ACCESSORY_SALE then convert to GIFT_LATE. */
  as_gift: boolean;
  /** Catalog total at pick time, so we can show a negotiated override struck through. */
  catalog_amount: number;
  /** Unit retail price — re-derives the catalog total when qty changes in the cart. */
  unit_price: number;
  /** Branch stock at pick time; caps the cart's qty editor the same way the picker does. */
  stock: number;
}

interface PaymentRow {
  method: PaymentMethod;
  amount: number;
  bank_account_id: number | null;
}

export function ContractAddonModal({ open, contract, onClose, onSuccess }: {
  open: boolean;
  contract: ContractForAddon | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: 'CASH', amount: 0, bank_account_id: null }]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ billId: number; code: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // Add-line composer
  const [addOpen, setAddOpen] = useState(false);
  const [pickMode, setPickMode] = useState<'sale' | 'gift' | null>(null);
  const [priceEdit, setPriceEdit] = useState<CartLine | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [qtyDraft, setQtyDraft] = useState(1);

  const resetForm = () => {
    setView('form');
    setLines([]);
    setPayments([{ method: 'CASH', amount: 0, bank_account_id: null }]);
    setError('');
    setSubmitting(false);
    setResult(null);
    setConfirmClose(false);
    setAddOpen(false);
    setPickMode(null);
    setPriceEdit(null);
    setPriceDraft('');
    setQtyDraft(1);
  };

  useEffect(() => {
    if (open) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Data-driven payment methods — CONTRACT_ADDON has no wallet methods, but read
  // them rather than hardcoding so a backend change flows through.
  const { data: methodRows = [] } = useQuery({
    queryKey: ['contract-addon-methods'],
    queryFn: () => apiClient.get<AllowedMethodRow[]>(
      '/v_purpose_allowed_methods?bill_purpose=eq.CONTRACT_ADDON&is_active=eq.true',
    ),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const methodOptions = useMemo(
    () => methodRows.map(m => ({ value: m.method, label: t(`wizard.method_${m.method}`, { defaultValue: m.method }) })),
    [methodRows, t],
  );

  // ── Totals ──────────────────────────────────────────────────────────────
  // Gifts are free to the customer: they contribute 0 to what must be collected.
  const total = lines.reduce((s, l) => s + (l.as_gift ? 0 : l.amount), 0);
  const giftValue = lines.reduce((s, l) => s + (l.as_gift ? l.catalog_amount : 0), 0);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  // An all-gift bill is legitimately 0 — nothing to collect, so it counts as balanced.
  const isBalanced = total === 0 ? totalPaid === 0 : Math.abs(totalPaid - total) < 0.01;

  const isDirty = lines.length > 0 || payments.some(p => p.amount > 0);

  // ── Add / remove lines ──────────────────────────────────────────────────
  const handlePick = (variant: SellableVariant, qty: number) => {
    if (!pickMode) return;
    const asGift = pickMode === 'gift';
    const catalogTotal = variant.retail_price * qty;
    // Dedupe by variant + gift-ness, matching BillCart: re-picking the same item
    // updates qty instead of stacking a duplicate line. A sale and a gift of the
    // same variant stay distinct.
    const existing = lines.find(l => l.variant_id === variant.variant_id && l.as_gift === asGift);
    if (existing) {
      setLines(prev => prev.map(l => (
        l.id === existing.id
          ? {
            ...l,
            quantity: qty,
            amount: asGift ? 0 : catalogTotal,
            catalog_amount: catalogTotal,
            unit_price: variant.retail_price,
            stock: variant.qty,
          }
          : l
      )));
    } else {
      setLines(prev => [...prev, {
        id: nextLineId(),
        description: variant.full_name,
        amount: asGift ? 0 : catalogTotal,
        quantity: qty,
        variant_id: variant.variant_id,
        as_gift: asGift,
        catalog_amount: catalogTotal,
        unit_price: variant.retail_price,
        stock: variant.qty,
      }]);
    }
    setPickMode(null);
  };

  const removeLine = (id: string) => setLines(prev => prev.filter(l => l.id !== id));

  const openPriceEdit = (line: CartLine) => {
    setPriceEdit(line);
    setPriceDraft(String(line.amount));
    setQtyDraft(line.quantity);
  };

  // Changing qty re-prices the line at catalog rate UNLESS the staff already
  // negotiated a custom amount — an override is a deliberate number and must not
  // be silently rewritten. Without this, bumping qty to 3 left the amount at the
  // 1-unit price and the bill under-charged.
  const handleQtyDraftChange = (next: number) => {
    setQtyDraft(next);
    if (!priceEdit || priceEdit.as_gift) return;
    const wasOverridden = Math.abs(priceEdit.amount - priceEdit.catalog_amount) > 0.001;
    if (!wasOverridden) setPriceDraft(String(priceEdit.unit_price * next));
  };

  const saveLineEdit = () => {
    if (!priceEdit) return;
    const qty = Math.max(1, Math.min(qtyDraft, priceEdit.stock));
    // A gift's price is server-owned (convert overwrites it with RETAIL_PRICE),
    // so only qty is editable there. For a sale we keep whatever the staff typed,
    // but re-scale the catalog reference to the new qty so the struck-through
    // "was" price stays truthful.
    const amount = priceEdit.as_gift ? 0 : (parseFloat(priceDraft) || 0);
    if (!priceEdit.as_gift && amount <= 0) return;
    setLines(prev => prev.map(l => (
      l.id === priceEdit.id
        ? { ...l, quantity: qty, amount, catalog_amount: l.unit_price * qty }
        : l
    )));
    setPriceEdit(null);
    setPriceDraft('');
  };

  // variant_id → qty in cart for the mode being picked, so the picker flags
  // existing items and switches its button to "Update".
  const cartQtys = useMemo(() => {
    const m: Record<number, number> = {};
    for (const l of lines) {
      if (l.as_gift === (pickMode === 'gift')) m[l.variant_id] = (m[l.variant_id] ?? 0) + l.quantity;
    }
    return m;
  }, [lines, pickMode]);

  // ── Payments ────────────────────────────────────────────────────────────
  const updatePayment = (idx: number, patch: Partial<PaymentRow>) =>
    setPayments(prev => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));

  const addPaymentRow = () => {
    const remaining = Math.max(0, total - totalPaid);
    setPayments(prev => [...prev, { method: 'CASH', amount: remaining, bank_account_id: null }]);
  };

  const removePaymentRow = (idx: number) => setPayments(prev => prev.filter((_, i) => i !== idx));

  // ── Validation ──────────────────────────────────────────────────────────
  // Only non-obvious blockers get surfaced. Empty cart / unbalanced are already
  // visible in the cart and the paid-vs-total box, so those just disable the button.
  const displayReasons: string[] = [];
  payments.forEach(p => {
    if (p.method === 'TRANSFER' && p.amount > 0 && !p.bank_account_id) {
      displayReasons.push(t('contractAddon.blockNoBank'));
    }
  });
  const canSubmit = lines.length > 0 && isBalanced && displayReasons.length === 0 && !submitting && !!contract;

  // ── Confirm — full server sequence ──────────────────────────────────────
  const handleConfirm = async () => {
    if (!canSubmit || !contract) return;
    setSubmitting(true);
    setError('');
    try {
      // 1. Create the bill WITH all lines. fn_bill_create rejects an empty
      //    p_line_items (SALE.VALIDATION.LINE_ITEMS_REQUIRED), and it auto-pairs
      //    the negative GIFT_LATE_DISCOUNT for any GIFT_LATE line itself — so
      //    gifts go in directly here and need no convert call. (The
      //    USE_CONVERT_TO_GIFT guard lives in fn_bill_line_item_add, a different
      //    RPC that this flow no longer uses.)
      //
      //    p_amount is PER UNIT — the server multiplies by quantity. Our cart
      //    tracks `amount` as the line total, so divide. Sending the total here
      //    billed qty² (a 2× hoco at 500 total came back as 1,000).
      const created = await apiClient.rpc<BillCreateResult>('fn_bill_create', {
        p_branch_id: contract.branch_id,
        p_customer_id: contract.customer_id ?? null,
        p_contract_id: contract.id,
        p_bill_purpose: 'CONTRACT_ADDON',
        p_line_items: lines.map(l => ({
          charge_type: l.as_gift ? 'GIFT_LATE' : 'ACCESSORY_SALE',
          description: l.description,
          // A gift bills at catalog retail (the server pairs it off to net 0);
          // a sale bills at whatever the staff agreed.
          amount: l.as_gift ? l.unit_price : l.amount / l.quantity,
          quantity: l.quantity,
          variant_id: l.variant_id,
        })),
        p_created_by: user?.user_id ?? null,
      });
      const billId = created.bill_id;

      // 2. Record payments. A pure-gift bill has nothing to collect.
      for (const p of payments) {
        if (p.amount <= 0) continue;
        await apiClient.rpc('fn_bill_payment_add', {
          p_bill_id: billId,
          p_method: p.method,
          p_amount: p.amount,
          p_bank_account_id: p.method === 'TRANSFER' ? p.bank_account_id : null,
          p_added_by: user?.user_id ?? null,
          p_contract_id: null,
        });
      }

      // 3. Confirm — stock deducts (STOCK_SELL, owner-FIFO) for both sale and
      //    gift lines. No contract_txn / installment impact (doc 24 §12).
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
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
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
    { label: t('contractAddon.total'), value: fmtCurrency(total), emphasis: true },
    ...(giftValue > 0 ? [{ label: t('contractAddon.giftValue'), value: fmtCurrency(giftValue) }] : []),
  ] : [];

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="40rem" width="100%" ariaLabel="Contract Add-on">
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('contractAddon.title')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={t('contractAddon.done')}
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
                  <label className="form-label">{t('contractAddon.linesLabel')}</label>
                  <div className="border border-line rounded-md overflow-hidden">
                    {lines.length === 0 ? (
                      <div className="py-8 text-center text-subtler text-sm">{t('contractAddon.emptyCart')}</div>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-line">
                          {lines.map(line => (
                            <tr key={line.id}>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-info shrink-0">
                                    {line.as_gift ? <Gift size={14} /> : <ShoppingBag size={14} />}
                                  </span>
                                  <span className="truncate">{line.description}</span>
                                  {line.quantity > 1 && (
                                    <span className="text-xs text-subtle shrink-0">× {line.quantity}</span>
                                  )}
                                </div>
                                {line.as_gift && (
                                  <div className="text-xs text-subtle ml-5 mt-0.5">
                                    {t('contractAddon.giftHint', { value: fmtCurrency(line.catalog_amount) })}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                                {line.as_gift ? (
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="btn-icon-xs"
                                      startIcon={<Pencil size={12} />}
                                      onClick={() => openPriceEdit(line)}
                                      aria-label={t('contractAddon.editQty')}
                                    />
                                    <span className="text-subtle">{fmtCurrency(0)}</span>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-end gap-0.5">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="btn-icon-xs"
                                        startIcon={<Pencil size={12} />}
                                        onClick={() => openPriceEdit(line)}
                                        aria-label={t('contractAddon.editPrice')}
                                      />
                                      <span className="tabular-nums">{fmtCurrency(line.amount)}</span>
                                    </div>
                                    {line.amount !== line.catalog_amount && (
                                      <span className="text-[10px] text-subtle line-through">
                                        {fmtCurrency(line.catalog_amount)}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 w-10">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="btn-icon-sm"
                                  startIcon={<Trash2 size={14} />}
                                  onClick={() => removeLine(line.id)}
                                  aria-label={t('common.delete')}
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
                        {t('contractAddon.addLine')}
                      </Button>
                    }
                    placement="bottom"
                    align="start"
                    minWidth="16rem"
                  >
                    <div className="flex flex-col py-1">
                      <button
                        type="button"
                        className="flex items-center gap-2 px-3 py-2 text-sm text-left bg-transparent border-none cursor-pointer hover:bg-surface-hover"
                        onClick={() => { setAddOpen(false); setPickMode('sale'); }}
                      >
                        <span className="text-info shrink-0"><ShoppingBag size={14} /></span>
                        <span>{t('contractAddon.addSale')}</span>
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-2 px-3 py-2 text-sm text-left bg-transparent border-none cursor-pointer hover:bg-surface-hover"
                        onClick={() => { setAddOpen(false); setPickMode('gift'); }}
                      >
                        <span className="text-info shrink-0"><Gift size={14} /></span>
                        <span>{t('contractAddon.addGift')}</span>
                      </button>
                    </div>
                  </PopOver>

                  {giftValue > 0 && (
                    <div className="flex justify-between text-xs text-subtle pl-1">
                      <span>{t('contractAddon.giftValue')}</span>
                      <span className="tabular-nums">{fmtCurrency(giftValue)}</span>
                    </div>
                  )}
                </div>

                {/* ── Payments — hidden for a pure-gift bill (nothing to collect) ── */}
                {total > 0 && (
                  <div className="flex flex-col gap-2">
                    <label className="form-label">{t('contractAddon.paymentsLabel')}</label>
                    <div className="flex flex-col gap-3">
                      {payments.map((p, idx) => (
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
                                  const others = payments.reduce((s, q, i) => (i === idx ? s : s + (q.amount || 0)), 0);
                                  updatePayment(idx, { amount: Math.max(0, total - others) });
                                }}
                              />
                            </div>
                            {payments.length > 1 && (
                              <Button
                                size="sm"
                                className="shrink-0"
                                startIcon={<Trash2 size={14} />}
                                onClick={() => removePaymentRow(idx)}
                                aria-label={t('common.delete')}
                              />
                            )}
                          </div>
                          {p.method === 'TRANSFER' && (
                            <BranchPaymentAccountField
                              active={p.method === 'TRANSFER'}
                              onResolve={(id) => updatePayment(idx, { bank_account_id: id })}
                            />
                          )}
                        </div>
                      ))}
                      <Button size="sm" startIcon={<Plus size={14} />} onClick={addPaymentRow} className="self-start">
                        {t('wizard.addPayment')}
                      </Button>
                    </div>

                    <div className={`flex justify-between items-center p-3 rounded-lg border mt-1 ${
                      isBalanced ? 'border-success-border bg-success-soft' : 'border-warning-border bg-warning-soft'
                    }`}>
                      <span className="text-sm">
                        {t('contractAddon.paid')} / {t('contractAddon.total')}
                      </span>
                      <span className={`font-semibold tabular-nums ${isBalanced ? 'text-success-fg' : 'text-warning-fg'}`}>
                        {fmtCurrency(totalPaid)} / {fmtCurrency(total)}
                      </span>
                    </div>
                  </div>
                )}

                {lines.length > 0 && total === 0 && (
                  <div className="alert alert-info">
                    <AlertCircle size={16} />
                    <div className="alert-description">{t('contractAddon.giftOnlyNotice')}</div>
                  </div>
                )}

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
                    {submitting ? t('common.loading') : t('contractAddon.confirm')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Price override composer */}
        <Modal open={priceEdit != null} onClose={() => setPriceEdit(null)} maxWidth="22rem" width="100%">
          <div className="modal-header">
            <h2 className="modal-title">
              {priceEdit?.as_gift ? t('contractAddon.editQty') : t('contractAddon.editLine')}
            </h2>
            <button type="button" className="modal-close-btn" onClick={() => setPriceEdit(null)} aria-label="Close">×</button>
          </div>
          <div className="modal-content">
            <div className="form-grid">
              <div className="flex flex-col">
                <label className="form-label">{priceEdit?.description ?? ''}</label>
                <NumberSpinner
                  value={qtyDraft}
                  onChange={(val) => handleQtyDraftChange(Math.max(1, val === '' ? 1 : Number(val)))}
                  min={1}
                  max={priceEdit?.stock ?? 1}
                  scale="sm"
                />
                {priceEdit && (
                  <span className="text-xs text-subtle mt-1">
                    {t('retail.create.stock')}: {priceEdit.stock}
                  </span>
                )}
              </div>
              {/* A gift's amount is set server-side from the catalog retail price,
                  so editing it here would be a lie — qty only. */}
              {priceEdit && !priceEdit.as_gift && (
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.amount')}</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={2}
                    value={priceDraft}
                    onChange={setPriceDraft}
                    size="sm"
                    className="w-full"
                    placeholder="0.00"
                    endIcon={<ChevronsRight size={14} />}
                    onEndIconClick={() => setPriceDraft(String(priceEdit.unit_price * qtyDraft))}
                  />
                  <span className="text-xs text-subtle mt-1">
                    {t('contractAddon.catalogHint', {
                      value: fmtCurrency(priceEdit.unit_price * qtyDraft),
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <Button variant="outline" onClick={() => setPriceEdit(null)}>{t('common.cancel')}</Button>
            <Button
              color="primary"
              disabled={priceEdit != null && !priceEdit.as_gift && !(parseFloat(priceDraft) > 0)}
              onClick={saveLineEdit}
            >
              {t('common.save')}
            </Button>
          </div>
        </Modal>
      </Modal>

      {/* Product picker — same component the wizard cart uses */}
      <ProductPickerModal
        open={pickMode != null}
        branchId={contract?.branch_id ?? null}
        cartQtys={cartQtys}
        onClose={() => setPickMode(null)}
        onPick={handlePick}
        titleKey={pickMode === 'gift' ? 'workspace.cart_pickGift' : 'workspace.cart_pickAccessory'}
      />

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
