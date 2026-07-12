import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Modal, Button, Select, TextArea, Badge, Tooltip } from 'tsp-form';
import { XCircle, Plus, Trash2, ChevronsRight, ArrowRight, Search } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { CurrencyInput } from '../../components/CurrencyInput';
import { BranchPinInput } from '../../components/BranchPinInput';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { getBucketLabel, getBucketColor, codeDisplay } from './inventoryUtils';

// ============================================================================
// Sell External B2B (ขายให้คู่ค้า) — sell ON_HAND_AVAILABLE assets out of stock
// to an EXTERNAL partner branch. One bill = many assets, one buyer.
// Spec: nnf/UI_SUMMARY/63_ASSET_SELL_B2B_FLOW.md
//
// Bill is a JOURNAL — money does NOT count toward day-close (counted_in_daily=false).
// Atomic: one call closes the bill (PAID) and moves every asset to SOLD_B2B_EXTERNAL.
// BRANCH_MANAGER only (INVENTORY.SELL_EXTERNAL); RPC is the backstop.
// ============================================================================

interface ExternalBuyerBranch {
  id: number;
  name: string;
  code: string;
  branch_type: string;
  is_active: boolean;
}

// Minimal asset shape the modal needs — matches v_assets + the price-preview items.
export interface SellExternalAsset {
  asset_id: number;
  asset_code: string;
  asset_code_display: string | null;
  product_display_name: string | null;
  variant_name: string;
  serial_no: string | null;
  imei: string | null;
  external_ref: string | null;
  condition_grade: string;
  branch_id: number;
  current_bucket: string;
}

interface PreviewItem {
  asset_id: number;
  asset_code: string;
  product_display_name: string | null;
  variant_name: string;
  serial_no: string | null;
  imei: string | null;
  condition_grade: string;
  sell_price: number;       // suggested default
  cost_basis: number | null;
  catalog_cost: number | null;
  resolve_method: string;   // COST_BASIS | CATALOG_COST
}

interface PreviewResponse {
  items: PreviewItem[];
  total: number;
  count: number;
}

interface SellMovement {
  asset_id: number;
  asset_code: string;
  bucket_from: string;
  bucket_to: string;
}

interface SellResponse {
  bill_id: number;
  bill_code: string;
  buyer_name: string;
  total_amount: number;
  asset_count: number;
  counted_in_daily: boolean;
  asset_movements: SellMovement[];
}

type ViewState = 'form' | 'done';

function translateErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    return (
      (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') ||
      (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '') ||
      err.message
    );
  }
  return String(err);
}

export function SellExternalModal({
  open,
  onClose,
  seedAsset,
  onSold,
}: {
  open: boolean;
  onClose: () => void;
  /** Asset the flow started from — pre-added to the cart. */
  seedAsset: SellExternalAsset | null;
  /** Called after a successful sale (refresh the list) and after a cancel. */
  onSold: () => void;
}) {
  const { t } = useTranslation();

  const [view, setView] = useState<ViewState>('form');
  const [buyerId, setBuyerId] = useState<string | null>(null);
  const [assetIds, setAssetIds] = useState<number[]>([]);
  // Per-asset sell price the user typed (string, raw). Absent = use suggested.
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [addPickerOpen, setAddPickerOpen] = useState(false);

  const [result, setResult] = useState<SellResponse | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  // Buyer picker search state (declared before the reset effect that clears it).
  const [debouncedBuyerSearch, setDebouncedBuyerSearch] = useState('');
  const [selectedBuyer, setSelectedBuyer] = useState<ExternalBuyerBranch | null>(null);
  const buyerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const branchId = seedAsset?.branch_id ?? null;

  // Reset on open.
  useEffect(() => {
    if (open) {
      setView('form');
      setBuyerId(null);
      setSelectedBuyer(null);
      setDebouncedBuyerSearch('');
      setAssetIds(seedAsset ? [seedAsset.asset_id] : []);
      setPrices({});
      setNote('');
      setError('');
      setConfirmClose(false);
      setAddPickerOpen(false);
      setResult(null);
      setCancelOpen(false);
    }
  }, [open, seedAsset]);

  // Buyer picker — EXTERNAL partner branches (RLS-bypass view). There can be
  // ~100 partner branches, so search server-side by name (ILIKE) instead of
  // loading them all. Empty term loads a first batch; the selected option is
  // pinned so it stays visible after the results change.
  const handleBuyerSearch = useCallback((term: string) => {
    if (buyerDebounceRef.current) clearTimeout(buyerDebounceRef.current);
    buyerDebounceRef.current = setTimeout(() => setDebouncedBuyerSearch(term.trim()), 300);
  }, []);

  const { data: buyers = [], isFetching: buyersFetching } = useQuery({
    queryKey: ['external-buyer-branches', debouncedBuyerSearch],
    queryFn: () => {
      const term = debouncedBuyerSearch.replace(/[*,()]/g, '');
      const filter = term ? `&name=ilike.*${encodeURIComponent(term)}*` : '';
      // No term → first 20 by name; with a term → matches (capped).
      return apiClient.get<ExternalBuyerBranch[]>(
        `/v_external_buyer_branches?order=name.asc&limit=20${filter}`,
      );
    },
    enabled: open,
    staleTime: 60 * 1000,
  });
  const buyerOptions = useMemo(() => {
    const base = buyers.map(b => ({ value: String(b.id), label: b.name }));
    // Pin the selected branch so it doesn't vanish when the search narrows.
    if (selectedBuyer && !base.some(o => o.value === String(selectedBuyer.id))) {
      return [{ value: String(selectedBuyer.id), label: selectedBuyer.name }, ...base];
    }
    return base;
  }, [buyers, selectedBuyer]);

  // Price preview for the current cart — refetches whenever the set changes.
  const { data: preview, isFetching: previewFetching } = useQuery({
    queryKey: ['sell-external-preview', assetIds],
    queryFn: () => apiClient.rpc<PreviewResponse>('fn_asset_sell_price_preview', { p_asset_ids: assetIds }),
    enabled: open && assetIds.length > 0,
  });
  const items = preview?.items ?? [];

  // Sellable assets at this branch (for the "add device" picker), minus ones already in the cart.
  const { data: sellable = [] } = useQuery({
    queryKey: ['sell-external-sellable', branchId],
    queryFn: () => apiClient.get<SellExternalAsset[]>(
      `/v_assets?branch_id=eq.${branchId}&current_bucket=eq.ON_HAND_AVAILABLE&order=asset_id.desc&limit=200`
      + '&select=asset_id,asset_code,asset_code_display,product_display_name,variant_name,serial_no,imei,external_ref,condition_grade,branch_id,current_bucket',
    ),
    enabled: open && addPickerOpen && branchId != null,
    staleTime: 60 * 1000,
  });
  const addableOptions = useMemo(
    () => sellable
      .filter(a => !assetIds.includes(a.asset_id))
      .map(a => ({
        value: String(a.asset_id),
        label: `${codeDisplay(a.asset_code_display, a.asset_code)} — ${a.product_display_name ?? a.variant_name}`,
      })),
    [sellable, assetIds],
  );

  // Effective total from the current (possibly-edited) prices.
  const effectivePrice = useCallback((it: PreviewItem): number => {
    const typed = prices[it.asset_id];
    if (typed != null && typed !== '') return Number(typed);
    return it.sell_price;
  }, [prices]);
  const total = useMemo(
    () => items.reduce((sum, it) => sum + effectivePrice(it), 0),
    [items, effectivePrice],
  );

  const isDirty = buyerId != null || note.trim() !== '' || Object.keys(prices).length > 0
    || (assetIds.length !== (seedAsset ? 1 : 0));

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const removeAsset = (id: number) => {
    setAssetIds(prev => prev.filter(a => a !== id));
    setPrices(prev => { const next = { ...prev }; delete next[id]; return next; });
  };
  const addAsset = (id: number) => {
    if (!assetIds.includes(id)) setAssetIds(prev => [...prev, id]);
    setAddPickerOpen(false);
  };

  const sellMutation = useMutation({
    mutationFn: () => {
      // Send p_sell_prices only when at least one price was edited; index-aligned
      // to assetIds, null for untouched (backend uses the suggested price).
      const anyEdited = items.some(it => {
        const typed = prices[it.asset_id];
        return typed != null && typed !== '' && Number(typed) !== it.sell_price;
      });
      const sellPrices = anyEdited
        ? assetIds.map(id => {
            const typed = prices[id];
            return typed != null && typed !== '' ? Number(typed) : null;
          })
        : undefined;
      return apiClient.rpc<SellResponse>('fn_inv_sell_b2b_external', {
        p_asset_ids: assetIds,
        p_buyer_branch_id: Number(buyerId),
        p_sell_prices: sellPrices ?? null,
        p_note: note.trim() || null,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setView('done');
      onSold();
    },
    onError: (err) => setError(translateErr(err, t)),
  });

  const canSubmit = buyerId != null && assetIds.length > 0 && !previewFetching && !sellMutation.isPending;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="42rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done'
              ? t('sellExternal.doneTitle', { defaultValue: 'Sold to partner' })
              : t('sellExternal.title', { defaultValue: 'Sell to partner' })}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              {error && (
                <div className="alert alert-danger mb-4 animate-pop-in">
                  <XCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {/* JOURNAL note — money doesn't hit day-close. */}
              <div className="alert alert-info mb-4">
                <span>{t('sellExternal.journalNote', { defaultValue: 'This is a partner sale — the amount does NOT count toward day-close.' })}</span>
              </div>

              <div className="form-grid gap-4">
                {/* Buyer picker */}
                <div className="flex flex-col">
                  <label className="form-label">{t('sellExternal.buyer', { defaultValue: 'Buyer (partner branch)' })} *</label>
                  <Select
                    options={buyerOptions}
                    value={buyerId}
                    onChange={(v) => {
                      const val = (v as string) || null;
                      setBuyerId(val);
                      setSelectedBuyer(
                        buyers.find(b => String(b.id) === val)
                        ?? (selectedBuyer && String(selectedBuyer.id) === val ? selectedBuyer : null),
                      );
                    }}
                    onSearchChange={handleBuyerSearch}
                    filterOptions={false}
                    loading={buyersFetching}
                    placeholder={t('sellExternal.buyerPlaceholder', { defaultValue: 'Select partner branch' })}
                    startIcon={<Search size={16} />}
                    showChevron
                  />
                </div>

                {/* Device list + price preview */}
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="form-label mb-0">{t('sellExternal.devices', { defaultValue: 'Devices' })} *</label>
                    <Button
                      variant="outline"
                      size="xs"
                      startIcon={<Plus size={14} />}
                      onClick={() => setAddPickerOpen(o => !o)}
                    >
                      {t('sellExternal.addDevice', { defaultValue: 'Add device' })}
                    </Button>
                  </div>

                  {addPickerOpen && (
                    <div className="mb-2">
                      <Select
                        options={addableOptions}
                        value={null}
                        onChange={(v) => { if (v) addAsset(Number(v)); }}
                        placeholder={t('sellExternal.addDevicePlaceholder', { defaultValue: 'Search ON_HAND devices at this branch' })}
                        searchable
                        showChevron
                        startIcon={<Search size={14} />}
                      />
                    </div>
                  )}

                  {items.length === 0 ? (
                    <div className="text-sm text-subtler italic px-1 py-3">
                      {previewFetching
                        ? t('common.loading')
                        : t('sellExternal.noDevices', { defaultValue: 'No devices selected.' })}
                    </div>
                  ) : (
                    <div className="rounded-md border border-line overflow-hidden divide-y divide-line">
                      {items.map(it => {
                        const suggested = it.sell_price;
                        const typed = prices[it.asset_id];
                        const isManual = typed != null && typed !== '' && Number(typed) !== suggested;
                        return (
                          <div key={it.asset_id} className="px-3 py-2.5 flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-sm truncate">{it.asset_code}</span>
                                {isManual && (
                                  <Badge size="xs" color="warning">{t('sellExternal.manualPrice', { defaultValue: 'Custom' })}</Badge>
                                )}
                              </div>
                              <div className="text-xs text-subtle truncate">
                                {it.product_display_name ?? it.variant_name}
                              </div>
                              <div className="text-xs text-subtler mt-0.5 tabular-nums">
                                {t('sellExternal.cost', { defaultValue: 'Cost' })}: {fmtCurrency(it.cost_basis)}
                                {' · '}
                                {t('sellExternal.catalog', { defaultValue: 'Catalog' })}: {fmtCurrency(it.catalog_cost)}
                              </div>
                            </div>
                            <div className="w-32 shrink-0">
                              <CurrencyInput
                                value={typed ?? String(suggested)}
                                onChange={(raw) => setPrices(prev => ({ ...prev, [it.asset_id]: raw }))}
                                endIcon={isManual ? <ChevronsRight size={14} /> : undefined}
                                onEndIconClick={isManual
                                  ? () => setPrices(prev => { const n = { ...prev }; delete n[it.asset_id]; return n; })
                                  : undefined}
                                className="w-full"
                              />
                            </div>
                            {items.length > 1 && (
                              <Tooltip content={t('sellExternal.removeDevice', { defaultValue: 'Remove' })}>
                                <button
                                  type="button"
                                  onClick={() => removeAsset(it.asset_id)}
                                  className="shrink-0 text-subtle hover:text-danger cursor-pointer bg-transparent border-none p-1"
                                  aria-label={t('sellExternal.removeDevice', { defaultValue: 'Remove' })}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Total */}
                {items.length > 0 && (
                  <div className="flex items-center justify-between px-1">
                    <span className="text-sm font-medium">{t('sellExternal.total', { defaultValue: 'Total' })}</span>
                    <span className="text-lg font-semibold tabular-nums">{fmtCurrency(total)}</span>
                  </div>
                )}

                {/* Note */}
                <div className="flex flex-col">
                  <label className="form-label">{t('sellExternal.note', { defaultValue: 'Note (optional)' })}</label>
                  <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={sellMutation.isPending}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                onClick={() => { setError(''); sellMutation.mutate(); }}
                disabled={!canSubmit}
              >
                {sellMutation.isPending ? t('common.loading') : t('sellExternal.submit', { defaultValue: 'Sell to partner' })}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            headline={t('sellExternal.doneTitle', { defaultValue: 'Sold to partner' })}
            contractCode={result.bill_code}
            billId={result.bill_id}
            detailRows={[
              { label: t('sellExternal.buyer', { defaultValue: 'Buyer' }), value: result.buyer_name },
              { label: t('sellExternal.deviceCount', { defaultValue: 'Devices' }), value: result.asset_count },
              { label: t('sellExternal.total', { defaultValue: 'Total' }), value: fmtCurrency(result.total_amount), emphasis: true },
            ]}
            extras={
              <div className="flex flex-col gap-3">
                {!result.counted_in_daily && (
                  <div className="alert alert-info">
                    <span>{t('sellExternal.notInDaily', { defaultValue: 'ไม่เข้ายอดปิดวัน — not counted in day-close' })}</span>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs font-semibold text-subtle uppercase tracking-wider">
                    {t('sellExternal.movements', { defaultValue: 'Device movements' })}
                  </div>
                  {result.asset_movements.map(m => (
                    <div key={m.asset_id} className="flex items-center gap-2 text-xs">
                      <span className="font-mono">{m.asset_code}</span>
                      <Badge size="xs" color={getBucketColor(m.bucket_from)}>{getBucketLabel(m.bucket_from, t)}</Badge>
                      <ArrowRight size={12} className="text-subtle" />
                      <Badge size="xs" color={getBucketColor(m.bucket_to)}>{getBucketLabel(m.bucket_to, t)}</Badge>
                    </div>
                  ))}
                </div>
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    color="danger"
                    onClick={() => setCancelOpen(true)}
                  >
                    {t('sellExternal.cancelSale', { defaultValue: 'Cancel this sale' })}
                  </Button>
                </div>
              </div>
            }
            onClose={onClose}
          />
        )}
      </Modal>

      {/* Cancel-sale modal (PIN) — reverses the bill, devices back to stock. */}
      <CancelSaleModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        billId={result?.bill_id ?? null}
        billCode={result?.bill_code ?? ''}
        onCancelled={() => {
          setCancelOpen(false);
          onSold();
          onClose();
        }}
      />

      {/* Unsaved-changes guard */}
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

// ============================================================================
// Cancel-sale — fn_bill_cancel with branch PIN. Reverses a partner-sale bill;
// devices move SOLD_B2B_EXTERNAL → ON_HAND_AVAILABLE. Same-day only (BE-enforced).
// ============================================================================

interface CancelResponse {
  bill_status: string;
  asset_movements: SellMovement[];
}

function CancelSaleModal({
  open,
  onClose,
  billId,
  billCode,
  onCancelled,
}: {
  open: boolean;
  onClose: () => void;
  billId: number | null;
  billCode: string;
  onCancelled: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setReason(''); setPin(''); setError(''); }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<CancelResponse>('fn_bill_cancel', {
      p_bill_id: billId,
      p_reason: reason.trim(),
      p_pin: pin,
    }),
    onSuccess: () => onCancelled(),
    onError: (err) => setError(translateErr(err, t)),
  });

  const canSubmit = reason.trim() !== '' && pin.length === 6 && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('sellExternal.cancelSale', { defaultValue: 'Cancel this sale' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4 animate-pop-in">
            <XCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
          <div className="font-medium text-sm">{billCode}</div>
          <div className="text-xs text-subtle">{t('sellExternal.cancelHint', { defaultValue: 'Devices return to stock. Same-day only.' })}</div>
        </div>
        <div className="form-grid gap-4">
          <div className="flex flex-col">
            <label className="form-label">{t('sellExternal.cancelReason', { defaultValue: 'Reason' })} *</label>
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full" />
          </div>
          <BranchPinInput value={pin} onChange={setPin} required />
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={() => { setError(''); mutation.mutate(); }} disabled={!canSubmit}>
          {mutation.isPending ? t('common.loading') : t('sellExternal.confirmCancel', { defaultValue: 'Cancel sale' })}
        </Button>
      </div>
    </Modal>
  );
}
