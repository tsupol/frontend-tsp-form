// ============================================================================
// §2 / §3.0 — "What's happening now" status box. Answers, at a glance: WHAT is
// happening, WHY, what's NEXT, and how it UNLOCKS — so a staffer taking a
// customer call ("why is my screen pink?") can answer without reading the queue.
//
// Driven by one column: `activity_code` picks icon/colour/headline. The rest are
// detail lines, each hidden when its source is null (null is a real answer — the
// device isn't under a live contract — never render "0 days").
//
// Two hard rules from the 2026-07-27 corrections:
//   - enforcement_level 0 = the baseline `light` lock (the floor, applied at
//     handover, stays the whole contract) — NOT "no restriction". The ladder /
//     dots only mean something for dunning (levels 1–3).
//   - the "how it unlocks" line comes ONLY from release_condition_code. Never
//     compose it from enforcement_origin_code (they contradicted on real
//     hardware). null release_condition ≠ unrestricted — hide the line.
//
// <MdmActivityCard> = full box (top of sub-tab 2).
// <MdmActivityLine> = one-line summary (above the dunning buttons, sub-tab 3).
// ============================================================================

import { useTranslation } from 'react-i18next';
import {
  ShieldOff, PauseCircle, LogOut, Loader2, ShieldAlert, WifiOff, CheckCircle2,
} from 'lucide-react';
import { RelativeDateTime } from './RelativeDateTime';
import type { AssetMdmStatus, MdmActivityCode } from './mdmApi';

// tsp-form .alert only has info/success/warning/danger — neutral maps to info.
type Tone = 'info' | 'warning' | 'danger' | 'success';

const ACTIVITY: Record<MdmActivityCode, { icon: typeof ShieldAlert; tone: Tone; spin?: boolean }> = {
  NOT_ENROLLED:       { icon: ShieldOff,    tone: 'info' },
  ENFORCEMENT_PAUSED: { icon: PauseCircle,  tone: 'warning' },
  LEFT_FLEET:         { icon: LogOut,       tone: 'info' },
  COMMAND_IN_FLIGHT:  { icon: Loader2,      tone: 'info', spin: true },
  ENFORCED:           { icon: ShieldAlert,  tone: 'danger' },
  DEVICE_UNREACHABLE: { icon: WifiOff,      tone: 'warning' },
  NORMAL:             { icon: CheckCircle2, tone: 'success' },
};

const ALERT_CLASS: Record<Tone, string> = {
  info: 'alert alert-info',
  warning: 'alert alert-warning',
  danger: 'alert alert-danger',
  success: 'alert alert-success',
};

// Compact pill tint for MdmActivityLine (an .alert would be too heavy there).
const PILL_CLASS: Record<Tone, string> = {
  info: 'bg-info-soft border-info-border text-info-fg',
  warning: 'bg-warning-soft border-warning-border text-warning-fg',
  danger: 'bg-danger-soft border-danger-border text-danger-fg',
  success: 'bg-success-soft border-success-border text-success-fg',
};

/** Enforcement level dots ●●○ — only meaningful for dunning (level ≥ 1). */
function LevelDots({ level, max }: { level: number; max: number }) {
  if (max <= 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5 ml-2" aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < level ? 'bg-current' : 'bg-current opacity-30'}`} />
      ))}
    </span>
  );
}

export function MdmActivityCard({ status }: { status: AssetMdmStatus }) {
  const { t } = useTranslation();
  const a = ACTIVITY[status.activity_code] ?? ACTIVITY.NORMAL;
  const Icon = a.icon;

  const isDunning = status.enforcement_level >= 1 && status.enforcement_level_max > 0;
  const showLevel = isDunning || status.activity_code === 'ENFORCED';

  // Why line — only when we have a real overdue figure (null = not under a live
  // contract → hide, don't show "0 days").
  const showWhy = status.overdue_days_effective != null;
  // GRACE bent the number → show the raw one alongside for transparency.
  const showRaw = status.overdue_days_raw != null
    && status.overdue_days_effective != null
    && status.overdue_days_raw !== status.overdue_days_effective;

  const showNext = status.next_level != null && status.days_until_next_level != null;
  const showRelease = status.release_condition_code != null;

  const originText = status.enforcement_origin_code !== 'NONE'
    ? t(`asset.mdm.activity.origin.${status.enforcement_origin_code}`, { defaultValue: '' })
    : '';

  return (
    <div className={ALERT_CLASS[a.tone]}>
      <Icon size={20} className={`shrink-0 ${a.spin ? 'animate-spin' : ''}`} />
      <div className="min-w-0 flex-1">
        {/* Headline: what + level */}
        <div className="alert-title flex items-center gap-2 flex-wrap">
          <span>{t(`asset.mdm.activity.code.${status.activity_code}`)}</span>
          {showLevel && (
            <span className="text-sm font-normal inline-flex items-center">
              {t('asset.mdm.activity.levelOf', { level: status.enforcement_level, max: status.enforcement_level_max })}
              <LevelDots level={status.enforcement_level} max={status.enforcement_level_max} />
            </span>
          )}
        </div>

        {/* Detail lines — full-size, labels not dimmed. */}
        <div className="alert-description flex flex-col gap-1 mt-1">
          {showWhy && (
            <div>
              <span className="text-subtle">{t('asset.mdm.activity.whyLabel')}: </span>
              {t('asset.mdm.activity.overdue', { count: status.overdue_days_effective! })}
              {showRaw && (
                <span className="text-subtle"> · {t('asset.mdm.activity.overdueRaw', { raw: status.overdue_days_raw! })}</span>
              )}
            </div>
          )}

          {showNext && (
            <div>
              <span className="text-subtle">{t('asset.mdm.activity.nextLabel')}: </span>
              {t('asset.mdm.activity.nextIn', { count: status.days_until_next_level! })}
            </div>
          )}

          {showRelease && (
            <div>
              <span className="text-subtle">{t('asset.mdm.activity.releaseLabel')}: </span>
              {t(`asset.mdm.activity.release.${status.release_condition_code}`)}
            </div>
          )}

          {originText && (
            <div>
              <span className="text-subtle">{t('asset.mdm.activity.byLabel')}: </span>{originText}
            </div>
          )}

          {/* What the system last did — always show the outcome, never bare "failed". */}
          {status.last_command_type && (
            <div>
              <span className="text-subtle">{t('asset.mdm.activity.lastLabel')}: </span>
              {t(`asset.mdm.intentType.${status.last_command_type}`, { defaultValue: status.last_command_type })}
              {status.last_command_state && <> · {t(`asset.mdm.activity.cmdState.${status.last_command_state}`)}</>}
              {status.last_command_state && status.last_command_state !== 'EXECUTED' && status.last_command_outcome_code && (
                <> · {t(`asset.mdm.outcome.${status.last_command_outcome_code}`, { defaultValue: status.last_command_outcome_code })}</>
              )}
              {status.last_command_at && <> · <RelativeDateTime value={status.last_command_at} relClassName="text-subtle" /></>}
            </div>
          )}

          {/* In-flight commands — name what's queued and say we're WAITING on the
              device (not "sending", which implies active progress). §0.3: tell a
              human story, never a bare perpetual spinner. */}
          {status.pending_command_count > 0 && (
            <div className="inline-flex items-center gap-1.5">
              <Loader2 size={14} className="animate-spin shrink-0" />
              <span>
                {status.pending_command_type
                  ? t('asset.mdm.activity.waitingFor', {
                      cmd: t(`asset.mdm.intentType.${status.pending_command_type}`, { defaultValue: status.pending_command_type }),
                    })
                  : t('asset.mdm.activity.waiting')}
                {status.pending_command_count > 1 && <> · {t('asset.mdm.activity.sending', { count: status.pending_command_count })}</>}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact one-liner for the top of the dunning tab — just what + level, so a
 *  staffer doesn't re-press something already in effect. */
export function MdmActivityLine({ status }: { status: AssetMdmStatus }) {
  const { t } = useTranslation();
  const a = ACTIVITY[status.activity_code] ?? ACTIVITY.NORMAL;
  const Icon = a.icon;
  const showLevel = status.enforcement_level >= 1 && status.enforcement_level_max > 0;
  return (
    <div className={`rounded-md border px-3 py-2 text-sm inline-flex items-center gap-2 ${PILL_CLASS[a.tone]}`}>
      <Icon size={15} className={`shrink-0 ${a.spin ? 'animate-spin' : ''}`} />
      <span className="font-medium">{t(`asset.mdm.activity.code.${status.activity_code}`)}</span>
      {showLevel && (
        <span className="inline-flex items-center">
          {t('asset.mdm.activity.levelOf', { level: status.enforcement_level, max: status.enforcement_level_max })}
          <LevelDots level={status.enforcement_level} max={status.enforcement_level_max} />
        </span>
      )}
    </div>
  );
}
