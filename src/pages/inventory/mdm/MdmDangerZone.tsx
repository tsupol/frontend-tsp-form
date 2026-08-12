// ============================================================================
// Sub-tab 7, lower half — the company_admin actions that take a device OUT of
// enforcement permanently, plus the codes needed after one has been erased.
// IMPLEMENT 2026-08-11 (remove_enforcement_and_erase · tab7_company_admin_actions).
//
// Why these three sit together: sub-tab 7 is "getting a device out from under
// enforcement", and pause is only the temporary form of it. The full arc is
//   overdue → locked → { paused | enforcement removed | erased } → erased devices
//   come back on Activation Lock → you need the unlock codes.
// The person who erases is the person who needs the codes, so the codes live here.
//
// Visibility is by CAPABILITY, not role_code. All three RPCs reject on their own,
// but a button that only ever 403s is a support call. (The pause block above uses
// per-device may_* flags; these permissions are company-scoped and resolve from
// the asset, so they hold even once the binding is gone — which is exactly when a
// repossessed device gets wiped.)
//
// Erase is ONE button (CHANGE 2026-08-12, mig 229). It used to be two: a dry run
// the operator had to pass before the real wipe would unlock, because the DB
// refused a wet erase without a passing dry run in the last hour. That rule is
// gone — dry run is a dev/owner test, not a step for staff, and the accident it
// guarded against (a sender that ignored dry_run) was fixed at the source. The
// remaining rails are unchanged: MDM.ERASE, the Activation-Lock brick check at
// preview, and the 4-digit challenge.
// ============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { ShieldOff, Trash2, KeyRound, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { ActivationLockRevealModal } from '../../nnf-extra/ActivationLockRevealModal';
import { MdmChallengeDialog } from './MdmChallengeDialog';
import {
  removeEnforcementPreview, removeEnforcementCommit,
  erasePreview, eraseCommit, parseMdmError,
  type AssetMdmStatus, type MdmChallenge,
} from './mdmApi';

/** Which flow the one challenge dialog is currently serving. */
type Flow = 'remove' | 'erase';

export function MdmDangerZone({ status, onChanged }: {
  status: AssetMdmStatus;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { user, can } = useAuth();

  const mayRemove = can('MDM.PROFILE_REMOVE');
  const mayErase = can('MDM.ERASE');
  const mayReveal = can('MDM.ACTIVATION_LOCK_REVEAL');

  const [flow, setFlow] = useState<Flow | null>(null);
  const [challenge, setChallenge] = useState<MdmChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Banner errors — a failed PREVIEW never opens a dialog, so it needs a home. */
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reconcilerNote, setReconcilerNote] = useState<string | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);

  const actorId = user?.user_id ?? null;
  const serial = status.serial_number;
  const ready = actorId != null && !!serial;

  if (!mayRemove && !mayErase && !mayReveal) return null;

  const closeDialog = () => { setFlow(null); setChallenge(null); setError(null); };

  /** preview → open the dialog with the server's challenge. */
  const startFlow = async (next: Flow) => {
    if (!ready) return;
    setBusy(true); setPageError(null); setNotice(null); setError(null);
    try {
      if (next === 'remove') {
        const res = await removeEnforcementPreview(serial!, actorId!);
        setReconcilerNote(res.reconciler_note ?? null);
        // Nothing on the device to strip → say so and stop. No challenge exists.
        if (res.nothing_to_remove || !res.challenge) {
          setNotice(t('asset.mdm.danger.nothingToRemove'));
          return;
        }
        setChallenge(res.challenge);
      } else {
        const res = await erasePreview(serial!, actorId!);
        // Erasing a device whose Activation Lock is on with no key on file
        // leaves a brick. The BE refuses; warn before the dialog, not after.
        if (res.activation_lock && !res.has_bypass_key) {
          setPageError(t('asset.mdm.danger.wouldBrick'));
          return;
        }
        if (!res.challenge) {
          setPageError(t('asset.mdm.danger.noChallenge'));
          return;
        }
        setChallenge(res.challenge);
      }
      setFlow(next);
    } catch (e) {
      setPageError(parseMdmError(e, t).message);
    } finally {
      setBusy(false);
    }
  };

  /** commit → consume the challenge. */
  const confirm = async (code: string) => {
    if (!ready || !challenge || !flow) return;
    setBusy(true); setError(null);
    try {
      if (flow === 'remove') {
        const res = await removeEnforcementCommit(serial!, actorId!, challenge.challenge_id, code);
        setReconcilerNote(res.reconciler_note ?? reconcilerNote);
        setNotice(t('asset.mdm.danger.removeDone'));
      } else {
        await eraseCommit(serial!, actorId!, challenge.challenge_id, code);
        setNotice(t('asset.mdm.danger.eraseQueued'));
      }
      closeDialog();
      onChanged();
    } catch (e) {
      // Stay in the dialog: CHALLENGE_INVALID / _TOO_SOON are recoverable by
      // retyping or waiting, and closing would throw away the challenge.
      setError(parseMdmError(e, t).message);
    } finally {
      setBusy(false);
    }
  };

  const dialogCopy: Record<Flow, { title: string; body: string; confirm: string; tone: 'warning' | 'danger' }> = {
    remove: {
      title: t('asset.mdm.danger.removeTitle'),
      body: t('asset.mdm.danger.removeBody'),
      confirm: t('asset.mdm.danger.removeConfirm'),
      tone: 'warning',
    },
    erase: {
      title: t('asset.mdm.danger.eraseTitle'),
      body: t('asset.mdm.danger.eraseBody'),
      confirm: t('asset.mdm.danger.eraseConfirm'),
      tone: 'danger',
    },
  };

  return (
    <div className="border border-danger-border rounded-md p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-danger-fg">{t('asset.mdm.danger.heading')}</h3>
        <p className="text-xs text-subtle mt-0.5">{t('asset.mdm.danger.intro')}</p>
      </div>

      {pageError && <div className="alert alert-danger"><span>{pageError}</span></div>}
      {notice && (
        <div className="alert alert-success">
          <CheckCircle2 size={16} className="shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {/* Dunning re-applies the lock on the next pass while the device is still
          overdue — the operator has to know the unlock may not stick. */}
      {reconcilerNote && <div className="alert alert-info"><span>{reconcilerNote}</span></div>}

      {!serial && <p className="text-xs text-subtler">{t('asset.mdm.danger.noSerial')}</p>}

      <div className="flex flex-wrap gap-2">
        {mayRemove && (
          <Button
            variant="outline" size="sm"
            startIcon={<ShieldOff size={15} />}
            disabled={busy || !ready}
            onClick={() => startFlow('remove')}
          >
            {t('asset.mdm.danger.removeButton')}
          </Button>
        )}

        {mayErase && (
          <Button
            color="danger" size="sm"
            startIcon={<Trash2 size={15} />}
            disabled={busy || !ready}
            onClick={() => startFlow('erase')}
          >
            {t('asset.mdm.danger.eraseButton')}
          </Button>
        )}

        {mayReveal && (
          <Button
            variant="outline" size="sm"
            startIcon={<KeyRound size={15} />}
            disabled={busy}
            onClick={() => setRevealOpen(true)}
          >
            {t('asset.mdm.danger.revealButton')}
          </Button>
        )}
      </div>

      {mayErase && <p className="text-xs text-subtler">{t('asset.mdm.danger.eraseHint')}</p>}

      <MdmChallengeDialog
        challenge={challenge}
        serial={serial ?? '—'}
        title={flow ? dialogCopy[flow].title : ''}
        body={flow ? dialogCopy[flow].body : ''}
        confirmLabel={flow ? dialogCopy[flow].confirm : ''}
        tone={flow ? dialogCopy[flow].tone : 'warning'}
        note={flow === 'remove' ? reconcilerNote : null}
        busy={busy}
        error={error}
        onDismissError={() => setError(null)}
        onConfirm={confirm}
        onClose={closeDialog}
      />

      <ActivationLockRevealModal
        target={revealOpen ? {
          asset_id: status.asset_id,
          serial_number: status.serial_number,
        } : null}
        onClose={() => setRevealOpen(false)}
      />
    </div>
  );
}
