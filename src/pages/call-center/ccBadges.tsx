// Shared visual bits for the collection call-center: flag chips (DB-driven color),
// skip-reason badge, dunning-status badge. Colors come from v_ref_contract_flag_levels;
// labels come from FE i18n; unknown codes render raw with a neutral color.

import { useTranslation } from 'react-i18next';
import { Badge, Tooltip } from 'tsp-form';
import { AlertTriangle } from 'lucide-react';
import { flagColor, type FlagLevelRef } from './callCenterApi';

function flagLabel(t: (k: string, o?: Record<string, unknown>) => string, code: string): string {
  const translated = t(`callCenter.flagLevel.${code}`, { defaultValue: '' });
  return translated || code;
}

/** A single flag chip — colored dot from DB hex + i18n label. */
export function FlagChip({
  code,
  levels,
  prefix,
}: {
  code: string;
  levels: FlagLevelRef[] | undefined;
  prefix?: string;
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: flagColor(levels, code) }}
      />
      {prefix && <span className="text-subtle">{prefix}</span>}
      <span>{flagLabel(t, code)}</span>
    </span>
  );
}

/**
 * Auto + manual flag pair, shown side by side (never merged). When they diverge,
 * a warning marker prompts reading the history first.
 */
export function FlagPair({
  auto,
  manual,
  divergent,
  levels,
  showLabels = false,
}: {
  auto: string;
  manual: string;
  divergent: boolean;
  levels: FlagLevelRef[] | undefined;
  showLabels?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-2">
      <FlagChip code={auto} levels={levels} prefix={showLabels ? t('callCenter.flagAuto') : undefined} />
      <span className="text-subtler">·</span>
      <FlagChip code={manual} levels={levels} prefix={showLabels ? t('callCenter.flagManual') : undefined} />
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
