// ============================================================================
// The compact activity pill for the top of the dunning sub-tab (§3.0): what is
// in effect right now + which dunning rung, so a staffer doesn't re-press
// something already applied.
//
// The full "what's happening now" BOX that used to live here is gone — as of
// 2026-09-09 that box reads `v_asset_mdm_story`, where the DB composes every
// line (see MdmStoryBox.tsx). This file keeps only what the story view does not
// carry: the enforcement level and its ●●○ ladder, which come from
// `v_asset_mdm_status`.
//
// The level rule still applies: enforcement_level 0 is the baseline `light`
// lock applied at handover, NOT "no restriction" — dunning is levels 1–3, so
// only level ≥ 1 renders as a rung.
// ============================================================================

import { useTranslation } from 'react-i18next';
import {
  ShieldOff, PauseCircle, LogOut, Loader2, ShieldAlert, WifiOff, CheckCircle2,
} from 'lucide-react';
import type { AssetMdmStatus, MdmActivityCode } from './mdmApi';

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
