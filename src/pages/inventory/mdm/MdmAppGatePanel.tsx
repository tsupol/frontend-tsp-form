// ============================================================================
// "ให้ลูกค้าลบแอปเอง" — let the customer remove apps themselves, for a while.
// IMPLEMENT 2026-08-13 mdm_app_removal_gate · status endpoint 2026-08-14 (mig 243).
//
// The enforcement profile carries allowAppRemoval=false, and Apple has no
// per-app form of that key — it is all or nothing, so today the customer can't
// remove even their own LINE or photos. This panel opens the door for a chosen
// number of minutes; the system shuts it again on its own, re-locking at
// whatever level is correct by then, and reinstalls the NNF app if the customer
// removed it meanwhile.
//
// This is deliberately NOT the same thing as the per-row remove button below it:
// there, staff remove one app on the customer's behalf and the shop carries the
// responsibility. Here the customer does it, on Apple's own dialog, and carries
// it themselves. Both exist because they answer different requests, and seeing
// both at once is how the operator picks the right one.
//
// Placement (doc §1): the TOP of the app tab, above the list. It's a
// device-level action, not a row-level one, and while the door is open that is
// live state — burying it under sixty app rows means nobody sees it.
//
// Size discipline, also §1: closed = one compact line, because most people open
// this tab just to read the app list. Open = a full-width warning bar, because
// then it is something happening right now.
//
// ⛔ Vocabulary is locked by the doc: "อนุญาต", never "ปลดล็อก" (that word belongs
// to removing the enforcement profile in sub-tab 7, which is a far more
// dangerous and entirely different act — sharing the word guarantees someone
// presses the wrong one). The words ประตู / gate / profile / enforcement /
// allowAppRemoval never reach the screen either; branch staff don't speak them.
//
// Three things the status endpoint changed, all worth keeping:
//   • Everyone who can see the tab can see the state, including branch staff who
//     can't operate it (read is MDM.APP_CONTROL, open/close stay
//     MDM.APP_REMOVE). An open door is live state, not a privilege.
//   • `can_open` + `block_code` mean the button says WHY it's unavailable
//     instead of making someone press it to find out.
//   • `open_apply_state` distinguishes "open in our records" from "the device
//     actually accepted it" — the profile swap is async, so a sleeping handset
//     is open on paper and still locked in the customer's hand.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { Unlock, Lock, Loader2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { DateTime } from '../../../components/DateTime';
import { MdmChallengeDialog } from './MdmChallengeDialog';
import { MDM_NO_CACHE } from './useMdmStatus';
import {
  appGateOpenPreview, appGateOpenCommit, appGateClose, fetchAppGateStatus,
  parseMdmError, type MdmChallenge, type MdmAppGateStatus,
} from './mdmApi';

/** The doc suggests these three; the RPC itself accepts 5–120. */
const MINUTE_CHOICES = [15, 30, 60] as const;

/** Whole minutes left until `iso`, floored at 0. */
function minutesUntil(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}

export function MdmAppGatePanel({
  serial,
  onChanged,
}: {
  serial: string | null;
  /** Re-read the surrounding screen — opening/closing changes the lock level. */
  onChanged: () => void;
}) {
  const { can } = useAuth();

  // Reading the state needs only MDM.APP_CONTROL — the same permission that put
  // this whole sub-tab on screen. The open/close buttons check APP_REMOVE
  // separately below. Split in two components so this early return doesn't sit
  // above the body's hooks.
  if (!can('MDM.APP_CONTROL')) return null;

  return <GatePanelBody serial={serial} onChanged={onChanged} />;
}

function GatePanelBody({
  serial, onChanged,
}: {
  serial: string | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const actorId = user?.user_id ?? null;
  const mayOperate = can('MDM.APP_REMOVE');
  const qc = useQueryClient();

  const statusKey = ['mdm-app-gate-status', serial];
  const { data: gate, isLoading } = useQuery<MdmAppGateStatus>({
    queryKey: statusKey,
    queryFn: () => fetchAppGateStatus(serial!),
    enabled: !!serial,
    ...MDM_NO_CACHE,
  });
  const reloadStatus = () => qc.invalidateQueries({ queryKey: statusKey });

  const [minutes, setMinutes] = useState<number>(60);
  const [challenge, setChallenge] = useState<MdmChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  /** Re-render every half minute so the countdown ticks down. */
  const [, setTick] = useState(0);

  // Held in a ref so the ticker below doesn't restart every time the parent
  // hands us a fresh callback identity.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const isOpen = gate?.open === true;
  const expiresAt = gate?.expires_at ?? null;
  const remaining = minutesUntil(expiresAt);

  // Tick the countdown, and re-read the moment it runs out — the sweeper closes
  // the door on its own, so the panel has to return to idle with nobody
  // pressing anything. Re-reading (rather than assuming) also catches a close
  // performed from the ops console or by another member of staff.
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => {
      if (expiresAt && minutesUntil(expiresAt) === 0) {
        reloadStatus();
        onChangedRef.current();
      } else {
        setTick((n) => n + 1);
      }
    }, 30_000);
    return () => clearInterval(id);
    // reloadStatus closes over a stable queryKey; re-creating the interval on
    // its identity would reset the clock every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, expiresAt]);

  const ready = actorId != null && !!serial;

  const startOpen = async () => {
    if (!ready) return;
    setBusy(true); setPageError(null); setDialogError(null);
    try {
      const res = await appGateOpenPreview(serial!, actorId!, minutes);
      if (!res.challenge) {
        setPageError(t('asset.mdm.appGate.noChallenge'));
        return;
      }
      setChallenge(res.challenge);
    } catch (e) {
      setPageError(parseMdmError(e, t).message);
      // Whatever refused us, the status row is the authority on why.
      reloadStatus();
    } finally {
      setBusy(false);
    }
  };

  const confirmOpen = async (code: string) => {
    if (!ready || !challenge) return;
    setBusy(true); setDialogError(null);
    try {
      await appGateOpenCommit(serial!, actorId!, minutes, challenge.challenge_id, code);
      setChallenge(null);
      await reloadStatus();
      onChanged();
    } catch (e) {
      // Stay in the dialog — CHALLENGE_INVALID / _TOO_SOON are recoverable by
      // retyping or waiting, and closing throws the challenge away.
      setDialogError(parseMdmError(e, t).message);
    } finally {
      setBusy(false);
    }
  };

  // Closing early needs no ritual: re-locking is always the safe direction.
  const closeNow = async () => {
    if (!ready) return;
    setBusy(true); setPageError(null);
    try {
      await appGateClose(serial!, actorId!);
    } catch (e) {
      const err = parseMdmError(e, t);
      // Nothing open after all — it expired, or someone else closed it. The
      // reload below puts the panel right, so this isn't worth an error band.
      if (err.code.toUpperCase() !== 'MDM.NOT_FOUND.GATE_OPEN') {
        setPageError(err.message);
      }
    } finally {
      setBusy(false);
      await reloadStatus();
      onChanged();
    }
  };

  if (isLoading || !gate) {
    return (
      <div className="border border-line rounded-md px-3 py-2.5 flex items-center gap-2 text-sm text-subtle">
        <Loader2 size={14} className="animate-spin" />
        {t('asset.mdm.appGate.title')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {pageError && <div className="alert alert-danger"><span>{pageError}</span></div>}

      {isOpen ? (
        /* Live state — full-width, loud, and carrying what staff must tell the
           customer. The reinstall promise is here because Apple gives us no way
           to stop them removing the NNF app while the door is open. */
        <div className="alert alert-warning">
          <Unlock size={16} className="shrink-0" />
          <div className="alert-description flex flex-col gap-1.5 min-w-0">
            <div className="text-sm font-semibold">
              {expiresAt
                ? t('asset.mdm.appGate.openWithTime', { minutes: remaining })
                : t('asset.mdm.appGate.openNoTime')}
            </div>

            {expiresAt && (
              <div className="text-xs">
                {t('asset.mdm.appGate.until')} <DateTime value={expiresAt} showTime />
                {' · '}{t('asset.mdm.appGate.autoCloses')}
              </div>
            )}

            {/* Who opened it — so two people don't fight over one device. */}
            {gate.opened_by_username && (
              <div className="text-xs">
                {t('asset.mdm.appGate.openedBy', { name: gate.opened_by_username })}
                {gate.opened_at && <> · <DateTime value={gate.opened_at} showTime /></>}
              </div>
            )}

            {/* Open in our records, but the profile swap hasn't reached the
                handset yet — the customer still can't delete anything. Saying
                so beats the operator telling them to try and being wrong. */}
            {gate.open_apply_state != null && gate.open_apply_state !== 'EXECUTED' && (
              <div className="text-xs inline-flex items-center gap-1">
                <Loader2 size={12} className="animate-spin shrink-0" />
                {t('asset.mdm.appGate.applying')}
              </div>
            )}

            <div className="text-xs">{t('asset.mdm.appGate.tellCustomer')}</div>

            {mayOperate && (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  startIcon={<Lock size={15} />}
                  disabled={busy || !ready}
                  onClick={closeNow}
                >
                  {t('asset.mdm.appGate.stopNow')}
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Idle — one compact line. Most visitors came to read the app list. */
        <div className="border border-line rounded-md px-3 py-2.5 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm font-medium">{t('asset.mdm.appGate.title')}</span>

            {mayOperate && (
              <>
                <div className="flex items-center gap-1">
                  {MINUTE_CHOICES.map((m) => (
                    <Button
                      key={m}
                      size="sm"
                      variant={minutes === m ? 'solid' : 'ghost'}
                      color={minutes === m ? 'primary' : undefined}
                      disabled={!gate.can_open}
                      onClick={() => setMinutes(m)}
                    >
                      {t('asset.mdm.appGate.minutes', { count: m })}
                    </Button>
                  ))}
                </div>
                <div className="ml-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    startIcon={<Unlock size={15} />}
                    disabled={busy || !ready || !gate.can_open}
                    onClick={startOpen}
                  >
                    {t('asset.mdm.appGate.allowFor', { count: minutes })}
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Why the button is dead, said up front rather than on press.
              block_code is the same code the open RPC would have returned, so
              it translates through the shared apiErrors catalogue. */}
          {mayOperate && !gate.can_open && gate.block_code && (
            <div className="text-xs text-subtle">
              {t(gate.block_code, { ns: 'apiErrors', defaultValue: gate.block_code })}
            </div>
          )}

          {/* What happened last time, when there is a last time. */}
          {gate.last_closed_at && (
            <div className="text-xs text-subtler">
              {t('asset.mdm.appGate.lastTime')} <DateTime value={gate.last_closed_at} showTime />
              {' · '}
              {gate.last_removed_bundles.length > 0
                ? t('asset.mdm.appGate.lastRemoved', { count: gate.last_removed_bundles.length })
                : t('asset.mdm.appGate.lastRemovedNone')}
            </div>
          )}
        </div>
      )}

      <MdmChallengeDialog
        challenge={challenge}
        serial={serial ?? '—'}
        title={t('asset.mdm.appGate.confirmTitle', { count: minutes })}
        body={t('asset.mdm.appGate.confirmBody', { count: minutes })}
        confirmLabel={t('asset.mdm.appGate.confirmButton')}
        tone="warning"
        note={t('asset.mdm.appGate.confirmNote')}
        busy={busy}
        error={dialogError}
        onDismissError={() => setDialogError(null)}
        onConfirm={confirmOpen}
        onClose={() => { setChallenge(null); setDialogError(null); }}
      />
    </div>
  );
}
