// ============================================================================
// Sub-tab 6 — โหมดสูญหาย & ตำแหน่ง (131 §8). Three clusters:
//   Lost Mode: enable (template one-click — recommended — OR free-type;
//              message + phone both required when free-typing) / disable / sound
//   Location:  request once (only meaningful while lost mode is ON) + read latest
//   Loop:      continuous location loop (§8.1) — start/stop, live status polled
//              by next_poll_at (§8.2), guarded against double-fire by
//              pending_intent_count
//
// Gotchas honoured:
//   - message + phone required for free-type enable (§8).
//   - request-location gated on is_mdm_lost_mode_enabled — Apple only reports
//     location in Lost Mode (§8).
//   - read_locations uses enrollment_id; may return null (never reported), which
//     is not an error. Staleness first — a stale fix that reads fresh is the trap.
//   - after an action, poll with backoff (3·5·8·13·20·30s, ~2min ceiling, §8.3)
//     for the value that action changes; then "device hasn't answered", never
//     "error".
//   - loop status lives in the DB (§8.1) so it survives tab switches; poll it by
//     next_poll_at, not a fixed interval (§8.2).
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, TextArea, Select } from 'tsp-form';
import {
  MapPin, Bell, BellOff, Volume2, LocateFixed, ExternalLink, AlertTriangle,
  Repeat, Square, Loader2,
} from 'lucide-react';
import { DateTime } from '../../../components/DateTime';
import { RelativeDateTime } from './RelativeDateTime';
import { useAuth } from '../../../contexts/AuthContext';
import {
  enableLostMode, enableLostModeFromTemplate, disableLostMode, playLostModeSound,
  requestLocation, readLocations, signalLocationLoop, stopLocationLoop,
  fetchDeviceOverview, fetchActiveLoop, fetchLockTemplates, parseMdmError,
  type AssetMdmStatus, type MdmLocation, type MdmActiveLoop, type ParsedMdmError,
} from './mdmApi';
import { useMdmCommand } from './useMdmCommand';
import { MDM_NO_CACHE } from './useMdmStatus';
import { MdmErrorAlert, CommandAckNote } from './MdmSharedBits';

const LOOP_WINDOW_SEC = 3600; // 60 min, matching ops (§8.4).

export function SubTabLostMode({
  status,
  canLostMode,
  canLocation,
  onAck,
  onNotEnrolled,
}: {
  status: AssetMdmStatus;
  canLostMode: boolean;
  canLocation: boolean;
  onAck: (intentIds: number[]) => void;
  onNotEnrolled: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const actorId = user?.user_id ?? null;
  const cmd = useMdmCommand({ onAck, onNotEnrolled });

  const [mode, setMode] = useState<'template' | 'custom'>('template');
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');

  const { data: overview, refetch: refetchOverview } = useQuery({
    queryKey: ['mdm-device-overview', status.asset_id],
    queryFn: () => fetchDeviceOverview(status.asset_id),
    ...MDM_NO_CACHE,
  });
  const lostOn = overview?.is_mdm_lost_mode_enabled === true;

  const { data: templates = [] } = useQuery({
    queryKey: ['mdm-lock-templates', i18n.language],
    queryFn: () => fetchLockTemplates(i18n.language === 'th' ? 'th' : 'en'),
  });

  // Active location loop (§8.1) — polled by next_poll_at (§8.2).
  const { data: loop, refetch: refetchLoop } = useQuery({
    queryKey: ['mdm-active-loop', status.asset_id],
    queryFn: () => fetchActiveLoop(status.asset_id),
    ...MDM_NO_CACHE,
  });
  useNextPollAt(loop?.next_poll_at ?? null, refetchLoop);

  // Post-action backoff (§8.3): after firing, poll the relevant view until the
  // awaited value flips, then stop.
  const lostBackoff = useBackoffPoll(refetchOverview);
  const loopBackoff = useBackoffPoll(refetchLoop);

  // Latest location — fetched on demand (button), PDPA-logged read.
  const [loc, setLoc] = useState<MdmLocation | null>(null);
  const [locFetched, setLocFetched] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<ParsedMdmError | null>(null);

  const readLatest = async () => {
    if (status.enrollment_id == null) return;
    setLocLoading(true); setLocError(null);
    try {
      const r = await readLocations(status.enrollment_id);
      setLoc(r);
      setLocFetched(true);
    } catch (err) {
      setLocError(parseMdmError(err, t));
    } finally {
      setLocLoading(false);
    }
  };

  const run = (fire: () => Promise<{ intent_id: number }>, after?: () => void) =>
    cmd.run(fire, (r) => [r.intent_id]).then((res) => { if (res) after?.(); return res; });

  // Enable eligibility.
  const canEnableTemplate = !cmd.pending && actorId != null && !!templateKey && phone.trim().length > 0;
  const canEnableCustom = !cmd.pending && actorId != null && message.trim().length > 0 && phone.trim().length > 0;

  const loopActive = loop != null;
  const loopBusy = (loop?.pending_intent_count ?? 0) > 0 || loopBackoff.active;

  return (
    <div className="flex flex-col gap-4">
      <MdmErrorAlert error={cmd.error} onGoToEnroll={onNotEnrolled} />
      <CommandAckNote show={cmd.acked && !cmd.error} />

      {/* ── Lost Mode ── */}
      {canLostMode && (
        <div className="border border-line rounded-md p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <MapPin size={16} className="text-danger" />
            <span className="text-sm font-semibold">{t('asset.mdm.lost.title')}</span>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border ${lostOn ? 'bg-danger-soft border-danger-border text-danger-fg' : 'bg-surface border-line text-subtle'}`}>
              {lostOn ? t('asset.mdm.lost.on') : t('asset.mdm.lost.off')}
            </span>
          </div>

          {lostBackoff.timedOut && (
            <div className="text-xs text-warning-fg flex items-center gap-1">
              <AlertTriangle size={12} />{t('asset.mdm.lost.noAnswer')}
            </div>
          )}

          {!lostOn ? (
            <>
              <p className="text-xs text-subtle">{t('asset.mdm.lost.enableHint')}</p>

              {/* Template vs custom. Template is the recommended primary (§8.4). */}
              <div className="flex gap-2 text-xs">
                <ModeTab active={mode === 'template'} onClick={() => setMode('template')} label={t('asset.mdm.lost.modeTemplate')} />
                <ModeTab active={mode === 'custom'} onClick={() => setMode('custom')} label={t('asset.mdm.lost.modeCustom')} />
              </div>

              {mode === 'template' ? (
                <>
                  <div className="flex flex-col">
                    <label className="form-label">{t('asset.mdm.lost.template')} *</label>
                    <Select
                      value={templateKey}
                      onChange={(v) => setTemplateKey(v as string)}
                      options={templates.map((tpl) => ({ value: tpl.template_key, label: tpl.message_template }))}
                      placeholder={t('asset.mdm.lost.templatePlaceholder')}
                      size="sm"
                      showChevron
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="form-label">{t('asset.mdm.lost.phone')} *</label>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} size="sm" className="w-full" placeholder={t('asset.mdm.lost.phonePlaceholder')} />
                  </div>
                  <div>
                    <Button color="danger" size="sm" startIcon={<Bell size={15} />} disabled={!canEnableTemplate}
                      onClick={() => actorId != null && templateKey && run(
                        () => enableLostModeFromTemplate({
                          p_asset_id: status.asset_id, p_actor_id: actorId, p_template_key: templateKey,
                          p_phone_number: phone.trim(), p_locale: i18n.language === 'th' ? 'th' : 'en',
                        }),
                        () => lostBackoff.start(),
                      )}>
                      {t('asset.mdm.lost.enable')}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col">
                    <label className="form-label">{t('asset.mdm.lost.message')} *</label>
                    <TextArea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} className="w-full" placeholder={t('asset.mdm.lost.messagePlaceholder')} />
                  </div>
                  <div className="flex flex-col">
                    <label className="form-label">{t('asset.mdm.lost.phone')} *</label>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} size="sm" className="w-full" placeholder={t('asset.mdm.lost.phonePlaceholder')} />
                  </div>
                  <div>
                    <Button color="danger" size="sm" startIcon={<Bell size={15} />} disabled={!canEnableCustom}
                      onClick={() => actorId != null && run(
                        () => enableLostMode({
                          p_asset_id: status.asset_id, p_actor_id: actorId, p_lock_message: message.trim(), p_phone_number: phone.trim(),
                        }),
                        () => lostBackoff.start(),
                      )}>
                      {t('asset.mdm.lost.enable')}
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" startIcon={<BellOff size={15} />} disabled={cmd.pending || actorId == null}
                onClick={() => actorId != null && run(() => disableLostMode(status.asset_id, actorId), () => lostBackoff.start())}>
                {t('asset.mdm.lost.disable')}
              </Button>
              <Button variant="outline" size="sm" startIcon={<Volume2 size={15} />} disabled={cmd.pending || actorId == null}
                onClick={() => actorId != null && run(() => playLostModeSound(status.asset_id, actorId))}>
                {t('asset.mdm.lost.playSound')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Location ── */}
      {canLocation && (
        <div className="border border-line rounded-md p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <LocateFixed size={16} className="text-info-fg" />
            <span className="text-sm font-semibold">{t('asset.mdm.location.title')}</span>
          </div>

          {!lostOn && (
            <div className="text-xs text-warning-fg flex items-center gap-1">
              <AlertTriangle size={12} />{t('asset.mdm.location.needLostMode')}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" startIcon={<MapPin size={15} />}
              disabled={cmd.pending || actorId == null || !lostOn}
              onClick={() => actorId != null && run(() => requestLocation(status.asset_id, actorId))}>
              {t('asset.mdm.location.request')}
            </Button>
            <Button variant="outline" size="sm" startIcon={<LocateFixed size={15} />}
              disabled={locLoading || status.enrollment_id == null}
              onClick={readLatest}>
              {t('asset.mdm.location.readLatest')}
            </Button>
          </div>

          {/* Continuous loop (§8.1). */}
          <div className="border-t border-line pt-3 flex flex-col gap-2">
            {loopActive ? (
              <>
                <LoopStatus loop={loop!} />
                <div>
                  <Button variant="outline" size="sm" startIcon={<Square size={14} />}
                    disabled={cmd.pending || actorId == null || loopBusy}
                    onClick={() => actorId != null && run(() => stopLocationLoop(status.asset_id, actorId), () => loopBackoff.start())}>
                    {t('asset.mdm.location.stopLoop')}
                  </Button>
                </div>
              </>
            ) : (
              <div>
                <Button variant="outline" size="sm" startIcon={<Repeat size={14} />}
                  disabled={cmd.pending || actorId == null || !lostOn || loopBusy}
                  onClick={() => actorId != null && run(() => signalLocationLoop(status.asset_id, actorId, LOOP_WINDOW_SEC), () => loopBackoff.start())}>
                  {t('asset.mdm.location.startLoop')}
                </Button>
                <div className="text-xs text-subtler mt-1">{t('asset.mdm.location.loopHint')}</div>
              </div>
            )}
            {loopBackoff.timedOut && (
              <div className="text-xs text-warning-fg flex items-center gap-1">
                <AlertTriangle size={12} />{t('asset.mdm.lost.noAnswer')}
              </div>
            )}
          </div>

          <MdmErrorAlert error={locError} />

          {locFetched && !loc && !locError && (
            <div className="text-xs text-subtle">{t('asset.mdm.location.none')}</div>
          )}

          {loc && <LocationCard loc={loc} serial={status.serial_number} />}
        </div>
      )}
    </div>
  );
}

function ModeTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md border cursor-pointer ${
        active ? 'bg-primary-soft border-primary-border text-primary-fg font-medium' : 'bg-surface border-line text-subtle'
      }`}
    >
      {label}
    </button>
  );
}

function LoopStatus({ loop }: { loop: MdmActiveLoop }) {
  const { t } = useTranslation();
  const pct = loop.progress != null ? Math.round(loop.progress * 100) : null;
  return (
    <div className="rounded-md border border-info-border bg-info-soft p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-xs text-info-fg font-medium">
        <Loader2 size={13} className="animate-spin" />{t('asset.mdm.location.loopRunning')}
      </div>
      {pct != null && (
        <div className="h-1.5 rounded-full bg-info-border/40 overflow-hidden">
          <div className="h-full bg-info-fg" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="text-xs text-subtle flex flex-wrap gap-x-3 gap-y-0.5">
        {loop.attempts_made != null && loop.max_attempts != null && (
          <span>{t('asset.mdm.location.loopAttempts', { made: loop.attempts_made, max: loop.max_attempts })}</span>
        )}
        {loop.ends_at && <span>{t('asset.mdm.location.loopEnds')} <RelativeDateTime value={loop.ends_at} staleAfterDays={9999} /></span>}
        {loop.last_location_at && <span>{t('asset.mdm.location.loopLast')} <RelativeDateTime value={loop.last_location_at} /></span>}
      </div>
    </div>
  );
}

function LocationCard({ loc, serial }: { loc: MdmLocation; serial: string | null }) {
  const { t } = useTranslation();
  const gmaps = `https://www.google.com/maps?q=${loc.lat},${loc.lon}`;
  const amaps = `https://maps.apple.com/?ll=${loc.lat},${loc.lon}${serial ? `&q=${encodeURIComponent(serial)}` : ''}`;
  return (
    <div className={`rounded-md border p-3 flex flex-col gap-2 ${loc.is_stale ? 'border-warning-border bg-warning-soft' : 'border-line'}`}>
      {/* Staleness first — a stale fix that reads as current is the trap (§8). */}
      <div className={`text-xs flex items-center gap-1 ${loc.is_stale ? 'text-warning-fg' : 'text-subtle'}`}>
        {loc.is_stale && <AlertTriangle size={12} />}
        {loc.is_stale ? t('asset.mdm.location.asOf') : t('asset.mdm.location.current')}{' '}
        <DateTime value={loc.reported_at} showTime />
      </div>
      <div className="text-sm font-mono">
        {loc.lat.toFixed(6)}, {loc.lon.toFixed(6)}
        {loc.accuracy_m != null && <span className="text-subtler"> · ±{Math.round(loc.accuracy_m)}m</span>}
      </div>
      <div className="flex gap-3">
        <a href={gmaps} target="_blank" rel="noreferrer" className="text-xs text-primary-fg underline inline-flex items-center gap-1">
          {t('asset.mdm.location.googleMaps')} <ExternalLink size={11} />
        </a>
        <a href={amaps} target="_blank" rel="noreferrer" className="text-xs text-primary-fg underline inline-flex items-center gap-1">
          {t('asset.mdm.location.appleMaps')} <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

// ── Polling helpers ──────────────────────────────────────────────────────────

/** Schedule ONE refetch shortly after next_poll_at (§8.2) — the system's own
 *  next round — instead of a fixed interval. If it's already past, wait 15s. */
function useNextPollAt(nextPollAt: string | null, refetch: () => void) {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    if (!nextPollAt) return;
    const due = new Date(nextPollAt).getTime() + 5000;
    const delay = Number.isFinite(due) ? Math.max(due - Date.now(), 15000) : 15000;
    const id = setTimeout(() => refetchRef.current(), delay);
    return () => clearTimeout(id);
  }, [nextPollAt]);
}

const BACKOFF_STEPS = [3000, 5000, 8000, 13000, 20000, 30000]; // §8.3

/** After an action, refetch on a widening backoff for ~2 min, then give up with
 *  a "device hasn't answered" flag (§8.3) — never surfaced as an error. `step`
 *  is state so each tick re-schedules the next (wider) delay. */
function useBackoffPoll(refetch: () => void) {
  const [step, setStep] = useState(-1); // -1 = idle
  const [timedOut, setTimedOut] = useState(false);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const start = () => { setTimedOut(false); setStep(0); };

  useEffect(() => {
    if (step < 0) return;
    if (step >= BACKOFF_STEPS.length) { setStep(-1); setTimedOut(true); return; }
    const id = setTimeout(() => {
      refetchRef.current();
      setStep((s) => s + 1);
    }, BACKOFF_STEPS[step]);
    return () => clearTimeout(id);
  }, [step]);

  return { active: step >= 0, timedOut, start };
}
