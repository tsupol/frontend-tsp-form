// ============================================================================
// Sub-tab 1 — เตรียมเครื่อง (enroll → readiness). A 7-step READINESS CHECKLIST
// answering one question at the top: "is this device ready to hand to a customer?"
//
//   1–5  enrollment (unchanged, derived from mdm_status): serial, ABM scan,
//        send-enrollment [button], wipe, device reports in.
//   6    two AUTO-DETECTED status badges (rewritten 2026-08-01 per
//        UI_FEEDBACK/2026-08-01_IMPLEMENT_mdm_tab1_status_badges.md): the NNF-app
//        scan result and the escrow (Activation-Lock bypass) key window. These
//        used to be two checkboxes, which mis-read as a staff checklist — but the
//        values are system-detected, the user never sets them, and the iCloud one
//        had NO backing column at all. So: NO checkboxes, just badges.
//   7    baseline lock — fn_mdm_apply_device_policy (preview→confirm), MDM.PROFILE.
//
// Step 7 has NO app/iCloud precondition — the DB never gated on it (may_profile
// checks only the MDM.PROFILE permission). The button is always pressable; a
// confirm dialog reminds staff to verify iCloud/Find-My/NNF-app first, but does
// not force a tick. The only real protection is the restriction profile itself,
// so delaying the lock just leaves the device unprotected longer.
//
// Escrow badge (why it matters): Apple lets us pull the Activation-Lock bypass
// code only within 15 days of enroll — miss it and recovery is impossible
// forever. This badge surfaces that deadline before it silently passes.
//
// "Is it locked?" and "can I lock it?" come from the DB, NOT from enforcement_level
// (UI_SUMMARY 134): enforcement_badge answers the first (LIGHT/MEDIUM/HARD = yes;
// NONE/WALLPAPER_ONLY = no, even at level 1), may_apply_light answers the second.
// Readiness summary = steps 1–5 done + a real baseline lock present (badge).
// ============================================================================

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Badge } from 'tsp-form';
import {
  ShieldCheck, RefreshCw, Send, CheckCircle, AlertTriangle, Loader2,
  Fingerprint, ScanLine, RotateCcw, Smartphone, XCircle, Lock, Cloud, CircleDashed,
  PackageCheck, PackageOpen, KeyRound, HelpCircle, LockOpen, PauseCircle, Search,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient, ApiError } from '../../../lib/api';
import { DateTime } from '../../../components/DateTime';
import { RelativeDateTime } from './RelativeDateTime';
import { applyLightLock, type AssetMdmStatus, type MdmStatusCode, type ApplyTemplateResult, type MdmEnforcementBadge } from './mdmApi';
import { parseMdmError } from './mdmApi';
import { translateApiError } from '../../../lib/apiErrors';

interface PrepareResponse {
  request_id: number;
  serial: string;
  status: string;
  dep_name: string;
  abm_tenant_id: number;
  abm_display_name: string;
  deduped?: boolean;
}

type BadgeTone = 'neutral' | 'info' | 'warning' | 'danger' | 'successSoft' | 'success';

// tsp-form .alert only has info/success/warning/danger — map our badge tones onto it.
const ALERT_TONE: Record<BadgeTone, string> = {
  neutral: 'alert alert-info',
  info: 'alert alert-info',
  warning: 'alert alert-warning',
  danger: 'alert alert-danger',
  successSoft: 'alert alert-success',
  success: 'alert alert-success',
};

const TONE_ICON: Record<BadgeTone, typeof CheckCircle> = {
  neutral: Fingerprint,
  info: Loader2,
  warning: AlertTriangle,
  danger: XCircle,
  successSoft: Loader2,
  success: CheckCircle,
};

type EnrollExtras = {
  device_info_at?: string | null;
};
type EnrollStatus = AssetMdmStatus & EnrollExtras;

function statusPresentation(s: AssetMdmStatus): { key: string; tone: BadgeTone; spin?: boolean } {
  switch (s.mdm_status) {
    case 'NO_SERIAL': return { key: 'NO_SERIAL', tone: 'neutral' };
    case 'NOT_STARTED': return { key: 'NOT_STARTED', tone: 'neutral' };
    case 'PREPARING': return { key: 'PREPARING', tone: 'info', spin: true };
    case 'PROFILE_READY': return { key: 'PROFILE_READY', tone: 'warning' };
    case 'PREPARE_FAILED': return { key: 'PREPARE_FAILED', tone: 'danger' };
    case 'IN_MDM':
      return s.has_basic_info
        ? { key: 'IN_MDM_INFO', tone: 'success' }
        : { key: 'IN_MDM_WAITING', tone: 'successSoft', spin: true };
    default: return { key: 'NOT_STARTED', tone: 'neutral' };
  }
}

// ── Step model ───────────────────────────────────────────────────────────────
// Steps 1–5 are the original enroll strip. 6 and 7 are the new handover steps.

const STEPS_1_5 = [
  { key: 'serial', icon: Fingerprint, where: 'system' },
  { key: 'scan', icon: ScanLine, where: 'device' },
  { key: 'send', icon: Send, where: 'system' },
  { key: 'wipe', icon: RotateCcw, where: 'device' },
  { key: 'enrolled', icon: Smartphone, where: 'auto' },
] as const;

// enforcement_badge values that mean a real restriction profile is on the device.
// NONE / WALLPAPER_ONLY / APPLYING / PAUSED / NOT_IN_MDM are NOT "locked".
const LOCKED_BADGES = new Set<MdmEnforcementBadge>(['LIGHT', 'MEDIUM', 'HARD']);

/** How many of steps 1–5 are done, from mdm_status. */
function enrollDoneCount(s: { mdm_status: MdmStatusCode }): number {
  switch (s.mdm_status) {
    case 'NO_SERIAL': return 0;
    case 'NOT_STARTED': return 1;
    case 'PREPARING': return 2;
    case 'PROFILE_READY': return 3;
    case 'PREPARE_FAILED': return 1;
    case 'IN_MDM': return 5;
    default: return 0;
  }
}

type StepStatus = 'done' | 'current' | 'todo';

function StepRow({
  n, icon: Icon, title, where, state, last, children,
}: {
  n: number;
  icon: typeof CheckCircle;
  title: string;
  where?: string;
  state: StepStatus;
  last?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${
          state === 'current' ? 'bg-primary border-primary text-primary-contrast'
            : state === 'done' ? 'bg-success border-success text-success-contrast'
              : 'bg-surface border-line text-subtle'
        }`}>
          {state === 'done' ? <CheckCircle size={13} /> : <Icon size={12} />}
        </div>
        {!last && <div className={`w-0.5 flex-1 min-h-[0.75rem] my-0.5 ${state === 'done' ? 'bg-success' : 'bg-line'}`} />}
      </div>
      <div className="pb-3 min-w-0 flex-1">
        <div className={`text-sm font-medium leading-snug ${
          state === 'current' ? 'text-primary-fg' : state === 'done' ? 'text-success-fg' : 'text-fg'
        }`}>
          <span className="text-subtler tabular-nums">{n}. </span>{title}
        </div>
        {where && <div className="text-xs text-subtle leading-snug mt-0.5">{where}</div>}
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}

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
  const [justPrepared, setJustPrepared] = useState(false);
  // Step-3 serial zoom — staff eyeball the serial against the physical device
  // before sending the enrollment, so it renders BIG and letter-spaced.
  const [serialZoomOpen, setSerialZoomOpen] = useState(false);

  // A re-enroll leaves mdm_status at IN_MDM (the view checks the binding first),
  // so the READY signal lives in prepare_status/detail, not mdm_status.
  const reenrollReady = status.prepare_is_reenroll && status.prepare_status === 'READY';

  useEffect(() => {
    const inFlight = status.mdm_status === 'PREPARING' || status.mdm_status === 'PROFILE_READY';
    if (!inFlight && !reenrollReady) setJustPrepared(false);
  }, [status.mdm_status, reenrollReady]);

  const prepare = useMutation({
    mutationFn: () => apiClient.rpc<PrepareResponse>('fn_mdm_prepare_asset', { p_asset_id: status.asset_id }),
    onSuccess: () => {
      setErrorMsg(null);
      setJustPrepared(true);
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

  const presentation = useMemo(() => statusPresentation(status), [status]);
  const showPrepareButton = status.can_prepare && status.may_prepare;
  const isRetry = status.mdm_status === 'PREPARE_FAILED';
  const ToneIcon = TONE_ICON[presentation.tone];

  // Step readiness.
  const doneEnroll = enrollDoneCount(status);
  const enrollComplete = doneEnroll >= 5;               // steps 1–5
  // "Locked?" comes from the badge, not enforcement_level (wallpaper fakes level 1).
  const isLocked = LOCKED_BADGES.has(status.enforcement_badge);
  const isApplying = status.enforcement_badge === 'APPLYING';
  const step7Done = isLocked;
  const readyToHandOver = enrollComplete && step7Done;  // step 6 is informational, not a gate

  // Step-7 apply flow (preview→confirm). The button gate is may_apply_light ALONE.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<ApplyTemplateResult | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyErr, setPolicyErr] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const openStep7 = async () => {
    setPolicyErr(null);
    setPreview(null);
    setConfirmOpen(true);
    setPolicyBusy(true);
    try {
      if (actorId == null) throw new Error('no actor');
      setPreview(await applyLightLock(status.asset_id, actorId, true));
    } catch (err) {
      setPolicyErr(parseMdmError(err, t).message);
    } finally {
      setPolicyBusy(false);
    }
  };

  const applyStep7 = async () => {
    setPolicyBusy(true);
    setPolicyErr(null);
    try {
      if (actorId == null) throw new Error('no actor');
      await applyLightLock(status.asset_id, actorId, false); // ⛔ false = real apply
      setApplied(true);
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['asset-mdm-status', status.asset_id] });
      onRefresh();
    } catch (err) {
      setPolicyErr(parseMdmError(err, t).message);
    } finally {
      setPolicyBusy(false);
    }
  };

  // Step 7 state for the strip. Step 6 no longer gates it — once 1–5 are done and
  // the lock isn't applied yet, step 7 is the current action.
  const step7State: StepStatus = step7Done ? 'done' : (enrollComplete ? 'current' : 'todo');
  // Step 6 is a status readout, not a checklist item — mark it done once enrolled
  // (its badges then carry the real state), current while enrolling.
  const step6State: StepStatus = enrollComplete ? 'done' : 'current';

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

      {/* ⭐ Readiness summary — the one-glance answer (§6.5). */}
      <div className={readyToHandOver ? 'alert alert-success' : 'alert alert-warning'}>
        {readyToHandOver ? <PackageCheck size={20} className="shrink-0" /> : <PackageOpen size={20} className="shrink-0" />}
        <div className="min-w-0">
          <div className="alert-title">
            {readyToHandOver ? t('asset.mdm.readiness.ready') : t('asset.mdm.readiness.notReady')}
          </div>
          {!readyToHandOver && (
            <div className="alert-description">
              {t('asset.mdm.readiness.remaining', { steps: remainingStepLabels(t, { enrollComplete, step7Done }) })}
            </div>
          )}
        </div>
      </div>

      {/* Prepare status badge (steps 1–5 detail). The sub line is dropped when it
          would just repeat the title (e.g. IN_MDM_INFO). */}
      <div className={ALERT_TONE[presentation.tone]}>
        <ToneIcon size={20} className={`shrink-0 ${presentation.spin ? 'animate-spin' : ''}`} />
        <div className="min-w-0 flex-1">
          <div className="alert-title">{t(`asset.mdm.badge.${presentation.key}.label`)}</div>
          {(() => {
            const label = t(`asset.mdm.badge.${presentation.key}.label`);
            const sub = t(`asset.mdm.badge.${presentation.key}.sub`);
            // Drop a sub that only restates the label (ignoring trailing period).
            const same = sub.replace(/[.。]\s*$/, '') === label.replace(/[.。]\s*$/, '');
            return same ? null : <div className="alert-description">{sub}</div>;
          })()}
          {status.mdm_status === 'PREPARE_FAILED' && status.prepare_blocked_reason && (
            <div className="alert-description font-mono break-words mt-1">{status.prepare_blocked_reason}</div>
          )}
        </div>
      </div>

      {justPrepared && (status.mdm_status === 'PREPARING' || status.mdm_status === 'PROFILE_READY') && (
        <div className="alert alert-info">
          <Loader2 size={20} className="shrink-0 animate-spin" />
          <div className="min-w-0">
            <div className="alert-title">{t('asset.mdm.afterPress.title')}</div>
            <div className="alert-description">{t('asset.mdm.afterPress.next')}</div>
            <div className="alert-description">{t('asset.mdm.afterPress.note')}</div>
          </div>
        </div>
      )}

      {/* Re-enroll READY — the profile is pushed but mdm_status stays IN_MDM, so
          this box (not the PROFILE_READY one above) tells staff to wipe. The
          wording names WHOSE device gets erased: pressing this on a customer's
          device by mistake and then wiping it loses their data (§งานจอ #3). */}
      {reenrollReady && (
        <div className="alert alert-warning">
          <RotateCcw size={20} className="shrink-0" />
          <div className="min-w-0">
            <div className="alert-title">{t('asset.mdm.reenrollReady.title')}</div>
            <div className="alert-description">{t('asset.mdm.reenrollReady.warn')}</div>
            <div className="alert-description">{t('asset.mdm.reenrollReady.next')}</div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="alert alert-danger">
          <XCircle size={16} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 7-step checklist. */}
      <div className="border border-line rounded-md p-4">
        <div className="flex flex-col">
          {STEPS_1_5.map((step, i) => {
            const state: StepStatus = i < doneEnroll ? 'done' : (i === doneEnroll ? 'current' : 'todo');
            const isSendStep = step.key === 'send';
            return (
              <StepRow
                key={step.key}
                n={i + 1}
                icon={step.icon}
                title={t(`asset.mdm.step.${step.key}`)}
                where={t(`asset.mdm.stepWhere.${step.where}`)}
                state={state}
              >
                {/* Step 3 shows the serial being enrolled + a magnifier that
                    blows it up full-screen, so staff can check it against the
                    physical device before sending. */}
                {isSendStep && status.serial_number && (
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
                )}

                {/* Step 3 owns the send-enrollment button. Re-enroll (device
                    already IN_MDM, branch wiped it) reuses the same RPC — only
                    the wording changes (mig 968). */}
                {isSendStep && showPrepareButton && (
                  <div className="flex flex-col gap-1.5">
                    <div>
                      <Button
                        color="primary"
                        size="sm"
                        startIcon={isRetry ? <RotateCcw size={15} /> : status.prepare_is_reenroll ? <RotateCcw size={15} /> : <Send size={15} />}
                        onClick={() => prepare.mutate()}
                        disabled={prepare.isPending}
                      >
                        {isRetry
                          ? t('asset.mdm.button.retry')
                          : status.prepare_is_reenroll
                            ? t('asset.mdm.button.reenroll')
                            : t('asset.mdm.button.prepare')}
                      </Button>
                    </div>
                    {status.prepare_is_reenroll && !isRetry && (
                      <p className="text-xs text-subtle">{t('asset.mdm.button.reenrollHint')}</p>
                    )}
                  </div>
                )}
                {isSendStep && status.can_prepare && !status.may_prepare && (
                  <div className="text-xs text-subtler">{t('asset.mdm.noPermission')}</div>
                )}
              </StepRow>
            );
          })}

          {/* Step 6 — two AUTO-DETECTED status badges (NNF app + escrow key).
              Not checkboxes: the system computes these, staff never sets them. */}
          <StepRow
            n={6}
            icon={Cloud}
            title={t('asset.mdm.step6.title')}
            state={step6State}
          >
            <div className="flex flex-col gap-2">
              <StatusLine label={t('asset.mdm.step6.nnfAppLabel')}>
                <NnfAppBadge status={status} />
              </StatusLine>
              <StatusLine label={t('asset.mdm.step6.escrowLabel')}>
                <EscrowBadge status={status} />
              </StatusLine>
            </div>
          </StepRow>

          {/* Step 7 — baseline lock. The "การล็อค" badge answers "locked yet?" from
              enforcement_badge; the button shows/hides on may_apply_light alone. */}
          <StepRow
            n={7}
            icon={Lock}
            title={t('asset.mdm.step7.title')}
            state={step7State}
            last
          >
            <div className="flex flex-col gap-2">
              <StatusLine label={t('asset.mdm.step7.lockLabel')}>
                <EnforcementBadge badge={status.enforcement_badge} />
              </StatusLine>

              {/* WALLPAPER_ONLY looks locked but has NO real restriction — warn. */}
              {status.enforcement_badge === 'WALLPAPER_ONLY' && (
                <div className="text-xs text-warning-fg inline-flex items-center gap-1">
                  <AlertTriangle size={12} className="shrink-0" />{t('asset.mdm.step7.wallpaperOnlyWarn')}
                </div>
              )}

              {isLocked ? (
                status.enforcement_verify_state === 'PENDING' && (
                  <div className="text-xs text-warning-fg inline-flex items-center gap-1">
                    <CircleDashed size={13} className="animate-spin" />{t('asset.mdm.step7.verifyPending')}
                  </div>
                )
              ) : isApplying ? (
                <div className="text-xs text-info-fg inline-flex items-center gap-1">
                  <CircleDashed size={13} className="animate-spin" />{t('asset.mdm.step7.applied')}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-subtle">{t('asset.mdm.step7.desc')}</p>
                  {status.may_apply_light ? (
                    <div>
                      <Button
                        color="primary"
                        size="sm"
                        startIcon={<Lock size={15} />}
                        onClick={openStep7}
                      >
                        {t('asset.mdm.step7.button')}
                      </Button>
                    </div>
                  ) : status.apply_light_blocked_reason ? (
                    <div className="text-xs text-subtler">
                      {t(`asset.mdm.step7.blocked.${status.apply_light_blocked_reason}`)}
                    </div>
                  ) : null}
                  {applied && (
                    <div className="text-xs text-info-fg inline-flex items-center gap-1">
                      <CircleDashed size={13} className="animate-spin" />{t('asset.mdm.step7.applied')}
                    </div>
                  )}
                </div>
              )}
            </div>
          </StepRow>
        </div>
      </div>

      {/* Device info — when reported. */}
      {status.in_mdm && status.has_basic_info && (
        <div className="border border-line rounded-md p-4">
          <div className="text-xs text-subtle mb-2.5">{t('asset.mdm.deviceInfo')}</div>
          <DeviceInfo status={status} />
        </div>
      )}

      {/* Serial zoom — the whole point is legibility at arm's length while the
          device is in the other hand, so: as wide as the viewport allows, the
          characters spaced apart (Ohm: "A B C D E"), and a plain unspaced copy
          underneath for reading it back normally. Always mounted (§Modal rule). */}
      <Modal
        open={serialZoomOpen}
        onClose={() => setSerialZoomOpen(false)}
        maxWidth="min(64rem, 96vw)"
        width="100%"
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('asset.mdm.serialCheck.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={() => setSerialZoomOpen(false)}>&times;</button>
        </div>
        <div className="modal-content min-w-0">
          <div className="flex flex-col items-center gap-4 py-4 min-w-0 w-full">
            {/* MUST stay on one line — a wrapped serial defeats the whole check.
                Mono glyphs are 0.6em wide and each carries the letter-spacing,
                so N chars ≈ N × 0.82em: size off the length, not a fixed clamp. */}
            <div
              className="font-mono font-bold text-center leading-tight whitespace-nowrap w-full select-all"
              style={{
                fontSize: `min(9vw, ${(90 / Math.max((status.serial_number?.length ?? 1) * 0.82, 1)).toFixed(2)}vw, 4rem)`,
                letterSpacing: '0.22em',
                textIndent: '0.22em', // trailing letter-space would push it off-centre
              }}
            >
              {status.serial_number}
            </div>
            <div className="font-mono text-base text-subtle break-all text-center select-all">
              {status.serial_number}
            </div>
            <p className="text-xs text-subtle text-center">{t('asset.mdm.serialCheck.hint')}</p>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setSerialZoomOpen(false)}>{t('common.close')}</Button>
        </div>
      </Modal>

      {/* Step-7 confirm modal (preview→apply). Always mounted (§Modal rule). */}
      <Modal open={confirmOpen} onClose={() => !policyBusy && setConfirmOpen(false)} maxWidth="28rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('asset.mdm.step7.confirmTitle')}</h2>
        </div>
        <div className="modal-content">
          {policyBusy && !preview ? (
            <div className="flex items-center gap-2 text-sm text-subtle py-2">
              <Loader2 size={16} className="animate-spin" />{t('common.loading')}
            </div>
          ) : policyErr ? (
            <div className="alert alert-danger"><XCircle size={16} /><span>{policyErr}</span></div>
          ) : preview ? (
            <>
              <p className="text-sm text-subtle">{t('asset.mdm.step7.confirmBody')}</p>
              {status.serial_number && (
                <p className="text-sm mt-2">
                  <span className="text-subtle">{t('asset.mdm.dunning.deviceLabel')}:</span>{' '}
                  <span className="font-mono">{status.serial_number}</span>
                </p>
              )}
              <div className="alert alert-warning mt-3">
                <AlertTriangle size={16} className="shrink-0" />
                <div className="min-w-0">
                  <div className="alert-title">{t('asset.mdm.step7.reminderTitle')}</div>
                  <ul className="alert-description mt-1 flex flex-col gap-0.5 list-disc pl-4">
                    <li>{t('asset.mdm.step7.reminderIcloud')}</li>
                    <li>{t('asset.mdm.step7.reminderFindMy')}</li>
                    <li>{t('asset.mdm.step7.reminderNnfApp')}</li>
                  </ul>
                </div>
              </div>
              <ul className="text-xs text-subtle mt-3 flex flex-col gap-1">
                {preview.restrictions.map((r) => (
                  <li key={r.key} className="inline-flex items-center gap-1.5">
                    <Lock size={11} className="shrink-0" />
                    {t(`asset.mdm.step7.flag.${r.key}`, { defaultValue: r.key })}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={policyBusy}>{t('common.cancel')}</Button>
          <Button color="primary" onClick={applyStep7} disabled={policyBusy || !preview} startIcon={<Lock size={15} />}>
            {t('asset.mdm.step7.confirmButton')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** A step-6 status readout row: label on the left, an auto-detected badge on
 *  the right. These replaced the old checkboxes — the values are system-computed. */
function StatusLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <span className="text-subtle">{label}</span>
      {children}
    </div>
  );
}

/** "การล็อค" badge — the single answer to "locked yet?" (enforcement_badge).
 *  NONE / WALLPAPER_ONLY are deliberately NOT green: no real restriction on the
 *  device. NOT_IN_MDM renders nothing (step 7 is unreachable until enrolled). */
const ENFORCEMENT_BADGE_STYLE: Record<
  MdmEnforcementBadge,
  { color: 'default' | 'success' | 'warning' | 'danger' | 'info'; icon: typeof Lock } | null
> = {
  NOT_IN_MDM: null,
  APPLYING: { color: 'info', icon: CircleDashed },
  NONE: { color: 'default', icon: LockOpen },
  WALLPAPER_ONLY: { color: 'warning', icon: LockOpen },
  LIGHT: { color: 'success', icon: Lock },
  MEDIUM: { color: 'success', icon: Lock },
  HARD: { color: 'success', icon: Lock },
  PAUSED: { color: 'warning', icon: PauseCircle },
};
function EnforcementBadge({ badge }: { badge: MdmEnforcementBadge }) {
  const { t } = useTranslation();
  const style = ENFORCEMENT_BADGE_STYLE[badge];
  if (!style) return <span className="text-xs text-subtler">{t(`asset.mdm.lock.${badge}`)}</span>;
  const Icon = style.icon;
  return (
    <Badge color={style.color} startIcon={<Icon size={12} className={badge === 'APPLYING' ? 'animate-spin' : ''} />}>
      {t(`asset.mdm.lock.${badge}`)}
    </Badge>
  );
}

/** NNF-app scan result. Three distinct states — null (never scanned) must NOT
 *  read as "not installed", or it accuses the customer before we've even checked. */
function NnfAppBadge({ status }: { status: EnrollStatus }) {
  const { t } = useTranslation();
  if (status.nnf_app_installed == null) {
    return <Badge color="default" startIcon={<HelpCircle size={12} />}>{t('asset.mdm.step6.nnfUnknown')}</Badge>;
  }
  if (status.nnf_app_installed) {
    return (
      <>
        <Badge color="success" startIcon={<CheckCircle size={12} />}>{t('asset.mdm.step6.nnfInstalled')}</Badge>
        {status.nnf_app_checked_at && <span className="text-xs text-subtler"><RelativeDateTime value={status.nnf_app_checked_at} /></span>}
      </>
    );
  }
  return (
    <>
      <Badge color="warning" startIcon={<XCircle size={12} />}>{t('asset.mdm.step6.nnfNotInstalled')}</Badge>
      {status.nnf_app_checked_at && <span className="text-xs text-subtler"><RelativeDateTime value={status.nnf_app_checked_at} /></span>}
    </>
  );
}

/** Escrow (Activation-Lock bypass) key window. Order matters: check
 *  window_status==null FIRST (not enrolled), else has_code, else OK vs EXPIRED.
 *  has_code alone means nothing — an unenrolled device has has_code=false too. */
function EscrowBadge({ status }: { status: EnrollStatus }) {
  const { t } = useTranslation();
  if (status.escrow_window_status == null) {
    return <Badge color="default" startIcon={<HelpCircle size={12} />}>{t('asset.mdm.step6.escrowNotEnrolled')}</Badge>;
  }
  if (status.escrow_has_code) {
    return <Badge color="success" startIcon={<KeyRound size={12} />}>{t('asset.mdm.step6.escrowHasKey')}</Badge>;
  }
  if (status.escrow_window_status === 'OK') {
    return (
      <Badge color="warning" startIcon={<AlertTriangle size={12} />}>
        {t('asset.mdm.step6.escrowRacing', { days: status.escrow_days_remaining ?? 0 })}
      </Badge>
    );
  }
  return <Badge color="danger" startIcon={<XCircle size={12} />}>{t('asset.mdm.step6.escrowMissed')}</Badge>;
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
 *  Step 6 is informational (auto-detected badges) and never blocks handover. */
function remainingStepLabels(
  t: (k: string) => string,
  { enrollComplete, step7Done }: { enrollComplete: boolean; step7Done: boolean },
): string {
  const parts: string[] = [];
  if (!enrollComplete) parts.push(t('asset.mdm.readiness.stepEnroll'));
  if (!step7Done) parts.push(t('asset.mdm.readiness.step7'));
  return parts.join(', ');
}
