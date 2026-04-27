import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Modal, Button, Select, Badge, Input, MaskedInput, NumberSpinner, TextArea, useSnackbarContext,
} from 'tsp-form';
import {
  Plus, Trash2, ShoppingCart, Truck, Percent, Wallet,
  AlertCircle, CheckCircle, XCircle, Search,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';

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
}

interface BankAccount {
  id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
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

  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [shippingOpen, setShippingOpen] = useState(false);
  const [discountForLineIdx, setDiscountForLineIdx] = useState<number | null>(null);

  // Reset everything when modal closes/reopens
  useEffect(() => {
    if (!open) {
      setLines([]);
      setPaymentMethod('CASH');
      setPaymentAmount(0);
      setBankAccountId(null);
      setPreview(null);
      setPreviewError('');
      setProductPickerOpen(false);
      setShippingOpen(false);
      setDiscountForLineIdx(null);
    }
  }, [open]);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts-active'],
    queryFn: () => apiClient.get<BankAccount[]>('/v_bank_accounts?is_active=is.true&order=bank_name'),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (open && !branchId && branches.length > 0) {
      setBranchId(branches[0].id);
    }
  }, [open, branches, branchId]);

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

  const submitMutation = useMutation({
    mutationFn: () => apiClient.rpc<SubmitResponse>('fn_bill_retail_submit', {
      ...previewParams,
      p_payment_reference: null,
      p_preview_token: preview?.preview_token,
    }),
    onSuccess: (res) => {
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span className="alert-description">
              {t('retail.create.submitSuccess', { code: res.code_display, change: fmtCurrency(res.change_amount) })}
            </span>
          </div>
        ),
      });
      onSuccess();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        addSnackbar({
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

  const total = preview?.bill?.total_amount ?? lines.reduce((s, l) => {
    const sign = l.charge_type === 'RETAIL_DISCOUNT' ? -1 : 1;
    return s + sign * l.amount * (l.qty ?? 1);
  }, 0);
  const change = paymentAmount > total ? paymentAmount - total : 0;
  const allowedMethods = preview?.payments_required?.allowed_methods ?? ['CASH', 'TRANSFER'];

  const blockReasons: string[] = [];
  if (!branchId) blockReasons.push(t('retail.create.blockNoBranch'));
  if (lines.length === 0) blockReasons.push(t('retail.create.blockEmptyCart'));
  if (paymentMethod === 'TRANSFER' && !bankAccountId) blockReasons.push(t('retail.create.blockNoBank'));
  if (lines.length > 0 && paymentAmount < total) blockReasons.push(t('retail.create.blockInsufficient'));
  if (preview?.approvals?.any_required) blockReasons.push(t('retail.create.blockNeedsApproval'));
  preview?.guards?.custom_guards?.forEach(g => {
    if (g.ok === false && g.message_th) blockReasons.push(g.message_th);
  });
  preview?.blockers?.forEach(b => {
    if (b.message_th || b.message_en) blockReasons.push(b.message_th || b.message_en || b.code);
  });
  if (preview && !preview.valid && blockReasons.length === 0) {
    blockReasons.push(t('retail.create.blockInvalid'));
  }
  const canSubmit = blockReasons.length === 0 && !!preview?.valid && !submitMutation.isPending;

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

        <div className="modal-content flex flex-col gap-3" style={{ paddingBottom: 0 }}>
          {/* Branch + walk-in tag */}
          <div className="flex items-center gap-2">
            <div style={{ width: '14rem' }}>
              <Select
                value={branchId ? String(branchId) : null}
                onChange={(v) => setBranchId(v ? Number(v) : null)}
                placeholder={t('accounting.branch')}
                options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
                size="sm"
                showChevron
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
                          <div className="text-xs text-warning flex items-center gap-1 mt-0.5">
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

          {/* Payment method + amount (single payment per retail bill — split_allowed=false) */}
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
              endIcon={<Wallet size={14} />}
              onEndIconClick={total > 0 ? () => setPaymentAmount(total) : undefined}
            />
          </div>
          {paymentMethod === 'TRANSFER' && (
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
          )}

          {/* Total + change */}
          <div className="flex flex-col items-end pt-2 pb-6 border-t border-line">
            <div className="flex items-baseline gap-3">
              <span className="text-base text-fg/70">{t('retail.create.total')}</span>
              <span className="heading-3 tabular-nums">{fmtCurrency(total)}</span>
            </div>
            {paymentAmount > total && (
              <div className="flex items-baseline gap-3 text-sm mt-1">
                <span className="text-fg/60">{t('retail.create.change')}</span>
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
            {submitMutation.isPending
              ? t('common.loading')
              : previewing
              ? t('retail.create.previewing')
              : t('retail.create.checkout')}
          </Button>
        </div>
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
        url += `&full_name=ilike.*${encodeURIComponent(term)}*`;
      }
      return apiClient.get<SellableVariant[]>(url);
    },
    enabled: open && !!branchId,
    staleTime: 30 * 1000,
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="40rem" width="100%" ariaLabel="Add Product">
      <div className="flex flex-col overflow-hidden" style={{ height: '70dvh' }}>
        <div className="modal-header">
          <h2 className="modal-title">{t('retail.create.productPickerTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('retail.create.searchProducts')}
            startIcon={<Search size={16} />}
            size="sm"
            className="w-full mb-3"
            autoFocus
          />
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
                      <div className="text-sm font-medium truncate">{v.full_name}</div>
                      <div className="text-xs text-fg/60 flex items-center gap-2">
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
