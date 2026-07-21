import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea, RadioGroup } from 'tsp-form';
import { XCircle, Loader2, MapPin, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { REPO_RESULT_CODES, type RepoResultCode } from './repoApi';

/* บันทึกผลลงพื้นที่ (ops_repo_log_attempt) — the heart of the field flow.
   4 result codes only. SUCCESS = ยึดได้ → REPO_COMPLETED (terminal): a confirm
   step guards it. p_lat/p_lng captured from the device (sets geo_precision=EXACT,
   so everyone thereafter sees the real pin instead of the tambon centroid).
   p_client_action_id (UUID per press) dedupes double-taps on flaky field signal. */

function apiErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    return (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '')
      || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// A UUID per modal-open, sent as p_client_action_id so a retry after a dropped
// connection can't create a second attempt. crypto.randomUUID is available in
// all target browsers (HTTPS context).
function newClientActionId(): string {
  return crypto.randomUUID();
}

export function RepoLogAttemptModal({ open, contractId, contractCode, onClose, onSuccess }: {
  open: boolean;
  contractId: number | null;
  contractCode: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'confirm' | 'done'>('form');
  const [result, setResult] = useState<RepoResultCode | ''>('');
  const [note, setNote] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState('');
  const [clientActionId, setClientActionId] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) {
      setView('form');
      setResult('');
      setNote('');
      setCoords(null);
      setLocBusy(false);
      setLocError('');
      setClientActionId(newClientActionId());
      setError('');
      setSubmitting(false);
      setConfirmClose(false);
    }
  }, [open]);

  const isDirty = result !== '' || note.trim().length > 0 || coords != null;
  const canSubmit = result !== '' && !submitting;
  const isTerminal = result === 'SUCCESS';

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const captureLocation = () => {
    if (!navigator.geolocation) { setLocError(t('repo.log.geoUnsupported')); return; }
    setLocBusy(true);
    setLocError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocBusy(false); },
      () => { setLocError(t('repo.log.geoDenied')); setLocBusy(false); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = async () => {
    if (contractId == null || result === '') return;
    setSubmitting(true);
    setError('');
    try {
      await apiClient.rpc('ops_repo_log_attempt', {
        p_contract_id: contractId,
        p_result_code: result,
        p_note: note.trim() || null,
        p_lat: coords?.lat ?? null,
        p_lng: coords?.lng ?? null,
        p_photo_media_ids: null,
        p_client_action_id: clientActionId,
      });
      setView('done');
      onSuccess();
    } catch (err) {
      setError(apiErr(err, t));
      setView('form'); // back to the form so the user sees the error with the inputs
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrimary = () => {
    if (isTerminal && view === 'form') { setView('confirm'); return; }
    submit();
  };

  const resultOptions = REPO_RESULT_CODES.map((code) => ({
    value: code,
    label: t(`repo.result.${code}`),
  }));

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%" ariaLabel={t('repo.log.title')}>
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('repo.log.title')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>×</button>
          </div>

          {view === 'done' ? (
            <ActionDoneView
              headline={isTerminal ? t('repo.log.done_success_headline') : t('repo.log.done_headline')}
              contractCode={contractCode}
              tone={isTerminal ? 'success' : 'neutral'}
              stateTransition={isTerminal
                ? { from: t('repo.status.WAIT_FOR_REPO'), to: t('repo.status.REPO_COMPLETED'), toColor: 'success' }
                : undefined}
              detailRows={[
                { label: t('repo.log.resultLabel'), value: result ? t(`repo.result.${result}`) : '—', emphasis: true },
                ...(coords ? [{ label: t('repo.log.locationLabel'), value: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` }] : []),
              ]}
              onClose={forceClose}
            />
          ) : view === 'confirm' ? (
            <>
              <div className="modal-content flex flex-col gap-4">
                <div className="alert alert-warning">
                  <AlertTriangle size={16} />
                  <div className="alert-description">{t('repo.log.confirmSuccess', { code: contractCode })}</div>
                </div>
                <p className="text-sm text-subtle">{t('repo.log.confirmSuccessNote')}</p>
              </div>
              <div className="modal-footer">
                <Button variant="outline" onClick={() => setView('form')}>{t('common.back')}</Button>
                <Button
                  color="primary"
                  disabled={submitting}
                  startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  onClick={submit}
                >
                  {submitting ? t('common.loading') : t('repo.log.confirmSuccessBtn')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="modal-content flex flex-col gap-4">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                  <div className="text-xs text-subtle mt-0.5">{t('repo.log.intro')}</div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="form-label">{t('repo.log.resultLabel')}</label>
                  <RadioGroup
                    name="repo-result"
                    value={result}
                    onChange={(v) => setResult(v as RepoResultCode)}
                    options={resultOptions}
                  />
                  {isTerminal && (
                    <div className="text-[11px] text-warning-fg flex items-center gap-1 mt-0.5">
                      <AlertTriangle size={12} />
                      {t('repo.log.successTerminalHint')}
                    </div>
                  )}
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('repo.log.noteLabel')}</label>
                  <TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder={t('repo.log.notePlaceholder')}
                  />
                </div>

                {/* GPS — sets EXACT pin. Optional; only when at the address. */}
                <div className="flex flex-col gap-1.5">
                  <label className="form-label">{t('repo.log.locationLabel')}</label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      startIcon={locBusy ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
                      onClick={captureLocation}
                      disabled={locBusy}
                    >
                      {coords ? t('repo.log.locationRecapture') : t('repo.log.locationCapture')}
                    </Button>
                    {coords && (
                      <span className="text-xs text-subtle tabular-nums">
                        {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-subtle">{t('repo.log.locationHint')}</p>
                  {locError && <p className="text-[11px] text-danger-fg">{locError}</p>}
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
                  color="primary"
                  disabled={!canSubmit}
                  startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : undefined}
                  onClick={handlePrimary}
                >
                  {submitting ? t('common.loading') : t('repo.log.confirm')}
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
