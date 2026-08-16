// ============================================================================
// MdmChallengeDialog — the confirmation gate for the destructive MDM actions in
// sub-tab 7 (remove enforcement · erase dry-run · erase for real).
// IMPLEMENT 2026-08-11_mdm_remove_enforcement_and_erase.md §1.
//
// The sequence the operator sees, all three times:
//   1. serial, large — "is this the handset I mean?" comes before anything else
//   2. a 5-second countdown with the confirm button dead, so nobody muscle-memories
//      through a wipe
//   3. the server's 4-digit code appears; they retype it; the button wakes up
//
// Two rules this file exists to enforce:
//   • The code comes from the server's preview response. We display it and
//     compare typing to decide whether to ENABLE the button — that is a
//     convenience, not the check. The server consumes the challenge and rejects
//     a wrong/expired/reused one on its own (CHALLENGE_INVALID).
//   • The countdown likewise mirrors `countdown_seconds` from the response
//     rather than a local constant, and the server independently refuses an
//     early commit (CHALLENGE_TOO_SOON).
//
// Challenges expire after 3 minutes. When that passes with the dialog still
// open we stop offering a confirm that is certain to fail and ask for a restart.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Input } from 'tsp-form';
import { ShieldAlert } from 'lucide-react';
import { ModalErrorBand } from '../../../components/ModalErrorBand';
import type { MdmChallenge } from './mdmApi';

export type MdmChallengeTone = 'warning' | 'danger';

interface Props {
  /** Null = closed. The Modal stays mounted; this only drives `open`. */
  challenge: MdmChallenge | null;
  serial: string;
  /** Action title, already translated. */
  title: string;
  /** One or two sentences on what is about to happen, already translated. */
  body: string;
  /** `danger` = irreversible (wet erase). `warning` = reversible/no data loss. */
  tone?: MdmChallengeTone;
  /** Extra caveat under the body — e.g. the reconciler re-lock note. */
  note?: string | null;
  /** Label for the confirm button, already translated. */
  confirmLabel: string;
  /**
   * Extra fields rendered inside the dialog, ABOVE the countdown — so the 5
   * seconds are spent filling them in rather than staring at a number. The
   * enroll-link dialog uses this for its mandatory "issued to whom" note.
   */
  extraFields?: React.ReactNode;
  /**
   * Blocks confirm even when the code matches — for a required `extraFields`
   * value. The server validates independently (ISSUED_TO_REQUIRED) and does NOT
   * burn the challenge on that rejection, so this is convenience, not the check.
   */
  extraInvalid?: boolean;
  busy?: boolean;
  /** Submit error from the commit call, already translated. */
  error?: string | null;
  onDismissError?: () => void;
  onConfirm: (confirmCode: string) => void;
  onClose: () => void;
}

/** Seconds remaining until `iso`, floored at 0. */
function secondsUntil(iso: string | undefined): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 1000);
}

export function MdmChallengeDialog({
  challenge, serial, title, body, tone = 'warning', note,
  confirmLabel, extraFields, extraInvalid = false,
  busy = false, error, onDismissError, onConfirm, onClose,
}: Props) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [expired, setExpired] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-arm on each new challenge. `earliest_confirm_at` is authoritative — a
  // dialog reopened after a slow round-trip must not restart a full 5s wait the
  // server already considers served.
  useEffect(() => {
    if (!challenge) return;
    setTyped('');
    setExpired(secondsUntil(challenge.expires_at) === 0);
    setRemaining(
      Math.min(
        challenge.countdown_seconds ?? 5,
        secondsUntil(challenge.earliest_confirm_at) || (challenge.countdown_seconds ?? 5),
      ),
    );
  }, [challenge?.challenge_id]);

  // One ticker drives both the countdown and the 3-minute expiry.
  useEffect(() => {
    if (!challenge) return;
    const id = setInterval(() => {
      setRemaining(secondsUntil(challenge.earliest_confirm_at));
      setExpired(secondsUntil(challenge.expires_at) === 0);
    }, 250);
    return () => clearInterval(id);
  }, [challenge?.challenge_id, challenge?.earliest_confirm_at, challenge?.expires_at]);

  // Focus the code box the moment it becomes usable, not before — autofocus at
  // open would put the caret in a field the operator can't act on yet.
  useEffect(() => {
    if (remaining === 0 && !expired && challenge) inputRef.current?.focus();
  }, [remaining === 0, expired, challenge?.challenge_id]);

  const code = challenge?.confirm_code ?? '';
  const matches = typed === code && code.length > 0;
  const canConfirm = !busy && !expired && remaining === 0 && matches && !extraInvalid;

  return (
    <Modal open={!!challenge} onClose={() => !busy && onClose()} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{title}</h2>
        <button type="button" className="modal-close-btn" onClick={() => !busy && onClose()} aria-label={t('common.close', { defaultValue: 'Close' })}>&times;</button>
      </div>

      <div className="modal-content">
        {/* Serial first and biggest — the "right handset?" check outranks
            everything else in this dialog. */}
        <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
          <div className="text-xs text-subtle">{t('asset.mdm.challenge.serialLabel')}</div>
          <div className="font-mono text-lg font-semibold tracking-wide break-all select-all">{serial}</div>
        </div>

        <div className={`alert alert-${tone} mt-3`}>
          <ShieldAlert size={16} className="shrink-0" />
          <span>{body}</span>
        </div>

        {note && <p className="text-xs text-subtle mt-2">{note}</p>}

        {/* Above the countdown on purpose: the enforced 5-second wait becomes
            the time the operator fills this in, instead of dead air. */}
        {extraFields && <div className="mt-3">{extraFields}</div>}

        {expired ? (
          <div className="alert alert-warning mt-3">
            <span>{t('asset.mdm.challenge.expired')}</span>
          </div>
        ) : remaining > 0 ? (
          <div className="mt-4 text-center">
            <div className="text-3xl font-semibold tabular-nums">{remaining}</div>
            <div className="text-xs text-subtle mt-1">{t('asset.mdm.challenge.waitHint')}</div>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-sm text-subtle">{t('asset.mdm.challenge.typeHint')}</p>
            <div className="flex items-center gap-3">
              {/* The code to read off. Never generated here — see file header. */}
              <div className="font-mono text-2xl font-bold tracking-[0.35em] tabular-nums select-all px-3 py-1.5 rounded-md bg-surface-shallow">
                {code}
              </div>
              <Input
                ref={inputRef}
                value={typed}
                onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, code.length))}
                inputMode="numeric"
                autoComplete="off"
                placeholder={t('asset.mdm.challenge.inputPlaceholder')}
                className="w-full font-mono tracking-widest"
                aria-label={t('asset.mdm.challenge.inputPlaceholder')}
              />
            </div>
          </div>
        )}
      </div>

      <ModalErrorBand message={error} onDismiss={onDismissError} />

      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button
          color={tone === 'danger' ? 'danger' : 'primary'}
          onClick={() => onConfirm(typed)}
          disabled={!canConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
