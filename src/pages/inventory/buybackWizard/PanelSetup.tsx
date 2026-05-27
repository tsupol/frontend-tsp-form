import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query';
import { Input, Button, Modal, Badge, TextArea, MaskedInput } from 'tsp-form';
import { Search, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useFormSnapshot } from '../../../hooks/useFormSnapshot';
import { getLine } from './useBuyback';
import type { BuybackDraft } from './types';

interface ProductSearchVariant { variant_id: number; sku_code: string; name: string; is_active: boolean }
interface ProductSearchModel {
  model_id: number;
  model_code: string;
  model_name: string;
  brand_name: string | null;
  family_name: string | null;
  is_contractable: boolean;
  is_active: boolean;
  variants: ProductSearchVariant[];
}
interface ProductSearchResponse { rows: ProductSearchModel[] }

interface PickedProduct {
  model_id: number;
  variant_id: number;
  brand_name: string;
  family_name: string;
  model_name: string;
  variant_name: string;
  sku_code: string;
}

export function PanelSetup({
  draft,
  dirtyRef,
  onSaved,
  onClose,
}: {
  draft: BuybackDraft | null;
  dirtyRef?: React.MutableRefObject<boolean>;
  onSaved: (newPoId: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const line = getLine(draft);

  const [product, setProduct] = useState<PickedProduct | null>(() =>
    line?.model_id && line?.variant_id
      ? {
          model_id: line.model_id,
          variant_id: line.variant_id,
          brand_name: line.brand_name ?? '',
          family_name: line.family_name ?? '',
          model_name: line.model_name ?? '',
          variant_name: line.variant_name ?? '',
          sku_code: line.sku_code ?? '',
        }
      : null,
  );
  const [seller, setSeller] = useState(draft?.supplier_name ?? '');
  const [price, setPrice] = useState<string>(line?.buyback_price != null ? String(line.buyback_price) : '');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState('');

  // Dirty tracking — diff form state vs. last snapshot baseline.
  const snapshot = useFormSnapshot({
    productVariantId: product?.variant_id ?? null,
    seller,
    price,
    notes,
  });

  // Push dirty state up
  useEffect(() => {
    if (dirtyRef) dirtyRef.current = snapshot.isDirty;
  }, [snapshot.isDirty, dirtyRef]);

  // Initial snapshot for the no-draft case (fresh wizard)
  useEffect(() => {
    if (!draft) snapshot.resetNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-sync local state when draft refetches (after save / external invalidation)
  useEffect(() => {
    if (!draft) return;
    const l = getLine(draft);
    setSeller(draft.supplier_name ?? '');
    setNotes(draft.notes ?? '');
    setPrice(l?.buyback_price != null ? String(l.buyback_price) : '');
    if (l?.model_id && l?.variant_id) {
      setProduct({
        model_id: l.model_id,
        variant_id: l.variant_id,
        brand_name: l.brand_name ?? '',
        family_name: l.family_name ?? '',
        model_name: l.model_name ?? '',
        variant_name: l.variant_name ?? '',
        sku_code: l.sku_code ?? '',
      });
    }
    snapshot.resetNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const save = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error(t('buybackWizard.errorPickProduct', { defaultValue: 'Pick a product first' }));
      const priceNum = Number(price);
      if (!priceNum || priceNum <= 0) throw new Error(t('buybackWizard.errorPriceRequired', { defaultValue: 'Price must be > 0' }));

      if (!draft) {
        // Create draft
        const result = await apiClient.rpc<{ po_id: number; line_ids: number[] }>('fn_inv_buyback_create_draft', {
          p_lines: [{
            model_id: product.model_id,
            variant_id: product.variant_id,
            buyback_price: priceNum,
            item_condition: 'USED_A',
            condition_snapshot: {},
            images: [],
            note: null,
          }],
          p_seller_name: seller.trim() || null,
          p_notes: notes.trim() || null,
          p_branch_id: null,
        });
        return result.po_id;
      }

      // Update line — buyback is single-line
      if (!line) throw new Error('No line on draft');
      await apiClient.rpc('fn_inv_buyback_update_line', {
        p_line_id: line.po_line_id,
        p_model_id: product.model_id,
        p_variant_id: product.variant_id,
        p_buyback_price: priceNum,
        p_item_condition: null,
        p_condition_snapshot: null,
        p_images: null,
        p_note: null,
        p_branch_id: null,
      });
      // Note: seller_name / notes are PO-header fields. There's no documented
      // RPC for editing them post-create. We only set them on create_draft.
      return draft.po_id;
    },
    onSuccess: (poId) => {
      setError('');
      snapshot.reset();
      if (dirtyRef) dirtyRef.current = false;
      onSaved(poId);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  const canSave = !!product && Number(price) > 0 && seller.trim().length > 0 && !save.isPending;
  const isEditingExisting = !!draft;

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden better-scroll">
        <div className="p-4 max-w-2xl min-w-0">
          <h2 className="heading-3 mb-4">{t('buybackWizard.cardSetup', { defaultValue: 'Setup' })}</h2>

          {error && (
            <div className="alert alert-danger mb-4">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-grid gap-4">
            {/* Product picker */}
            <div className="flex flex-col min-w-0">
              <label className="form-label">{t('buybackWizard.product', { defaultValue: 'Product' })} *</label>
              {product ? (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-line bg-surface min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {[product.brand_name, product.family_name, product.model_name].filter(Boolean).join(' ')}
                    </div>
                    <div className="text-xs text-subtle truncate">{product.variant_name} · {product.sku_code}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)} className="shrink-0">
                    {t('common.change', { defaultValue: 'Change' })}
                  </Button>
                </div>
              ) : (
                <Button variant="outline" startIcon={<Search size={16} />} onClick={() => setPickerOpen(true)}>
                  {t('buybackWizard.pickProduct', { defaultValue: 'Pick a product' })}
                </Button>
              )}
            </div>

            {/* Seller */}
            <div className="flex flex-col min-w-0">
              <label className="form-label">{t('buyback.seller')} *</label>
              <Input
                value={seller}
                onChange={(e) => setSeller(e.target.value)}
                placeholder={t('buybackWizard.sellerPlaceholder', { defaultValue: 'Walk-in customer name' })}
                className="w-full"
                disabled={isEditingExisting}
              />
              {isEditingExisting && (
                <div className="text-xs text-subtle mt-1">
                  {t('buybackWizard.sellerLocked', { defaultValue: 'Seller name is set at creation and not editable after.' })}
                </div>
              )}
            </div>

            {/* Price */}
            <div className="flex flex-col min-w-0">
              <label className="form-label">{t('buybackWizard.price', { defaultValue: 'Buyback price' })} *</label>
              <MaskedInput
                mask="number"
                decimalScale={2}
                value={price}
                onChange={(raw) => setPrice(raw)}
                className="w-full"
              />
            </div>

            {/* Notes */}
            <div className="flex flex-col min-w-0">
              <label className="form-label">{t('buybackWizard.poNotes', { defaultValue: 'Notes' })}</label>
              <TextArea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder={t('buybackWizard.poNotesPlaceholder', { defaultValue: 'Optional notes for this buyback' })}
                disabled={isEditingExisting}
                className="w-full"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-none border-t border-line px-4 py-3 flex justify-end gap-2">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="primary" disabled={!canSave} onClick={() => save.mutate()}>
          {save.isPending ? t('common.loading') : t('common.save', { defaultValue: 'Save' })}
        </Button>
      </div>

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(p) => { setProduct(p); setPickerOpen(false); }}
      />
    </div>
  );
}

function ProductPickerModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (p: PickedProduct) => void;
}) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setKeyword('');
      setDebounced('');
      setSelectedModelId(null);
      setSelectedVariantId(null);
    }
  }, [open]);

  useEffect(() => {
    const tm = setTimeout(() => setDebounced(keyword.trim()), 300);
    return () => clearTimeout(tm);
  }, [keyword]);

  const { data: results, isFetching } = useQuery({
    queryKey: ['buyback-product-search', debounced],
    queryFn: () => apiClient.rpc<ProductSearchResponse>('fn_product_search', {
      p_q: debounced,
      p_is_contractable: true,
      p_is_active: true,
      p_limit: 20,
    }),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const models = results?.rows ?? [];
  const selectedModel = useMemo(() => models.find(m => m.model_id === selectedModelId) ?? null, [models, selectedModelId]);
  const activeVariants = useMemo(() => selectedModel?.variants.filter(v => v.is_active) ?? [], [selectedModel]);

  useEffect(() => {
    if (activeVariants.length === 0) { setSelectedVariantId(null); return; }
    if (!activeVariants.some(v => v.variant_id === selectedVariantId)) {
      setSelectedVariantId(activeVariants[0].variant_id);
    }
  }, [activeVariants, selectedVariantId]);

  const selectedVariant = activeVariants.find(v => v.variant_id === selectedVariantId) ?? null;
  const canConfirm = !!selectedModel && !!selectedVariant;

  const handleConfirm = () => {
    if (!selectedModel || !selectedVariant) return;
    onPick({
      model_id: selectedModel.model_id,
      variant_id: selectedVariant.variant_id,
      brand_name: selectedModel.brand_name ?? '',
      family_name: selectedModel.family_name ?? '',
      model_name: selectedModel.model_name,
      variant_name: selectedVariant.name,
      sku_code: selectedVariant.sku_code,
    });
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="36rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('buybackWizard.pickProduct', { defaultValue: 'Pick a product' })}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t('buybackWizard.searchPlaceholder', { defaultValue: 'Search model (e.g. iPhone 16)' })}
            startIcon={<Search size={16} />}
            className="w-full"
            autoFocus
          />
          <div className="mt-3 h-80 overflow-auto better-scroll border border-line rounded-md">
            {isFetching && models.length === 0 && (
              <div className="p-3 text-xs text-subtle text-center">{t('common.loading')}</div>
            )}
            {!isFetching && models.length === 0 && (
              <div className="p-3 text-xs text-subtler text-center">{t('common.noData')}</div>
            )}
            {models.map((model) => {
              const activeCount = model.variants.filter(v => v.is_active).length;
              if (activeCount === 0) return null;
              const isSelected = model.model_id === selectedModelId;
              return (
                <div
                  key={model.model_id}
                  className={`border-b border-line last:border-b-0 ${isSelected ? 'bg-item-active-bg' : ''}`}
                >
                  {isSelected ? (
                    <div>
                      <div className="px-3 py-2 flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate text-item-active-fg">
                            {[model.brand_name, model.family_name, model.model_name].filter(Boolean).join(' ')}
                          </div>
                          <div className="text-[11px] text-subtler font-mono truncate">{model.model_code}</div>
                        </div>
                        <Badge size="xs" color="info">{t('po.contractable', { defaultValue: 'Contractable' })}</Badge>
                        <button
                          type="button"
                          className="shrink-0 p-1 rounded hover:bg-surface-hover cursor-pointer bg-transparent border-none text-current"
                          onClick={() => { setSelectedModelId(null); setSelectedVariantId(null); }}
                          aria-label={t('common.clear', { defaultValue: 'Clear' })}
                        >
                          <XCircle size={16} />
                        </button>
                      </div>
                      <div className="border-t border-line/50 px-3 py-2 flex flex-wrap gap-1.5">
                        {activeVariants.map((v) => (
                          <button
                            type="button"
                            key={v.variant_id}
                            onClick={() => setSelectedVariantId(v.variant_id)}
                            className={`px-2.5 py-1 rounded text-xs border cursor-pointer ${
                              v.variant_id === selectedVariantId
                                ? 'border-primary bg-primary-soft text-primary-fg font-medium'
                                : 'border-line bg-bg hover:bg-surface-hover'
                            }`}
                          >
                            {v.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-surface-hover cursor-pointer flex items-center gap-2"
                      onClick={() => setSelectedModelId(model.model_id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {[model.brand_name, model.family_name, model.model_name].filter(Boolean).join(' ')}
                        </div>
                        <div className="text-[11px] text-subtler font-mono truncate">{model.model_code}</div>
                      </div>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button color="primary" disabled={!canConfirm} onClick={handleConfirm}>
            {t('common.confirm', { defaultValue: 'Confirm' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
