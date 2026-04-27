import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, Button, Select, Badge,
  Modal, Input, MaskedInput, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowRightFromLine, Plus, Trash2, ShoppingCart, Truck, Percent,
  AlertCircle, CheckCircle, XCircle, Search,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';

// ============================================================================
// Types — match fn_bill_retail_preview / fn_bill_retail_submit (doc 38 §0)
// ============================================================================

interface Branch {
  id: number;
  name: string;
}

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

interface AddableChargeType {
  charge_type: string;
  charge_type_label: string;
  line_type: string;
  owner_type: string;
  amount_sign: 'positive' | 'negative';
  requires_approval: boolean;
  approval_reason: string | null;
}

interface PreviewLine {
  line_no: number;
  charge_type: string;
  line_type: string;
  amount: number;
  qty: number;
  description: string;
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
    addable_charge_types: AddableChargeType[];
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
  blockers?: Blocker[];
}

interface SubmitResponse {
  bill_id: number;
  bill_code: string;
  status: 'PAID';
  change_amount: number;
}

// ============================================================================
// Component
// ============================================================================

export function RetailPosPage() {
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
    if (!branchId && branches.length > 0) {
      setBranchId(branches[0].id);
    }
  }, [branches, branchId]);

  const previewParams = useMemo(() => ({
    p_branch_id: branchId,
    p_customer_id: null,
    p_line_items: lines,
    p_payment_method: paymentMethod,
    p_payment_amount: paymentAmount,
    p_bank_account_id: bankAccountId,
  }), [branchId, lines, paymentMethod, paymentAmount, bankAccountId]);

  const runPreview = useCallback(async () => {
    if (!branchId || lines.length === 0) {
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
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setPreviewError(translated || err.message);
      } else {
        setPreviewError(String(err));
      }
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [branchId, lines.length, previewParams, t]);

  // Re-preview on structural boundaries: add/remove line, branch change, payment method change
  useEffect(() => {
    runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, lines, paymentMethod, paymentAmount, bankAccountId]);

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
              {t('retail.pos.submitSuccess', { code: res.bill_code, change: fmtCurrency(res.change_amount) })}
            </span>
          </div>
        ),
      });
      setLines([]);
      setPaymentAmount(0);
      setBankAccountId(null);
      setPreview(null);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
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
      // Cascade: if removing a sale line, also remove discounts pointing at it
      const removeSet = new Set<number>([idx]);
      prev.forEach((l, i) => {
        if (l.charge_type === 'RETAIL_DISCOUNT' && l.target_line_index === idx) removeSet.add(i);
      });
      const next = prev.filter((_, i) => !removeSet.has(i));
      // Reindex remaining discount targets to account for removed indices
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

  const canSubmit =
    !!preview?.valid &&
    !preview.approvals?.any_required &&
    paymentAmount >= total &&
    !submitMutation.isPending;

  const saleLines = lines
    .map((l, i) => ({ ...l, idx: i }))
    .filter(l => l.charge_type === 'RETAIL_SALE');

  return (
    <PageNav panels={['cart']} className="h-dvh">
      {({ isMobile, isRoot }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot && (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label="Open menu"
                    onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                  >
                    <ArrowRightFromLine size={18} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {t('retail.pos.title')}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('retail.pos.title')}</h1>
              <p className="text-sm text-fg/60 truncate">{t('retail.pos.description')}</p>
            </div>
          )}

          <PageNavPanel id="cart" className="flex-1 flex flex-col min-h-0">
            <div className="flex-none flex items-center gap-2 p-3 border-b border-line">
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

            <div className="flex-1 overflow-auto better-scroll p-4">
              {lines.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-subtler gap-3">
                  <ShoppingCart size={48} className="opacity-30" />
                  <p>{t('retail.pos.emptyCart')}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {lines.map((line, idx) => {
                    const previewLine = preview?.lines?.[idx];
                    const isDiscount = line.charge_type === 'RETAIL_DISCOUNT';
                    return (
                      <div key={idx} className={`flex items-center gap-3 p-3 border rounded-lg ${isDiscount ? 'border-warning/30 bg-warning/5' : 'border-line'}`}>
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
                              {t('retail.pos.requiresApproval')}
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
                        <Button size="sm" className="btn-icon-sm shrink-0" onClick={() => removeLine(idx)} aria-label="Remove">
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex-none flex flex-wrap gap-2 p-3 border-t border-line">
              <Button
                variant="outline"
                color="primary"
                size="sm"
                startIcon={<Plus size={14} />}
                onClick={() => setProductPickerOpen(true)}
                disabled={!branchId}
              >
                {t('retail.pos.addProduct')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                startIcon={<Percent size={14} />}
                onClick={() => setDiscountForLineIdx(saleLines[0]?.idx ?? -1)}
                disabled={saleLines.length === 0}
              >
                {t('retail.pos.addDiscount')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                startIcon={<Truck size={14} />}
                onClick={() => setShippingOpen(true)}
              >
                {t('retail.pos.addShipping')}
              </Button>
            </div>

            {(preview?.blockers && preview.blockers.length > 0) && (
              <div className="flex-none px-3 py-2 border-t border-line space-y-1">
                {preview.blockers.map((b, i) => (
                  <div key={i} className="alert alert-danger">
                    <XCircle size={16} />
                    <div className="alert-description">{b.message_th || b.message_en || b.code}</div>
                  </div>
                ))}
              </div>
            )}

            {previewError && (
              <div className="flex-none px-3 py-2 border-t border-line">
                <div className="alert alert-danger">
                  <XCircle size={16} />
                  <div className="alert-description">{previewError}</div>
                </div>
              </div>
            )}

            <div className="flex-none p-3 border-t border-line bg-surface flex flex-col gap-3">
              {/* Payment method + amount + (bank if transfer) */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="sm:w-32 shrink-0">
                  <Select
                    value={paymentMethod}
                    onChange={(v) => { setPaymentMethod((v as PaymentMethod) ?? 'CASH'); setBankAccountId(null); }}
                    options={allowedMethods.map(m => ({ label: t(`paymentMethod.${m}`, { defaultValue: m }), value: m }))}
                    size="sm"
                    searchable={false}
                    showChevron
                  />
                </div>
                <MaskedInput
                  mask="number"
                  decimalScale={2}
                  value={paymentAmount ? String(paymentAmount) : ''}
                  onChange={(raw) => setPaymentAmount(parseFloat(raw) || 0)}
                  placeholder={t('retail.pos.amountPlaceholder')}
                  size="sm"
                  className="w-full"
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
                  placeholder={t('retail.pos.selectBank')}
                  size="sm"
                  showChevron
                />
              )}

              <div className="flex justify-between text-sm">
                <span className="text-fg/60">{t('retail.pos.total')}</span>
                <span className="font-semibold tabular-nums">{fmtCurrency(total)}</span>
              </div>
              {paymentAmount > total && (
                <div className="flex justify-between text-sm">
                  <span className="text-fg/60">{t('retail.pos.change')}</span>
                  <span className="font-semibold tabular-nums text-success">{fmtCurrency(change)}</span>
                </div>
              )}
              <Button
                color="primary"
                className="w-full"
                disabled={!canSubmit}
                onClick={() => submitMutation.mutate()}
              >
                {submitMutation.isPending
                  ? t('common.loading')
                  : previewing
                  ? t('retail.pos.previewing')
                  : t('retail.pos.submit')}
              </Button>
            </div>
          </PageNavPanel>

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
        </>
      )}
    </PageNav>
  );
}

// ============================================================================
// Product Picker Modal
// ============================================================================

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
    queryKey: ['retail-pos', 'sellable', branchId, debounced],
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
          <h2 className="modal-title">{t('retail.pos.productPickerTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('retail.pos.searchProducts')}
            startIcon={<Search size={16} />}
            size="sm"
            className="w-full mb-3"
            autoFocus
          />
          {isFetching && variants.length === 0 ? (
            <div className="p-8 text-center text-subtler text-sm">{t('common.loading')}</div>
          ) : variants.length === 0 ? (
            <div className="p-8 text-center text-subtler text-sm">{t('retail.pos.noProducts')}</div>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {variants.map(v => {
                const qty = pickedQtys[v.variant_id] ?? 1;
                return (
                  <div key={v.variant_id} className="flex items-center gap-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{v.full_name}</div>
                      <div className="text-xs text-fg/60 flex items-center gap-2">
                        <span>{t('retail.pos.stock')}: {v.qty}</span>
                        <span className="font-medium tabular-nums">{fmtCurrency(v.retail_price)}</span>
                      </div>
                    </div>
                    <div className="w-16 shrink-0">
                      <MaskedInput
                        mask="number"
                        decimalScale={0}
                        value={String(qty)}
                        onChange={(raw) => setPickedQtys(prev => ({ ...prev, [v.variant_id]: Math.max(1, parseInt(raw) || 1) }))}
                        size="sm"
                        className="w-full"
                      />
                    </div>
                    <Button
                      size="sm"
                      color="primary"
                      onClick={() => onPick(v, qty)}
                      disabled={qty > v.qty}
                    >
                      {t('retail.pos.add')}
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

// ============================================================================
// Shipping Modal
// ============================================================================

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
          <h2 className="modal-title">{t('retail.pos.addShipping')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('retail.pos.amount')}</label>
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
            <label className="form-label">{t('retail.pos.descriptionLabel')}</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('retail.pos.shippingDescriptionPlaceholder')}
              size="sm"
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

// ============================================================================
// Discount Modal
// ============================================================================

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
          <h2 className="modal-title">{t('retail.pos.addDiscount')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('retail.pos.discountTarget')}</label>
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
            <label className="form-label">{t('retail.pos.amount')}</label>
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
              <div className="text-xs text-danger mt-1">{t('retail.pos.discountExceedsLine')}</div>
            )}
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('retail.pos.discountReason')}</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('retail.pos.discountReasonPlaceholder')}
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
