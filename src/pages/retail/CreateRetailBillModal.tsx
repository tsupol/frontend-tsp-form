import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Modal, Button, Select, Badge, Input, MaskedInput, TextArea,
} from 'tsp-form';
import {
  Plus, Trash2, ShoppingCart, Truck, Percent, ChevronsRight,
  AlertCircle, XCircle, Pencil,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';
import { BranchPaymentAccountField } from '../../components/BranchPaymentAccountField';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ProductPickerModal, type SellableVariant } from '../../components/ProductPickerModal';
import { translateApiError } from '../../lib/apiErrors';

/* ───────────────────────────────────────────────────────────────────────────
 * Types — match fn_bill_retail_preview / fn_bill_retail_submit (doc 38 §0)
 * ─────────────────────────────────────────────────────────────────────────── */

interface Branch { id: number; name: string }

type PaymentMethod = 'CASH' | 'TRANSFER';

interface PaymentRow {
  method: PaymentMethod;
  amount: number;
  bank_account_id: number | null;
}

interface CartLine {
  charge_type: 'RETAIL_SALE' | 'SHIPPING_FEE' | 'RETAIL_DISCOUNT';
  /** Unit price for RETAIL_SALE (× qty for the line total); line amount otherwise. */
  amount: number;
  qty?: number;
  variant_id?: number | null;
  target_line_index?: number;
  description?: string;
  /** Catalog unit price at add time — lets the cart show the original price and
      detect a manual override. Only set for RETAIL_SALE lines. */
  catalog_price?: number | null;
}

interface PreviewLine {
  line_no: number;
  charge_type: string;
  line_type: string;
  amount: number;
  qty: number;
  description?: string;
  capability: {
    is_editable: boolean;
    editable_fields: string[];
    is_removable: boolean;
    min_amount: number | null;
    max_amount: number | null;
    requires_approval: boolean;
  };
}

interface Blocker {
  code: string;
  message_th?: string;
  message_en?: string;
}

interface PreviewResponse {
  preview: true;
  preview_token?: string;
  valid_until?: string;
  valid: boolean;
  change_amount?: number;
  bill?: {
    total_amount: number;
  };
  lines?: PreviewLine[];
  payments_required?: {
    gross: number;
    allowed_methods: PaymentMethod[];
    min_payment: number;
  };
  approvals?: {
    any_required: boolean;
    lines_requiring_approval: number[];
  };
  guards?: {
    custom_guards?: Array<{
      code: string;
      ok: boolean;
      message_th?: string | null;
      message_en?: string | null;
    }>;
  };
  blockers?: Blocker[];
}

interface CreateRetailBillModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Main modal
 * ─────────────────────────────────────────────────────────────────────────── */

export function CreateRetailBillModal({ open, onClose, onSuccess }: CreateRetailBillModalProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  const [branchId, setBranchId] = useState<number | null>(user?.branch_id ?? null);
  const [lines, setLines] = useState<CartLine[]>([]);
  // Split payment (cart pattern): one row per payment; CASH + TRANSFER only.
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: 'CASH', amount: 0, bank_account_id: null }]);

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string>('');
  // Submit rejection — rendered in the band above the footer, not a snackbar,
  // so the reason sits next to the button that produced it.
  const [submitError, setSubmitError] = useState<string>('');

  // Success state — replaces auto-close + snackbar (write-modal checklist §1/§2).
  const [view, setView] = useState<'form' | 'done'>('form');
  const [done, setDone] = useState<{
    code: string;
    mode: 'atomic' | 'approval';
    change: number;
    total: number;
    billId: number;
    /** Echoed by the server — what was actually recorded, per method. */
    paymentBreakdown: Array<{ method: string; amount: number }>;
  } | null>(null);

  const [confirmClose, setConfirmClose] = useState(false);

  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [shippingOpen, setShippingOpen] = useState(false);
  const [discountForLineIdx, setDiscountForLineIdx] = useState<number | null>(null);
  const [priceEditIdx, setPriceEditIdx] = useState<number | null>(null);

  // Reset everything when modal opens (checklist §1: reset to 'form' on open).
  useEffect(() => {
    if (open) {
      setLines([]);
      setPayments([{ method: 'CASH', amount: 0, bank_account_id: null }]);
      setPreview(null);
      setPreviewError('');
      setSubmitError('');
      setProductPickerOpen(false);
      setShippingOpen(false);
      setDiscountForLineIdx(null);
      setPriceEditIdx(null);
      setConfirmClose(false);
      setView('form');
      setDone(null);
    }
  }, [open]);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  // Branch-level staff bill only for their own branch — lock the picker to it.
  // Company/holding users (branch_id null) keep the full picker.
  const ownBranchId = user?.branch_id ?? null;
  const branchLocked = ownBranchId != null;
  const selectableBranches = useMemo(
    () => (branchLocked ? branches.filter(b => b.id === ownBranchId) : branches),
    [branches, branchLocked, ownBranchId],
  );

  useEffect(() => {
    if (open && !branchId) {
      if (ownBranchId != null) setBranchId(ownBranchId);
      else if (branches.length > 0) setBranchId(branches[0].id);
    }
  }, [open, branches, branchId, ownBranchId]);

  // Preview validates stock + discount policy + branch guards, and issues the
  // token that fn_bill_retail_submit consumes as its idempotency key. The real
  // payment split rides on submit's p_payments, so preview is told the nominal
  // total as one CASH row — enough for its balance check, nothing more.
  const previewParams = useMemo(() => ({
    p_branch_id: branchId,
    p_customer_id: null,
    p_line_items: lines,
    p_payment_method: 'CASH' as PaymentMethod,
    p_payment_amount: lines.reduce((s, l) => {
      const sign = l.charge_type === 'RETAIL_DISCOUNT' ? -1 : 1;
      return s + sign * l.amount * (l.qty ?? 1);
    }, 0),
    p_bank_account_id: null,
  }), [branchId, lines]);

  // Returns the fresh preview so a PREVIEW_STALE retry can chain straight off
  // it instead of racing the `preview` state update.
  const runPreview = useCallback(async (): Promise<PreviewResponse | null> => {
    if (!open || !branchId || lines.length === 0) {
      setPreview(null);
      setPreviewError('');
      return null;
    }
    setPreviewing(true);
    setPreviewError('');
    try {
      const res = await apiClient.rpc<PreviewResponse>('fn_bill_retail_preview', previewParams);
      setPreview(res);
      return res;
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setPreviewError(translated || err.message);
      } else {
        setPreviewError(String(err));
      }
      setPreview(null);
      return null;
    } finally {
      setPreviewing(false);
    }
  }, [open, branchId, lines.length, previewParams, t]);

  // Re-preview when the cart (lines/branch) changes. Payment rows don't affect
  // preview — they're recorded via the cart at submit.
  useEffect(() => {
    runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branchId, lines]);

  /**
   * Submission strategy:
   *  - No discount needing approval → ONE atomic call, fn_bill_retail_submit
   *    with p_payments[] (mig 1056, 2026-08-10). Nothing is written to the DB
   *    until it succeeds, so cancelling mid-checkout leaves no bill to void,
   *    and p_preview_token makes a retry after a dropped connection return the
   *    same bill instead of a duplicate.
   *  - Discount needs approval → 3-step flow per doc 25:
   *      fn_bill_create (REVENUE lines)
   *      → fn_bill_line_item_add (each DISCOUNT line)
   *      → fn_bill_line_item_submit_approval (each DISCOUNT line)
   *    Bill ends up OPEN with discount line PENDING. Payment is collected
   *    later (after approver review) via fn_bill_payment_add/_confirm.
   *    Kept on the cart path because retail_submit's discount path creates the
   *    bill without the per-line target linkage this screen collects.
   */
  const submitMutation = useMutation({
    mutationFn: async (): Promise<{
      code: string;
      mode: 'atomic' | 'approval';
      change: number;
      billId: number;
      paymentBreakdown: Array<{ method: string; amount: number }>;
    }> => {
      if (!preview?.approvals?.any_required) {
        // Amounts must sum to the bill total exactly — the server records no
        // change (DELIVERY §2), so we send only what enters the drawer and the
        // cashier hands back the difference at the counter.
        const buildPayload = (token: string | undefined) => ({
          p_branch_id: branchId,
          p_customer_id: null,
          p_line_items: lines,
          p_payments: payments
            .filter(p => p.amount > 0)
            .map(p => ({
              method: p.method,
              amount: p.amount,
              ...(p.method === 'TRANSFER' ? { bank_account_id: p.bank_account_id } : {}),
            })),
          p_preview_token: token ?? null,
        });

        type SubmitResponse = {
          bill_id?: number;
          code?: string;
          code_display?: string;
          change_amount?: number;
          payments?: Array<{ method: string; amount: number }>;
          /** Refusal shape — see the `valid === false` guard below. */
          valid?: boolean;
          blockers?: Blocker[] | null;
        };

        let res: SubmitResponse;
        try {
          res = await apiClient.rpc<SubmitResponse>(
            'fn_bill_retail_submit',
            buildPayload(preview?.preview_token),
          );
        } catch (err) {
          // The token expires after 60 min and dies if the cart moved under it.
          // Re-preview once for a fresh token and resubmit; a second failure is
          // a real error and surfaces to the user.
          if (!(err instanceof ApiError) || err.code !== 'SALE.STATE.PREVIEW_STALE') throw err;
          const fresh = await runPreview();
          if (!fresh?.preview_token) throw err;
          res = await apiClient.rpc<SubmitResponse>(
            'fn_bill_retail_submit',
            buildPayload(fresh.preview_token),
          );
        }

        // A refused submit still answers `ok: true` — the envelope carries
        // `{valid: false, preview: false, blockers}` and no bill_id rather than an
        // error code (verified 2026-08-10 against a day-closed branch, where
        // `blockers` came back null, so there is not always a reason to show).
        // Without this it would read as a completed sale and show a receipt for
        // a bill that was never created.
        if (res.valid === false || res.bill_id == null) {
          const reason = res.blockers?.map(pickMessage).filter(Boolean).join(' · ');
          // Re-preview so the guard that refused surfaces in the inline list.
          await runPreview();
          throw new Error(reason || t('retail.create.blockInvalid'));
        }

        return {
          code: res.code ?? res.code_display ?? '',
          mode: 'atomic',
          change: res.change_amount ?? 0,
          billId: res.bill_id,
          paymentBreakdown: (res.payments ?? []).map(p => ({ method: p.method, amount: p.amount })),
        };
      }

      // 3-step approval flow
      const revenueLines = lines.filter(l => l.charge_type !== 'RETAIL_DISCOUNT');
      const discountLines = lines
        .map((l, idx) => ({ line: l, idx }))
        .filter(({ line }) => line.charge_type === 'RETAIL_DISCOUNT');

      // Step 1: create bill with REVENUE lines only.
      const created = await apiClient.rpc<{
        bill_id: number;
        code_display: string;
      }>('fn_bill_create', {
        p_branch_id: branchId,
        p_customer_id: null,
        p_contract_id: null,
        p_bill_purpose: 'RETAIL',
        p_line_items: revenueLines.map(l => ({
          line_type: 'REVENUE',
          charge_type: l.charge_type,
          description: l.description ?? null,
          amount: l.amount,
          quantity: l.qty ?? 1,
          variant_id: l.variant_id ?? null,
        })),
      });

      const billId = created.bill_id;

      // fn_bill_create's response doesn't echo line ids — fetch them from v_bill_detail.
      // line_items come back in line_no order, which matches the order we sent.
      const detail = await apiClient.get<Array<{
        line_items: Array<{ line_id: number; charge_type: string }>;
      }>>(`/v_bill_detail?bill_id=eq.${billId}`);
      const createdLines = detail[0]?.line_items ?? [];
      const revenueLineIds = createdLines.map(li => li.line_id);

      // Build a map from original cart index → bill_line_item id (revenue lines only).
      const cartIdxToLineId = new Map<number, number>();
      let cursor = 0;
      lines.forEach((line, idx) => {
        if (line.charge_type !== 'RETAIL_DISCOUNT') {
          cartIdxToLineId.set(idx, revenueLineIds[cursor++]);
        }
      });

      // Step 2 + 3: add each DISCOUNT line + submit for approval.
      for (const { line } of discountLines) {
        const targetCartIdx = line.target_line_index ?? 0;
        const targetLineId = cartIdxToLineId.get(targetCartIdx);
        if (!targetLineId) {
          throw new Error(`Discount target line ${targetCartIdx} not found after create`);
        }

        const added = await apiClient.rpc<{ line_item_id: number }>('fn_bill_line_item_add', {
          p_bill_id: billId,
          p_line_type: 'DISCOUNT',
          p_charge_type: 'RETAIL_DISCOUNT',
          p_description: line.description ?? null,
          p_amount: line.amount,
          p_quantity: 1,
          p_target_line_id: targetLineId,
        });

        await apiClient.rpc('fn_bill_line_item_submit_approval', {
          p_line_item_id: added.line_item_id,
          p_reason: line.description ?? null,
        });
      }

      // Payment is collected after approval, so there's nothing to break down yet.
      return { code: created.code_display, mode: 'approval', change: 0, billId, paymentBreakdown: [] };
    },
    onSuccess: ({ code, mode, change, billId, paymentBreakdown }) => {
      // Refresh the list behind the modal, then show the in-modal success view.
      // The user prints/closes themselves (checklist §1/§2) — no snackbar, no auto-close.
      onSuccess();
      setDone({ code, mode, change, total, billId, paymentBreakdown });
      setView('done');
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setSubmitError(translateApiError(err, t) || err.message);
        return;
      }
      // Refusal thrown above already carries a user-facing reason.
      setSubmitError(err instanceof Error && err.message ? err.message : t('common.error'));
    },
  });

  const removeLine = (idx: number) => {
    setLines(prev => {
      const removeSet = new Set<number>([idx]);
      prev.forEach((l, i) => {
        if (l.charge_type === 'RETAIL_DISCOUNT' && l.target_line_index === idx) removeSet.add(i);
      });
      const next = prev.filter((_, i) => !removeSet.has(i));
      return next.map(l => {
        if (l.charge_type !== 'RETAIL_DISCOUNT' || l.target_line_index == null) return l;
        const decrement = [...removeSet].filter(r => r < l.target_line_index!).length;
        return { ...l, target_line_index: l.target_line_index - decrement };
      });
    });
  };

  // qty is the desired final quantity for this variant. Already-in-cart →
  // update that line's qty (the picker shows the current cart qty as the start).
  // Not in cart → append a new RETAIL_SALE line. Clamp to available stock.
  const addProduct = (variant: SellableVariant, qty: number) => {
    const finalQty = Math.min(Math.max(1, qty), variant.qty);
    setLines(prev => {
      const existingIdx = prev.findIndex(
        l => l.charge_type === 'RETAIL_SALE' && l.variant_id === variant.variant_id,
      );
      if (existingIdx >= 0) {
        // Re-picking resets to catalog price for the new qty — a prior manual
        // override is intentionally cleared (re-picking is an explicit "update").
        return prev.map((l, i) => (i === existingIdx
          ? { ...l, qty: finalQty, amount: variant.retail_price, catalog_price: variant.retail_price }
          : l));
      }
      return [...prev, {
        charge_type: 'RETAIL_SALE',
        amount: variant.retail_price,
        qty: finalQty,
        variant_id: variant.variant_id,
        description: variant.full_name,
        catalog_price: variant.retail_price,
      }];
    });
    setProductPickerOpen(false);
  };

  const addShipping = (amount: number, description: string) => {
    setLines(prev => [...prev, {
      charge_type: 'SHIPPING_FEE',
      amount,
      description: description || undefined,
    }]);
    setShippingOpen(false);
  };

  const addDiscount = (targetIdx: number, amount: number, reason: string) => {
    setLines(prev => [...prev, {
      charge_type: 'RETAIL_DISCOUNT',
      amount,
      target_line_index: targetIdx,
      description: reason || undefined,
    }]);
    setDiscountForLineIdx(null);
  };

  // Walk-in negotiated unit price for a product line. Submitted verbatim
  // (fn_bill_create / fn_bill_payment honor p_amount — no catalog re-clamp).
  const savePrice = (idx: number, unitPrice: number) => {
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, amount: unitPrice } : l)));
    setPriceEditIdx(null);
  };

  // Don't trust preview.bill.total_amount — fn_bill_retail_preview currently
  // returns gross sum (sums DISCOUNT line amounts as positive). Submit returns
  // correct net (per nnf commit ac6c376), but preview is unfixed. Compute
  // locally so the cart total matches what the bill will actually be.
  const total = lines.reduce((s, l) => {
    const sign = l.charge_type === 'RETAIL_DISCOUNT' ? -1 : 1;
    return s + sign * l.amount * (l.qty ?? 1);
  }, 0);
  // Summary quantity — total units of product (RETAIL_SALE) across all cart lines.
  const totalQty = lines.reduce(
    (s, l) => (l.charge_type === 'RETAIL_SALE' ? s + (l.qty ?? 1) : s),
    0,
  );

  // variant_id → qty currently in cart, so the picker can flag existing items
  // and pre-fill the stepper / switch its button to "Update cart".
  const cartQtys = useMemo(() => {
    const m: Record<number, number> = {};
    for (const l of lines) {
      if (l.charge_type === 'RETAIL_SALE' && l.variant_id != null) {
        m[l.variant_id] = (m[l.variant_id] ?? 0) + (l.qty ?? 1);
      }
    }
    return m;
  }, [lines]);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const remaining = Math.max(0, total - totalPaid);
  // The server records no change (DELIVERY §2) and rejects any overpay, so an
  // over-entry here is a number to correct — not change to hand back. Cash given
  // over the total is settled at the counter and never typed into these rows.
  const overpaid = totalPaid > total ? totalPaid - total : 0;

  const updatePayment = (idx: number, patch: Partial<PaymentRow>) =>
    setPayments(prev => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  const addPaymentRow = () =>
    setPayments(prev => [...prev, { method: 'CASH', amount: Math.max(0, total - prev.reduce((s, p) => s + (p.amount || 0), 0)), bank_account_id: null }]);
  const removePaymentRow = (idx: number) =>
    setPayments(prev => prev.filter((_, i) => i !== idx));

  const needsApproval = !!preview?.approvals?.any_required;

  // Guards and blockers ship both languages (mig 1057) — read the one the user
  // is looking at, fall back to the other, then to the bare code.
  const pickMessage = useCallback(
    (m: { message_th?: string | null; message_en?: string | null; code: string }) => {
      const th = m.message_th ?? '';
      const en = m.message_en ?? '';
      return (i18n.language.startsWith('th') ? th || en : en || th) || m.code;
    },
    [i18n.language],
  );

  // Server-side stops — shown inline, above the footer, before the user clicks.
  // A guard row's message is null when ok: true, so read only the failing ones.
  const serverBlocks: string[] = [];
  preview?.guards?.custom_guards?.forEach(g => {
    if (g.ok === false) serverBlocks.push(pickMessage(g));
  });
  preview?.blockers?.forEach(b => serverBlocks.push(pickMessage(b)));

  // Form-side gaps — the submit button being disabled is the message here; each
  // field carries its own hint, so these never become an alert on an untouched
  // form. They only exist to decide `canSubmit`.
  const formGaps: string[] = [];
  if (!branchId) formGaps.push(t('retail.create.blockNoBranch'));
  if (lines.length === 0) formGaps.push(t('retail.create.blockEmptyCart'));
  // Payment-side checks only apply to the pay-now flow. Approval flow defers payment.
  if (!needsApproval && lines.length > 0) {
    if (payments.some(p => p.method === 'TRANSFER' && p.amount > 0 && !p.bank_account_id)) {
      formGaps.push(t('retail.create.blockNoBank'));
    }
    // Must pay the exact bill total (no overpay — change is a counter matter).
    if (Math.abs(totalPaid - total) >= 0.01) formGaps.push(t('retail.create.blockInsufficient'));
  }
  // For atomic path, preview must be valid. For approval path, preview returns
  // valid: false only because of the approval requirement — that's expected.
  const previewOk = needsApproval ? !!preview : !!preview?.valid;
  // Preview said no but named no reason — surface something rather than a
  // silently dead button.
  if (preview && !previewOk && serverBlocks.length === 0) {
    serverBlocks.push(t('retail.create.blockInvalid'));
  }
  const canSubmit =
    formGaps.length === 0 && serverBlocks.length === 0 && previewOk && !submitMutation.isPending;

  const handleSubmitClick = () => {
    if (!canSubmit || previewing) return;
    setSubmitError('');
    submitMutation.mutate();
  };

  // Nothing is written until submit succeeds, so an abandoned cart costs no
  // cleanup — but it is still typed work, so confirm before dropping it.
  const isDirty = lines.length > 0 || totalPaid > 0;
  const forceClose = () => {
    setConfirmClose(false);
    onClose();
  };
  const handleClose = () => {
    if (view === 'done' || !isDirty) { forceClose(); return; }
    setConfirmClose(true);
  };

  const saleLines = lines
    .map((l, i) => ({ ...l, idx: i }))
    .filter(l => l.charge_type === 'RETAIL_SALE');

  // Display order: products first, then SHIPPING_FEE, then RETAIL_DISCOUNT.
  // Original idx is preserved so removeLine / preview lookups still match.
  const displayOrder = (ct: CartLine['charge_type']) =>
    ct === 'RETAIL_SALE' ? 0 : ct === 'SHIPPING_FEE' ? 1 : 2;
  const sortedLines = lines
    .map((line, idx) => ({ line, idx }))
    .sort((a, b) => displayOrder(a.line.charge_type) - displayOrder(b.line.charge_type));

  return (
    <Modal open={open} onClose={handleClose} maxWidth="42rem" width="100%" ariaLabel="Create Retail Bill">
      <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
        <div className="modal-header">
          <h2 className="modal-title">{t('retail.create.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
        </div>

        {view === 'done' && done ? (
          <ActionDoneView
            headline={done.mode === 'atomic'
              ? t('retail.create.doneHeadlineSale')
              : t('retail.create.doneHeadlineApproval')}
            contractCode={done.code}
            tone={done.mode === 'atomic' ? 'success' : 'warning'}
            detailRows={done.mode === 'atomic'
              ? [
                  { label: t('retail.create.doneRowTotal'), value: fmtCurrency(done.total), emphasis: true },
                  // One row per method taken, so a split sale's receipt shows how
                  // the money actually arrived rather than a single lump.
                  ...done.paymentBreakdown.map(p => ({
                    label: t(`paymentMethod.${p.method}`, { defaultValue: p.method }),
                    value: fmtCurrency(p.amount),
                  })),
                  ...(done.change > 0
                    ? [{ label: t('retail.create.doneRowChange'), value: fmtCurrency(done.change) }]
                    : []),
                ]
              : [{ label: t('retail.create.doneRowTotal'), value: fmtCurrency(done.total), emphasis: true }]}
            extras={done.mode === 'approval' ? (
              <div className="alert alert-info">
                <AlertCircle size={16} />
                <div className="alert-description">{t('retail.create.doneApprovalNote')}</div>
              </div>
            ) : undefined}
            /* Print/PDF only for a PAID atomic sale — approval bills are OPEN, no receipt yet. */
            billId={done.mode === 'atomic' ? done.billId : null}
            onClose={onClose}
          />
        ) : (
        <>
        <div className="modal-content flex flex-col gap-3" style={{ paddingBottom: 0 }}>
          {/* Branch + walk-in tag */}
          <div className="flex items-center gap-2">
            <div style={{ width: '14rem' }}>
              <Select
                value={branchId ? String(branchId) : null}
                onChange={(v) => setBranchId(v ? Number(v) : null)}
                placeholder={t('accounting.branch')}
                options={selectableBranches.map(b => ({ label: b.name, value: String(b.id) }))}
                size="sm"
                showChevron
                disabled={branchLocked}
              />
            </div>
            <div className="flex-1" />
            <Badge color="info" size="sm">{t('retail.walkIn')}</Badge>
          </div>

          {/* Cart */}
          <div className="flex-1 min-h-[10rem] max-h-[40dvh] overflow-auto better-scroll border border-line rounded-md">
            {lines.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-subtler gap-2 py-8">
                <ShoppingCart size={36} className="opacity-30" />
                <p className="text-sm">{t('retail.create.emptyCart')}</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {sortedLines.map(({ line, idx }) => {
                  const previewLine = preview?.lines?.[idx];
                  const isDiscount = line.charge_type === 'RETAIL_DISCOUNT';
                  return (
                    <div
                      key={idx}
                      className={`flex items-center gap-3 p-3 border-b border-line last:border-b-0 ${
                        isDiscount ? 'bg-warning-soft' : ''
                      }`}
                    >
                      <Badge size="sm" color={isDiscount ? 'warning' : line.charge_type === 'SHIPPING_FEE' ? 'info' : 'default'}>
                        {line.charge_type}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {line.description || previewLine?.description || line.charge_type}
                        </div>
                        {previewLine?.capability.requires_approval && (
                          <div className="text-xs text-warning-fg flex items-center gap-1 mt-0.5">
                            <AlertCircle size={12} />
                            {t('retail.create.requiresApproval')}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="flex items-center justify-end gap-1.5">
                          {line.charge_type === 'RETAIL_SALE' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="btn-icon-xs"
                              startIcon={<Pencil size={12} />}
                              onClick={() => setPriceEditIdx(idx)}
                              aria-label={t('retail.create.editPrice')}
                            />
                          )}
                          <span className="text-sm font-medium tabular-nums">
                            {isDiscount ? '−' : ''}{fmtCurrency(line.amount * (line.qty ?? 1))}
                          </span>
                        </div>
                        {(line.qty ?? 1) > 1 && (
                          <div className="text-xs text-subtle">
                            {fmtCurrency(line.amount)} × {line.qty}
                          </div>
                        )}
                        {line.catalog_price != null && line.amount !== line.catalog_price && (
                          <div className="text-[10px] text-subtle line-through tabular-nums">
                            {fmtCurrency(line.catalog_price * (line.qty ?? 1))}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        startIcon={<Trash2 size={14} />}
                        onClick={() => removeLine(idx)}
                        aria-label="Remove"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add line buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              color="primary"
              size="sm"
              startIcon={<Plus size={14} />}
              onClick={() => setProductPickerOpen(true)}
              disabled={!branchId}
            >
              {t('retail.create.addProduct')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              startIcon={<Percent size={14} />}
              onClick={() => setDiscountForLineIdx(saleLines[0]?.idx ?? -1)}
              disabled={saleLines.length === 0}
            >
              {t('retail.create.addDiscount')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              startIcon={<Truck size={14} />}
              onClick={() => setShippingOpen(true)}
            >
              {t('retail.create.addShipping')}
            </Button>
          </div>

          {/* Server-side stops — guards + blockers, shown before the click so the
              reason is on screen rather than in a snackbar after a dead press. */}
          {serverBlocks.length > 0 && (
            <div className="space-y-1">
              {serverBlocks.map((msg, i) => (
                <div key={i} className="alert alert-danger">
                  <XCircle size={16} />
                  <div className="alert-description">{msg}</div>
                </div>
              ))}
            </div>
          )}
          {previewError && (
            <div className="alert alert-danger">
              <XCircle size={16} />
              <div className="alert-description">{previewError}</div>
            </div>
          )}

          {/* Split payment — one row per payment (CASH + TRANSFER). Approval flow
              defers payment, so no rows there. */}
          {!needsApproval && (
            <div className="flex flex-col gap-2">
              <label className="form-label">{t('retail.create.paymentsLabel', { defaultValue: 'Payment' })}</label>
              <div className="flex flex-col gap-3">
                {payments.map((p, idx) => (
                  <div key={idx} className="border border-line rounded-lg p-3 flex flex-col gap-3">
                    <div className="flex gap-3 items-end">
                      <div className="flex flex-col" style={{ width: '11rem' }}>
                        <label className="form-label text-xs">{t('wizard.method')}</label>
                        <Select
                          options={(['CASH', 'TRANSFER'] as PaymentMethod[]).map(m => ({ label: t(`paymentMethod.${m}`, { defaultValue: m }), value: m }))}
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
                          aria-label={t('common.remove', { defaultValue: 'Remove' })}
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
                  {t('retail.create.addPayment', { defaultValue: 'Add payment' })}
                </Button>
              </div>
            </div>
          )}
          {needsApproval && (
            <div className="alert alert-info">
              <AlertCircle size={16} />
              <div className="alert-description">{t('retail.create.approvalNote')}</div>
            </div>
          )}

          {/* Total + change */}
          <div className="flex flex-col items-end pt-2 pb-6 border-t border-line">
            <div className="text-xs text-subtle mb-0.5 tabular-nums">
              {t('retail.create.itemsSummary', { count: totalQty })}
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-base text-subtle">{t('retail.create.total')}</span>
              <span className="heading-3 tabular-nums">{fmtCurrency(total)}</span>
            </div>
            {remaining > 0 && totalPaid > 0 && (
              <div className="flex items-baseline gap-3 text-sm mt-1">
                <span className="text-subtle">{t('retail.create.remaining', { defaultValue: 'Remaining' })}</span>
                <span className="font-medium tabular-nums text-warning-fg">{fmtCurrency(remaining)}</span>
              </div>
            )}
            {overpaid > 0 && (
              <div className="flex items-baseline gap-3 text-sm mt-1">
                <span className="text-subtle">{t('retail.create.overpaid')}</span>
                <span className="font-medium tabular-nums text-danger-fg">{fmtCurrency(overpaid)}</span>
              </div>
            )}
          </div>
        </div>

        <ModalErrorBand message={submitError} onDismiss={() => setSubmitError('')} />

        <div className="modal-footer">
          <Button onClick={handleClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            disabled={!canSubmit || previewing}
            onClick={handleSubmitClick}
          >
            {needsApproval ? t('retail.create.submitForApproval') : t('retail.create.checkout')}
          </Button>
        </div>
        </>
        )}
      </div>

      <ProductPickerModal
        open={productPickerOpen}
        branchId={branchId}
        cartQtys={cartQtys}
        onClose={() => setProductPickerOpen(false)}
        onPick={addProduct}
      />
      <ShippingModal
        open={shippingOpen}
        onClose={() => setShippingOpen(false)}
        onSave={addShipping}
      />
      <DiscountModal
        open={discountForLineIdx !== null && discountForLineIdx >= 0}
        saleLines={saleLines.map(l => ({ idx: l.idx, label: l.description ?? '', amount: l.amount * (l.qty ?? 1) }))}
        initialTargetIdx={discountForLineIdx ?? -1}
        onClose={() => setDiscountForLineIdx(null)}
        onSave={addDiscount}
      />
      <PriceModal
        line={priceEditIdx != null ? lines[priceEditIdx] ?? null : null}
        lineIdx={priceEditIdx}
        onClose={() => setPriceEditIdx(null)}
        onSave={savePrice}
      />

      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        maxWidth="24rem"
        width="100%"
        ariaLabel="Discard sale"
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('common.unsavedChanges')}</h2>
        </div>
        <div className="modal-content">
          <p>{t('common.unsavedChangesMessage')}</p>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </Modal>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Shipping modal
 * ─────────────────────────────────────────────────────────────────────────── */

function ShippingModal({ open, onClose, onSave }: {
  open: boolean;
  onClose: () => void;
  onSave: (amount: number, description: string) => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) { setAmount(''); setDescription(''); }
  }, [open]);

  const amountNum = parseFloat(amount) || 0;
  const valid = amountNum > 0;

  return (
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%" ariaLabel="Add Shipping">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('retail.create.addShipping')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('retail.create.amount')}</label>
            <MaskedInput
              mask="number"
              decimalScale={2}
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
              size="sm"
              className="w-full"
              autoFocus
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('retail.create.descriptionLabel')}</label>
            <TextArea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('retail.create.shippingDescriptionPlaceholder')}
              size="sm"
              rows={3}
              className="w-full"
            />
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button color="primary" disabled={!valid} onClick={() => onSave(amountNum, description.trim())}>
            {t('common.add', { defaultValue: 'Add' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Discount modal
 * ─────────────────────────────────────────────────────────────────────────── */

function DiscountModal({ open, saleLines, initialTargetIdx, onClose, onSave }: {
  open: boolean;
  saleLines: { idx: number; label: string; amount: number }[];
  initialTargetIdx: number;
  onClose: () => void;
  onSave: (targetIdx: number, amount: number, reason: string) => void;
}) {
  const { t } = useTranslation();
  const [targetIdx, setTargetIdx] = useState<number>(initialTargetIdx);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setTargetIdx(initialTargetIdx);
      setAmount('');
      setReason('');
    }
  }, [open, initialTargetIdx]);

  const amountNum = parseFloat(amount) || 0;
  const targetLine = saleLines.find(l => l.idx === targetIdx);
  const valid = amountNum > 0 && targetLine != null && amountNum <= targetLine.amount;

  return (
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%" ariaLabel="Add Discount">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('retail.create.addDiscount')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('retail.create.discountTarget')}</label>
            <Select
              value={String(targetIdx)}
              onChange={(v) => setTargetIdx(parseInt(v as string))}
              options={saleLines.map(l => ({
                label: `${l.label} (${fmtCurrency(l.amount)})`,
                value: String(l.idx),
              }))}
              size="sm"
              showChevron
              searchable={false}
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('retail.create.amount')}</label>
            <MaskedInput
              mask="number"
              decimalScale={2}
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
              size="sm"
              className="w-full"
              autoFocus
            />
            {targetLine && amountNum > targetLine.amount && (
              <div className="text-xs text-danger mt-1">{t('retail.create.discountExceedsLine')}</div>
            )}
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('retail.create.discountReason')}</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('retail.create.discountReasonPlaceholder')}
              size="sm"
              className="w-full"
            />
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button color="primary" disabled={!valid} onClick={() => onSave(targetIdx, amountNum, reason.trim())}>
            {t('common.add', { defaultValue: 'Add' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Price override modal — walk-in negotiated unit price for a product line.
 * Edits the unit price (line total = unit × qty). Prefills current, shows the
 * catalog price + one-tap reset. Modal stays mounted; `line` drives visibility.
 * ─────────────────────────────────────────────────────────────────────────── */

function PriceModal({ line, lineIdx, onClose, onSave }: {
  line: CartLine | null;
  lineIdx: number | null;
  onClose: () => void;
  onSave: (idx: number, unitPrice: number) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  // Prefill with the line's current unit price each time a new line is targeted.
  const [seenIdx, setSeenIdx] = useState<number | null>(null);
  if (line && lineIdx != null && seenIdx !== lineIdx) {
    setSeenIdx(lineIdx);
    setValue(String(line.amount));
  }
  if (!line && seenIdx !== null) setSeenIdx(null);

  const parsed = parseFloat(value);
  const canSave = Number.isFinite(parsed) && parsed >= 0;
  const catalog = line?.catalog_price ?? null;
  const qty = line?.qty ?? 1;

  return (
    <Modal open={line != null} onClose={onClose} maxWidth="22rem" width="100%" ariaLabel="Adjust price">
      <div className="modal-header">
        <h2 className="modal-title">{t('retail.create.editPrice')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="modal-content form-grid">
        <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
          <div className="text-sm font-medium">{line?.description}</div>
          {qty > 1 && <div className="text-xs text-subtle mt-0.5">× {qty}</div>}
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('retail.create.newPrice')}</label>
          <MaskedInput
            mask="number"
            decimalScale={2}
            value={value}
            onChange={setValue}
            size="sm"
            className="w-full"
            placeholder="0.00"
            autoFocus
          />
          {catalog != null && (
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs text-subtle">
                {t('retail.create.catalogPrice')}: {fmtCurrency(catalog)}
              </span>
              {parsed !== catalog && (
                <button
                  type="button"
                  onClick={() => setValue(String(catalog))}
                  className="text-xs text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer"
                >
                  {t('retail.create.resetPrice')}
                </button>
              )}
            </div>
          )}
          {qty > 1 && canSave && (
            <div className="text-xs text-subtle mt-1.5 tabular-nums">
              {t('retail.create.lineTotal')}: {fmtCurrency(parsed * qty)}
            </div>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          color="primary"
          disabled={!canSave || lineIdx == null}
          onClick={() => lineIdx != null && canSave && onSave(lineIdx, parsed)}
        >
          {t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}
