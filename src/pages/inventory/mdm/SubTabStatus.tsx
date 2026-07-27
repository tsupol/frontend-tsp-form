// ============================================================================
// Sub-tab 2 — สถานะเครื่อง & คิวงาน (131 §3–§4).
// Top: the "what's happening now" box. Then the device-info glance (§3.1) —
// battery, capacity, iOS, supervised, plus enroll/serial/last-seen — every
// timestamp as absolute + relative (§3.2, RelativeDateTime). Then the
// profiles/apps accordion (§3.4) which is the render target for the pull
// commands. Then the shared queue (§4).
// ============================================================================

import { useTranslation } from 'react-i18next';
import {
  Smartphone, HardDrive, ShieldCheck, Battery, Cpu, Database, MonitorSmartphone, Clock,
  AlertTriangle,
} from 'lucide-react';
import { DateTime } from '../../../components/DateTime';
import { useAuth } from '../../../contexts/AuthContext';
import { type AssetMdmStatus } from './mdmApi';
import { RelativeDateTime } from './RelativeDateTime';
import { RecentIntentsPanel } from './RecentIntentsPanel';
import { MdmActivityCard } from './MdmActivityCard';
import { DeviceProfilesApps } from './DeviceProfilesApps';

export function SubTabStatus({
  status,
  onNotEnrolled,
}: {
  status: AssetMdmStatus;
  onNotEnrolled: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const actorId = user?.user_id ?? null;

  const battery = status.battery_level != null ? Math.round(status.battery_level * 100) : null;
  const capPct = status.capacity_gb && status.available_capacity_gb != null
    ? Math.round((status.available_capacity_gb / status.capacity_gb) * 100)
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* "What's happening now" — the first thing a staffer on a call needs. */}
      <MdmActivityCard status={status} />

      {/* Device info glance (§3.1). has_basic_info === false → nothing to show
          yet; the pull buttons live in the accordion below. */}
      <div className="border border-line rounded-md p-4">
        {!status.has_basic_info && (
          <div className="alert alert-info mb-3">
            <div className="alert-description">{t('asset.mdm.status.noBasicInfo')}</div>
          </div>
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <Field icon={<Smartphone size={14} />} label={t('asset.mdm.status.enrollState')}>
            {status.in_mdm ? t('asset.mdm.status.inMdm') : t('asset.mdm.status.notInMdm')}
          </Field>
          {status.in_mdm_since && (
            <Field icon={<ShieldCheck size={14} />} label={t('asset.mdm.status.since')}>
              <DateTime value={status.in_mdm_since} showTime={false} />
            </Field>
          )}

          {battery != null && (
            <Field icon={<Battery size={14} />} label={t('asset.mdm.status.battery')}>
              <span className={battery < 20 ? 'text-danger-fg' : ''}>{battery}%</span>
            </Field>
          )}
          {status.capacity_gb != null && (
            <Field icon={<Database size={14} />} label={t('asset.mdm.status.capacity')}>
              <span className={capPct != null && capPct < 10 ? 'text-warning-fg' : ''}>
                {status.available_capacity_gb != null
                  ? t('asset.mdm.status.capacityFree', {
                      free: fmtGb(status.available_capacity_gb),
                      total: fmtGb(status.capacity_gb),
                    })
                  : t('asset.mdm.status.capacityTotal', { total: fmtGb(status.capacity_gb) })}
              </span>
            </Field>
          )}
          {status.os_version && (
            <Field icon={<Cpu size={14} />} label={t('asset.mdm.status.os')}>
              {status.os_version}{status.build_version && <span className="text-subtle"> ({status.build_version})</span>}
            </Field>
          )}
          {status.is_supervised != null && (
            <Field icon={<MonitorSmartphone size={14} />} label={t('asset.mdm.status.supervised')}>
              {status.is_supervised ? (
                t('common.yes')
              ) : (
                <span className="text-warning-fg inline-flex items-center gap-1">
                  <AlertTriangle size={13} />{t('asset.mdm.status.notSupervised')}
                </span>
              )}
            </Field>
          )}

          {status.serial_number && (
            <Field icon={<HardDrive size={14} />} label={t('asset.mdm.status.serial')}>
              <span className="font-mono">{status.serial_number}</span>
            </Field>
          )}
          {status.last_seen_at && (
            <Field icon={<Clock size={14} />} label={t('asset.mdm.status.lastSeen')} wide>
              <RelativeDateTime value={status.last_seen_at} />
              {isStale(status.last_seen_at) && (
                <div className="text-xs text-warning-fg mt-0.5">{t('asset.mdm.status.lastSeenStale')}</div>
              )}
            </Field>
          )}
        </dl>
      </div>

      {/* Profiles & apps — the render target for the pull commands (§3.4). */}
      <DeviceProfilesApps assetId={status.asset_id} actorId={actorId} onNotEnrolled={onNotEnrolled} />

      {/* The queue — shared history surface (§4). */}
      <RecentIntentsPanel assetId={status.asset_id} highlightIds={[]} />
    </div>
  );
}

function fmtGb(gb: number): string {
  return gb >= 10 ? String(Math.round(gb)) : gb.toFixed(1);
}

const SEVEN_DAYS_MS = 7 * 86_400_000;
function isStale(iso: string): boolean {
  const age = Date.now() - new Date(iso).getTime();
  return Number.isFinite(age) && age > SEVEN_DAYS_MS;
}

function Field({ icon, label, children, wide }: {
  icon: React.ReactNode; label: string; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-2' : ''}`}>
      <dt className="text-xs text-subtle flex items-center gap-1">{icon}{label}</dt>
      <dd className={`text-sm mt-0.5 ${wide ? '' : 'truncate'}`}>{children}</dd>
    </div>
  );
}
