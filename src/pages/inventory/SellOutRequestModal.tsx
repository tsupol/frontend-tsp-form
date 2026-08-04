import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Modal, Button, TextArea, Input } from 'tsp-form';
import { XCircle, ChevronsRight, ExternalLink } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useQuery } from '@tanstack/react-query';
import { CurrencyInput } from '../../components/CurrencyInput';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { codeDisplay } from './inventoryUtils';
import { SellOutConditionPhotos } from './SellOutPhotos';
import { translateApiError } from '../../lib/apiErrors';

// ============================================================================
// Sell-Out (ขายออก) — open a fraud-controlled outright-sale request for one
// contractable asset (ON_HAND_AVAILABLE / QUARANTINED). Usually selling a
// defective device back to a dealer. Spec: UI_SUMMARY/124_ASSET_SELL_OUT_FLOW.md
//
//   BRANCH_MANAGER creates a DRAFT (proposed price + supplier) → attaches
//   condition photos (only while DRAFT) → submits for approval (asset locks
//   into PENDING_SALE_APPROVAL, photos freeze) → COMPANY_ADMIN approves →
//   branch confirms + collects. Price is frozen at approval.
//
// This modal is Screen A. Three views: 'form' (enter details) → 'draft'
// (attach photos + submit) → 'done' (submitted, pending approval). Create no
// longer locks the asset — submit does. Closing on 'draft' keeps the draft;
// it's resumable from the Asset Sales ledger. The "ขายออก" button that opens
// this is a standalone BRANCH_MANAGER-only button — NOT in
// fn_asset_available_actions.
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

interface SubmitResponse {
  request_id: number;
  status: string;
  asset_id: number;
  locked_bucket: string;
  origin_bucket: string;
}

type ViewState = 'form' | 'done';

function translateErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    return (
      translateApiError(err, t) ||
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
  const navigate = useNavigate();

  const [view, setView] = useState<ViewState>('form');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [error, setError] = useState('');
  // Set when create fails with SELL_REQUEST_ALREADY_OPEN — the open request on
  // this asset, so the alert can link straight to it (the error carries no id,
  // so we look it up from the ledger view).
  const [existingRequest, setExistingRequest] = useState<{ id: number; code: string; status: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [result, setResult] = useState<CreateResponse | null>(null);
  // Form values captured at draft-create time, to detect whether a flush-update
  // is actually needed before submit (skip an unnecessary — and possibly
  // unpermitted — update when nothing changed).
  const [savedForm, setSavedForm] = useState<{ price: string; note: string; supplierName: string; supplierRef: string } | null>(null);

  useEffect(() => {
    if (open) {
      setView('form');
      setPrice('');
      setNote('');
      setSupplierName('');
      setSupplierRef('');
      setError('');
      setExistingRequest(null);
      setConfirmClose(false);
      setResult(null);
      setSavedForm(null);
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

  // Fire the list refresh on CLOSE, not on success. Refreshing while a later
  // view is open would refetch the asset list; on submit the asset moves to
  // PENDING_SALE_APPROVAL and drops out of the current filter, so selectedAsset
  // briefly goes null → the host AssetDetailPanel (which owns this modal)
  // unmounts mid-flow → the modal dies and leaves an orphaned backdrop.
  // Deferring keeps the host mounted until the user is done.
  const forceClose = () => {
    setConfirmClose(false);
    if (result) onCreated();
    onClose();
  };
  const handleClose = () => {
    // 'done': submitted, safe. A live draft (result set) stays a DRAFT server-
    // side — resumable from the Asset Sales ledger, so closing is safe. Only
    // guard un-persisted typed input (no draft yet).
    if (view === 'done' || result) { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  // Create the DRAFT. Called lazily — either by the photo album (first Add /
  // Capture) or by Submit when no draft exists yet. Price freezes at create
  // (there's no update-price RPC), so the price field locks once result is set.
  // Returns the created row so callers can chain (Submit creates-then-submits).
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
      // Snapshot the values this draft was created with, so submit can tell if
      // the form was edited afterward and only then flush an update.
      setSavedForm({ price, note, supplierName, supplierRef });
    },
    onError: async (err) => {
      setError(translateErr(err, t));
      // On "already open", find that request so the alert can link to it.
      if (err instanceof ApiError && err.code === 'INV.STATE.SELL_REQUEST_ALREADY_OPEN' && asset) {
        try {
          const rows = await apiClient.get<{ id: number; code_display: string; status: string }[]>(
            `/v_asset_sell_requests?asset_id=eq.${asset.asset_id}&status=in.(DRAFT,PENDING_APPROVAL,APPROVED)&select=id,code_display,status&order=created_at.desc&limit=1`,
          );
          if (rows[0]) setExistingRequest({ id: rows[0].id, code: rows[0].code_display, status: rows[0].status });
        } catch { /* best-effort — the plain message still shows */ }
      }
    },
  });

  // Ensure a draft exists, return its id. Reuses the current result if present.
  const ensureDraft = async (): Promise<number> => {
    if (result) return result.request_id;
    const data = await createMutation.mutateAsync();
    return data.request_id;
  };

  // The form differs from what the existing draft was created with → a flush
  // update is needed before submit. Only true when a draft already exists.
  const formDiffersFromDraft = !!savedForm && (
    savedForm.price !== price ||
    savedForm.note !== note ||
    savedForm.supplierName !== supplierName ||
    savedForm.supplierRef !== supplierRef
  );

  const submitMutation = useMutation({
    mutationFn: async () => {
      // A draft created lazily by the photo step may have had its fields edited
      // afterward — flush those via update before submitting. Skip when nothing
      // changed, so an unchanged (and possibly EDIT-unpermitted) draft still
      // submits.
      if (result && formDiffersFromDraft) {
        await apiClient.rpc('fn_asset_sell_request_update', {
          p_request_id: result.request_id,
          p_proposed_price: Number(price),
          p_note: note.trim(),
          p_supplier_name: supplierName.trim(),
          p_supplier_ref: supplierRef.trim(),
          p_branch_id: asset!.branch_id,
        });
        // Keep result in sync so the done view shows the submitted price, not
        // the stale create-time one.
        setResult((prev) => (prev ? { ...prev, proposed_price: Number(price) } : prev));
      }
      const requestId = await ensureDraft(); // create-then-submit if no draft yet
      return apiClient.rpc<SubmitResponse>('fn_asset_sell_request_submit', {
        p_request_id: requestId,
        p_branch_id: asset!.branch_id,
      });
    },
    onSuccess: () => setView('done'),
    onError: (err) => setError(translateErr(err, t)),
  });

  const cancelDraftMutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_asset_sell_request_cancel', {
      p_request_id: result!.request_id,
      p_note: null,
      p_branch_id: asset!.branch_id,
    }),
    // Draft discarded — nothing to keep. Clear result so forceClose skips the
    // list refresh (asset never left its bucket) and just closes.
    onSuccess: () => { setResult(null); onClose(); },
    onError: (err) => setError(translateErr(err, t)),
  });

  const priceNum = Number(price);
  const hasDraft = result != null;
  const priceValid = price.trim() !== '' && priceNum > 0;
  const busy = createMutation.isPending || submitMutation.isPending || cancelDraftMutation.isPending;
  const canSubmit = asset != null && priceValid && !busy;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="40rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done'
              ? t('sellOut.doneTitle', { defaultValue: 'Submitted for approval' })
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
                  <div className="flex flex-col gap-1 min-w-0">
                    <span>{error}</span>
                    {existingRequest && (
                      <button
                        type="button"
                        onClick={() => { onClose(); navigate(`/admin/inventory/asset-sales/${existingRequest.id}`); }}
                        className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer self-start"
                      >
                        {t('sellOut.openExistingRequest', { defaultValue: 'Open existing request' })} {existingRequest.code}
                        <ExternalLink size={12} />
                      </button>
                    )}
                  </div>
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
                {/* Proposed price — locks once a draft exists (no update-price RPC). */}
                {/* Fields stay editable even after the draft is created — edits
                    are flushed via fn_asset_sell_request_update on Submit (drafts
                    are mutable since BE mig 595). */}
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

                {/* Supplier (dealer) — optional */}
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

                {/* Condition photos — first Add/Capture lazily creates the draft
                    (needs a valid price first), then attaches. The album renders
                    its own "Condition photos" header, so only the placeholder
                    branch carries a label. */}
                <div className="flex flex-col">
                  {!priceValid && !hasDraft ? (
                    <>
                      <label className="form-label">{t('sellOut.photos', { defaultValue: 'Condition photos' })}</label>
                      <div className="text-xs text-subtler border border-dashed border-line rounded-md px-3 py-4 text-center">
                        {t('sellOut.photosNeedPrice', { defaultValue: 'Enter a sell price to add condition photos.' })}
                      </div>
                    </>
                  ) : (
                    <SellOutConditionPhotos
                      requestId={result?.request_id ?? null}
                      code={result?.code ?? asset?.asset_code ?? ''}
                      editable
                      onRequestDraft={() => {
                        // Guard: never fire a second create if one is in flight
                        // or a draft already exists (idempotent).
                        if (createMutation.isPending || result) return;
                        setError('');
                        createMutation.mutate();
                      }}
                      requestDraftPending={createMutation.isPending}
                    />
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              {hasDraft ? (
                <Button
                  variant="ghost"
                  color="danger"
                  onClick={() => { setError(''); cancelDraftMutation.mutate(); }}
                  disabled={busy}
                >
                  {cancelDraftMutation.isPending ? t('common.loading') : t('sellOut.cancelDraft', { defaultValue: 'Discard draft' })}
                </Button>
              ) : (
                <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              )}
              <Button
                color="primary"
                onClick={() => { setError(''); submitMutation.mutate(); }}
                disabled={!canSubmit}
              >
                {submitMutation.isPending ? t('common.loading') : t('sellOut.submitForApproval', { defaultValue: 'Submit for approval' })}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            headline={t('sellOut.doneTitle', { defaultValue: 'Submitted for approval' })}
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
                {/* Photos are frozen at submit — read-only view of the set. */}
                <SellOutConditionPhotos requestId={result.request_id} code={result.code} editable={false} compact />
              </div>
            }
            onClose={forceClose}
          />
        )}
      </Modal>

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
