// ============================================================================
// Sub-tab 1 — เตรียมเครื่อง (enroll → readiness). §6 reframes the old 5-step
// enroll strip as a 7-step READINESS CHECKLIST answering one question at the top:
// "is this device ready to hand to a customer?"
//
//   1–5  enrollment (unchanged, derived from mdm_status): serial, ABM scan,
//        send-enrollment [button], wipe, device reports in.
//   6    customer signs into iCloud + installs the NNF app. Apple can't report
//        iCloud state, so the system NEVER blocks — the staffer TICKS two
//        confirmations (§6.3). nnf_app_installed helps pre-tick the app one.
//   7    baseline lock — fn_mdm_apply_device_policy (preview→confirm), MDM.PROFILE.
//
// ⛔ Step 6 MUST precede step 7 (§6.1): the light profile sets
//    allowAccountModification:false, so once step 7 fires the customer can no
//    longer sign into iCloud. So step 7 stays disabled until both step-6 boxes
//    are ticked.
//
// Readiness summary = steps 1–5 done  +  both step-6 ticks  +  enforcement_level>=1
// (step-7 done-ness is read from enforcement_level, NOT preset_level — §6.4).
// ============================================================================

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from 'tsp-form';
import {
  ShieldCheck, RefreshCw, Send, CheckCircle, AlertTriangle, Loader2,
  Fingerprint, ScanLine, RotateCcw, Smartphone, XCircle, Lock, Cloud, CircleDashed,
  PackageCheck, PackageOpen,
} from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { DateTime } from '../../../components/DateTime';
import { RelativeDateTime } from './RelativeDateTime';
import { applyDevicePolicy, type AssetMdmStatus, type MdmStatusCode, type ApplyDevicePolicyResult } from './mdmApi';
import { parseMdmError } from './mdmApi';

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
        <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
          state === 'current' ? 'bg-primary border-primary text-primary-contrast'
            : state === 'done' ? 'bg-success border-success text-success-contrast'
              : 'bg-surface border-line text-subtle'
        }`}>
          {state === 'done' ? <CheckCircle size={17} /> : <Icon size={16} />}
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
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [justPrepared, setJustPrepared] = useState(false);

  // Step-6 self-confirmations (§6.3). NNF-app box pre-ticks when the device
  // actually reports the app installed; the iCloud box is always manual.
  const [icloudOk, setIcloudOk] = useState(false);
  const [nnfAppOk, setNnfAppOk] = useState(false);
  useEffect(() => {
    // Pre-tick the app box only on a firm `true` — null (never pulled) ≠ false.
    if (status.nnf_app_installed === true) setNnfAppOk(true);
  }, [status.nnf_app_installed]);

  useEffect(() => {
    if (status.mdm_status !== 'PREPARING' && status.mdm_status !== 'PROFILE_READY') setJustPrepared(false);
  }, [status.mdm_status]);

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
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
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
  const step6Complete = icloudOk && nnfAppOk;           // both ticks
  const step7Done = status.enforcement_level >= 1;      // baseline lock present (§6.4)
  const readyToHandOver = enrollComplete && step6Complete && step7Done;

  // Step-7 apply flow (preview→confirm).
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<ApplyDevicePolicyResult | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyErr, setPolicyErr] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const openStep7 = async () => {
    setPolicyErr(null);
    setPreview(null);
    setConfirmOpen(true);
    setPolicyBusy(true);
    try {
      setPreview(await applyDevicePolicy(status.asset_id, true));
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
      await applyDevicePolicy(status.asset_id, false);
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

  // Step 7 state for the strip.
  const step7State: StepStatus = step7Done ? 'done' : (enrollComplete && step6Complete ? 'current' : 'todo');
  const step6State: StepStatus = step6Complete ? 'done' : (enrollComplete ? 'current' : 'todo');

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
              {t('asset.mdm.readiness.remaining', { steps: remainingStepLabels(t, { enrollComplete, step6Complete, step7Done }) })}
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
                {/* Step 3 owns the send-enrollment button. */}
                {isSendStep && showPrepareButton && (
                  <Button
                    color="primary"
                    size="sm"
                    startIcon={isRetry ? <RotateCcw size={15} /> : <Send size={15} />}
                    onClick={() => prepare.mutate()}
                    disabled={prepare.isPending}
                  >
                    {isRetry ? t('asset.mdm.button.retry') : t('asset.mdm.button.prepare')}
                  </Button>
                )}
                {isSendStep && status.can_prepare && !status.may_prepare && (
                  <div className="text-xs text-subtler">{t('asset.mdm.noPermission')}</div>
                )}
              </StepRow>
            );
          })}

          {/* Step 6 — customer iCloud + NNF app (staffer-confirmed). */}
          <StepRow
            n={6}
            icon={Cloud}
            title={t('asset.mdm.step6.title')}
            state={step6State}
          >
            <div className="flex flex-col gap-2">
              <label className={`flex items-start gap-2 text-sm ${enrollComplete ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={icloudOk}
                  disabled={!enrollComplete || step7Done}
                  onChange={(e) => setIcloudOk(e.target.checked)}
                />
                <span>{t('asset.mdm.step6.icloud')}</span>
              </label>
              <label className={`flex items-start gap-2 text-sm ${enrollComplete ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={nnfAppOk}
                  disabled={!enrollComplete || step7Done}
                  onChange={(e) => setNnfAppOk(e.target.checked)}
                />
                <span>
                  {t('asset.mdm.step6.nnfApp')}
                  <NnfAppHint status={status} />
                </span>
              </label>
            </div>
          </StepRow>

          {/* Step 7 — baseline lock. */}
          <StepRow
            n={7}
            icon={Lock}
            title={t('asset.mdm.step7.title')}
            state={step7State}
            last
          >
            {step7Done ? (
              <div className="text-xs text-success-fg inline-flex items-center gap-1">
                <CheckCircle size={13} />
                {t('asset.mdm.step7.done')}
                {status.enforcement_verify_state === 'PENDING' && <span className="text-warning-fg ml-1">· {t('asset.mdm.step7.verifyPending')}</span>}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-subtle">{t('asset.mdm.step7.desc')}</p>
                {status.may_profile ? (
                  <div>
                    <Button
                      color="primary"
                      size="sm"
                      startIcon={<Lock size={15} />}
                      disabled={!enrollComplete || !step6Complete}
                      onClick={openStep7}
                    >
                      {t('asset.mdm.step7.button')}
                    </Button>
                    {enrollComplete && !step6Complete && (
                      <div className="text-xs text-warning-fg mt-1 inline-flex items-center gap-1">
                        <AlertTriangle size={12} />{t('asset.mdm.step7.needStep6')}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-subtler">{t('asset.mdm.step7.noPermission')}</div>
                )}
                {applied && (
                  <div className="text-xs text-info-fg inline-flex items-center gap-1">
                    <CircleDashed size={13} className="animate-spin" />{t('asset.mdm.step7.applied')}
                  </div>
                )}
              </div>
            )}
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
                <AlertTriangle size={16} />
                <div className="alert-description">{t('asset.mdm.step7.irreversibleNote')}</div>
              </div>
              <ul className="text-xs text-subtle mt-3 flex flex-col gap-1">
                {Object.keys(preview.restriction_flags).map((flag) => (
                  <li key={flag} className="inline-flex items-center gap-1.5">
                    <Lock size={11} className="shrink-0" />
                    {t(`asset.mdm.step7.flag.${flag}`, { defaultValue: flag })}
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

/** Inline helper under the NNF-app checkbox: distinguishes false (pulled, absent)
 *  from null (never pulled) per §6.3 — null must NOT read as "not installed". */
function NnfAppHint({ status }: { status: EnrollStatus }) {
  const { t } = useTranslation();
  if (status.nnf_app_installed === true) {
    return <span className="text-xs text-success-fg ml-1">· {t('asset.mdm.step6.nnfFound')}</span>;
  }
  if (status.nnf_app_installed === false) {
    return (
      <span className="text-xs text-warning-fg ml-1">
        · {t('asset.mdm.step6.nnfMissing')}
        {status.nnf_app_checked_at && <> (<RelativeDateTime value={status.nnf_app_checked_at} />)</>}
      </span>
    );
  }
  return <span className="text-xs text-subtler ml-1">· {t('asset.mdm.step6.nnfUnknown')}</span>;
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

/** Comma-joined labels of the still-incomplete groups, for the summary line. */
function remainingStepLabels(
  t: (k: string) => string,
  { enrollComplete, step6Complete, step7Done }: { enrollComplete: boolean; step6Complete: boolean; step7Done: boolean },
): string {
  const parts: string[] = [];
  if (!enrollComplete) parts.push(t('asset.mdm.readiness.stepEnroll'));
  if (!step6Complete) parts.push(t('asset.mdm.readiness.step6'));
  if (!step7Done) parts.push(t('asset.mdm.readiness.step7'));
  return parts.join(', ');
}
