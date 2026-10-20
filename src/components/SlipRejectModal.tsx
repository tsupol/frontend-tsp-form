// Reject a pending slip (fn_payment_submission_review, REJECT). The reason only
// goes with the reject, so it is asked for here rather than in the panel footer.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { apiClient } from '../lib/api';
import { translateApiError } from '../lib/apiErrors';
import { useAuth } from '../contexts/AuthContext';
import { ActionDoneView } from '../pages/contracts/ActionDoneView';
import { ModalErrorBand } from './ModalErrorBand';
import { SlipActionSummary, ContractLink } from './SlipActionSummary';
import type { SubmissionRow } from './SubmissionReviewPanel';

export function SlipRejectModal({ open, row: rowProp, onClose, onFinished }: {
  open: boolean;
  row: SubmissionRow | null;
  onClose: () => void;
  /** Runs when the done view is closed — the host refreshes and empties its panel. */
  onFinished: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Keep the last row through the close transition (the host clears it on finish).
  const lastRow = useRef<SubmissionRow | null>(rowProp);
  if (rowProp) lastRow.current = rowProp;
  const row = rowProp ?? lastRow.current;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) { setView('form'); setReason(''); setError(null); setBusy(false); }
    // Reset on open only: once the action succeeds the slip leaves the host's
    // list and its row turns null — resetting then would hide the done view.
  }, [open]);

  const dirty = view === 'form' && reason.trim() !== '';
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
    if (!row || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.rpc('fn_payment_submission_review', {
        p_submission_id: row.id,
        p_action: 'REJECT',
        p_channel: null,
        p_branch_id: row.branch_id,
        p_bank_account_id: null,
        p_reject_reason: reason.trim(),
        p_reviewed_by: user?.user_id ?? null,
      });
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const slipCode = row?.code_display ?? (row ? `#${row.id}` : '');

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%" ariaLabel={t('paymentSubmissions.reject')}>
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('paymentSubmissions.reject')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>
          {view === 'done' ? (
            <ActionDoneView
              headline={t('paymentSubmissions.rejectSuccess')}
              contractCode={slipCode}
              tone="neutral"
              stateTransition={{
                from: t('paymentSubmissions.status_PENDING_REVIEW'),
                to: t('paymentSubmissions.status_REJECTED'),
                fromColor: 'warning',
                toColor: 'danger',
              }}
              detailRows={[
                { label: t('paymentSubmissions.contract'), value: row ? <ContractLink row={row} onNavigate={forceClose} /> : '—' },
                { label: t('paymentSubmissions.rejectReason'), value: reason.trim() },
              ]}
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content min-w-0">
                <div className="form-grid gap-3">
                  {row && <SlipActionSummary row={row} />}
                  <div className="flex flex-col">
                    <label className="form-label">{t('paymentSubmissions.rejectReason')} <span className="text-danger">*</span></label>
                    <TextArea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                      disabled={busy}
                      placeholder={t('paymentSubmissions.rejectReasonExample')}
                    />
                  </div>
                </div>
              </div>
              <ModalErrorBand message={error} onDismiss={() => setError(null)} />
              <div className="modal-footer">
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
                <Button color="danger" size="sm" onClick={() => void submit()} disabled={busy || !reason.trim()}>
                  {busy ? t('common.loading') : t('paymentSubmissions.reject')}
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
