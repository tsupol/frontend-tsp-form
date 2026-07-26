// ============================================================================
// useMdmCommand — the shared async-command contract (131 §0.3, §2).
//
// Every MDM action button goes: idle → confirm (caller's dialog) → fire →
// "acknowledged" (queued, NOT done) → the returned intent_id(s) get handed to
// the queue for tracking. This hook owns the fire/ack/error half so each
// sub-tab doesn't re-implement it (and can't accidentally say "success").
//
//   const cmd = useMdmCommand({ onAck });
//   cmd.run(() => enforceDunning({ p_asset_id }), r => [r.wallpaper_intent_id, r.lock_intent_id]);
//
// - cmd.pending disables the button (guards double-fire, §0.2).
// - onAck(intentIds) fires after a queued command so the caller can refresh +
//   highlight those rows in the queue. NEVER interpret ack as completion.
// - cmd.error is the parsed MDM error (translated, by code) or null.
// - cmd.notEnrolled bubbles up ASSET_NOT_ENROLLED so the tab can redirect to
//   sub-tab 1 centrally (§12).
// ============================================================================

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseMdmError, type ParsedMdmError } from './mdmApi';

export interface UseMdmCommandOpts {
  /** Called with every intent_id produced by a queued command. */
  onAck?: (intentIds: number[]) => void;
  /** Called when the command failed with ASSET_NOT_ENROLLED. */
  onNotEnrolled?: () => void;
}

export interface MdmCommandState {
  pending: boolean;
  error: ParsedMdmError | null;
  /** Last successful ack message ("รับทราบแล้ว …") — cleared on next run. */
  acked: boolean;
  run: <T>(fire: () => Promise<T>, extractIntentIds?: (result: T) => number[]) => Promise<T | null>;
  reset: () => void;
}

export function useMdmCommand(opts: UseMdmCommandOpts = {}): MdmCommandState {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ParsedMdmError | null>(null);
  const [acked, setAcked] = useState(false);

  const reset = useCallback(() => {
    setError(null);
    setAcked(false);
  }, []);

  const run = useCallback(
    async <T,>(fire: () => Promise<T>, extractIntentIds?: (result: T) => number[]): Promise<T | null> => {
      setPending(true);
      setError(null);
      setAcked(false);
      try {
        const result = await fire();
        setAcked(true);
        const ids = extractIntentIds ? extractIntentIds(result).filter((n) => Number.isFinite(n)) : [];
        opts.onAck?.(ids);
        return result;
      } catch (err) {
        const parsed = parseMdmError(err, t);
        if (parsed.isNotEnrolled) {
          opts.onNotEnrolled?.();
        }
        setError(parsed);
        return null;
      } finally {
        setPending(false);
      }
    },
    // opts.onAck / onNotEnrolled are stable-enough per caller; t is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  return { pending, error, acked, run, reset };
}
