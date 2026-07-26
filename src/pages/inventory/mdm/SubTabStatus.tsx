// ============================================================================
// Sub-tab 2 — สถานะเครื่อง & คิวงาน (131 §3–§4).
// A device-status glance + the shared command queue. "Pull from device" buttons
// (query profiles/apps) are async commands too (need p_actor_id, §11.2) → they
// land in the same queue.
// ============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { DownloadCloud, Smartphone, HardDrive, Battery, ShieldCheck } from 'lucide-react';
import { DateTime } from '../../../components/DateTime';
import { useAuth } from '../../../contexts/AuthContext';
import { queryProfiles, queryApps, type AssetMdmStatus } from './mdmApi';
import { useMdmCommand } from './useMdmCommand';
import { RecentIntentsPanel } from './RecentIntentsPanel';
import { MdmErrorAlert, CommandAckNote } from './MdmSharedBits';

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
  const [highlightIds, setHighlightIds] = useState<number[]>([]);

  const cmd = useMdmCommand({
    onAck: (ids) => setHighlightIds(ids),
    onNotEnrolled,
  });

  const pull = (kind: 'profiles' | 'apps') => {
    if (actorId == null) return;
    cmd.run(
      () => (kind === 'profiles' ? queryProfiles(status.asset_id, actorId) : queryApps(status.asset_id, actorId)),
      (r) => [r.intent_id],
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Status glance */}
      <div className="border border-line rounded-md p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <Field icon={<Smartphone size={14} />} label={t('asset.mdm.status.enrollState')}>
            {status.in_mdm ? t('asset.mdm.status.inMdm') : t('asset.mdm.status.notInMdm')}
          </Field>
          {status.in_mdm_since && (
            <Field icon={<ShieldCheck size={14} />} label={t('asset.mdm.status.since')}>
              <DateTime value={status.in_mdm_since} showTime={false} />
            </Field>
          )}
          {status.last_seen_at && (
            <Field icon={<DownloadCloud size={14} />} label={t('asset.mdm.status.lastSeen')}>
              <DateTime value={status.last_seen_at} showTime />
            </Field>
          )}
          {status.serial_number && (
            <Field icon={<HardDrive size={14} />} label={t('asset.mdm.status.serial')}>
              <span className="font-mono">{status.serial_number}</span>
            </Field>
          )}
        </dl>

        {/* Pull-from-device — refresh the device's reported profiles/apps. */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line">
          <span className="text-xs text-subtle flex items-center gap-1"><Battery size={13} />{t('asset.mdm.status.pullHint')}</span>
          <div className="ml-auto flex gap-1.5">
            <Button variant="outline" size="sm" disabled={cmd.pending || actorId == null} onClick={() => pull('profiles')}>
              {t('asset.mdm.status.pullProfiles')}
            </Button>
            <Button variant="outline" size="sm" disabled={cmd.pending || actorId == null} onClick={() => pull('apps')}>
              {t('asset.mdm.status.pullApps')}
            </Button>
          </div>
        </div>
      </div>

      <MdmErrorAlert error={cmd.error} onGoToEnroll={onNotEnrolled} />
      <CommandAckNote show={cmd.acked && !cmd.error} />

      {/* The queue — shared history surface (§4). */}
      <RecentIntentsPanel assetId={status.asset_id} highlightIds={highlightIds} />
    </div>
  );
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-subtle flex items-center gap-1">{icon}{label}</dt>
      <dd className="text-sm truncate mt-0.5">{children}</dd>
    </div>
  );
}
