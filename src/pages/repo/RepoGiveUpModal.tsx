import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { XCircle, Loader2, Scale, ArrowRight } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { translateApiError } from '../../lib/apiErrors';

/* ยอมแพ้ → ส่งต่อทีมกฎหมาย (ops_repo_give_up). WAIT_FOR_REPO → WAIT_FOR_LEGAL.
   p_note is MANDATORY (OPS.VALIDATION.NOTE_REQUIRED) — free text, no dropdown,
   because "why we gave up" is hard to enumerate and the legal team reads it. */

const MIN_NOTE_LEN = 10;

function apiErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    return translateApiError(err, t)
      || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export function RepoGiveUpModal({ open, contractId, contractCode, onClose, onSuccess }: {
  open: boolean;
  contractId: number | null;
  contractCode: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) {
      setView('form');
      setNote('');
      setError('');
      setSubmitting(false);
      setConfirmClose(false);
    }
  }, [open]);

  const noteLen = note.trim().length;
  const isDirty = noteLen > 0;
  const canSubmit = noteLen >= MIN_NOTE_LEN && !submitting;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleConfirm = async () => {
    if (!canSubmit || contractId == null) return;
    setSubmitting(true);
    setError('');
    try {
      await apiClient.rpc('ops_repo_give_up', { p_contract_id: contractId, p_note: note.trim() });
      setView('done');
      onSuccess();
    } catch (err) {
      setError(apiErr(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%" ariaLabel={t('repo.giveUp.title')}>
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('repo.giveUp.title')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>×</button>
          </div>

          {view === 'done' ? (
            <ActionDoneView
              headline={t('repo.giveUp.done_headline')}
              contractCode={contractCode}
              tone="warning"
              stateTransition={{ from: t('repo.status.WAIT_FOR_REPO'), to: t('repo.status.WAIT_FOR_LEGAL'), toColor: 'warning' }}
              extras={
                <div className="alert alert-info">
                  <Scale size={16} />
                  <span>{t('repo.giveUp.done_note')}</span>
                </div>
              }
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content flex flex-col gap-4">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                  <div className="text-xs text-subtle mt-0.5 flex items-center gap-1.5">
                    {t('repo.status.WAIT_FOR_REPO')}
                    <ArrowRight size={12} />
                    {t('repo.status.WAIT_FOR_LEGAL')}
                  </div>
                </div>

                <div className="alert alert-warning">
                  <Scale size={16} />
                  <div className="alert-description">{t('repo.giveUp.intro')}</div>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('repo.giveUp.noteLabel')}</label>
                  <TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder={t('repo.giveUp.notePlaceholder')}
                  />
                  <div className="text-[11px] text-subtle mt-1">
                    {t('repo.giveUp.noteHint', { min: MIN_NOTE_LEN, count: noteLen })}
                  </div>
                </div>

                {error && (
                  <div className="alert alert-danger">
                    <XCircle size={16} />
                    <div className="alert-description">{error}</div>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                <Button
                  color="warning"
                  disabled={!canSubmit}
                  startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <Scale size={16} />}
                  onClick={handleConfirm}
                >
                  {submitting ? t('common.loading') : t('repo.giveUp.confirm')}
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
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
