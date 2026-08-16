// ============================================================================
// "นำเครื่องเข้าระบบจากนอกสาขา" — branch A's half of the delegation feature.
// IMPLEMENT 2026-08-15_mdm_remote_enroll_delegation.md §1
//
// A customer of branch A collects the handset at branch B. B may have no NNF
// login at all (often another financier's staff). A issues a 3-hour, single-
// device link; B opens it and walks the device through the enroll ritual on the
// public page, while A watches the same state on tab-1.
//
// Three things this file is careful about:
//
//  1. VISIBILITY IS `may_enroll_delegate`, NEVER role_code. The eligible role
//     set is DB config that changes with no FE release; the flag follows on the
//     next poll. false hides the strip entirely rather than letting a press 403.
//     It is deliberately NOT tied to can_prepare — issuing a link ahead of time,
//     for B to press later, is the normal case.
//
//  2. THE STATUS BLOCK RENDERS FROM THE VIEW, not from an RPC. The enroll_link_*
//     columns ride the same row tab-1 already polls, so a live link shows from
//     page load with no extra call — and, crucially, without revealing a token.
//
//  3. REVEAL IS ONLY EVER AN EXPLICIT PRESS. Every reveal is logged as a
//     REVEALED audit event, so calling it on mount or in an effect would forge
//     an access trail. The view has no token column precisely to make that
//     mistake impossible.
// ============================================================================

import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Badge } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import {
  Share2, Link2, Copy, Check, EyeOff, Ban, RefreshCw, AlertTriangle, Clock, Eye,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { RelativeDateTime } from './RelativeDateTime';
import { ModalErrorBand } from '../../../components/ModalErrorBand';
import { MdmChallengeDialog } from './MdmChallengeDialog';
import {
  enrollLinkPreview, enrollLinkCreate, enrollLinkReveal, enrollLinkRevoke,
  isAlreadyActive, parseMdmError,
  type AssetMdmStatus, type MdmChallenge,
} from './mdmApi';
import { useTicker, secondsUntil, splitDuration } from './shared/useTicker';

// On the dev box the app is served from localhost, and a QR pointing at
// localhost is unscannable — the phone reading it resolves that to ITSELF. So
// in local dev only, swap the loopback host for the machine's LAN address.
// Production is untouched: it uses its own origin, which is already reachable.
const DEV_LAN_HOST = '192.168.1.54';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** The public page that consumes the token. Same origin — we own both halves. */
function enrollUrl(token: string): string {
  const url = new URL('/mdm-enroll', window.location.origin);
  if (LOOPBACK_HOSTS.has(url.hostname)) url.hostname = DEV_LAN_HOST;
  url.searchParams.set('token', token);
  return url.toString();
}

/** Live "expires in 2h 14m". 30s resolution is plenty for a 3-hour window. */
function ExpiryCountdown({ expiresAt }: { expiresAt: string | null }) {
  const { t } = useTranslation();
  useTicker(!!expiresAt, 30_000);
  const left = secondsUntil(expiresAt);
  if (left == null) return null;
  const { h, m } = splitDuration(left);
  return (
    <span className={`tabular-nums ${left < 15 * 60 ? 'text-warning-fg' : ''}`}>
      {h > 0 ? t('enrollLink.expiresInHm', { h, m }) : t('enrollLink.expiresInM', { m })}
    </span>
  );
}

/** The token, once we legitimately hold one: QR to scan, URL to send. */
function LinkReveal({ token, onClose }: { token: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  // The parent nulls `token` in the same handler that closes, so rendering
  // straight from the prop would blank the QR and the URL WHILE the panel is
  // still animating out — the modal appears to collapse rather than fade. Hold
  // the last value through the close transition.
  const lastToken = useRef<string | null>(null);
  if (token) lastToken.current = token;
  const shown = token ?? lastToken.current;
  const url = shown ? enrollUrl(shown) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal open={!!token} onClose={onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('enrollLink.reveal.title')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="modal-content min-w-0">
        <div className="flex flex-col items-center gap-3">
          {/* White plate behind the QR: scanners need the light quiet zone, and
              in dark theme a bare SVG sits on a dark surface and won't read. */}
          {shown && (
            <div className="bg-white p-3 rounded-md">
              <QRCodeSVG value={url} size={200} />
            </div>
          )}
          <p className="text-xs text-subtle text-center">{t('enrollLink.reveal.scanHint')}</p>
          <div className="w-full min-w-0 px-3 py-2 rounded-md bg-surface border border-line">
            <div className="text-xs break-all font-mono select-all">{url}</div>
          </div>
          <Button
            variant="outline"
            className="w-full"
            startIcon={copied ? <Check size={15} /> : <Copy size={15} />}
            onClick={copy}
          >
            {copied ? t('enrollLink.reveal.copied') : t('enrollLink.reveal.copy')}
          </Button>
          <div className="alert alert-warning">
            <EyeOff size={16} className="shrink-0" />
            <span>{t('enrollLink.reveal.privacyNote')}</span>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}

export function EnrollDelegationPanel({
  status, onRefresh,
}: {
  status: AssetMdmStatus;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const actorId = user?.user_id ?? null;

  const [challenge, setChallenge] = useState<MdmChallenge | null>(null);
  const [replaceMode, setReplaceMode] = useState(false);
  const [inAbmNow, setInAbmNow] = useState(true);
  const [issuedTo, setIssuedTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');

  // §1 — the flag hides the whole strip. Not a disabled button: a delegate-less
  // role should not be shown a door it cannot open.
  if (!status.may_enroll_delegate) return null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['asset-mdm-status', status.asset_id] });
    onRefresh();
  };

  const openDialog = async (replace: boolean) => {
    if (actorId == null) return;
    setPanelError(null);
    setDialogError(null);
    setIssuedTo('');
    setReplaceMode(replace);
    setBusy(true);
    try {
      const res = await enrollLinkPreview(status.asset_id, actorId, replace);
      // The race-guard branch: someone issued a link while this page was stale.
      // Not an error — close up and let the status block (which the refresh
      // repaints) show the live link.
      if (isAlreadyActive(res)) {
        refresh();
        return;
      }
      setInAbmNow(res.in_abm_now);
      setChallenge(res.challenge);
    } catch (err) {
      setPanelError(parseMdmError(err, t).message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async (confirmCode: string) => {
    if (actorId == null || !challenge) return;
    setBusy(true);
    setDialogError(null);
    try {
      const res = await enrollLinkCreate({
        assetId: status.asset_id,
        actorId,
        challengeId: challenge.challenge_id,
        confirmCode,
        issuedTo: issuedTo.trim(),
        // ⚠️ Must ride BOTH preview and commit. A commit that drops it does not
        // error — it falls through to the already-active branch and returns the
        // OLD link (BE will not silently kill a QR branch B is holding).
        replace: replaceMode,
      });
      setChallenge(null);
      if (isAlreadyActive(res)) {
        // Only reachable if the flag went missing; surface it rather than
        // leaving the operator thinking they issued a fresh link.
        setPanelError(t('enrollLink.error.replaceFlagLost'));
        refresh();
        return;
      }
      setRevealToken(res.token);
      refresh();
    } catch (err) {
      setDialogError(parseMdmError(err, t).message);
    } finally {
      setBusy(false);
    }
  };

  const doReveal = async () => {
    if (actorId == null) return;
    setPanelError(null);
    setBusy(true);
    try {
      const res = await enrollLinkReveal(status.asset_id, actorId);
      setRevealToken(res.token);
    } catch (err) {
      setPanelError(parseMdmError(err, t).message);
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async () => {
    if (actorId == null) return;
    setBusy(true);
    setPanelError(null);
    try {
      await enrollLinkRevoke(status.asset_id, actorId, revokeReason.trim() || undefined);
      setConfirmRevoke(false);
      setRevokeReason('');
      refresh();
    } catch (err) {
      setPanelError(parseMdmError(err, t).message);
    } finally {
      setBusy(false);
    }
  };

  const active = status.enroll_link_active;

  return (
    <div className="border border-line rounded-md p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Share2 size={16} className="text-subtle" />
        <h3 className="text-sm font-semibold">{t('enrollLink.title')}</h3>
        {active && <Badge color="success">{t('enrollLink.activeBadge')}</Badge>}
      </div>

      {panelError && (
        <div className="alert alert-danger">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="min-w-0">{panelError}</span>
        </div>
      )}

      {active ? (
        <>
          {/* Rendered entirely from the view row — no RPC, no token. */}
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-subtle">{t('enrollLink.issuedTo')}</span>
              <span className="font-medium min-w-0 break-words">{status.enroll_link_issued_to}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs text-subtle">
              <Clock size={12} className="shrink-0" />
              <ExpiryCountdown expiresAt={status.enroll_link_expires_at} />
            </div>
            <div className="text-xs text-subtle">
              {status.enroll_link_last_seen_at ? (
                <>
                  {t('enrollLink.lastSeen')}{' '}
                  <RelativeDateTime value={status.enroll_link_last_seen_at} relClassName="" />
                </>
              ) : (
                t('enrollLink.neverOpened')
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" startIcon={<Eye size={14} />} onClick={doReveal} disabled={busy}>
              {t('enrollLink.showLink')}
            </Button>
            <Button variant="outline" size="sm" startIcon={<RefreshCw size={14} />} onClick={() => openDialog(true)} disabled={busy}>
              {t('enrollLink.reissue')}
            </Button>
            <Button variant="outline" size="sm" startIcon={<Ban size={14} className="text-danger-fg" />} onClick={() => setConfirmRevoke(true)} disabled={busy}>
              {t('enrollLink.revoke')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-subtle">{t('enrollLink.desc')}</p>
          <div>
            <Button
              variant="outline"
              size="sm"
              startIcon={<Link2 size={15} />}
              onClick={() => openDialog(false)}
              disabled={busy}
            >
              {t('enrollLink.issueButton')}
            </Button>
          </div>
        </>
      )}

      {/* Issue / re-issue ritual. Same 5s + 4-digit gate as erase and remove-app,
          plus the mandatory note, filled in during the countdown. */}
      <MdmChallengeDialog
        challenge={challenge}
        serial={status.serial_number ?? ''}
        title={replaceMode ? t('enrollLink.dialog.replaceTitle') : t('enrollLink.dialog.title')}
        body={replaceMode ? t('enrollLink.dialog.replaceBody') : t('enrollLink.dialog.body')}
        tone="warning"
        note={replaceMode ? t('enrollLink.dialog.replaceNote') : null}
        confirmLabel={t('enrollLink.dialog.confirm')}
        busy={busy}
        error={dialogError}
        onDismissError={() => setDialogError(null)}
        onConfirm={commit}
        onClose={() => { setChallenge(null); setDialogError(null); }}
        extraInvalid={!issuedTo.trim()}
        extraFields={
          <div className="flex flex-col gap-2">
            {/* in_abm_now false = the link dead-ends at B, who cannot scan a
                device into ABM. Say so before the link is even created. */}
            {!inAbmNow && (
              <div className="alert alert-warning">
                <AlertTriangle size={16} className="shrink-0" />
                <div className="min-w-0">
                  <div className="alert-title">{t('enrollLink.dialog.notInAbmTitle')}</div>
                  <div className="alert-description">{t('enrollLink.dialog.notInAbmBody')}</div>
                </div>
              </div>
            )}
            <div className="flex flex-col">
              <label className="form-label" htmlFor="enroll-issued-to">
                {t('enrollLink.dialog.issuedToLabel')}
              </label>
              <Input
                id="enroll-issued-to"
                value={issuedTo}
                onChange={(e) => setIssuedTo(e.target.value)}
                placeholder={t('enrollLink.dialog.issuedToPlaceholder')}
                className="w-full"
                maxLength={120}
              />
              <p className="text-xs text-subtle mt-1">{t('enrollLink.dialog.issuedToHint')}</p>
            </div>
          </div>
        }
      />

      <LinkReveal token={revealToken} onClose={() => setRevealToken(null)} />

      {/* Revoke confirm. Always mounted — the Modal rule. */}
      <Modal open={confirmRevoke} onClose={() => !busy && setConfirmRevoke(false)} maxWidth="24rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('enrollLink.revokeDialog.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={() => !busy && setConfirmRevoke(false)}>&times;</button>
        </div>
        <div className="modal-content">
          <p className="text-sm text-subtle">{t('enrollLink.revokeDialog.body')}</p>
          <div className="flex flex-col mt-3">
            <label className="form-label" htmlFor="enroll-revoke-reason">
              {t('enrollLink.revokeDialog.reasonLabel')}
            </label>
            <Input
              id="enroll-revoke-reason"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder={t('enrollLink.revokeDialog.reasonPlaceholder')}
              className="w-full"
              maxLength={200}
            />
          </div>
        </div>
        <ModalErrorBand message={panelError} onDismiss={() => setPanelError(null)} />
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmRevoke(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button color="danger" onClick={doRevoke} disabled={busy}>
            {t('enrollLink.revokeDialog.confirm')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
