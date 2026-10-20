// Reopen a rejected slip for re-review (fn_payment_submission_reopen). The note
// only goes with the reopen, so it lives here rather than in the panel footer.
// The button that opens this shows only when the backend lists REOPEN
// (DELIVERY 2026-10-20, mig 1470).
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Modal, Button, TextArea } from 'tsp-form';
import { apiClient } from '../lib/api';
import { translateApiError } from '../lib/apiErrors';
import { ActionDoneView } from '../pages/contracts/ActionDoneView';
import { ModalErrorBand } from './ModalErrorBand';
import { SlipActionSummary, ContractLink } from './SlipActionSummary';
import type { SubmissionRow } from './SubmissionReviewPanel';

export function SlipReopenModal({ open, row: rowProp, onClose, onFinished }: {
  open: boolean;
  row: SubmissionRow | null;
  onClose: () => void;
  /** Runs when the done view is closed — the host refreshes and empties its panel. */
  onFinished: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Keep the last row through the close transition (the host clears it on finish).
  const lastRow = useRef<SubmissionRow | null>(rowProp);
  if (rowProp) lastRow.current = rowProp;
  const row = rowProp ?? lastRow.current;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) { setView('form'); setNote(''); setError(null); setBusy(false); }
    // Reset on open only: once the action succeeds the slip leaves the host's
    // list and its row turns null — resetting then would hide the done view.
  }, [open]);

  const dirty = view === 'form' && note.trim() !== '';
  const forceClose = () => {
    setConfirmClose(false);
    const finished = view === 'done';
    onClose();
    if (finished) onFinished();
  };
  const handleClose = () => {
    if (busy) return;
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.rpc('fn_payment_submission_reopen', {
        p_submission_id: row.id,
        p_note: note.trim() || null,
      });
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const slipCode = row?.code_display ?? (row ? `#${row.id}` : '');
  // After a reopen the slip sits in the Pending tab — the usual next step is to review it.
  const reviewPath = row ? `/admin/payment-submissions/${row.id}` : '';
  const reviewNow = () => {
    onClose();
    onFinished();
    navigate(reviewPath);
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%" ariaLabel={t('paymentSubmissions.reopen')}>
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('paymentSubmissions.reopen')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>
          {view === 'done' ? (
            <ActionDoneView
              headline={t('paymentSubmissions.reopenSuccess')}
              contractCode={slipCode}
              stateTransition={{
                from: t('paymentSubmissions.status_REJECTED'),
                to: t('paymentSubmissions.status_PENDING_REVIEW'),
                fromColor: 'danger',
                toColor: 'warning',
              }}
              detailRows={[
                { label: t('paymentSubmissions.contract'), value: row ? <ContractLink row={row} onNavigate={forceClose} /> : '—' },
                ...(note.trim() ? [{ label: t('paymentSubmissions.reopenNoteDone'), value: note.trim() }] : []),
              ]}
              secondaryAction={row ? {
                label: t('paymentSubmissions.reviewNow'),
                to: reviewPath,
                onClick: reviewNow,
                isNextStep: true,
              } : undefined}
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content min-w-0">
                <div className="form-grid gap-3">
                  {row && <SlipActionSummary row={row} showRejection />}
                  <div className="text-sm text-subtle">{t('paymentSubmissions.reopenExplain')}</div>
                  <div className="flex flex-col">
                    <label className="form-label">{t('paymentSubmissions.reopenNoteLabel')}</label>
                    <TextArea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      disabled={busy}
                      placeholder={t('paymentSubmissions.reopenNotePlaceholder')}
                    />
                  </div>
                </div>
              </div>
              <ModalErrorBand message={error} onDismiss={() => setError(null)} />
              <div className="modal-footer">
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
                <Button color="primary" size="sm" onClick={() => void submit()} disabled={busy}>
                  {busy ? t('common.loading') : t('paymentSubmissions.reopen')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" size="sm" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" size="sm" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
