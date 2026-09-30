// Shows the iCloud account of the device on a repo/legal job, for the agent
// standing in front of it.
//
// The password lives in no view on purpose — every read is logged — so it comes
// only from ops_repo_reveal_icloud_password, and only for a contract the user
// has picked up (focus). Consequences for this component:
//   · the RPC fires on the button press inside this modal, never on mount of
//     the page behind it, and never through react-query (no cache entry);
//   · the value is held in local state and dropped when the modal closes;
//   · one press = one reveal = one log row, so the press is disabled while in
//     flight and the user must press again to re-reveal.
// One account can control up to ~20 devices belonging to other customers, which
// is why it is gated this tightly.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, useSnackbarContext } from 'tsp-form';
import { Loader2, AlertTriangle, Copy, Check, KeyRound, Eye } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { repoRevealIcloud, repoFocusAdd, type RepoIcloudReveal } from './repoApi';

function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      addSnackbar({
        message: (
          <div className="alert alert-danger">
            <AlertTriangle size={16} />
            <span className="alert-description">{t('repo.icloud.copyFailed')}</span>
          </div>
        ),
        type: 'error',
      });
    }
  };

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-subtle w-24 shrink-0">{label}</span>
      <span className="font-mono text-sm truncate flex-1 min-w-0">{value}</span>
      <Button
        variant="outline"
        size="sm"
        startIcon={copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
        onClick={copy}
        aria-label={t('common.copy')}
      />
    </div>
  );
}

export function RepoIcloudRevealModal({
  open,
  onClose,
  contractId,
  contractCode,
  deviceCode,
  onFocusChanged,
}: {
  open: boolean;
  onClose: () => void;
  contractId: number | null;
  contractCode: string | null;
  deviceCode: string | null;
  // The reveal needs focus; if the user picks the job up from in here, the
  // panel behind must refetch so its own focus state agrees.
  onFocusChanged: () => void;
}) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState<RepoIcloudReveal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the BE says the job isn't picked up — then the modal offers to
  // pick it up rather than just reporting the refusal.
  const [needsFocus, setNeedsFocus] = useState(false);

  // Nothing survives a close: the password is never kept.
  useEffect(() => {
    if (!open) {
      setRevealed(null);
      setError(null);
      setNeedsFocus(false);
      setBusy(false);
    }
  }, [open]);

  const reveal = async () => {
    if (contractId == null) return;
    setBusy(true);
    setError(null);
    setNeedsFocus(false);
    try {
      setRevealed(await repoRevealIcloud(contractId));
    } catch (err) {
      setRevealed(null);
      if (err instanceof ApiError) {
        if (err.code === 'OPS.STATE.NOT_ON_FOCUS') setNeedsFocus(true);
        setError(translateApiError(err, t));
      } else {
        setError(String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const pickUpThenReveal = async () => {
    if (contractId == null) return;
    setBusy(true);
    setError(null);
    try {
      await repoFocusAdd(contractId);
      setNeedsFocus(false);
      onFocusChanged();
      setRevealed(await repoRevealIcloud(contractId));
    } catch (err) {
      if (err instanceof ApiError) setError(translateApiError(err, t));
      else setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%" ariaLabel={t('repo.icloud.title')}>
      <div className="modal-header">
        <h2 className="modal-title">{t('repo.icloud.title')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>

      <div className="modal-content">
        <div className="flex flex-col gap-3">
          <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">{contractCode ?? '—'}</div>
            {(revealed?.device_code_display ?? deviceCode) && (
              <div className="text-xs text-subtle font-mono">
                {revealed?.device_code_display ?? deviceCode}
              </div>
            )}
          </div>

          {!revealed && (
            <p className="text-xs text-subtle">{t('repo.icloud.hint')}</p>
          )}

          {revealed ? (
            <div className="flex flex-col gap-2">
              <CopyRow label={t('repo.icloud.appleId')} value={revealed.apple_id} />
              <CopyRow label={t('repo.icloud.password')} value={revealed.password} />
              <p className="text-xs text-subtler">{t('repo.icloud.sharedAccountWarning')}</p>
            </div>
          ) : (
            <Button
              variant="primary"
              startIcon={busy ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
              disabled={busy || contractId == null}
              onClick={reveal}
            >
              {t('repo.icloud.revealButton')}
            </Button>
          )}

          {needsFocus && (
            <Button
              variant="outline"
              startIcon={busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
              disabled={busy}
              onClick={pickUpThenReveal}
            >
              {t('repo.icloud.pickUpAndReveal')}
            </Button>
          )}
        </div>
      </div>

      <ModalErrorBand message={error} onDismiss={() => setError(null)} />

      <div className="modal-footer">
        <Button onClick={onClose}>{t('common.close')}</Button>
        {revealed && (
          <Button
            variant="outline"
            startIcon={busy ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
            disabled={busy}
            onClick={reveal}
          >
            {t('repo.icloud.revealAgain')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
