// ============================================================================
// "ให้ลูกค้าลบแอปเอง" — let the customer remove apps themselves, for a while.
// IMPLEMENT 2026-08-13 mdm_app_removal_gate.
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
// it themselves. Both exist because they answer different requests.
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
// ⚠️ There is no status endpoint yet (doc §4). Nothing tells us on page load
// whether a door is already open — the only signal is GATE_ALREADY_OPEN coming
// back from a preview, which is what `knownOpen` below latches on. So after a
// reload the panel reads as closed until someone presses the button. BE has the
// read side on their ops console and we've asked them to expose it
// (UI_FEEDBACK 2026-08-14); when it lands, feed `expiresAt` from it and the
// countdown becomes real on every load.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { Unlock, Lock } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { DateTime } from '../../../components/DateTime';
import { MdmChallengeDialog } from './MdmChallengeDialog';
import {
  appGateOpenPreview, appGateOpenCommit, appGateClose, parseMdmError,
  type MdmChallenge,
} from './mdmApi';

/** The doc suggests these three; the RPC itself accepts 5–120. */
const MINUTE_CHOICES = [15, 30, 60] as const;

/** Whole minutes left until `iso`, floored at 0. */
function minutesUntil(iso: string | null): number {
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

  // Same permission as the per-row remove button (doc §1). Without it the whole
  // panel is absent — not disabled. Split in two so this early return doesn't
  // sit above the body's hooks.
  if (!can('MDM.APP_REMOVE')) return null;

  return <GatePanelBody serial={serial} onChanged={onChanged} />;
}

function GatePanelBody({
  serial, onChanged,
}: {
  serial: string | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const actorId = user?.user_id ?? null;
  const [minutes, setMinutes] = useState<number>(60);
  const [challenge, setChallenge] = useState<MdmChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  /** When the door shuts. Known only from a commit we performed — see header. */
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  /** Open, but we don't know until when (learned from GATE_ALREADY_OPEN). */
  const [knownOpen, setKnownOpen] = useState(false);
  /** Re-render once a minute so the countdown ticks down. */
  const [, setTick] = useState(0);

  // Held in a ref so the ticker below doesn't restart every time the parent
  // hands us a fresh callback identity.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const isOpen = knownOpen || minutesUntil(expiresAt) > 0;

  // Tick the countdown down, and notice the moment it runs out — the system
  // closes the door on its own, so the panel has to go back to idle without
  // anyone pressing anything.
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => {
      if (minutesUntil(expiresAt) === 0) {
        setExpiresAt(null);
        setKnownOpen(false);
        onChangedRef.current();
      } else {
        setTick((n) => n + 1);
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [expiresAt]);

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
      const err = parseMdmError(e, t);
      // The one way we currently learn a door is already open (doc §4). Switch
      // to the open state so the operator gets the stop button, even though we
      // can't say how long is left.
      // Codes arrive lowercase via messageKey, upper when raw — compare folded.
      if (err.code.toUpperCase() === 'MDM.STATE.GATE_ALREADY_OPEN') {
        setKnownOpen(true);
        onChanged();
      } else {
        setPageError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmOpen = async (code: string) => {
    if (!ready || !challenge) return;
    setBusy(true); setDialogError(null);
    try {
      const res = await appGateOpenCommit(serial!, actorId!, minutes, challenge.challenge_id, code);
      setExpiresAt(res.expires_at);
      setKnownOpen(true);
      setChallenge(null);
      onChanged();
    } catch (e) {
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
      setExpiresAt(null);
      setKnownOpen(false);
      onChanged();
    } catch (e) {
      const err = parseMdmError(e, t);
      // Nothing open after all (it expired, or another staffer closed it).
      if (err.code.toUpperCase() === 'MDM.NOT_FOUND.GATE_OPEN') {
        setExpiresAt(null);
        setKnownOpen(false);
      } else {
        setPageError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const remaining = minutesUntil(expiresAt);

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
            <div className="text-xs">{t('asset.mdm.appGate.tellCustomer')}</div>
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
          </div>
        </div>
      ) : (
        /* Idle — one compact line. Most visitors came to read the app list. */
        <div className="border border-line rounded-md px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm font-medium">{t('asset.mdm.appGate.title')}</span>
          <div className="flex items-center gap-1">
            {MINUTE_CHOICES.map((m) => (
              <Button
                key={m}
                size="sm"
                variant={minutes === m ? 'solid' : 'ghost'}
                color={minutes === m ? 'primary' : undefined}
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
              disabled={busy || !ready}
              onClick={startOpen}
            >
              {t('asset.mdm.appGate.allowFor', { count: minutes })}
            </Button>
          </div>
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
