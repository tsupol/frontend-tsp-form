// Cross-module dunning timeline — read-only fan-out view across the 3
// dunning modules. Reads all 3 module lists in parallel via useDunningStages,
// merges by day, and renders 3 horizontal lanes over a shared day axis.
// (The former `ops`/call-center lane was removed 2026-07-28 — obsolete
// call-ticket ladder.)
//
// Open-ended stages (day_to == null) are drawn with a trailing arrow off the
// right edge to signal "continues indefinitely."

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MobileHeader } from 'tsp-form';
import { ArrowRightFromLine, Bell, ShieldBan, Scale } from 'lucide-react';
import { useDunningStages } from '../dunning/useDunningStages';
import type { DunningModule, DunningStageRow } from '../dunning/dunningTypes';

const LANES: { module: DunningModule; icon: React.ReactNode; labelKey: string; color: string }[] = [
  { module: 'notif',     icon: <Bell size={14} />,     labelKey: 'dunningSystem.tab_notif',     color: 'var(--color-info-fg, #3b82f6)' },
  { module: 'blacklist', icon: <ShieldBan size={14} />, labelKey: 'dunningSystem.tab_blacklist', color: 'var(--color-danger, #ef4444)' },
  { module: 'legal',     icon: <Scale size={14} />,    labelKey: 'dunningSystem.tab_legal',     color: 'var(--color-danger, #ef4444)' },
];

// Axis bounds — explicit so all lanes share the same scale.
// Spec: UI_SUMMARY/112 §7.2 — range −2…+70 (covers all module ranges),
// tick labels −2 / 0 / +1 / +3 / +7 / +15 / +21 / +30 / +45 / +60.
const AXIS_MIN = -2;
const AXIS_MAX = 70;
const AXIS_TICKS = [-2, 0, 1, 3, 7, 15, 21, 30, 45, 60];

export function TimelineOverviewPage() {
  const { t } = useTranslation();

  // Pull all 3 module lists. Each hook fires its own query; they run in
  // parallel naturally via React Query.
  const notif     = useDunningStages('notif');
  const blacklist = useDunningStages('blacklist');
  const legal     = useDunningStages('legal');

  const isLoading = notif.isLoading || blacklist.isLoading || legal.isLoading;

  const rowsByModule = useMemo(() => ({
    notif:     notif.rows,
    blacklist: blacklist.rows,
    legal:     legal.rows,
  }), [notif.rows, blacklist.rows, legal.rows]);

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('nav.timelineOverview')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content">
        <div className="mb-6 max-md:hidden">
          <h1 className="heading-2">{t('nav.timelineOverview')}</h1>
          <p className="text-sm text-subtle mt-1">{t('dunningSystem.timelineDescription')}</p>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-sm text-subtle">{t('common.loading')}</div>
        ) : (
          <div className="border border-line rounded-md p-4 overflow-x-auto">
            <div className="min-w-[40rem]">
              {/* Axis (top) — mirror the lane structure (w-32 label spacer +
                  flex-1 track) so tick % and dot % share one coordinate origin.
                  Positioning ticks by a full-container % + 8rem (as before)
                  put them ~30px right of where the track maps the same day. */}
              <div className="flex items-end mb-2 h-6 border-b border-line">
                <div className="w-32 shrink-0" />
                <div className="flex-1 relative h-full">
                  {AXIS_TICKS.map(tick => (
                    <span
                      key={tick}
                      className="absolute bottom-0 text-[10px] text-subtle tabular-nums"
                      style={{ left: `${positionPct(tick)}%`, transform: 'translateX(-50%)' }}
                    >
                      {tick > 0 ? `+${tick}` : tick}
                    </span>
                  ))}
                </div>
              </div>

              {/* Lanes */}
              {LANES.map(lane => {
                const rows = rowsByModule[lane.module];
                return (
                  <div key={lane.module} className="flex items-center py-3 border-b border-line last:border-b-0">
                    {/* Lane label */}
                    <div className="w-32 shrink-0 flex items-center gap-2 text-sm">
                      <span style={{ color: lane.color }}>{lane.icon}</span>
                      <span className="truncate">{t(lane.labelKey)}</span>
                    </div>
                    {/* Lane track */}
                    <div className="flex-1 relative h-6">
                      <div className="absolute inset-y-1/2 -translate-y-px left-0 right-0 h-px bg-line" />
                      {rows.map(row => (
                        <StageDot key={row.stage} row={row} laneColor={lane.color} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend */}
        {!isLoading && (
          <div className="mt-4 text-xs text-subtle flex flex-wrap gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-current" />
              {t('dunningSystem.timelineLegendStage')}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-px bg-current align-middle" />
              {t('dunningSystem.timelineLegendOpenEnded')}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

function StageDot({ row, laneColor }: { row: DunningStageRow; laneColor: string }) {
  // effective is null when the holding hasn't overridden this stage — the
  // template (system default) is then what's actually applied.
  const eff = row.effective ?? row.template;
  const isOpenEnded = eff.day_to == null;
  const left = positionPct(eff.day_from);
  const isPointStage = eff.day_to != null && eff.day_to === eff.day_from;

  // If the stage spans a window, draw a pill from day_from to day_to. If it's
  // a point (from===to) or open-ended, draw a dot at day_from with an
  // optional trailing line for open-ended.
  //
  // Native `title` tooltip (not tsp-form's) per request — the marker is a bare
  // element so the browser shows the plain-text summary on hover.
  const title = stageTitle(row);
  return isPointStage || isOpenEnded ? (
    <span
      className="absolute top-1/2 -translate-y-1/2 inline-flex items-center"
      style={{ left: `${left}%` }}
      title={title}
    >
      <span
        className="inline-block w-2 h-2 rounded-full ring-2 ring-bg"
        style={{ background: laneColor }}
      />
      {isOpenEnded && (
        <span
          className="ml-0.5 inline-block h-0.5"
          style={{ background: laneColor, width: `calc(${100 - left}% - 0.5rem)` }}
        />
      )}
    </span>
  ) : (
    <span
      className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full ring-2 ring-bg"
      style={{
        left: `${left}%`,
        width: `calc(${positionPct(eff.day_to!) - left}%)`,
        background: laneColor,
        minWidth: '0.5rem',
      }}
      title={title}
    />
  );
}

// Plain-text summary for the native `title` tooltip: "stage · days · extra · custom".
function stageTitle(row: DunningStageRow): string {
  const eff = row.effective ?? row.template;
  const dayLabel = eff.day_to == null
    ? `${formatDay(eff.day_from)}…`
    : eff.day_to === eff.day_from
      ? formatDay(eff.day_from)
      : `${formatDay(eff.day_from)} → ${formatDay(eff.day_to)}`;
  const extra = row.event_type ?? eff.reason_code ?? eff.action_code ?? null;
  return [
    row.stage,
    row.description,
    dayLabel,
    extra,
    row.effective?.is_custom ? 'custom' : null,
  ].filter(Boolean).join(' · ');
}

function positionPct(day: number): number {
  const clamped = Math.max(AXIS_MIN, Math.min(AXIS_MAX, day));
  return ((clamped - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * 100;
}

function formatDay(day: number): string {
  return day > 0 ? `+${day}` : String(day);
}
