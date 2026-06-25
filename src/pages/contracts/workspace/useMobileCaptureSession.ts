import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, ApiError } from '../../../lib/api';

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
  /** Cancel (if active) and reset to idle. Safe to call on any phase. */
  cancel: () => Promise<void>;
}

export function useMobileCaptureSession(
  contractId: number | null,
  contractCode: string | null,
): MobileCaptureSession {
  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<RequestSessionData | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hold the active session id in a ref so the unmount cleanup can cancel it
  // without re-subscribing the effect on every render.
  const sessionIdRef = useRef<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
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
        p_entity_type: 'CONTRACT_ATTACHMENT',
        p_entity_id: contractId,
        p_ttl_minutes: null,
        p_max_uploads: null,
        p_meta: { source: 'contract-wizard-documents' },
        p_note: contractCode ? `Contract ${contractCode}` : null,
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
  }, [contractId, contractCode, phase]);

  // Poll while active.
  useEffect(() => {
    if (phase !== 'active' || !session) return;
    let cancelled = false;
    const poll = () => {
      apiClient
        .rpc<StatusData>('fn_mobile_capture_session_status', { p_session_id: session.session_id })
        .then((data) => {
          if (cancelled) return;
          setStatus(data);
          if (data.status !== 'ACTIVE') {
            stopPolling();
            setPhase('done');
          }
        })
        .catch(() => {
          // Transient poll failure — keep the last known state and retry next tick.
        });
    };
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [phase, session, stopPolling]);

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

  // Cancel a still-active session if the component unmounts (e.g. wizard step change).
  useEffect(() => {
    return () => {
      const id = sessionIdRef.current;
      if (id != null) {
        apiClient
          .rpc('fn_mobile_capture_session_cancel', { p_session_id: id, p_reason: 'USER_CANCEL' })
          .catch(() => {});
      }
    };
  }, []);

  const uploadCount = status?.upload_count ?? 0;

  return { phase, session, status, error, uploadCount, start, cancel };
}
