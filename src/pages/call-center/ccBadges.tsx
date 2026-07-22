// Shared visual bits for the collection call-center: flag chips (DB-driven color),
// skip-reason badge, dunning-status badge. Colors come from v_ref_contract_flag_levels;
// labels come from FE i18n; unknown codes render raw with a neutral color.

import { useTranslation } from 'react-i18next';
import { Badge, Tooltip } from 'tsp-form';
import { AlertTriangle, Cpu, User } from 'lucide-react';
import { flagColor, type FlagLevelRef } from './callCenterApi';

function flagLabel(t: (k: string, o?: Record<string, unknown>) => string, code: string): string {
  const translated = t(`callCenter.flagLevel.${code}`, { defaultValue: '' });
  return translated || code;
}

/** A single flag: source icon tinted with the level color + the level label.
 *  No dot — the icon's color IS the level; its shape (cpu/user) is the source. */
export function FlagChip({
  code,
  levels,
  source,
  showSourceLabel = false,
}: {
  code: string;
  levels: FlagLevelRef[] | undefined;
  source: 'auto' | 'manual';
  /** Also render the source word ("auto"/"manual") before the level. */
  showSourceLabel?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = source === 'auto' ? Cpu : User;
  const color = flagColor(levels, code);
  const sourceWord = t(source === 'auto' ? 'callCenter.flagAuto' : 'callCenter.flagManual');
  return (
    <Tooltip content={`${sourceWord}: ${flagLabel(t, code)}`}>
      <span className="inline-flex items-center gap-1 text-xs">
        <Icon size={13} className="shrink-0" style={{ color }} />
        {showSourceLabel && <span className="text-subtle">{sourceWord}</span>}
        <span>{flagLabel(t, code)}</span>
      </span>
    </Tooltip>
  );
}

/**
 * Auto + manual flag pair, shown side by side (never merged). Each flag is a
 * source icon (cpu=auto / user=manual) tinted with the level color + the level
 * label — no dots. When they diverge, a warning marker prompts reading the
 * history first.
 *
 * `compact` (dense list rows): icon + level label only.
 * `showLabels` (detail panel): also prefix each with the source word.
 */
export function FlagPair({
  auto,
  manual,
  divergent,
  levels,
  showLabels = false,
  compact = false,
}: {
  auto: string;
  manual: string;
  divergent: boolean;
  levels: FlagLevelRef[] | undefined;
  showLabels?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center ${compact ? 'gap-2' : 'gap-3'}`}>
      <FlagChip code={auto} levels={levels} source="auto" showSourceLabel={showLabels} />
      <FlagChip code={manual} levels={levels} source="manual" showSourceLabel={showLabels} />
      {divergent && (
        <Tooltip content={t('callCenter.flagDivergent')}>
          <AlertTriangle size={13} className="text-warning-fg shrink-0" />
        </Tooltip>
      )}
    </span>
  );
}

/** "System paused dunning" badge — shown, never hides the row. */
export function SkipReasonBadge({ reason }: { reason: string | null }) {
  const { t } = useTranslation();
  if (!reason) return null;
  const label = t(`callCenter.skipReason.${reason}`, { defaultValue: reason });
  return <Badge size="sm" color="warning">{label}</Badge>;
}

export function DunningStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  if (status === 'ACTIVE') return null; // active is the default — no badge noise
  const label = t(`callCenter.dunningStatus.${status}`, { defaultValue: status });
  const color = status === 'WAIT_FOR_LEGAL' ? 'danger' : 'info';
  return <Badge size="sm" color={color}>{label}</Badge>;
}
