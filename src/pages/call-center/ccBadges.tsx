// Shared visual bits for the collection call-center: flag chips (DB-driven color),
// skip-reason badge, dunning-status badge. Colors come from v_ref_contract_flag_levels;
// labels come from FE i18n; unknown codes render raw with a neutral color.

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Badge, Tooltip } from 'tsp-form';
import { AlertTriangle, Cpu, User, Wrench, Store, Repeat, CalendarClock, ExternalLink } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { flagColor, type FlagLevelRef } from './callCenterApi';

function flagLabel(t: (k: string, o?: Record<string, unknown>) => string, code: string): string {
  const translated = t(`callCenter.flagLevel.${code}`, { defaultValue: '' });
  return translated || code;
}

function flagRank(levels: FlagLevelRef[] | undefined, code: string): number | null {
  return levels?.find(l => l.code === code)?.severity_rank ?? null;
}

/** A single flag: source icon tinted with the level color + the level label.
 *  No dot — the icon's color IS the level; its shape (cpu/user) is the source.
 *  Detail-panel style (labels visible). List rows use FlagDot instead. */
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

/** A single flag as a colored circle with its severity_rank number inside.
 *  Colour-blind safe: the number distinguishes levels when hue can't (green/red).
 *  title + aria-label carry the full "Auto: Orange (3)" text for screen readers.
 *  `emphasize` thickens the ring (used on the Auto dot when flags diverge). */
function FlagDot({
  code, levels, source, emphasize = false,
}: {
  code: string;
  levels: FlagLevelRef[] | undefined;
  source: 'auto' | 'manual';
  emphasize?: boolean;
}) {
  const { t } = useTranslation();
  const color = flagColor(levels, code);
  const rank = flagRank(levels, code);
  const sourceWord = t(source === 'auto' ? 'callCenter.flagAuto' : 'callCenter.flagManual');
  const full = `${sourceWord}: ${flagLabel(t, code)}${rank != null ? ` (${rank})` : ''}`;
  // WHITE (rank 0) needs dark text; the rest read on white.
  const textOnDot = code === 'WHITE' ? '#374151' : '#ffffff';
  return (
    <span
      title={full}
      aria-label={full}
      role="img"
      className={`inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0 text-[9px] font-semibold leading-none tabular-nums ${
        emphasize ? 'ring-2 ring-offset-1 ring-warning-fg' : ''
      }`}
      style={{ backgroundColor: color, color: textOnDot }}
    >
      {rank ?? ''}
    </span>
  );
}

/**
 * Auto + manual flag pair, shown side by side (never merged).
 *
 * `compact` (dense list rows): two colored circles with the severity_rank
 *   number inside + short "Auto:"/"Manual:" prefixes — no level text. When the
 *   flags diverge the Auto circle gets a warning ring (no words).
 * `showLabels` (detail panel): source icon + full level label per flag, plus a
 *   warning marker on divergence.
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

  if (compact) {
    return (
      <span className="inline-flex items-center gap-2 text-[11px] text-subtle">
        <span className="inline-flex items-center gap-1">
          {t('callCenter.flagAuto')}:
          <FlagDot code={auto} levels={levels} source="auto" emphasize={divergent} />
        </span>
        <span className="inline-flex items-center gap-1">
          {t('callCenter.flagManual')}:
          <FlagDot code={manual} levels={levels} source="manual" />
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-3">
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

/** Device-context badges: in-repair / deposited / has-loaner. Each is a distinct
 *  business signal for the collector — "may not truly be in default" / "we hold
 *  their device" / "another company asset is out with them". `loanerProminent`
 *  bumps the loaner chip to a solid danger fill for the repo team. */
export function DeviceContextBadges({
  inRepair, deposited, hasLoaner, loanerProminent = false,
}: {
  inRepair: boolean;
  deposited: boolean;
  hasLoaner: boolean;
  loanerProminent?: boolean;
}) {
  const { t } = useTranslation();
  if (!inRepair && !deposited && !hasLoaner) return null;
  return (
    <>
      {inRepair && (
        <Badge size="sm" color="info">
          <Wrench size={11} className="inline -mt-0.5 mr-0.5" />{t('callCenter.deviceInRepair')}
        </Badge>
      )}
      {deposited && (
        <Badge size="sm" color="warning">
          <Store size={11} className="inline -mt-0.5 mr-0.5" />{t('callCenter.deviceDeposited')}
        </Badge>
      )}
      {hasLoaner && (
        <Badge size="sm" color={loanerProminent ? 'danger' : 'info'}>
          <Repeat size={11} className="inline -mt-0.5 mr-0.5" />{t('callCenter.hasLoaner')}
        </Badge>
      )}
    </>
  );
}

/** "มีนัด <date>" badge — an open promise-to-pay. Dunning is suppressed while
 *  it stands, so this tells the collector not to call again. */
export function AppointmentBadge({ date }: { date: string | null }) {
  const { t } = useTranslation();
  if (!date) return null;
  return (
    <Badge size="sm" color="success">
      <CalendarClock size={11} className="inline -mt-0.5 mr-0.5" />
      {t('callCenter.appointmentOn')} <DateTime value={date} showTime={false} />
    </Badge>
  );
}

/** "Product (code)" where the code links to the asset page. Used for both the
 *  bound device and the loaner (mig 883/885). code is the clickable part. */
export function DeviceLink({
  deviceId, code, product, className = '',
}: {
  deviceId: number | null;
  code: string | null;
  product: string | null;
  className?: string;
}) {
  const navigate = useNavigate();
  if (!code && !product) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
      {product && <span className="truncate">{product}</span>}
      {code && (
        deviceId ? (
          <button
            type="button"
            onClick={() => navigate(`/admin/inventory/assets/${deviceId}`)}
            className="shrink-0 text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer font-mono text-xs"
          >
            {code}<ExternalLink size={11} />
          </button>
        ) : (
          <span className="shrink-0 font-mono text-xs text-subtle">{code}</span>
        )
      )}
    </span>
  );
}
