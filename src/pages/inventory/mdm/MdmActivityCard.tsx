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

type Tone = 'neutral' | 'warning' | 'info' | 'danger' | 'success';

const ACTIVITY: Record<MdmActivityCode, { icon: typeof ShieldAlert; tone: Tone; spin?: boolean }> = {
  NOT_ENROLLED:       { icon: ShieldOff,    tone: 'neutral' },
  ENFORCEMENT_PAUSED: { icon: PauseCircle,  tone: 'warning' },
  LEFT_FLEET:         { icon: LogOut,       tone: 'neutral' },
  COMMAND_IN_FLIGHT:  { icon: Loader2,      tone: 'info', spin: true },
  ENFORCED:           { icon: ShieldAlert,  tone: 'danger' },
  DEVICE_UNREACHABLE: { icon: WifiOff,      tone: 'warning' },
  NORMAL:             { icon: CheckCircle2, tone: 'success' },
};

const TONE_BOX: Record<Tone, string> = {
  neutral: 'bg-surface border-line text-subtle',
  warning: 'bg-warning-soft border-warning-border text-warning-fg',
  info: 'bg-info-soft border-info-border text-info-fg',
  danger: 'bg-danger-soft border-danger-border text-danger-fg',
  success: 'bg-success-soft border-success-border text-success-fg',
};

/** Enforcement level dots ●●○ — only meaningful for dunning (level ≥ 1). */
function LevelDots({ level, max }: { level: number; max: number }) {
  if (max <= 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5 ml-1" aria-hidden>
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
    <div className={`rounded-md border px-4 py-3 ${TONE_BOX[a.tone]}`}>
      {/* Header: what + level */}
      <div className="flex items-center gap-2">
        <Icon size={18} className={`shrink-0 ${a.spin ? 'animate-spin' : ''}`} />
        <span className="text-sm font-semibold">
          {t(`asset.mdm.activity.code.${status.activity_code}`)}
        </span>
        {showLevel && (
          <span className="text-xs opacity-90 inline-flex items-center">
            {t('asset.mdm.activity.levelOf', { level: status.enforcement_level, max: status.enforcement_level_max })}
            <LevelDots level={status.enforcement_level} max={status.enforcement_level_max} />
          </span>
        )}
      </div>

      {/* Detail lines */}
      <div className="mt-1.5 flex flex-col gap-1 text-xs opacity-90">
        {showWhy && (
          <div>
            <span className="opacity-70">{t('asset.mdm.activity.whyLabel')}: </span>
            {t('asset.mdm.activity.overdue', { count: status.overdue_days_effective! })}
            {showRaw && (
              <span className="opacity-70"> · {t('asset.mdm.activity.overdueRaw', { raw: status.overdue_days_raw! })}</span>
            )}
          </div>
        )}

        {showNext && (
          <div>
            <span className="opacity-70">{t('asset.mdm.activity.nextLabel')}: </span>
            {t('asset.mdm.activity.nextIn', { count: status.days_until_next_level! })}
          </div>
        )}

        {showRelease && (
          <div>
            <span className="opacity-70">{t('asset.mdm.activity.releaseLabel')}: </span>
            {t(`asset.mdm.activity.release.${status.release_condition_code}`)}
          </div>
        )}

        {originText && (
          <div>
            <span className="opacity-70">{t('asset.mdm.activity.byLabel')}: </span>{originText}
          </div>
        )}

        {/* What the system last did — always show the outcome, never bare "failed". */}
        {status.last_command_type && (
          <div className="opacity-70">
            {t('asset.mdm.activity.lastLabel')}: {t(`asset.mdm.intentType.${status.last_command_type}`, { defaultValue: status.last_command_type })}
            {status.last_command_state && <> · {t(`asset.mdm.activity.cmdState.${status.last_command_state}`)}</>}
            {status.last_command_state && status.last_command_state !== 'EXECUTED' && status.last_command_outcome_code && (
              <> · {t(`asset.mdm.outcome.${status.last_command_outcome_code}`, { defaultValue: status.last_command_outcome_code })}</>
            )}
            {status.last_command_at && <> · <RelativeDateTime value={status.last_command_at} /></>}
          </div>
        )}

        {/* In-flight commands. */}
        {status.pending_command_count > 0 && (
          <div className="inline-flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            {t('asset.mdm.activity.sending', { count: status.pending_command_count })}
          </div>
        )}
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
    <div className={`rounded-md border px-3 py-2 text-xs inline-flex items-center gap-2 ${TONE_BOX[a.tone]}`}>
      <Icon size={14} className={`shrink-0 ${a.spin ? 'animate-spin' : ''}`} />
      <span className="font-medium">{t(`asset.mdm.activity.code.${status.activity_code}`)}</span>
      {showLevel && (
        <span className="opacity-90 inline-flex items-center">
          {t('asset.mdm.activity.levelOf', { level: status.enforcement_level, max: status.enforcement_level_max })}
          <LevelDots level={status.enforcement_level} max={status.enforcement_level_max} />
        </span>
      )}
    </div>
  );
}
