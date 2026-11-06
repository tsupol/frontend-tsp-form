import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, ApiError } from '../../../lib/api';
import { capturePollInterval } from '../../../lib/capturePoll';

/**
 * Mobile Capture Bridge — Device-A (staff) session controller.
 *
 * Staff requests a capture session for a contract; the backend returns a QR
 * payload (a `capture.czynet.dev/m/:id?t=:token` URL). The staff renders the
 * QR; a phone scans it and uploads photos against the contract album with no
 * login. We only request the session, render the QR, and poll status — the
 * phone-side camera page is owned by the bridge BFF, not this app.
 *
 * Backend (live, mig 66/67):
 *   fn_mobile_capture_request_session(p_entity_type, p_entity_id, p_ttl_minutes?,
 *       p_max_uploads?, p_meta?, p_note?) → session
 *   fn_mobile_capture_session_status(p_session_id) → status + uploads[]
 *   fn_mobile_capture_session_cancel(p_session_id, p_reason?) → { cancelled }
 *
 * See UI_SUMMARY/119_MOBILE_CAPTURE_BRIDGE.md and
 * UI_FEEDBACK/2026-06-24_IMPLEMENT_contract_attachment_first_integration.md.
 */

export type CaptureSessionStatus = 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'CANCELLED';

interface RequestSessionData {
  session_id: number;
  session_token: string;
  qr_payload: string;
  expires_at: string;
  max_uploads: number;
  entity_type: string;
  attachment_mode: string;
  capture_method: string;
}

export interface CaptureUpload {
  upload_order: number;
  media_id: number;
  uploaded_at: string;
  attached_entity_media_id: number | null;
}

interface StatusData {
  session_id: number;
  status: CaptureSessionStatus;
  upload_count: number;
  max_uploads: number;
  remaining_uploads: number;
  expires_at: string;
  uploads: CaptureUpload[];
}

type Phase = 'idle' | 'requesting' | 'active' | 'done' | 'error';

const POLL_INTERVAL_MS = 3000;

export interface MobileCaptureSession {
  phase: Phase;
  session: RequestSessionData | null;
  status: StatusData | null;
  error: string | null;
  uploadCount: number;
  /** Begin a session for the given contract. No-op if one is already in flight. */
  start: () => void;
  /**
   * Stop polling and reset local state to idle WITHOUT cancelling the backend
   * session — the phone may still be mid-upload; the server expires it on TTL.
   * Use this when closing the staff UI but the capture window should live on.
   */
  stop: () => void;
  /** Cancel the backend session (frees quota immediately) and reset to idle. */
  cancel: () => Promise<void>;
}

export interface CaptureSessionOptions {
  /** Bridge entity_type to mint. Defaults to CONTRACT_ATTACHMENT. */
  entityType?: string;
  /** Extra meta merged into the session request. Pass a stable object. */
  meta?: Record<string, unknown>;
  /** Session lifetime in minutes (backend max 1440). null = backend default. */
  ttlMinutes?: number | null;
  /** Photo cap for the session (backend max 50). null = backend default. */
  maxUploads?: number | null;
  /** p_note override. Defaults to "Contract <code>". */
  note?: string | null;
  /**
   * Fast-then-fading polling (`capturePollInterval`), for a session that lives
   * on the page after its window closes. Pass the time the QR window last
   * opened (null before it ever opened). Omit = a fixed 3 s while active —
   * right for a QR that only exists inside an open modal.
   */
  pollSince?: number | null;
  /** What fading polling settles to after 5 min: false = stop, or a ms rate. */
  pollTail?: number | false;
}

export function useMobileCaptureSession(
  contractId: number | null,
  contractCode: string | null,
  options?: CaptureSessionOptions,
): MobileCaptureSession {
  const entityType = options?.entityType ?? 'CONTRACT_ATTACHMENT';
  const extraMeta = options?.meta;
  const ttlMinutes = options?.ttlMinutes ?? null;
  const maxUploads = options?.maxUploads ?? null;
  const note = options?.note;
  const adaptive = options?.pollSince !== undefined;
  const pollSince = options?.pollSince ?? null;
  const pollTail = options?.pollTail ?? false;
  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<RequestSessionData | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hold the active session id in a ref so the unmount cleanup can cancel it
  // without re-subscribing the effect on every render.
  const sessionIdRef = useRef<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const messageOf = (err: unknown): string => {
    if (err instanceof ApiError) return err.code || err.message;
    return err instanceof Error ? err.message : String(err);
  };

  const start = useCallback(() => {
    if (contractId == null) return;
    if (phase === 'requesting' || phase === 'active') return;
    setPhase('requesting');
    setError(null);
    setStatus(null);
    setSession(null);
    apiClient
      .rpc<RequestSessionData>('fn_mobile_capture_request_session', {
        p_entity_type: entityType,
        p_entity_id: contractId,
        p_ttl_minutes: ttlMinutes,
        p_max_uploads: maxUploads,
        p_meta: { source: 'contract-wizard-documents', ...extraMeta },
        p_note: note !== undefined ? note : (contractCode ? `Contract ${contractCode}` : null),
      })
      .then((data) => {
        sessionIdRef.current = data.session_id;
        setSession(data);
        setPhase('active');
      })
      .catch((err) => {
        setError(messageOf(err));
        setPhase('error');
      });
  }, [contractId, contractCode, phase, entityType, extraMeta, ttlMinutes, maxUploads, note]);

  // Poll while active. Each tick schedules the next one, so a fading rate is
  // re-read as time passes. Nothing runs while the browser tab is hidden; on
  // return it checks at once and carries on (even after fading has stopped).
  useEffect(() => {
    if (phase !== 'active' || !session) return;
    let cancelled = false;
    const nextDelay = (): number | false =>
      adaptive ? capturePollInterval(pollSince, pollTail) : POLL_INTERVAL_MS;
    const schedule = () => {
      if (cancelled || document.hidden) return;
      const delay = nextDelay();
      if (delay === false) return;
      pollRef.current = setTimeout(tick, delay);
    };
    const tick = () => {
      pollRef.current = null;
      apiClient
        .rpc<StatusData>('fn_mobile_capture_session_status', { p_session_id: session.session_id })
        .then((data) => {
          if (cancelled) return;
          setStatus(data);
          if (data.status !== 'ACTIVE') {
            setPhase('done');
            return;
          }
          schedule();
        })
        .catch(() => {
          // Transient poll failure — keep the last known state and retry next tick.
          schedule();
        });
    };
    const onVisibility = () => {
      stopPolling();
      if (!document.hidden) tick();
    };
    tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [phase, session, stopPolling, adaptive, pollSince, pollTail]);

  // Local-only teardown: forget the session client-side, leave it running on
  // the backend (TTL-expired). Does NOT clear sessionIdRef so a later cancel()
  // could still target it if ever needed.
  const stop = useCallback(() => {
    stopPolling();
    setPhase('idle');
    setSession(null);
    setStatus(null);
    setError(null);
  }, [stopPolling]);

  const cancel = useCallback(async () => {
    stopPolling();
    const id = sessionIdRef.current;
    sessionIdRef.current = null;
    setPhase('idle');
    setSession(null);
    setStatus(null);
    setError(null);
    if (id != null) {
      // Free the quota immediately so a stale QR can't keep uploading.
      try {
        await apiClient.rpc('fn_mobile_capture_session_cancel', {
          p_session_id: id,
          p_reason: 'USER_CANCEL',
        });
      } catch {
        // Best-effort — server may already have expired/cancelled it.
      }
    }
  }, [stopPolling]);

  // Note: intentionally NO unmount-cancel. The capture session must outlive the
  // staff modal / wizard step — the phone may still be uploading and the backend
  // expires the session on TTL. Only an explicit cancel() tears it down server-side.

  const uploadCount = status?.upload_count ?? 0;

  return { phase, session, status, error, uploadCount, start, stop, cancel };
}
