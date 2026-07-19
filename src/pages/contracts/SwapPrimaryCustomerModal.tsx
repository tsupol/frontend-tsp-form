// Change of lessee (เปลี่ยนตัวผู้เช่าหลัก) — opens the PRIMARY_SWAP signing document.
//
// Flow (UI_FEEDBACK/2026-07-19_CHANGE_OF_LESSEE_IMPLEMENTATION_GUIDE.md):
//   1. Pick the transferee (incoming lessee) — reuses CustomerPickerModal for
//      search / register / ID-card OCR. onPick here only STASHES the choice; it
//      does not fire a terminal RPC.
//   2. Run fn_contract_swap_readiness on the transferee. The transferee must be
//      as complete as a brand-new lessee (ID card + address + references) because
//      the sealed document embeds the full hire-purchase contract on page 3+.
//      Blockers list each missing item with a "Fix in profile" link — the exact
//      error codes reuse the wizard's existing i18n.
//   3. PIN + optional reason/note → fn_contract_swap_primary_customer.
//   4. Success shows ActionDoneView. ⚠️ The lessee has NOT changed yet — it swaps
//      only when every party signs and the document seals. The done view says so
//      and offers a jump to the Signing tab (where the QR + signatures live).
//
// The signing itself (QR, witnesses, per-party sign, void) is owned by SigningTab,
// which already renders a PRIMARY_SWAP signing once it exists.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input } from 'tsp-form';
import { CheckCircle, XCircle, Loader2, ArrowRight, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { BranchPinInput } from '../../components/BranchPinInput';
import { CustomerPickerModal } from './CustomerPickerModal';
import { ActionDoneView } from './ActionDoneView';

interface ReadinessError {
  code: string;
  field?: string;
  severity?: string;
  fix_rpc?: string;
  ui_step?: string;
  detail?: { customer_id?: number } | null;
}

interface ReadinessResult {
  ready: boolean;
  errors: ReadinessError[];
  contract_id: number;
  customer_id: number;
}

interface SwapResult {
  contract_id: number;
  signing_id: number;
  from_customer_id: number;
  to_customer_id: number;
  applied: boolean;
  applies_on: string;
}

type Transferee = { id: number; name: string };

export function SwapPrimaryCustomerModal({
  open,
  onClose,
  contractId,
  contractCode,
  currentCustomerId,
  currentCustomerName,
  onGoToSigning,
}: {
  open: boolean;
  onClose: () => void;
  contractId: number;
  contractCode: string;
  currentCustomerId: number | null;
  currentCustomerName: string | null;
  /** Jump the detail panel to the Signing tab (where the QR + signatures live). */
  onGoToSigning?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [transferee, setTransferee] = useState<Transferee | null>(null);
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [checkingReadiness, setCheckingReadiness] = useState(false);

  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<SwapResult | null>(null);

  // Reset everything when the modal (re)opens.
  useEffect(() => {
    if (!open) return;
    setPickerOpen(false);
    setTransferee(null);
    setReadiness(null);
    setCheckingReadiness(false);
    setReason('');
    setNote('');
    setPin('');
    setSubmitting(false);
    setError('');
    setView('form');
    setResult(null);
  }, [open]);

  // Run the readiness check whenever a transferee is chosen.
  const runReadiness = async (cust: Transferee) => {
    setCheckingReadiness(true);
    setReadiness(null);
    setError('');
    try {
      const rd = await apiClient.rpc<ReadinessResult>('fn_contract_swap_readiness', {
        p_contract_id: contractId,
        p_customer_id: cust.id,
      });
      setReadiness(rd);
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : (err instanceof Error ? err.message : String(err)));
    } finally {
      setCheckingReadiness(false);
    }
  };

  const handleTransfereePicked = async (customerId: number, fullName: string) => {
    const cust = { id: customerId, name: fullName };
    setTransferee(cust);
    setPickerOpen(false);
    await runReadiness(cust);
  };

  const canSubmit =
    !!transferee &&
    readiness?.ready === true &&
    pin.length === 6 &&
    !submitting;

  const handleSubmit = async () => {
    if (!transferee) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiClient.rpc<SwapResult>('fn_contract_swap_primary_customer', {
        p_contract_id: contractId,
        p_customer_id: transferee.id,
        p_reason: reason.trim() || null,
        p_note: note.trim() || null,
        p_pin: pin || null,
      });
      setResult(res);
      setView('done');
      // A new COLLECTING PRIMARY_SWAP signing now exists — refresh the signing
      // tab + contract so the document shows up immediately.
      queryClient.invalidateQueries({ queryKey: ['contract-signings', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-signing-parties', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-actions', contractId] });
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : (err instanceof Error ? err.message : String(err)));
      setSubmitting(false);
    }
  };

  // The form is dirty once a transferee is picked or any field is touched.
  const isDirty = !!transferee || reason.trim() !== '' || note.trim() !== '' || pin !== '';
  const handleClose = () => {
    if (view === 'done') { onClose(); return; }
    if (isDirty && !window.confirm(t('common.unsavedChangesMessage', { defaultValue: 'Discard unsaved changes?' }))) return;
    onClose();
  };

  return (
    <>
      <Modal open={open && !pickerOpen} onClose={handleClose} maxWidth="34rem" width="100%">
        <div className="flex flex-col overflow-hidden">
          <div className="modal-header">
            <h2 className="modal-title">{t('contract.swapPrimaryTitle', { defaultValue: 'Change of lessee' })}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              tone="warning"
              headline={t('contract.swapDoneHeadline', { defaultValue: 'Document opened — awaiting signatures' })}
              contractCode={contractCode}
              extras={
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-center gap-2 flex-wrap text-sm">
                    <span className="font-medium">{currentCustomerName ?? '—'}</span>
                    <ArrowRight size={14} className="text-subtle" />
                    <span className="font-medium">{transferee?.name ?? '—'}</span>
                  </div>
                  <div className="alert alert-warning">
                    <XCircle size={16} />
                    <div className="alert-description text-sm">{t('contract.swapDoneSubtitle')}</div>
                  </div>
                  <div className="text-xs text-subtle text-center">{t('contract.swapDoneNextStep')}</div>
                </div>
              }
              secondaryAction={onGoToSigning ? {
                label: t('contract.swapGoToSigning', { defaultValue: 'Go to Signing tab' }),
                // Close first, then switch tabs on the next tick — switching the tab
                // synchronously re-renders the parent and interrupts the modal's exit
                // transition, stranding the backdrop.
                onClick: () => { onClose(); setTimeout(() => onGoToSigning(), 0); },
              } : undefined}
              onClose={onClose}
            />
          ) : (
            <>
              <div className="modal-content">
                {error && (
                  <div className="alert alert-danger mb-3">
                    <XCircle size={16} />
                    <span>{error}</span>
                  </div>
                )}

                <p className="text-sm text-subtle mb-4">{t('contract.swapPrimaryHint')}</p>

                {/* Current lessee (transferor) */}
                <div className="mb-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-subtle mb-1.5">
                    {t('contract.swapCurrentLessee', { defaultValue: 'Current lessee' })}
                  </div>
                  <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                    <div className="font-medium text-sm">{currentCustomerName ?? '—'}</div>
                  </div>
                </div>

                {/* New lessee (transferee) */}
                <div className="mb-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-subtle mb-1.5">
                    {t('contract.swapNewLessee', { defaultValue: 'New lessee' })}
                  </div>
                  {transferee ? (
                    <div className="px-3 py-2.5 rounded-md border border-line flex items-center justify-between gap-2">
                      <div className="font-medium text-sm">{transferee.name}</div>
                      <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
                        {t('common.change', { defaultValue: 'Change' })}
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" className="w-full" onClick={() => setPickerOpen(true)}>
                      {t('contract.swapPickTransferee', { defaultValue: 'Select the new lessee' })}
                    </Button>
                  )}
                </div>

                {/* Readiness result */}
                {checkingReadiness && (
                  <div className="flex items-center gap-2 text-sm text-subtle mb-4">
                    <Loader2 size={14} className="animate-spin" />
                    {t('contract.swapReadinessChecking', { defaultValue: 'Checking the transferee’s profile…' })}
                  </div>
                )}

                {readiness && !readiness.ready && (
                  <div className="mb-4">
                    <div className="alert alert-warning mb-2">
                      <XCircle size={16} />
                      <div className="alert-description text-sm">{t('contract.swapReadinessBlocked')}</div>
                    </div>
                    <div className="rounded-md border border-line overflow-hidden">
                      {readiness.errors.map((e, i) => (
                        <div key={`${e.code}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-line last:border-b-0">
                          <span className="text-sm">
                            {t(e.code, { ns: 'apiErrors', defaultValue: e.code })}
                          </span>
                          {transferee && (
                            <Link
                              to={`/admin/customers/${transferee.id}`}
                              className="shrink-0 text-xs text-primary-fg hover:underline inline-flex items-center gap-1"
                            >
                              <Wrench size={12} />
                              {t('contract.swapFixInProfile', { defaultValue: 'Fix in profile' })}
                            </Link>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {readiness?.ready && (
                  <div className="flex items-center gap-2 text-sm text-success mb-4">
                    <CheckCircle size={16} />
                    {t('contract.swapReadinessOk', { defaultValue: 'Transferee’s profile is complete' })}
                  </div>
                )}

                {/* Reason / note / PIN — only meaningful once a ready transferee is picked */}
                {readiness?.ready && (
                  <div className="form-grid gap-3">
                    <div className="flex flex-col">
                      <label className="form-label">{t('contract.swapReason', { defaultValue: 'Reason (printed on the document)' })}</label>
                      <Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" />
                    </div>
                    <div className="flex flex-col">
                      <label className="form-label">{t('contract.swapNote', { defaultValue: 'Internal note (optional)' })}</label>
                      <Input value={note} onChange={(e) => setNote(e.target.value)} className="w-full" />
                    </div>
                    <BranchPinInput value={pin} onChange={setPin} required />
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <Button onClick={handleClose}>{t('common.cancel')}</Button>
                <Button
                  color="primary"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : undefined}
                >
                  {submitting ? t('common.saving') : t('contract.swapOpenDocument', { defaultValue: 'Open document for signing' })}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Transferee picker — reuses the full search / register / ID-card flow.
          onPick stashes the choice (does not fire a terminal RPC). */}
      <CustomerPickerModal
        open={pickerOpen}
        title={t('contract.swapPickTransferee', { defaultValue: 'Select the new lessee' })}
        excludeCustomerIds={currentCustomerId != null ? [currentCustomerId] : []}
        onClose={() => setPickerOpen(false)}
        onPick={handleTransfereePicked}
      />
    </>
  );
}
