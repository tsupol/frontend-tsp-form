// Shared reset-customer-login modal — the ONE way to reset a customer's app
// login anywhere in staff web (NNF App menu, contract page, customer page…).
//
// Why one component: after reset, the password is the customer's tel with all
// non-digits stripped, which can differ from what a `tel` column shows on
// screen. If one page shows the real credentials and another doesn't, staff
// guess off the visible tel and read the customer the wrong password. So every
// reset MUST render `username` + `password_used` from the RPC response, each
// with its own copy button. (BE IMPLEMENT doc, "same pattern everywhere".)
//
// Flow: form (reason + logout warning) → done (credential box). Success does
// NOT close — the credentials are the whole point of the action.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Input } from 'tsp-form';
import { KeyRound, XCircle, Loader2, Copy, Check, AlertTriangle, CheckCircle } from 'lucide-react';
import { ApiError } from '../lib/api';
import { resetCustomerLogin, type ResetLoginResult } from '../pages/nnf-app/nnfAppApi';
import { translateApiError } from '../lib/apiErrors';

interface Props {
  open: boolean;
  customerId: number | null;
  customerName?: string | null;
  onClose: () => void;
  /** Called after a successful reset (e.g. to refetch a list). */
  onDone?: () => void;
}

export function ResetCustomerLoginModal({ open, customerId, customerName, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ResetLoginResult | null>(null);

  useEffect(() => {
    if (open) { setReason(''); setError(''); setSubmitting(false); setResult(null); }
  }, [open]);

  const handleConfirm = async () => {
    if (customerId == null) return;
    const trimmed = reason.trim();
    if (!trimmed) { setError(t('nnfApp.reset.reasonRequired')); return; }
    setSubmitting(true);
    setError('');
    try {
      // Success is HTTP 200 with the standard envelope (unwrapped by apiClient).
      // A 403 (no permission) surfaces as an ApiError — handled below, not a
      // silent {ok:false}. Missing-permission should be prevented by hiding the
      // trigger, but we still translate it if it slips through.
      const res = await resetCustomerLogin(customerId, trimmed);
      setResult(res);
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setSubmitting(false);
    }
  };

  const telDirty = !!result && result.password_used !== result.tel_raw;

  return (
    <Modal open={open} onClose={onClose} maxWidth="30rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {result
            ? t('nnfApp.reset.doneTitle')
            : t('nnfApp.reset.title', { name: customerName ?? '' })}
        </h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>

      {result ? (
        // ── Done: credential box ────────────────────────────────────────────
        <div className="modal-content">
          <div className="alert alert-success mb-3">
            <CheckCircle size={16} />
            <span>{t('nnfApp.reset.doneMessage')}</span>
          </div>
          <div className="rounded-md border border-line bg-surface divide-y divide-line">
            <CredentialRow
              label={t('nnfApp.reset.usernameLabel')}
              value={result.username}
            />
            <CredentialRow
              label={t('nnfApp.reset.passwordLabel')}
              value={result.password_used}
            />
          </div>
          {telDirty && (
            <div className="alert alert-warning mt-3">
              <AlertTriangle size={16} />
              <span>{t('nnfApp.reset.telDirtyWarning', { tel: result.tel_raw })}</span>
            </div>
          )}
          <div className="modal-footer px-0 pb-0 pt-4">
            <Button color="primary" onClick={onClose}>{t('common.done')}</Button>
          </div>
        </div>
      ) : (
        // ── Form: reason + logout warning ───────────────────────────────────
        <>
          <div className="modal-content">
            {error && (
              <div className="alert alert-danger mb-3">
                <XCircle size={16} />
                <span>{error}</span>
              </div>
            )}
            <div className="alert alert-warning mb-3">
              <AlertTriangle size={16} />
              <span>{t('nnfApp.reset.logoutWarning')}</span>
            </div>
            <ul className="text-sm space-y-1.5 mb-4 pl-5 list-disc text-subtle">
              <li>{t('nnfApp.reset.consequenceUsername')}</li>
              <li>{t('nnfApp.reset.consequencePassword')}</li>
            </ul>
            <div className="form-grid">
              <div className="flex flex-col">
                <label className="form-label">{t('nnfApp.reset.reason')} *</label>
                <Input
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder={t('nnfApp.reset.reasonPlaceholder')}
                  className="w-full"
                />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
            <Button
              color="primary"
              onClick={handleConfirm}
              disabled={submitting || !reason.trim()}
              startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            >
              {t('nnfApp.reset.confirm')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

// A label + monospaced value + copy button. Copy sends the raw value so it can
// be pasted into a chat/SMS without retyping (retyping is how staff introduce
// errors — the whole reason for the copy button).
function CredentialRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => {},
    );
  };
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-xs text-subtle">{label}</div>
        <div className="text-base font-medium tabular-nums tracking-wide break-all">{value}</div>
      </div>
      <Button
        size="sm"
        variant={copied ? 'solid' : 'outline'}
        color={copied ? 'success' : undefined}
        startIcon={copied ? <Check size={14} /> : <Copy size={14} />}
        onClick={copy}
        aria-label={t('common.copy')}
      >
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  );
}
