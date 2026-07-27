// ============================================================================
// Sub-tab 6 — โหมดสูญหาย & ตำแหน่ง (131 §8). Two clusters:
//   Lost Mode: enable (message + phone BOTH required, §8) / disable / play sound
//   Location: request (only meaningful while lost mode is ON, §8) + read latest
//
// Gotchas honoured:
//   - message + phone are required → button disabled until both filled (§8).
//   - all these RPCs take p_actor_id (§11.2).
//   - request-location gated on is_mdm_lost_mode_enabled — Apple only reports
//     location in Lost Mode (§8).
//   - read_locations uses enrollment_id (not asset_id); may return null (never
//     reported) — that's not an error. Show staleness; a stale fix that looks
//     fresh is the dangerous case (§8), so colour + "as of {time}".
// ============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, TextArea } from 'tsp-form';
import {
  MapPin, Bell, BellOff, Volume2, LocateFixed, ExternalLink, AlertTriangle,
} from 'lucide-react';
import { DateTime } from '../../../components/DateTime';
import { useAuth } from '../../../contexts/AuthContext';
import {
  enableLostMode, disableLostMode, playLostModeSound, requestLocation, readLocations,
  fetchDeviceOverview, parseMdmError, type AssetMdmStatus, type MdmLocation, type ParsedMdmError,
} from './mdmApi';
import { useMdmCommand } from './useMdmCommand';
import { MDM_NO_CACHE } from './useMdmStatus';
import { MdmErrorAlert, CommandAckNote } from './MdmSharedBits';

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
  const { t } = useTranslation();
  const { user } = useAuth();
  const actorId = user?.user_id ?? null;
  const cmd = useMdmCommand({ onAck, onNotEnrolled });

  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');

  const { data: overview } = useQuery({
    queryKey: ['mdm-device-overview', status.asset_id],
    queryFn: () => fetchDeviceOverview(status.asset_id),
    ...MDM_NO_CACHE,
  });
  const lostOn = overview?.is_mdm_lost_mode_enabled === true;

  // Latest location — fetched on demand (button), not auto (PDPA-logged read).
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

  const canEnable = !cmd.pending && actorId != null && message.trim().length > 0 && phone.trim().length > 0;

  const run = (fire: () => Promise<{ intent_id: number }>) =>
    cmd.run(fire, (r) => [r.intent_id]);

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

          {!lostOn ? (
            <>
              <p className="text-xs text-subtle">{t('asset.mdm.lost.enableHint')}</p>
              <div className="flex flex-col">
                <label className="form-label">{t('asset.mdm.lost.message')} *</label>
                <TextArea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} className="w-full" placeholder={t('asset.mdm.lost.messagePlaceholder')} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('asset.mdm.lost.phone')} *</label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} size="sm" className="w-full" placeholder={t('asset.mdm.lost.phonePlaceholder')} />
              </div>
              <div>
                <Button color="danger" size="sm" startIcon={<Bell size={15} />} disabled={!canEnable}
                  onClick={() => actorId != null && run(() => enableLostMode({
                    p_asset_id: status.asset_id, p_actor_id: actorId, p_lock_message: message.trim(), p_phone_number: phone.trim(),
                  }))}>
                  {t('asset.mdm.lost.enable')}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" startIcon={<BellOff size={15} />} disabled={cmd.pending || actorId == null}
                onClick={() => actorId != null && run(() => disableLostMode(status.asset_id, actorId))}>
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

          <div className="flex gap-2">
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
