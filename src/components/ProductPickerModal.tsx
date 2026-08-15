import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, NumberSpinner, Tooltip, Badge } from 'tsp-form';
import { ScanBarcode, Barcode } from 'lucide-react';
import { apiClient } from '../lib/api';
import { fmtCurrency } from '../lib/format';
import { useBarcodeScanner } from './BarcodeScanner';
import { SearchInput } from './SearchInput';

export interface SellableVariant {
  variant_id: number;
  full_name: string;
  brand_name: string;
  model_name: string;
  variant_name: string;
  retail_price: number;
  qty: number;
  barcodes: string[];
}

interface Props {
  open: boolean;
  branchId: number | null;
  /** variant_id → qty already in cart. Flags in-cart items, pre-fills the
      stepper, and switches the button to "Update". Caller must dedupe by
      variant_id in onPick. */
  cartQtys: Record<number, number>;
  onClose: () => void;
  onPick: (variant: SellableVariant, qty: number) => void;
  /** Override modal title (defaults to retail picker title). */
  titleKey?: string;
  /** Override the Add button label (used when not in cart). */
  addLabelKey?: string;
}

/**
 * Product picker for "+ product / + accessory / + gift" cart actions.
 * Queries `v_branch_sellable_stock_priced` (qty > 0, ON_HAND_AVAILABLE) with
 * debounced ilike + barcode search. Flags items already in the cart and
 * switches to "Update" so re-picking the same variant updates its line.
 * Used by the retail New Bill modal and the contract Review & Pay cart.
 */
export function ProductPickerModal({
  open,
  branchId,
  cartQtys,
  onClose,
  onPick,
  titleKey,
  addLabelKey,
}: Props) {
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

  const { data: variants = [], isFetching } = useQuery({
    queryKey: ['sellable-variants', branchId, debounced],
    queryFn: () => {
      // bucket=ON_HAND_AVAILABLE is REQUIRED, not a nicety. The view returns one
      // row PER BUCKET, so a variant that also has IN_TRANSIT_OUTBOUND stock came
      // back twice — duplicate React keys, and because the picker indexes its
      // stepper state by variant_id, editing one row's qty moved the other's.
      // Only ON_HAND_AVAILABLE is sellable anyway (inv.ref_asset_actions gates
      // every sell action on that bucket), so the other rows were never pickable.
      let url = `/v_branch_sellable_stock_priced?branch_id=eq.${branchId}&qty=gt.0&bucket=eq.ON_HAND_AVAILABLE&order=brand_name,model_name&limit=50`;
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
    <Modal open={open} onClose={onClose} maxWidth="40rem" width="100%" ariaLabel={t(titleKey ?? 'retail.create.productPickerTitle')}>
      <div className="flex flex-col overflow-hidden" style={{ height: '70dvh' }}>
        <div className="modal-header">
          <h2 className="modal-title">{t(titleKey ?? 'retail.create.productPickerTitle')}</h2>
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
            <SearchInput
              value={search}
              onChange={setSearch}
              onDebouncedChange={setDebounced}
              placeholder={t('retail.create.searchProducts')}
              size="sm"
              // The scan button already carries the magnifier's job here, and
              // the input-group has no room for a second leading icon.
              startIcon={null}
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
                const inCartQty = cartQtys[v.variant_id] ?? 0;
                const isInCart = inCartQty > 0;
                // Default the stepper to the current cart qty so "Update"
                // starts from where the line already is.
                const qty = pickedQtys[v.variant_id] ?? (isInCart ? inCartQty : 1);
                const changed = qty !== inCartQty;
                return (
                  <div
                    key={v.variant_id}
                    className={`flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-md ${isInCart ? 'bg-primary-soft' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-medium truncate">{v.full_name}</span>
                        {isInCart && (
                          <Badge size="sm" color="primary" className="shrink-0">
                            {t('retail.create.inCart', { count: inCartQty })}
                          </Badge>
                        )}
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
                      variant={isInCart && !changed ? 'outline' : 'solid'}
                      onClick={() => onPick(v, qty)}
                      disabled={qty > v.qty}
                    >
                      {isInCart ? t('retail.create.updateCart') : t(addLabelKey ?? 'retail.create.add')}
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
