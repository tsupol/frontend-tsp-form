import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Modal, Button, Select, Badge, Input, MaskedInput, NumberSpinner, TextArea, Tooltip, useSnackbarContext,
} from 'tsp-form';
import {
  Plus, Trash2, ShoppingCart, Truck, Percent, ChevronsRight,
  AlertCircle, XCircle, Barcode, ScanBarcode,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';
import { useBarcodeScanner } from '../../components/BarcodeScanner';
import { BranchPaymentAccountField } from '../../components/BranchPaymentAccountField';
import { ActionDoneView } from '../contracts/ActionDoneView';

/* ───────────────────────────────────────────────────────────────────────────
 * Types — match fn_bill_retail_preview / fn_bill_retail_submit (doc 38 §0)
 * ─────────────────────────────────────────────────────────────────────────── */

interface Branch { id: number; name: string }

interface SellableVariant {
  variant_id: number;
  full_name: string;
  brand_name: string;
  model_name: string;
  variant_name: string;
  retail_price: number;
  qty: number;
  barcodes: string[];
}

type PaymentMethod = 'CASH' | 'TRANSFER';

interface CartLine {
  charge_type: 'RETAIL_SALE' | 'SHIPPING_FEE' | 'RETAIL_DISCOUNT';
  amount: number;
  qty?: number;
  variant_id?: number | null;
  target_line_index?: number;
  description?: string;
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
    custom_guards?: Array<{ code: string; ok: boolean; message_th?: string | null }>;
  };
  blockers?: Blocker[];
}

interface SubmitResponse {
  bill_id: number;
  code_display: string;
  status: 'PAID';
  change_amount: number;
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
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();

  const [branchId, setBranchId] = useState<number | null>(user?.branch_id ?? null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [bankAccountId, setBankAccountId] = useState<number | null>(null);

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string>('');

  // Success state — replaces auto-close + snackbar (write-modal checklist §1/§2).
  const [view, setView] = useState<'form' | 'done'>('form');
  const [done, setDone] = useState<{
    code: string;
    mode: 'atomic' | 'approval';
    change: number;
    total: number;
    billId: number;
  } | null>(null);

  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [shippingOpen, setShippingOpen] = useState(false);
  const [discountForLineIdx, setDiscountForLineIdx] = useState<number | null>(null);

  // Reset everything when modal opens (checklist §1: reset to 'form' on open).
  useEffect(() => {
    if (open) {
      setLines([]);
      setPaymentMethod('CASH');
      setPaymentAmount(0);
      setBankAccountId(null);
      setPreview(null);
      setPreviewError('');
      setProductPickerOpen(false);
      setShippingOpen(false);
      setDiscountForLineIdx(null);
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

  const previewParams = useMemo(() => ({
    p_branch_id: branchId,
    p_customer_id: null,
    p_line_items: lines,
    p_payment_method: paymentMethod,
    p_payment_amount: paymentAmount,
    p_bank_account_id: bankAccountId,
  }), [branchId, lines, paymentMethod, paymentAmount, bankAccountId]);

  const runPreview = useCallback(async () => {
    if (!open || !branchId || lines.length === 0) {
      setPreview(null);
      setPreviewError('');
      return;
    }
    setPreviewing(true);
    setPreviewError('');
    try {
      const res = await apiClient.rpc<PreviewResponse>('fn_bill_retail_preview', previewParams);
      setPreview(res);
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setPreviewError(translated || err.message);
      } else {
        setPreviewError(String(err));
      }
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [open, branchId, lines.length, previewParams, t]);

  // Re-preview on structural boundaries
  useEffect(() => {
    runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branchId, lines, paymentMethod, paymentAmount, bankAccountId]);

  /**
   * Submission strategy:
   *  - No discount needing approval → atomic fn_bill_retail_submit (PAID immediately).
   *  - Discount needs approval → 3-step flow per doc 25:
   *      fn_bill_create (REVENUE lines)
   *      → fn_bill_line_item_add (each DISCOUNT line)
   *      → fn_bill_line_item_submit_approval (each DISCOUNT line)
   *    Bill ends up OPEN with discount line PENDING. Payment is collected
   *    later (after approver review) via fn_bill_payment_add/_confirm.
   */
  const submitMutation = useMutation({
    mutationFn: async (): Promise<{ code: string; mode: 'atomic' | 'approval'; change: number; billId: number }> => {
      if (!preview?.approvals?.any_required) {
        const res = await apiClient.rpc<SubmitResponse>('fn_bill_retail_submit', {
          ...previewParams,
          p_payment_reference: null,
          p_preview_token: preview?.preview_token,
        });
        return { code: res.code_display, mode: 'atomic', change: res.change_amount, billId: res.bill_id };
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

      return { code: created.code_display, mode: 'approval', change: 0, billId };
    },
    onSuccess: ({ code, mode, change, billId }) => {
      // Refresh the list behind the modal, then show the in-modal success view.
      // The user prints/closes themselves (checklist §1/§2) — no snackbar, no auto-close.
      onSuccess();
      setDone({ code, mode, change, total, billId });
      setView('done');
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        addSnackbar({
          type: 'error',
          message: (
            <div className="alert alert-danger">
              <XCircle size={16} />
              <span className="alert-description">{translated || err.message}</span>
            </div>
          ),
        });
      }
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

  const addProduct = (variant: SellableVariant, qty: number) => {
    setLines(prev => [...prev, {
      charge_type: 'RETAIL_SALE',
      amount: variant.retail_price,
      qty,
      variant_id: variant.variant_id,
      description: variant.full_name,
    }]);
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

  // Don't trust preview.bill.total_amount — fn_bill_retail_preview currently
  // returns gross sum (sums DISCOUNT line amounts as positive). Submit returns
  // correct net (per nnf commit ac6c376), but preview is unfixed. Compute
  // locally so the cart total matches what the bill will actually be.
  const total = lines.reduce((s, l) => {
    const sign = l.charge_type === 'RETAIL_DISCOUNT' ? -1 : 1;
    return s + sign * l.amount * (l.qty ?? 1);
  }, 0);
  const change = paymentAmount > total ? paymentAmount - total : 0;
  const allowedMethods = preview?.payments_required?.allowed_methods ?? ['CASH', 'TRANSFER'];

  const needsApproval = !!preview?.approvals?.any_required;

  const blockReasons: string[] = [];
  if (!branchId) blockReasons.push(t('retail.create.blockNoBranch'));
  if (lines.length === 0) blockReasons.push(t('retail.create.blockEmptyCart'));
  // Payment-side checks only apply to atomic flow. Approval flow defers payment.
  if (!needsApproval) {
    if (paymentMethod === 'TRANSFER' && !bankAccountId) blockReasons.push(t('retail.create.blockNoBank'));
    if (lines.length > 0 && paymentAmount < total) blockReasons.push(t('retail.create.blockInsufficient'));
  }
  preview?.guards?.custom_guards?.forEach(g => {
    if (g.ok === false && g.message_th) blockReasons.push(g.message_th);
  });
  preview?.blockers?.forEach(b => {
    if (b.message_th || b.message_en) blockReasons.push(b.message_th || b.message_en || b.code);
  });
  // For atomic path, preview must be valid. For approval path, preview returns
  // valid: false only because of the approval requirement — that's expected.
  const previewOk = needsApproval ? !!preview : !!preview?.valid;
  if (preview && !previewOk && blockReasons.length === 0) {
    blockReasons.push(t('retail.create.blockInvalid'));
  }
  const canSubmit = blockReasons.length === 0 && previewOk && !submitMutation.isPending;

  const handleSubmitClick = () => {
    if (submitMutation.isPending || previewing) return;
    if (!canSubmit) {
      addSnackbar({
        type: 'warning',
        message: (
          <div className="alert alert-warning">
            <AlertCircle size={16} />
            <div className="alert-description">
              <div className="font-medium mb-1">{t('retail.create.cannotSubmit')}</div>
              <ul className="list-disc pl-4 text-sm space-y-0.5">
                {blockReasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          </div>
        ),
      });
      return;
    }
    submitMutation.mutate();
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
    <Modal open={open} onClose={onClose} maxWidth="42rem" width="100%" ariaLabel="Create Retail Bill">
      <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
        <div className="modal-header">
          <h2 className="modal-title">{t('retail.create.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
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
                        isDiscount ? 'bg-warning/5' : ''
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
                        <div className="text-sm font-medium tabular-nums">
                          {isDiscount ? '−' : ''}{fmtCurrency(line.amount * (line.qty ?? 1))}
                        </div>
                        {(line.qty ?? 1) > 1 && (
                          <div className="text-xs text-fg/50">
                            {fmtCurrency(line.amount)} × {line.qty}
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

          {/* Blockers / preview error */}
          {(preview?.blockers && preview.blockers.length > 0) && (
            <div className="space-y-1">
              {preview.blockers.map((b, i) => (
                <div key={i} className="alert alert-danger">
                  <XCircle size={16} />
                  <div className="alert-description">{b.message_th || b.message_en || b.code}</div>
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

          {/* Payment method + amount (atomic flow only — approval flow defers payment) */}
          {!needsApproval && (
            <>
              <div className="input-group">
                <div className="w-28 shrink-0">
                  <Select
                    value={paymentMethod}
                    onChange={(v) => { setPaymentMethod((v as PaymentMethod) ?? 'CASH'); setBankAccountId(null); }}
                    options={allowedMethods.map(m => ({ label: t(`paymentMethod.${m}`, { defaultValue: m }), value: m }))}
                    size="sm"
                    searchable={false}
                  />
                </div>
                <div className="input-group-divider" />
                <MaskedInput
                  mask="number"
                  decimalScale={2}
                  value={paymentAmount ? String(paymentAmount) : ''}
                  onChange={(raw) => setPaymentAmount(parseFloat(raw) || 0)}
                  placeholder={t('retail.create.amountPlaceholder')}
                  size="sm"
                  className="w-full"
                  endIcon={<ChevronsRight size={14} />}
                  onEndIconClick={total > 0 ? () => setPaymentAmount(total) : undefined}
                />
              </div>
              <BranchPaymentAccountField
                active={paymentMethod === 'TRANSFER'}
                onResolve={setBankAccountId}
              />
            </>
          )}
          {needsApproval && (
            <div className="alert alert-info">
              <AlertCircle size={16} />
              <div className="alert-description">{t('retail.create.approvalNote')}</div>
            </div>
          )}

          {/* Total + change */}
          <div className="flex flex-col items-end pt-2 pb-6 border-t border-line">
            <div className="flex items-baseline gap-3">
              <span className="text-base text-subtle">{t('retail.create.total')}</span>
              <span className="heading-3 tabular-nums">{fmtCurrency(total)}</span>
            </div>
            {paymentAmount > total && (
              <div className="flex items-baseline gap-3 text-sm mt-1">
                <span className="text-subtle">{t('retail.create.change')}</span>
                <span className="font-medium tabular-nums text-success">{fmtCurrency(change)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            variant={canSubmit ? 'solid' : 'outline'}
            disabled={submitMutation.isPending || previewing}
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
    </Modal>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Product picker
 * ─────────────────────────────────────────────────────────────────────────── */

function ProductPickerModal({ open, branchId, onClose, onPick }: {
  open: boolean;
  branchId: number | null;
  onClose: () => void;
  onPick: (variant: SellableVariant, qty: number) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [pickedQtys, setPickedQtys] = useState<Record<number, number>>({});
  const { open: openScanner, scannerEl } = useBarcodeScanner({ onScan: setSearch });

  useEffect(() => {
    if (!open) {
      setSearch('');
      setDebounced('');
      setPickedQtys({});
    }
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: variants = [], isFetching } = useQuery({
    queryKey: ['retail-create', 'sellable', branchId, debounced],
    queryFn: () => {
      let url = `/v_branch_sellable_stock_priced?branch_id=eq.${branchId}&qty=gt.0&order=brand_name,model_name&limit=50`;
      if (debounced) {
        const term = debounced.replace(/\s+/g, '*');
        const enc = encodeURIComponent(term);
        const isBarcode = /^\d{8,}$/.test(debounced);
        const orParts = [`full_name.ilike.*${enc}*`];
        if (isBarcode) orParts.push(`barcodes.cs.{${debounced}}`);
        url += `&or=(${orParts.join(',')})`;
      }
      return apiClient.get<SellableVariant[]>(url);
    },
    enabled: open && !!branchId,
    staleTime: 30 * 1000,
  });

  return (
    <>
    {scannerEl}
    <Modal open={open} onClose={onClose} maxWidth="40rem" width="100%" ariaLabel="Add Product">
      <div className="flex flex-col overflow-hidden" style={{ height: '70dvh' }}>
        <div className="modal-header">
          <h2 className="modal-title">{t('retail.create.productPickerTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          <div className="input-group mb-3">
            <Button
              size="sm"
              variant="outline"
              startIcon={<ScanBarcode size={16} />}
              onClick={openScanner}
              aria-label={t('barcodeScanner.title', { defaultValue: 'Scan barcode' })}
            />
            <div className="input-group-divider" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('retail.create.searchProducts')}
              size="sm"
              className="w-full"
              autoFocus
            />
          </div>
          {isFetching && variants.length === 0 ? (
            <div className="p-8 text-center text-subtler text-sm">{t('common.loading')}</div>
          ) : variants.length === 0 ? (
            <div className="p-8 text-center text-subtler text-sm">{t('retail.create.noProducts')}</div>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {variants.map(v => {
                const qty = pickedQtys[v.variant_id] ?? 1;
                return (
                  <div key={v.variant_id} className="flex items-center gap-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-medium truncate">{v.full_name}</span>
                        {v.barcodes.length > 0 && (
                          <Tooltip content={v.barcodes.join('\n')} placement="top">
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-subtle shrink-0">
                              <Barcode size={12} />
                              {v.barcodes.length > 1 && <span className="tabular-nums">{v.barcodes.length}</span>}
                            </span>
                          </Tooltip>
                        )}
                      </div>
                      <div className="text-xs text-subtle flex items-center gap-2">
                        <span>{t('retail.create.stock')}: {v.qty}</span>
                        <span className="font-medium tabular-nums">{fmtCurrency(v.retail_price)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 w-24">
                      <NumberSpinner
                        value={qty}
                        onChange={(val) => setPickedQtys(prev => ({
                          ...prev,
                          [v.variant_id]: Math.max(1, val === '' ? 1 : Number(val)),
                        }))}
                        min={1}
                        max={v.qty}
                        scale="sm"
                      />
                    </div>
                    <Button
                      size="sm"
                      color="primary"
                      onClick={() => onPick(v, qty)}
                      disabled={qty > v.qty}
                    >
                      {t('retail.create.add')}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </Modal>
    </>
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
