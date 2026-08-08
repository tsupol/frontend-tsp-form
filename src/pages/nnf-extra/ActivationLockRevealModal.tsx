// Activation Lock reveal — IMPLEMENT 2026-08-07 (migs 1038+1039).
//
// A device that got erased comes back locked to our organisation's Activation
// Lock and is unusable until someone types a bypass code into it. Those codes
// used to live only in a dev console, so every case became a phone call to the
// system owner.
//
// Two rules drive this whole file:
//   1. A code is NEVER shown without its type label. Both types are 27 chars and
//      visually identical, but they unlock different locks — the org lock vs the
//      customer's own Apple ID lock. Hand someone a bare code and they'll try
//      the wrong one and report "the code doesn't work" on a recoverable device.
//   2. Serial + model + asset code are always visible above the codes, so the
//      person reading them can confirm they opened the right device first.
//
// Codes are large + monospace because staff type them into a handset character
// by character. Each code gets its OWN copy button — never one "copy all".
//
// Reveals are logged server-side (mdm.device_escrow_access_log). Nothing to do
// here beyond passing the reason through.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { KeyRound, Building2, Apple } from 'lucide-react';
import { CopyButton } from '../../components/CopyButton';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { DateTime } from '../../components/DateTime';
import { parseMdmError, revealActivationLock } from '../inventory/mdm/mdmApi';
import type { MdmActivationLockKey, MdmActivationLockReveal } from '../inventory/mdm/mdmApi';

interface Props {
  /** Null when closed. The modal stays mounted; `open` drives visibility. */
  target: { asset_id: number; asset_code_display: string; serial_number: string | null } | null;
  onClose: () => void;
}

/** One escrow key: type label, expiry line, the code itself, its copy button. */
function KeyCard({ item }: { item: MdmActivationLockKey }) {
  const { t } = useTranslation();
  const isServer = item.escrow_type === 'ACTIVATION_LOCK_SERVER';

  return (
    <div className="rounded-md border border-line bg-surface p-3 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        {isServer
          ? <Building2 size={16} className="shrink-0 mt-0.5 text-primary-fg" />
          : <Apple size={16} className="shrink-0 mt-0.5 text-subtle" />}
        <div className="min-w-0">
          {/* Label by code, never by position — an unknown type still renders. */}
          <div className="text-sm font-medium">
            {t(`mdmDevices.activationLock.type.${item.escrow_type}`, { defaultValue: item.escrow_type })}
          </div>
          {item.never_expires ? (
            <div className="text-xs text-subtle">{t('mdmDevices.activationLock.neverExpires')}</div>
          ) : item.window_ends_at ? (
            <div className="text-xs text-subtle">
              {t('mdmDevices.activationLock.usableUntil')}{' '}
              <DateTime value={item.window_ends_at} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Large + monospace: this gets typed into a handset by hand. */}
        <code className="flex-1 min-w-0 font-mono text-base md:text-lg tracking-wide break-all select-all">
          {item.code}
        </code>
        <CopyButton value={item.code} size={16} className="shrink-0" />
      </div>
    </div>
  );
}

export function ActivationLockRevealModal({ target, onClose }: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MdmActivationLockReveal | null>(null);

  // Reset per open so a previous device's codes can never linger on screen.
  useEffect(() => {
    if (target) { setReason(''); setBusy(false); setError(''); setResult(null); }
  }, [target?.asset_id]);

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      setResult(await revealActivationLock(target.asset_id, reason));
    } catch (e) {
      // Every failure mode has its own code + message — never collapse these to
      // a generic "something went wrong". "No code yet" and "code was scrubbed"
      // lead to completely different next steps for the person on the phone.
      setError(parseMdmError(e, t).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!target} onClose={() => !busy && onClose()} maxWidth="34rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('mdmDevices.activationLock.title')}</h2>
        <button type="button" className="modal-close-btn" onClick={() => !busy && onClose()}>&times;</button>
      </div>

      <div className="modal-content">
        {/* Device identity — always on screen, in both views, so nobody reads
            out codes for the wrong handset. */}
        <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
          <div className="font-medium text-sm">
            {result?.serial_number ?? target?.serial_number ?? '—'}
            {result?.model && <span className="text-subtle font-normal"> · {result.model}</span>}
          </div>
          <div className="text-xs text-subtle">{result?.asset_code ?? target?.asset_code_display}</div>
        </div>

        {!result ? (
          <div className="form-grid mt-3">
            <div className="flex flex-col">
              <label className="form-label">{t('mdmDevices.activationLock.reasonLabel')}</label>
              <TextArea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('mdmDevices.activationLock.reasonPlaceholder')}
                rows={3}
                className="w-full"
              />
              <p className="text-xs text-subtle mt-1">{t('mdmDevices.activationLock.reasonHint')}</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 mt-3">
            {result.keys.length === 0 ? (
              <div className="alert alert-warning">
                <span>{t('mdmDevices.activationLock.noKeys')}</span>
              </div>
            ) : (
              <>
                {result.keys.map((k) => <KeyCard key={k.escrow_id} item={k} />)}
                {/* Apple's own field leaves the username blank — staff get this
                    wrong constantly and blame the code. */}
                <div className="alert alert-info">
                  <span>{t('mdmDevices.activationLock.blankUsernameNote')}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <ModalErrorBand message={error} onDismiss={() => setError('')} />

      <div className="modal-footer">
        {!result ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button color="primary" onClick={submit} disabled={busy} startIcon={<KeyRound size={15} />}>
              {t('mdmDevices.activationLock.revealButton')}
            </Button>
          </>
        ) : (
          <Button color="primary" onClick={onClose}>{t('common.done')}</Button>
        )}
      </div>
    </Modal>
  );
}
