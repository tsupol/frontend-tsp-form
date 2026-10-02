// Repo job: "Lock device + locate" — DELIVERY 2026-10-01 §3.
//
// The section shows the device & app panel (§1), polled every 15 s while a
// lock command or a location loop is under way (§3.2), and the three actions
// from the evaluator:
//   REPO_LOCATE_START   → confirm, then ops_repo_locate_start (Lost Mode + loop)
//   REPO_LOCATE_STOP    → confirm, then ops_repo_locate_stop
//   REPO_LOCATION_TRAIL → the last 3 fixes, inline. Each call is logged as a look
//                         at the customer's location, so it runs when the user
//                         presses the button and again only when the device
//                         reports a NEWER fix — never on a timer.
// A button the evaluator marks unavailable stays visible, disabled, with the
// reason: not picked up yet, or the device has no MDM.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Tooltip } from 'tsp-form';
import { Lock, LockOpen, MapPin, ExternalLink, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { DateTime } from '../../components/DateTime';
import { PhoneInput } from '../../components/PhoneInput';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import {
  DeviceSignalsPanel, useDeviceSignals, deviceSignalsKey, type ContractDeviceSignals,
} from '../../components/DeviceSignalsPanel';
import {
  repoLocateStart, repoLocateStop, repoLocationTrail,
  type RepoAction, type RepoLocateStartResult, type RepoLocateStopResult, type RepoLocationTrail,
} from './repoApi';

type LocateMode = 'start' | 'stop';

/** Why a locate action can't be pressed — derived from the facts the screen
 *  already holds, in the order the backend checks them. */
function blockedReason(
  a: RepoAction, inPool: boolean, onFocus: boolean, s: ContractDeviceSignals | null | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): string | null {
  if (a.is_available) return null;
  if (!inPool) return t('repo.action.onlyWhileInPool');
  if (!onFocus) return t('repo.locate.pickUpFirst');
  if (a.action_code !== 'REPO_LOCATION_TRAIL' && s && !s.mdm_enrolled) return t('repo.locate.noMdm');
  return t('repo.action.notAvailableNow');
}

export function RepoLocateSection({
  contractId, contractCode, actions, inPool, onFocus,
}: {
  contractId: number;
  contractCode: string;
  actions: RepoAction[];
  inPool: boolean;
  onFocus: boolean;
}) {
  const { t } = useTranslation();
  const { data: signals } = useDeviceSignals(contractId, { poll: true });
  const [mode, setMode] = useState<LocateMode | null>(null);
  const lastMode = useRef<LocateMode>('start');
  if (mode) lastMode.current = mode;

  // Location trail — loaded on press, then followed while the section is open.
  const [trail, setTrail] = useState<RepoLocationTrail | null>(null);
  const [trailOpen, setTrailOpen] = useState(false);
  const [trailLoading, setTrailLoading] = useState(false);
  const [trailError, setTrailError] = useState<string | null>(null);
  const trailForFix = useRef<string | null>(null);

  const loadTrail = async () => {
    setTrailLoading(true);
    setTrailError(null);
    try {
      trailForFix.current = signals?.mdm_last_location_at ?? null;
      setTrail(await repoLocationTrail(contractId));
      setTrailOpen(true);
    } catch (err) {
      setTrailError(locateErrorText(err, t));
    } finally {
      setTrailLoading(false);
    }
  };

  // A newer fix arrived while the list is open → read it once.
  const lastFix = signals?.mdm_last_location_at ?? null;
  useEffect(() => {
    if (!trailOpen || trailLoading || !lastFix) return;
    if (trailForFix.current && lastFix <= trailForFix.current) return;
    void loadTrail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastFix, trailOpen]);

  // Reset when switching to another job.
  useEffect(() => { setTrail(null); setTrailOpen(false); setTrailError(null); trailForFix.current = null; }, [contractId]);

  const find = (code: string) => actions.find((a) => a.action_code === code && a.is_permitted) ?? null;
  const startA = find('REPO_LOCATE_START');
  const stopA = find('REPO_LOCATE_STOP');
  const trailA = find('REPO_LOCATION_TRAIL');

  // A user with none of the three still gets the facts panel.
  const lostOn = !!signals?.mdm_lost_mode_on;
  const lostPending = !!signals?.mdm_lost_mode_pending;

  // "Device didn't answer": we saw our lock command waiting, and it stopped
  // waiting without the lock coming on.
  const [sawPending, setSawPending] = useState(false);
  useEffect(() => { if (lostPending) setSawPending(true); }, [lostPending]);
  useEffect(() => { if (lostOn) setSawPending(false); }, [lostOn]);
  useEffect(() => { setSawPending(false); }, [contractId]);
  const noAnswer = sawPending && !lostPending && !lostOn && signals != null;

  const actionButton = (
    a: RepoAction, label: string, icon: React.ReactNode, onClick: () => void,
    filled = false, busy = false,
  ) => {
    const reason = blockedReason(a, inPool, onFocus, signals, t);
    return (
      <Tooltip content={reason ?? label} placement="top">
        <Button
          variant={filled ? 'solid' : 'outline'}
          color={filled ? 'danger' : 'default'}
          size="sm"
          startIcon={busy ? <Loader2 size={14} className="animate-spin" /> : icon}
          disabled={!!reason || busy}
          onClick={onClick}
          data-action={a.action_code}
          data-blocked-reason={reason ?? undefined}
        >
          {label}
        </Button>
      </Tooltip>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <DeviceSignalsPanel contractId={contractId} signals={signals ?? null} />

      {/* A lock command waits up to an hour for the device; if it lapses the
          panel's "waiting" line disappears with the lock still off (§3.2). */}
      {noAnswer && (
        <div className="text-xs text-warning-fg flex items-center gap-1">
          <AlertTriangle size={12} />{t('repo.locate.noAnswer')}
        </div>
      )}

      {(startA || stopA || trailA) && (
        <div className="flex flex-wrap gap-2">
          {startA && actionButton(
            startA,
            lostOn ? t('repo.locate.startAgain') : t('repo.locate.start'),
            <Lock size={14} />,
            () => { setSawPending(false); setMode('start'); },
            !lostOn,
          )}
          {stopA && (lostOn || lostPending) && actionButton(stopA, t('repo.locate.stop'), <LockOpen size={14} />, () => setMode('stop'))}
          {trailA && actionButton(
            trailA,
            trailOpen ? t('repo.locate.trailRefresh') : t('repo.locate.trail'),
            trailOpen ? <RefreshCw size={14} /> : <MapPin size={14} />,
            () => void loadTrail(),
            false,
            trailLoading,
          )}
        </div>
      )}

      {trailError && <div className="alert alert-danger"><AlertTriangle size={16} /><span>{trailError}</span></div>}
      {trailOpen && trail && <TrailList trail={trail} />}

      <RepoLocateModal
        open={mode !== null}
        mode={mode ?? lastMode.current}
        contractId={contractId}
        contractCode={contractCode}
        onClose={() => setMode(null)}
      />
    </div>
  );
}

function TrailList({ trail }: { trail: RepoLocationTrail }) {
  const { t } = useTranslation();
  if (trail.count === 0) {
    return <div className="text-xs text-subtle">{t('repo.locate.trailEmpty')}</div>;
  }
  return (
    <div className="border border-line rounded-md divide-y divide-line">
      {trail.fixes.map((f, i) => {
        const old = f.staleness_band !== 'FRESH';
        return (
          <div key={f.location_id} className={`px-3 py-2 flex items-center gap-3 text-sm ${old ? 'text-subtle' : ''}`}>
            <MapPin size={14} className={`shrink-0 ${i === 0 && !old ? 'text-danger-fg' : 'text-subtler'}`} />
            <div className="min-w-0 flex-1">
              <DateTime value={f.reported_at} />
              <div className="text-xs text-subtle">
                {f.accuracy_m != null ? t('repo.locate.accuracy', { m: Math.round(f.accuracy_m) }) : '—'}
                {' · '}
                {t(`repo.locate.band.${f.staleness_band}`, { defaultValue: f.staleness_band })}
              </div>
            </div>
            <a
              href={`https://www.google.com/maps?q=${f.lat},${f.lon}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1 shrink-0"
            >
              {t('repo.locate.openMap')}<ExternalLink size={12} />
            </a>
          </div>
        );
      })}
    </div>
  );
}

// The backend's catalog messages for these codes are written for other screens
// (NOT_ON_FOCUS talks about the iCloud password), so this screen words them
// for what the user just pressed.
function locateErrorText(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'OPS.STATE.NOT_ON_FOCUS': return t('repo.locate.pickUpFirst');
      case 'OPS.STATE.NOT_IN_REPO_POOL': return t('repo.locate.notInPool');
      case 'MDM.STATE.ASSET_NOT_ENROLLED': return t('repo.locate.noMdmCannotSend');
    }
  }
  return translateApiError(err, t);
}

function RepoLocateModal({ open, mode, contractId, contractCode, onClose }: {
  open: boolean;
  mode: LocateMode;
  contractId: number;
  contractCode: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only asked for when the branch and the company have no phone on file.
  const [needPhone, setNeedPhone] = useState(false);
  const [phone, setPhone] = useState('');
  const [startResult, setStartResult] = useState<RepoLocateStartResult | null>(null);
  const [stopResult, setStopResult] = useState<RepoLocateStopResult | null>(null);

  useEffect(() => {
    if (open) {
      setView('form'); setSaving(false); setError(null); setNeedPhone(false); setPhone('');
      setStartResult(null); setStopResult(null);
    }
  }, [open]);

  const handleClose = () => { if (!saving) onClose(); };
  const isStart = mode === 'start';

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (isStart) setStartResult(await repoLocateStart(contractId, needPhone ? phone : null));
      else setStopResult(await repoLocateStop(contractId));
      setView('done');
      // The panel's polling picks the progress up from here.
      queryClient.invalidateQueries({ queryKey: deviceSignalsKey(contractId) });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MDM.VALIDATION.LOST_MODE_PHONE_REQUIRED') {
        setNeedPhone(true);
        setError(t('repo.locate.phoneRequired'));
      } else {
        setError(locateErrorText(err, t));
      }
    } finally {
      setSaving(false);
    }
  };

  const doneRows = startResult
    ? [
      { label: t('repo.locate.lostModeLabel'), value: t(`repo.locate.outcome.lost.${startResult.lost_mode}`, { defaultValue: startResult.lost_mode }) },
      { label: t('repo.locate.loopLabel'), value: t(`repo.locate.outcome.loop.${startResult.loop}`, { defaultValue: startResult.loop }) },
    ]
    : stopResult
      ? [{ label: t('repo.locate.lostModeLabel'), value: t(`repo.locate.outcome.lost.${stopResult.lost_mode}`, { defaultValue: stopResult.lost_mode }) }]
      : [];

  return (
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title inline-flex items-center gap-2">
          {isStart ? <Lock size={16} /> : <LockOpen size={16} />}
          {isStart ? t('repo.locate.start') : t('repo.locate.stop')}
        </h2>
        <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
      </div>

      {view === 'done' ? (
        <ActionDoneView
          headline={isStart ? t('repo.locate.startSent') : t('repo.locate.stopSent')}
          contractCode={contractCode}
          detailRows={doneRows}
          extras={<div className="text-xs text-subtle">{t('repo.locate.followOnPanel')}</div>}
          onClose={onClose}
        />
      ) : (
        <>
          <div className="modal-content min-w-0">
            <div className="flex flex-col gap-3">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{contractCode}</div>
              </div>
              {isStart ? (
                <>
                  <div className="alert alert-warning">
                    <AlertTriangle size={16} />
                    <span>{t('repo.locate.confirmStart', { code: contractCode })}</span>
                  </div>
                  <div className="text-xs text-subtle">{t('repo.locate.startExplain')}</div>
                  {needPhone && (
                    <div className="flex flex-col">
                      <label className="form-label">{t('repo.locate.fallbackPhone')} *</label>
                      <PhoneInput value={phone} onChange={(raw) => setPhone(raw)} className="w-full" />
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm">{t('repo.locate.confirmStop')}</div>
              )}
            </div>
          </div>
          <ModalErrorBand message={error} onDismiss={() => setError(null)} />
          <div className="modal-footer">
            <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
            <Button
              color={isStart ? 'danger' : 'primary'}
              onClick={submit}
              disabled={saving || (needPhone && phone.length < 9)}
              startIcon={saving ? <Loader2 size={16} className="animate-spin" /> : isStart ? <Lock size={16} /> : <LockOpen size={16} />}
            >
              {isStart ? t('repo.locate.confirmStartButton') : t('repo.locate.confirmStopButton')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
