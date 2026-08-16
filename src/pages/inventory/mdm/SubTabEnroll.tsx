// ============================================================================
// Sub-tab 1 — เตรียมเครื่อง (enroll → readiness). A 7-step READINESS CHECKLIST
// answering one question at the top: "is this device ready to hand to a customer?"
//
//   1–5  enrollment: serial, ABM scan, send-enrollment [button], wipe, reports in.
//   6    two AUTO-DETECTED status badges: the NNF-app scan result and the escrow
//        (Activation-Lock bypass) key window.
//   7    baseline lock — preview→confirm, MDM.PROFILE.
//
// ⭐ THIS FILE OWNS ALMOST NO MARKUP. All seven steps, the status band and the
//    wait hints come from shared/ — the public /mdm-enroll token page renders
//    the SAME components, so a change to any step changes both screens at once.
//    Before 2026-08-17 the step strip existed in three copies and had already
//    drifted. What stays here is what is genuinely tab-1's: the readiness
//    summary, the RPC wiring (fn_mdm_prepare_asset / fn_mdm_apply_template),
//    the device-info panel and the delegation panel.
//
// Step 7 has NO app/iCloud precondition — the DB never gated on it. The button
// is always pressable; the confirm dialog reminds staff to verify
// iCloud/Find-My/NNF-app first, but does not force a tick. The only real
// protection is the restriction profile itself, so delaying the lock just leaves
// the device unprotected longer.
//
// Escrow badge (why it matters): Apple lets us pull the Activation-Lock bypass
// code only within 15 days of enroll — miss it and recovery is impossible
// forever. That badge surfaces the deadline before it silently passes.
//
// "Is it locked?" and "can I lock it?" come from the DB, NOT from
// enforcement_level (UI_SUMMARY 134): enforcement_badge answers the first
// (LIGHT/MEDIUM/HARD = yes; NONE/WALLPAPER_ONLY = no, even at level 1),
// may_apply_light answers the second.
// ============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { ShieldCheck, RefreshCw, PackageCheck, PackageOpen, Search } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient, ApiError } from '../../../lib/api';
import { DateTime } from '../../../components/DateTime';
import { applyLightLock, parseMdmError, type AssetMdmStatus } from './mdmApi';
import { translateApiError } from '../../../lib/apiErrors';
import { EnrollChecklist } from './shared/EnrollChecklist';
import { EnrollReadinessSteps, isLockedBadge } from './shared/EnrollReadinessSteps';
import { SerialZoomModal } from './shared/SerialDisplay';
import { fromAssetStatus, enrollDoneCount } from './shared/enrollView';
import { EnrollDelegationPanel } from './EnrollDelegationPanel';

interface PrepareResponse {
  request_id: number;
  serial: string;
  status: string;
  dep_name: string;
  abm_tenant_id: number;
  abm_display_name: string;
  deduped?: boolean;
}

// The device_info_at column isn't on the shared view type but the row carries it.
type EnrollExtras = {
  device_info_at?: string | null;
};
type EnrollStatus = AssetMdmStatus & EnrollExtras;

export function SubTabEnroll({
  status,
  isFetching,
  onRefetch,
  onRefresh,
}: {
  status: EnrollStatus;
  isFetching: boolean;
  onRefetch: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const actorId = user?.user_id ?? null;
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Step-3 serial zoom — staff eyeball the serial against the physical device
  // before sending the enrollment, so it renders BIG and letter-spaced.
  const [serialZoomOpen, setSerialZoomOpen] = useState(false);

  const view = fromAssetStatus(status);

  const prepare = useMutation({
    mutationFn: () => apiClient.rpc<PrepareResponse>('fn_mdm_prepare_asset', { p_asset_id: status.asset_id }),
    onSuccess: () => {
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ['asset-mdm-status', status.asset_id] });
      onRefresh();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setErrorMsg(translated || err.message);
      } else {
        setErrorMsg(t('asset.mdm.prepareError'));
      }
      onRefetch();
    },
  });

  // Step readiness.
  const enrollComplete = enrollDoneCount(status) >= 5;   // steps 1–5
  // "Locked?" comes from the badge, not enforcement_level (wallpaper fakes level 1).
  const step7Done = isLockedBadge(status.enforcement_badge);
  // Handover needs BOTH keys, and the DB owns that rule (lock_ready) — never
  // recompute it from has_pull_key/has_push_key. A device with the Apple key but
  // no org key reads "safe" on every other field while a customer wipe would
  // lose it outright; that is exactly what shipped a device on 2026-08-11.
  // ⛔ lock_ready gates HANDOVER only. It must never reach the step-7 lock
  //    button — see the comment in EnrollReadinessSteps.
  const readyToHandOver = enrollComplete && step7Done && status.lock_ready;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-subtle" />
        <h3 className="text-sm font-semibold">{t('asset.mdm.title')}</h3>
        <div className="ml-auto">
          <Button
            variant="ghost" size="sm" className="btn-icon-sm"
            startIcon={<RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />}
            onClick={onRefetch}
            aria-label={t('common.refresh')}
          />
        </div>
      </div>

      {/* ⭐ Readiness summary — the one-glance answer (§6.5). Staff-side only:
          it is the branch's handover decision, phrased for someone with the
          asset record in front of them. */}
      <div className={readyToHandOver ? 'alert alert-success' : 'alert alert-warning'}>
        {readyToHandOver ? <PackageCheck size={20} className="shrink-0" /> : <PackageOpen size={20} className="shrink-0" />}
        <div className="min-w-0">
          <div className="alert-title">
            {readyToHandOver ? t('asset.mdm.readiness.ready') : t('asset.mdm.readiness.notReady')}
          </div>
          {!readyToHandOver && (
            <div className="alert-description">
              {t('asset.mdm.readiness.remaining', {
                steps: remainingStepLabels(t, { enrollComplete, step7Done, lockReady: status.lock_ready }),
              })}
            </div>
          )}
        </div>
      </div>

      {/* All 7 steps from shared/ — the same components the token page renders. */}
      <EnrollChecklist
        view={view}
        onPrepare={() => prepare.mutate()}
        preparing={prepare.isPending}
        errorMessage={errorMsg}
        hideKeyBanner
        showRawBlockedReason
        serialSlot={status.serial_number ? (
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-xs text-subtle">{t('asset.mdm.serialCheck.label')}</span>
            <span className="font-mono text-sm tracking-widest break-all">{status.serial_number}</span>
            <Button
              variant="outline"
              size="sm"
              className="btn-icon-sm"
              startIcon={<Search size={14} />}
              onClick={() => setSerialZoomOpen(true)}
              aria-label={t('asset.mdm.serialCheck.zoom')}
            />
          </div>
        ) : undefined}
      >
        <EnrollReadinessSteps
          view={view}
          onApplyLight={actorId == null ? undefined : (preview) => applyLightLock(status.asset_id, actorId, preview)}
          onApplied={() => {
            queryClient.invalidateQueries({ queryKey: ['asset-mdm-status', status.asset_id] });
            onRefresh();
          }}
          formatError={(err) => parseMdmError(err, t).message}
        />
      </EnrollChecklist>

      {/* Hand the enrollment to someone outside this branch (migs 248-250).
          Hides itself when may_enroll_delegate is false. Placed after the
          checklist because it is an alternative to doing steps 3–5 here, not a
          step of its own. */}
      <EnrollDelegationPanel status={status} onRefresh={onRefresh} />

      {/* Device info — when reported. */}
      {status.in_mdm && status.has_basic_info && (
        <div className="border border-line rounded-md p-4">
          <div className="text-xs text-subtle mb-2.5">{t('asset.mdm.deviceInfo')}</div>
          <DeviceInfo status={status} />
        </div>
      )}

      <SerialZoomModal
        open={serialZoomOpen}
        serial={status.serial_number}
        onClose={() => setSerialZoomOpen(false)}
      />
    </div>
  );
}

function DeviceInfo({ status }: { status: EnrollStatus }) {
  const { t } = useTranslation();
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (status.os_version) rows.push({ label: t('asset.mdm.info.os'), value: `iOS ${status.os_version}${status.build_version ? ` (${status.build_version})` : ''}` });
  if (status.battery_level != null) rows.push({ label: t('asset.mdm.info.battery'), value: `${Math.round(status.battery_level * 100)}%` });
  if (status.capacity_gb != null) {
    const avail = status.available_capacity_gb != null ? ` (${status.available_capacity_gb.toFixed(1)} GB ${t('asset.mdm.info.free')})` : '';
    rows.push({ label: t('asset.mdm.info.capacity'), value: `${status.capacity_gb} GB${avail}` });
  }
  if (status.is_supervised != null) rows.push({ label: t('asset.mdm.info.supervised'), value: status.is_supervised ? t('common.yes') : t('common.no') });
  if (status.device_info_at) rows.push({ label: t('asset.mdm.info.reportedAt'), value: <DateTime value={status.device_info_at} showTime /> });
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {rows.map((r, i) => (
        <div key={i} className="min-w-0">
          <div className="text-xs text-subtle">{r.label}</div>
          <div className="text-sm truncate">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Comma-joined labels of the still-incomplete groups, for the summary line.
 *  The org key is listed too: it blocks handover but is not something staff can
 *  DO anything about (the system installs it), so it must be named or the banner
 *  says "not ready" with no visible reason. */
function remainingStepLabels(
  t: (k: string) => string,
  { enrollComplete, step7Done, lockReady }: {
    enrollComplete: boolean; step7Done: boolean; lockReady: boolean;
  },
): string {
  const parts: string[] = [];
  if (!enrollComplete) parts.push(t('asset.mdm.readiness.stepEnroll'));
  if (!step7Done) parts.push(t('asset.mdm.readiness.step7'));
  if (!lockReady) parts.push(t('asset.mdm.readiness.stepKeys'));
  return parts.join(', ');
}
