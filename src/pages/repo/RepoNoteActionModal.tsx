import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { XCircle, Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { ActionDoneView, type ActionDoneStateTransition } from '../contracts/ActionDoneView';
import { translateApiError } from '../../lib/apiErrors';

/* Reusable note-driven repo action. Covers the actions whose only input is a note:
   REPO_ADD_NOTE, LEGAL_FINISH, LEGAL_RETURN_TO_REPO, REPO_REVERT_ACTIVE.
   Each config decides the RPC, i18n key stem, whether the note is required, and an
   optional state transition badge for the done view. */

export interface NoteActionConfig {
  rpc: string;
  keyStem: string;              // repo.<stem>.title / .noteLabel / .done_headline ...
  noteRequired: boolean;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
  transition?: ActionDoneStateTransition;
  confirmColor?: 'primary' | 'danger' | 'warning';
}

const MIN_NOTE_LEN = 10;

function apiErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    return translateApiError(err, t)
      || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export function RepoNoteActionModal({ open, config, contractId, contractCode, onClose, onSuccess }: {
  open: boolean;
  config: NoteActionConfig | null;
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

  const stem = config?.keyStem ?? '';
  const noteLen = note.trim().length;
  const isDirty = noteLen > 0;
  const noteOk = config ? (!config.noteRequired || noteLen >= MIN_NOTE_LEN) : false;
  const canSubmit = !!config && noteOk && !submitting;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleConfirm = async () => {
    if (!canSubmit || !config || contractId == null) return;
    setSubmitting(true);
    setError('');
    try {
      await apiClient.rpc(config.rpc, {
        p_contract_id: contractId,
        p_note: note.trim() || null,
      });
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
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%" ariaLabel={stem ? t(`repo.${stem}.title`) : undefined}>
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{stem && t(`repo.${stem}.title`)}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>×</button>
          </div>

          {view === 'done' && config ? (
            <ActionDoneView
              headline={t(`repo.${stem}.done_headline`)}
              contractCode={contractCode}
              tone={config.tone ?? 'success'}
              stateTransition={config.transition}
              onClose={forceClose}
            />
          ) : config ? (
            <>
              <div className="modal-content flex flex-col gap-4">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                  <div className="text-xs text-subtle mt-0.5">{t(`repo.${stem}.intro`)}</div>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">
                    {t(`repo.${stem}.noteLabel`)}
                    {!config.noteRequired && <span className="text-subtler font-normal"> ({t('common.optional')})</span>}
                  </label>
                  <TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder={t(`repo.${stem}.notePlaceholder`)}
                  />
                  {config.noteRequired && (
                    <div className="text-[11px] text-subtle mt-1">
                      {t('repo.noteHint', { min: MIN_NOTE_LEN, count: noteLen })}
                    </div>
                  )}
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
                  color={config.confirmColor ?? 'primary'}
                  disabled={!canSubmit}
                  startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : undefined}
                  onClick={handleConfirm}
                >
                  {submitting ? t('common.loading') : t(`repo.${stem}.confirm`)}
                </Button>
              </div>
            </>
          ) : null}
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
