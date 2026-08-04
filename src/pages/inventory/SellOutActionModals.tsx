import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Modal, Button, Select, TextArea, Input, Badge } from 'tsp-form';
import { XCircle, Plus, Trash2, ArrowRight, ChevronsRight } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { CurrencyInput } from '../../components/CurrencyInput';
import { BranchPinInput } from '../../components/BranchPinInput';
import { BranchPaymentAccountField } from '../../components/BranchPaymentAccountField';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { getBucketLabel, getBucketColor } from './inventoryUtils';
import { translateApiError } from '../../lib/apiErrors';

// ============================================================================
// Sell-out request actions (branch):
//   • Edit    — update a DRAFT's price / note / supplier (fn_..._update).
//   • Cancel  — withdraw DRAFT / PENDING_APPROVAL / APPROVED. Asset → origin.
//   • Commit  — Screen D: confirm the sale + collect payment (CASH/TRANSFER),
//     total must equal the APPROVED price (frozen — no price field), PIN.
//
// Which buttons show is driven by fn_asset_sell_request_available_actions
// (see useSellRequestActions), NOT by status checks — per BE reply
// 2026-07-12. Spec: UI_SUMMARY/124_ASSET_SELL_OUT_FLOW.md §3.
// ============================================================================

// ── Backend-driven action gating ────────────────────────────────────────────
// The evaluator returns one row per action with its own is_available +
// blocking_reason + require_permission, so gating is self-contained: render a
// button when its action_code is available; never infer from status alone.

export type SellRequestActionCode =
  | 'EDIT' | 'SUBMIT' | 'UPLOAD_PHOTO'
  | 'APPROVE' | 'REJECT' | 'COMMIT' | 'CANCEL';

export interface SellRequestAction {
  action_code: SellRequestActionCode;
  rpc_name: string;
  category: string;
  sort_order: number;
  require_pin: boolean;
  require_permission: string | null;
  is_available: boolean;
  blocking_reason: string | null;
}

interface SellRequestActionsData {
  status: string;
  request_id: number;
  actions: SellRequestAction[];
}

export const sellRequestActionsKey = (requestId: number | null) =>
  ['sell-request-actions', requestId] as const;

/**
 * Query the sell-request action evaluator. `can(code)` returns true only when
 * that action is currently available for this user + request. Drive every
 * draft/lifecycle button off this — never off status.
 */
export function useSellRequestActions(requestId: number | null) {
  const query = useQuery({
    queryKey: sellRequestActionsKey(requestId),
    queryFn: () => apiClient.rpc<SellRequestActionsData>('fn_asset_sell_request_available_actions', {
      p_request_id: requestId,
    }),
    enabled: requestId != null,
    staleTime: 15 * 1000,
  });
  const actions = query.data?.actions ?? [];
  const can = (code: SellRequestActionCode) =>
    actions.some((a) => a.action_code === code && a.is_available);
  return { ...query, actions, can };
}

function translateErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    return (
      translateApiError(err, t) ||
      err.message
    );
  }
  return err instanceof Error ? err.message : String(err);
}

// ── Cancel (withdraw) request ───────────────────────────────────────────────

export function SellOutCancelModal({
  open, onClose, requestId, code, branchId, onCancelled,
}: {
  open: boolean;
  onClose: () => void;
  requestId: number;
  code: string;
  branchId: number;
  onCancelled: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setNote(''); setError(''); }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_asset_sell_request_cancel', {
      p_request_id: requestId,
      p_note: note.trim() || null,
      p_branch_id: branchId,
    }),
    onSuccess: () => onCancelled(),
    onError: (err) => setError(translateErr(err, t)),
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('assetSales.cancelRequest', { defaultValue: 'Withdraw request' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4 animate-pop-in"><XCircle size={16} /><span>{error}</span></div>
        )}
        <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
          <div className="font-medium text-sm">{code}</div>
          <div className="text-xs text-subtle">{t('assetSales.cancelHint', { defaultValue: 'The device returns to its original bucket.' })}</div>
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('assetSales.cancelReason', { defaultValue: 'Reason (optional)' })}</label>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full" />
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={() => { setError(''); mutation.mutate(); }} disabled={mutation.isPending}>
          {mutation.isPending ? t('common.loading') : t('assetSales.confirmWithdraw', { defaultValue: 'Withdraw' })}
        </Button>
      </div>
    </Modal>
  );
}

// ── Edit DRAFT — update price / note / supplier ─────────────────────────────
// fn_asset_sell_request_update is a partial update: null = keep, "" = clear
// (note/supplier only), value = set. Price must be > 0. DRAFT only. BE
// recomputes price_snapshot. We send the full current form each time (simplest
// and unambiguous): trimmed strings, "" → clear; price always set.

interface EditDraftInitial {
  proposed_price: number;
  note: string | null;
  supplier_name: string | null;
  supplier_ref: string | null;
}

export function SellOutEditDraftModal({
  open, onClose, requestId, code, branchId, initial, suggestedPrice, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  requestId: number;
  code: string;
  branchId: number;
  initial: EditDraftInitial | null;
  /** Cost/catalog suggested price for the ChevronsRight autofill; null hides it. */
  suggestedPrice: number | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open && initial) {
      setPrice(String(initial.proposed_price ?? ''));
      setNote(initial.note ?? '');
      setSupplierName(initial.supplier_name ?? '');
      setSupplierRef(initial.supplier_ref ?? '');
      setError('');
      setConfirmClose(false);
    }
  }, [open, initial]);

  const save = useMutation({
    mutationFn: () => apiClient.rpc('fn_asset_sell_request_update', {
      p_request_id: requestId,
      p_proposed_price: Number(price),
      // "" clears; the RPC treats "" as NULL-out for these text fields.
      p_note: note.trim(),
      p_supplier_name: supplierName.trim(),
      p_supplier_ref: supplierRef.trim(),
      p_branch_id: branchId,
    }),
    onSuccess: () => onSaved(),
    onError: (err) => setError(translateErr(err, t)),
  });

  const priceNum = Number(price);
  const canSave = price.trim() !== '' && priceNum > 0 && !save.isPending;

  // Dirty guard — confirm before discarding edits (backdrop / X / Cancel).
  const isDirty = !!initial && (
    price !== String(initial.proposed_price ?? '') ||
    note !== (initial.note ?? '') ||
    supplierName !== (initial.supplier_name ?? '') ||
    supplierRef !== (initial.supplier_ref ?? '')
  );
  const handleClose = () => {
    if (save.isPending) return;
    if (isDirty) { setConfirmClose(true); return; }
    onClose();
  };

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('assetSales.editDraft', { defaultValue: 'Edit draft' })}</h2>
        <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4 animate-pop-in"><XCircle size={16} /><span>{error}</span></div>
        )}
        <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
          <div className="font-medium text-sm">{code}</div>
        </div>
        <div className="form-grid gap-4">
          <div className="flex flex-col">
            <label className="form-label">{t('sellOut.proposedPrice', { defaultValue: 'Proposed sell price' })} *</label>
            <CurrencyInput
              value={price}
              onChange={setPrice}
              endIcon={suggestedPrice != null && Number(price) !== suggestedPrice ? <ChevronsRight size={14} /> : undefined}
              onEndIconClick={suggestedPrice != null ? () => setPrice(String(suggestedPrice)) : undefined}
              className="w-full"
            />
          </div>
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
          <div className="flex flex-col">
            <label className="form-label">{t('sellOut.note', { defaultValue: 'Note (reason)' })}</label>
            <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full" />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={handleClose} disabled={save.isPending}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={() => { setError(''); save.mutate(); }} disabled={!canSave}>
          {save.isPending ? t('common.loading') : t('common.save', { defaultValue: 'Save' })}
        </Button>
      </div>
    </Modal>

    {/* Unsaved-changes guard — sibling, not nested, to keep the shared modal
        context in sync. */}
    <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
      <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
      <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={() => { setConfirmClose(false); onClose(); }}>{t('common.discard')}</Button>
      </div>
    </Modal>
    </>
  );
}

// ── Commit (Screen D) — confirm sale + collect payment ──────────────────────

type PayMethod = 'CASH' | 'TRANSFER';
interface PaymentRow {
  method: PayMethod;
  amount: string;             // raw
  bank_account_id: number | null;
}

interface CommitResponse {
  bill_id: number;
  bill_code: string;
  bill_type: string;
  total_amount: number;
  asset_id: number;
  sold_bucket: string;
}

type ViewState = 'form' | 'done';

export function SellOutCommitModal({
  open, onClose, requestId, code, branchId, approvedPrice, onCommitted,
}: {
  open: boolean;
  onClose: () => void;
  requestId: number;
  code: string;
  branchId: number;
  approvedPrice: number;
  onCommitted: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<ViewState>('form');
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<CommitResponse | null>(null);

  useEffect(() => {
    if (open) {
      setView('form');
      // Seed one CASH row for the full approved price.
      setPayments([{ method: 'CASH', amount: String(approvedPrice), bank_account_id: null }]);
      setPin('');
      setError('');
      setResult(null);
    }
  }, [open, approvedPrice]);

  const paidTotal = useMemo(
    () => payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
    [payments],
  );
  const remaining = approvedPrice - paidTotal;
  const balanced = Math.abs(remaining) < 0.005;

  const updatePayment = (idx: number, patch: Partial<PaymentRow>) => {
    setPayments((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };
  const addRow = () => {
    setPayments((prev) => [...prev, { method: 'CASH', amount: remaining > 0 ? String(remaining) : '0', bank_account_id: null }]);
  };
  const removeRow = (idx: number) => {
    setPayments((prev) => prev.filter((_, i) => i !== idx));
  };

  // Every TRANSFER row needs a resolved bank account.
  const transferMissingBank = payments.some((p) => p.method === 'TRANSFER' && p.bank_account_id == null);

  const commitMutation = useMutation({
    mutationFn: () => apiClient.rpc<CommitResponse>('fn_asset_sell_request_commit', {
      p_request_id: requestId,
      p_pin: pin,
      p_payments: payments.map((p) => ({
        method: p.method,
        amount: Number(p.amount),
        ...(p.method === 'TRANSFER' ? { bank_account_id: p.bank_account_id } : {}),
      })),
      p_branch_id: branchId,
    }),
    onSuccess: (data) => {
      setResult(data);
      setView('done');
      onCommitted();
    },
    onError: (err) => setError(translateErr(err, t)),
  });

  const canSubmit = balanced && !transferMissingBank && pin.length === 6 && !commitMutation.isPending;

  const methodOptions = [
    { value: 'CASH', label: t('assetSales.methodCASH', { defaultValue: 'Cash' }) },
    { value: 'TRANSFER', label: t('assetSales.methodTRANSFER', { defaultValue: 'Transfer' }) },
  ];

  return (
    <Modal open={open} onClose={onClose} maxWidth="34rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {view === 'done'
            ? t('assetSales.commitDoneTitle', { defaultValue: 'Sold' })
            : t('assetSales.commitTitle', { defaultValue: 'Confirm sale & collect' })}
        </h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>

      {view === 'form' && (
        <>
          <div className="modal-content">
            {error && (
              <div className="alert alert-danger mb-4 animate-pop-in"><XCircle size={16} /><span>{error}</span></div>
            )}

            {/* Target + frozen price */}
            <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">{code}</div>
                <div className="text-xs text-subtle">{t('assetSales.approvedPriceLocked', { defaultValue: 'Approved price (locked)' })}</div>
              </div>
              <div className="text-lg font-semibold tabular-nums">{fmtCurrency(approvedPrice)}</div>
            </div>

            {/* Payment split */}
            <div className="flex items-center justify-between mb-2">
              <label className="form-label mb-0">{t('assetSales.payment', { defaultValue: 'Payment' })} *</label>
              <Button variant="outline" size="xs" startIcon={<Plus size={14} />} onClick={addRow}>
                {t('assetSales.addPayment', { defaultValue: 'Split' })}
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              {payments.map((p, idx) => (
                <div key={idx} className="flex flex-col gap-2 rounded-md border border-line p-2.5">
                  <div className="flex items-center gap-2">
                    <div style={{ width: '9rem' }} className="shrink-0">
                      <Select
                        options={methodOptions}
                        value={p.method}
                        onChange={(v) => updatePayment(idx, { method: v as PayMethod, bank_account_id: null })}
                        size="sm"
                        searchable={false}
                      />
                    </div>
                    <CurrencyInput
                      value={p.amount}
                      onChange={(raw) => updatePayment(idx, { amount: raw })}
                      className="w-full"
                    />
                    {payments.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        className="shrink-0 text-subtle hover:text-danger cursor-pointer bg-transparent border-none p-1"
                        aria-label={t('common.remove', { defaultValue: 'Remove' })}
                      >
                        <Trash2 size={14} />
                      </button>
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
            </div>

            {/* Balance line */}
            <div className="flex items-center justify-between mt-3 px-1">
              <span className="text-sm text-subtle">{t('assetSales.remaining', { defaultValue: 'Remaining' })}</span>
              <span className={`text-sm font-semibold tabular-nums ${balanced ? 'text-success' : 'text-danger'}`}>
                {fmtCurrency(remaining)}
              </span>
            </div>

            <div className="mt-4">
              <BranchPinInput value={pin} onChange={setPin} required />
            </div>
          </div>
          <div className="modal-footer">
            <Button variant="ghost" onClick={onClose} disabled={commitMutation.isPending}>{t('common.cancel')}</Button>
            <Button color="primary" onClick={() => { setError(''); commitMutation.mutate(); }} disabled={!canSubmit}>
              {commitMutation.isPending ? t('common.loading') : t('assetSales.confirmSale', { defaultValue: 'Confirm sale' })}
            </Button>
          </div>
        </>
      )}

      {view === 'done' && result && (
        <ActionDoneView
          headline={t('assetSales.commitDoneTitle', { defaultValue: 'Sold' })}
          contractCode={result.bill_code}
          billId={result.bill_id}
          detailRows={[
            { label: t('assetSales.total', { defaultValue: 'Total' }), value: fmtCurrency(result.total_amount), emphasis: true },
          ]}
          extras={
            <div className="flex items-center gap-2 text-xs">
              <span className="text-subtle">{t('assetSales.device', { defaultValue: 'Device' })}</span>
              <ArrowRight size={12} className="text-subtle" />
              <Badge size="xs" color={getBucketColor(result.sold_bucket)}>{getBucketLabel(result.sold_bucket, t)}</Badge>
            </div>
          }
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
