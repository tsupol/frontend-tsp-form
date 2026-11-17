// ============================================================================
// useMdmCommand — the shared async-command contract (131 §0.3, §2).
//
// Every MDM action button goes: idle → confirm (caller's dialog) → fire →
// "acknowledged" (queued, NOT done) → the returned intent_id(s) get handed to
// the queue for tracking. This hook owns the fire/ack/error half so each
// sub-tab doesn't re-implement it (and can't accidentally say "success").
//
//   const cmd = useMdmCommand({ onAck });
//   const b = cmd.button('ENFORCE');
//   <Button disabled={b.busy} startIcon={b.icon ?? <Lock />}
//     onClick={() => cmd.run(() => enforceDunning(...), r => [...], 'ENFORCE')}>
//     {b.label ?? t('…')}
//   </Button>
//
// Re-press guard (IMPLEMENT 2026-11-17 button_double_press_guard_481):
// - A second press while the first is still in flight is dropped on the spot
//   (a ref, not state: a double tap 0.18 s apart lands before the re-render).
// - After a queued command the same button stays "ส่งแล้ว กำลังถึงเครื่อง… N"
//   for 10 s — READY_TO_SEND means queued, not on the phone yet, and staff
//   pressed again out of worry. The key names the button AND its values, so
//   removing app A then app B straight after still works.
// - The backend refuses the same press within 10 s with
//   MDM.STATE.COMMAND_JUST_SENT; that shows as a grey note (error.isJustSent),
//   never as a red error.
//
// - onAck(intentIds) fires after a queued command so the caller can refresh +
//   highlight those rows in the queue. NEVER interpret ack as completion.
// - cmd.error is the parsed MDM error (translated, by code) or null.
// - cmd.notEnrolled bubbles up ASSET_NOT_ENROLLED so the tab can redirect to
//   sub-tab 1 centrally (§12).
// ============================================================================

import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { parseMdmError, type ParsedMdmError } from './mdmApi';

/** Matches the backend's window (mdm.staff_command_dedupe_config, 10 s). */
export const MDM_SENT_HOLD_MS = 10_000;

export interface UseMdmCommandOpts {
  /** Called with every intent_id produced by a queued command. */
  onAck?: (intentIds: number[]) => void;
  /** Called when the command failed with ASSET_NOT_ENROLLED. */
  onNotEnrolled?: () => void;
}

export interface MdmButtonState {
  /** Disable the button: any command of this hook in flight, or this one just sent. */
  busy: boolean;
  /** Spinner while this button's command is sending or just sent; else undefined. */
  icon?: ReactNode;
  /** "กำลังส่งถึงเครื่อง…" / "ส่งแล้ว กำลังถึงเครื่อง… N"; undefined = the button's own label. */
  label?: string;
}

export interface MdmCommandState {
  pending: boolean;
  error: ParsedMdmError | null;
  /** Last successful ack message ("รับทราบแล้ว …") — cleared on next run. */
  acked: boolean;
  run: <T>(fire: () => Promise<T>, extractIntentIds?: (result: T) => number[], key?: string) => Promise<T | null>;
  /** How a button keyed `key` should look right now. */
  button: (key: string) => MdmButtonState;
  reset: () => void;
}

export function useMdmCommand(opts: UseMdmCommandOpts = {}): MdmCommandState {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ParsedMdmError | null>(null);
  const [acked, setAcked] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // key → when its "just sent" hold ends.
  const [sentUntil, setSentUntil] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  // Tick once a second while any hold is running, so the countdown moves and
  // the button comes back by itself.
  const holding = Object.values(sentUntil).some((until) => until > now);
  useEffect(() => {
    if (!holding) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [holding]);

  const hold = useCallback((key: string) => {
    const at = Date.now();
    setNow(at);
    setSentUntil((m) => ({ ...m, [key]: at + MDM_SENT_HOLD_MS }));
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setAcked(false);
  }, []);

  const run = useCallback(
    async <T,>(fire: () => Promise<T>, extractIntentIds?: (result: T) => number[], key?: string): Promise<T | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setPending(true);
      setPendingKey(key ?? null);
      setError(null);
      setAcked(false);
      try {
        const result = await fire();
        setAcked(true);
        if (key) hold(key);
        const ids = extractIntentIds ? extractIntentIds(result).filter((n) => Number.isFinite(n)) : [];
        opts.onAck?.(ids);
        return result;
      } catch (err) {
        const parsed = parseMdmError(err, t);
        if (parsed.isNotEnrolled) {
          opts.onNotEnrolled?.();
        }
        // The first press is still on its way: hold this button like a success.
        if (parsed.isJustSent && key) hold(key);
        setError(parsed);
        return null;
      } finally {
        inFlight.current = false;
        setPending(false);
        setPendingKey(null);
      }
    },
    // opts.onAck / onNotEnrolled are stable-enough per caller; t is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, hold],
  );

  const button = (key: string): MdmButtonState => {
    const spinner = createElement(Loader2, { size: 14, className: 'animate-spin' });
    if (pending && pendingKey === key) {
      return { busy: true, icon: spinner, label: t('asset.mdm.sending') };
    }
    const left = Math.ceil(((sentUntil[key] ?? 0) - now) / 1000);
    if (left > 0) {
      return { busy: true, icon: spinner, label: t('asset.mdm.sentHold', { n: left }) };
    }
    return { busy: pending };
  };

  return { pending, error, acked, run, button, reset };
}
