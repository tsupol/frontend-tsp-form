import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Input, NumberSpinner } from 'tsp-form';
import { Search } from 'lucide-react';
import { apiClient } from '../lib/api';
import { fmtCurrency } from '../lib/format';

export interface SellableVariant {
  variant_id: number;
  full_name: string;
  brand_name: string;
  model_name: string;
  variant_name: string;
  retail_price: number;
  qty: number;
}

interface Props {
  open: boolean;
  branchId: number | null;
  onClose: () => void;
  onPick: (variant: SellableVariant, qty: number) => void;
  /** Override modal title (defaults to retail picker title). */
  titleKey?: string;
  /** Override Add button label. */
  addLabelKey?: string;
}

/**
 * Shared product picker for "+ accessory / + gift" cart actions.
 * Queries `v_branch_sellable_stock_priced` (qty > 0) at the given branch with
 * debounced ilike search. Used by retail bills and contract Review & Pay.
 */
export function SellableVariantPickerModal({
  open,
  branchId,
  onClose,
  onPick,
  titleKey,
  addLabelKey,
}: Props) {
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
    queryKey: ['sellable-variants', branchId, debounced],
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
    <Modal open={open} onClose={onClose} maxWidth="40rem" width="100%" ariaLabel={t(titleKey ?? 'retail.create.productPickerTitle')}>
      <div className="flex flex-col overflow-hidden" style={{ height: '70dvh' }}>
        <div className="modal-header">
          <h2 className="modal-title">{t(titleKey ?? 'retail.create.productPickerTitle')}</h2>
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
                      {t(addLabelKey ?? 'retail.create.add')}
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
