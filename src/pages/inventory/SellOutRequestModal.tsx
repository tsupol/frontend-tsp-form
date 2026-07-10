import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, TextArea, Input } from 'tsp-form';
import { XCircle, ChevronsRight } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useQuery } from '@tanstack/react-query';
import { CurrencyInput } from '../../components/CurrencyInput';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { codeDisplay } from './inventoryUtils';
import { SellOutPhotoGrid, SellOutAddPhotoModal, SellOutCaptureQrModal, sellOutPhotosKey } from './SellOutPhotos';

// ============================================================================
// Sell-Out (ขายออก) — open a fraud-controlled outright-sale request for one
// contractable asset (ON_HAND_AVAILABLE / QUARANTINED). Usually selling a
// defective device back to a dealer. Spec: UI_SUMMARY/124_ASSET_SELL_OUT_FLOW.md
//
//   BRANCH_MANAGER opens the request (proposed price + supplier + photos) →
//   asset locks into PENDING_SALE_APPROVAL → COMPANY_ADMIN approves the price →
//   branch confirms + collects (Screen D). Price is frozen at approval.
//
// This modal is Screen A: create the request, then attach condition photos
// (only possible while PENDING_APPROVAL, so photos come AFTER create). The
// "ขายออก" button that opens this is a standalone BRANCH_MANAGER-only button —
// it is NOT in fn_asset_available_actions.
// ============================================================================

// Minimal asset shape the modal needs.
export interface SellOutAsset {
  asset_id: number;
  asset_code: string;
  asset_code_display: string | null;
  product_display_name: string | null;
  variant_name: string;
  serial_no: string | null;
  external_ref: string | null;
  condition_grade: string;
  branch_id: number;
  current_bucket: string;
}

interface PreviewItem {
  asset_id: number;
  sell_price: number;
  cost_basis: number | null;
  catalog_cost: number | null;
  resolve_method: string;
}
interface PreviewResponse {
  items: PreviewItem[];
  total: number;
  count: number;
}

interface CreateResponse {
  request_id: number;
  code: string;
  status: string;
  asset_id: number;
  origin_bucket: string;
  proposed_price: number;
  price_snapshot: Record<string, unknown>;
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
  return err instanceof Error ? err.message : String(err);
}

export function SellOutRequestModal({
  open,
  onClose,
  asset,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Asset the request is opened for. */
  asset: SellOutAsset | null;
  /** Called after a successful create (refresh the asset list). */
  onCreated: () => void;
}) {
  const { t } = useTranslation();

  const [view, setView] = useState<ViewState>('form');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [result, setResult] = useState<CreateResponse | null>(null);
  // Photo sub-modals are hoisted to the top level (siblings of the parent Modal,
  // NOT nested inside its content via extras). Nesting a <Modal> inside another
  // Modal's subtree desyncs tsp-form's shared modal-open context and the parent
  // renders as a bare backdrop. Mirrors SellExternalModal's CancelSaleModal.
  const [addPhotoOpen, setAddPhotoOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setView('form');
      setPrice('');
      setNote('');
      setSupplierName('');
      setSupplierRef('');
      setError('');
      setConfirmClose(false);
      setResult(null);
      setAddPhotoOpen(false);
      setQrOpen(false);
    }
  }, [open, asset]);

  // Reference cost/catalog for this asset — fills the suggested price.
  const { data: preview } = useQuery({
    queryKey: ['sell-out-preview', asset?.asset_id],
    queryFn: () => apiClient.rpc<PreviewResponse>('fn_asset_sell_price_preview', {
      p_asset_ids: [asset!.asset_id],
    }),
    enabled: open && asset != null,
  });
  const item = preview?.items?.[0] ?? null;
  const suggested = item?.sell_price ?? null;

  const isDirty = price.trim() !== '' || note.trim() !== '' || supplierName.trim() !== '' || supplierRef.trim() !== '';

  // Fire the list refresh on CLOSE, not on success. Refreshing while the success
  // view is open would refetch the asset list; the asset just moved to
  // PENDING_SALE_APPROVAL and drops out of the current filter, so selectedAsset
  // briefly goes null → the host AssetDetailPanel (which owns this modal)
  // unmounts mid-success → the modal dies and leaves an orphaned backdrop.
  // Deferring keeps the host mounted until the user is done.
  const forceClose = () => {
    setConfirmClose(false);
    if (result) onCreated();
    onClose();
  };
  const handleClose = () => {
    // Once the request is created (done view), it exists server-side; closing is
    // safe (photos are optional and attach independently). Only guard the
    // pre-create form.
    if (view !== 'form') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const createMutation = useMutation({
    mutationFn: () => apiClient.rpc<CreateResponse>('fn_asset_sell_request_create', {
      p_asset_id: asset!.asset_id,
      p_proposed_price: Number(price),
      p_note: note.trim() || null,
      p_supplier_name: supplierName.trim() || null,
      p_supplier_ref: supplierRef.trim() || null,
      p_branch_id: asset!.branch_id,
    }),
    onSuccess: (data) => {
      setResult(data);
      setView('done');
      // NB: do NOT refresh the asset list here — see forceClose. The refresh
      // fires on close so the host panel stays mounted through the success view.
    },
    onError: (err) => setError(translateErr(err, t)),
  });

  const priceNum = Number(price);
  const canSubmit = asset != null && price.trim() !== '' && priceNum > 0 && !createMutation.isPending;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="40rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done'
              ? t('sellOut.doneTitle', { defaultValue: 'Sell-out request opened' })
              : t('sellOut.title', { defaultValue: 'Sell out (ขายออก)' })}
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

              {/* Target asset box */}
              {asset && (
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
                  <div className="font-medium text-sm">{codeDisplay(asset.asset_code_display, asset.asset_code)}</div>
                  <div className="text-xs text-subtle">{asset.product_display_name ?? asset.variant_name}</div>
                  {(item?.cost_basis != null || item?.catalog_cost != null) && (
                    <div className="text-xs text-subtler mt-0.5 tabular-nums">
                      {t('sellOut.cost', { defaultValue: 'Cost' })}: {fmtCurrency(item?.cost_basis)}
                      {' · '}
                      {t('sellOut.catalog', { defaultValue: 'Catalog' })}: {fmtCurrency(item?.catalog_cost)}
                    </div>
                  )}
                </div>
              )}

              <div className="form-grid gap-4">
                {/* Proposed price */}
                <div className="flex flex-col">
                  <label className="form-label">{t('sellOut.proposedPrice', { defaultValue: 'Proposed sell price' })} *</label>
                  <CurrencyInput
                    value={price}
                    onChange={setPrice}
                    endIcon={suggested != null && Number(price) !== suggested ? <ChevronsRight size={14} /> : undefined}
                    onEndIconClick={suggested != null ? () => setPrice(String(suggested)) : undefined}
                    className="w-full"
                  />
                </div>

                {/* Supplier (dealer) */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <label className="form-label">{t('sellOut.supplierName', { defaultValue: 'Dealer / buyer name' })}</label>
                    <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="w-full" />
                  </div>
                  <div className="flex flex-col">
                    <label className="form-label">{t('sellOut.supplierRef', { defaultValue: 'Reference no.' })}</label>
                    <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} className="w-full" />
                  </div>
                </div>

                {/* Note */}
                <div className="flex flex-col">
                  <label className="form-label">{t('sellOut.note', { defaultValue: 'Note (reason)' })}</label>
                  <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={createMutation.isPending}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                onClick={() => { setError(''); createMutation.mutate(); }}
                disabled={!canSubmit}
              >
                {createMutation.isPending ? t('common.loading') : t('sellOut.submit', { defaultValue: 'Open request' })}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            headline={t('sellOut.doneTitle', { defaultValue: 'Sell-out request opened' })}
            contractCode={result.code}
            detailRows={[
              { label: t('sellOut.proposedPrice', { defaultValue: 'Proposed price' }), value: fmtCurrency(result.proposed_price), emphasis: true },
              { label: t('sellOut.status', { defaultValue: 'Status' }), value: t('sellOut.status_PENDING_APPROVAL', { defaultValue: 'Waiting for approval' }) },
            ]}
            extras={
              <div className="flex flex-col gap-4">
                <div className="alert alert-info">
                  <span>{t('sellOut.pendingHint', { defaultValue: 'The device is locked until a company admin approves the price.' })}</span>
                </div>
                {/* Optional condition photos — added after the request exists,
                    while it's still PENDING_APPROVAL. Not a gate: the success is
                    already shown above; this is a follow-on. The add/QR modals
                    live OUTSIDE this Modal (below) — extras only holds the grid. */}
                <SellOutPhotoGrid
                  requestId={result.request_id}
                  onAddPhoto={() => setAddPhotoOpen(true)}
                  onCaptureFromPhone={() => setQrOpen(true)}
                />
              </div>
            }
            onClose={forceClose}
          />
        )}
      </Modal>

      {/* Photo sub-modals — siblings of the parent Modal, not nested in extras. */}
      {result && (
        <>
          <SellOutAddPhotoModal
            open={addPhotoOpen}
            onClose={() => setAddPhotoOpen(false)}
            requestId={result.request_id}
            onAdded={() => {
              setAddPhotoOpen(false);
              queryClient.invalidateQueries({ queryKey: sellOutPhotosKey(result.request_id) });
            }}
          />
          <SellOutCaptureQrModal
            open={qrOpen}
            onClose={() => setQrOpen(false)}
            requestId={result.request_id}
            code={result.code}
            onUploaded={() => queryClient.invalidateQueries({ queryKey: sellOutPhotosKey(result.request_id) })}
          />
        </>
      )}

      {/* Unsaved-changes guard (pre-create only) */}
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
