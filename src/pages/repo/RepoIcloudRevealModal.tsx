// Shows the iCloud account of the device on a repo/legal job, for the agent
// standing in front of it.
//
// The password lives in no view on purpose — every read is logged — so it comes
// only from ops_repo_reveal_icloud_password, and only for a contract the user
// has picked up (focus). Consequences for this component:
//   · the panel's button is the press: opening this modal runs the reveal once
//     (picking the job up first when it isn't yet — one click, per the
//     2026-10-01 DELIVERY). Never on mount of the page behind it, and never
//     through react-query (no cache entry);
//   · the value is held in local state and dropped when the modal closes;
//   · one press = one reveal = one log row: no "show again" while the password
//     is on screen, a retry only after a failure a retry can fix.
// One account can control up to ~20 devices belonging to other customers, which
// is why it is gated this tightly.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, useSnackbarContext } from 'tsp-form';
import { Loader2, AlertTriangle, Copy, Check, Eye } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { repoRevealIcloud, repoFocusAdd, type RepoIcloudReveal } from './repoApi';

export function CopyRow({ label, value }: { label: string; value: string }) {
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
    // The agent may have to type these into a device by hand, so the value wraps
    // rather than truncating — an Apple ID cut off mid-address is useless.
    <div className="flex items-start gap-2 min-w-0">
      <span className="text-xs text-subtle shrink-0 pt-1">{label}</span>
      <span className="font-mono text-sm flex-1 min-w-0 break-all">{value}</span>
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
  pickUpFirst,
  onFocusChanged,
  onLeftPool,
}: {
  open: boolean;
  onClose: () => void;
  contractId: number | null;
  contractCode: string | null;
  deviceCode: string | null;
  // The job isn't picked up yet: the press that opened this modal picks it up
  // and then reveals, so the agent never meets a dead button.
  pickUpFirst: boolean;
  // Picking the job up changes the panel and the worklist behind it.
  onFocusChanged: () => void;
  // The BE says the job has left the pool — the list behind is stale.
  onLeftPool: () => void;
}) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState<RepoIcloudReveal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // False for failures a second press can't fix (job left the pool, device has
  // no account) — then the modal offers no retry.
  const [retryable, setRetryable] = useState(false);
  // One reveal per open: StrictMode or a re-render must not log a second view.
  const startedRef = useRef(false);
  // Bumped on every close. A request still in flight when the modal closes
  // carries the old number, and its answer is dropped instead of landing a
  // password in a closed modal.
  const openGenRef = useRef(0);

  // Nothing survives a close: the password is never kept. Cleared once the
  // fade-out has finished, so the box doesn't collapse while still visible.
  useEffect(() => {
    if (open) return;
    openGenRef.current += 1;
    startedRef.current = false;
    setBusy(false);
    const timer = setTimeout(() => {
      setRevealed(null);
      setError(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [open]);

  const run = async (pickUp: boolean) => {
    if (contractId == null) return;
    const gen = openGenRef.current;
    const stale = () => gen !== openGenRef.current;
    const pickUpThenReveal = async () => {
      await repoFocusAdd(contractId);
      onFocusChanged();
      if (stale()) return null;
      return repoRevealIcloud(contractId);
    };
    setBusy(true);
    setError(null);
    try {
      let result: RepoIcloudReveal | null;
      if (pickUp) {
        result = await pickUpThenReveal();
      } else {
        try {
          result = await repoRevealIcloud(contractId);
        } catch (err) {
          // The job was dropped since the panel loaded — pick it up again and
          // retry once, as the DELIVERY prescribes.
          if (err instanceof ApiError && err.code === 'OPS.STATE.NOT_ON_FOCUS') result = await pickUpThenReveal();
          else throw err;
        }
      }
      if (stale()) return;
      setRevealed(result);
    } catch (err) {
      if (stale()) return;
      setRevealed(null);
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'OPS.STATE.NOT_IN_REPO_POOL') onLeftPool();
      setRetryable(
        code !== 'OPS.STATE.NOT_IN_REPO_POOL'
        && code !== 'MDM.VALIDATION.NO_ICLOUD_ASSIGNED'
        && code !== 'MDM.VALIDATION.ACCOUNT_NOT_FOUND',
      );
      setError(translateApiError(err, t));
    } finally {
      if (!stale()) setBusy(false);
    }
  };

  useEffect(() => {
    if (open && !startedRef.current && contractId != null) {
      startedRef.current = true;
      setRevealed(null);
      setError(null);
      run(pickUpFirst);
    }
    // run is recreated each render; the ref is what keeps this to once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contractId, pickUpFirst]);

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

          {revealed ? (
            <div className="flex flex-col gap-2">
              <CopyRow label={t('repo.icloud.appleId')} value={revealed.apple_id} />
              <CopyRow label={t('repo.icloud.password')} value={revealed.password} />
              <p className="text-xs text-subtler">{t('repo.icloud.sharedAccountWarning')}</p>
            </div>
          ) : busy ? (
            <div className="flex items-center justify-center py-4 text-subtle">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : null}

          <p className="text-xs text-subtle">{t('repo.icloud.hint')}</p>
        </div>
      </div>

      <ModalErrorBand message={error} onDismiss={() => setError(null)} />

      <div className="modal-footer">
        <Button onClick={onClose}>{t('common.close')}</Button>
        {/* Only after a failure: while the password is on screen another press
            would just log a second view of the same thing. */}
        {!busy && !revealed && error && retryable && (
          <Button
            variant="outline"
            startIcon={<Eye size={16} />}
            onClick={() => run(false)}
          >
            {t('repo.icloud.revealButton')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
