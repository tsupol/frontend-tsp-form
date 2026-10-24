// The one-glance handover answer (§6.5): is this device ready to hand to a
// customer, and if not, what is left. Shown at the top of sub-tab 1 and, on its
// own, in finance's close-out review (Ohm #11) — one component so the two
// never disagree.
//
// Readiness = steps 1–5 done + baseline lock + BOTH keys. "Locked?" comes from
// enforcement_badge, not enforcement_level (wallpaper fakes level 1), and the
// two-key rule is the DB's own lock_ready — never recomputed from
// has_pull_key/has_push_key (a device with only the Apple key shipped
// unprotected on 2026-08-11).

import { useTranslation } from 'react-i18next';
import { PackageCheck, PackageOpen } from 'lucide-react';
import type { AssetMdmStatus } from './mdmApi';
import { isLockedBadge } from './shared/EnrollReadinessSteps';
import { enrollDoneCount } from './shared/enrollView';

export function mdmReadiness(status: AssetMdmStatus) {
  const enrollComplete = enrollDoneCount(status) >= 5;
  const step7Done = isLockedBadge(status.enforcement_badge);
  const lockReady = !!status.lock_ready;
  return { enrollComplete, step7Done, lockReady, ready: enrollComplete && step7Done && lockReady };
}

export function MdmReadinessBox({ status }: { status: AssetMdmStatus }) {
  const { t } = useTranslation();
  const r = mdmReadiness(status);

  // The org key is named too: staff can't act on it (the system installs it),
  // but leaving it out makes the box say "not ready" with no visible reason.
  const remaining: string[] = [];
  if (!r.enrollComplete) remaining.push(t('asset.mdm.readiness.stepEnroll'));
  if (!r.step7Done) remaining.push(t('asset.mdm.readiness.step7'));
  if (!r.lockReady) remaining.push(t('asset.mdm.readiness.stepKeys'));

  return (
    <div className={r.ready ? 'alert alert-success' : 'alert alert-warning'}>
      {r.ready ? <PackageCheck size={20} className="shrink-0" /> : <PackageOpen size={20} className="shrink-0" />}
      <div className="min-w-0">
        <div className="alert-title">
          {r.ready ? t('asset.mdm.readiness.ready') : t('asset.mdm.readiness.notReady')}
        </div>
        {!r.ready && (
          <div className="alert-description">
            {t('asset.mdm.readiness.remaining', { steps: remaining.join(', ') })}
          </div>
        )}
      </div>
    </div>
  );
}
