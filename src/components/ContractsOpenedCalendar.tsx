import { useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PopOver } from 'tsp-form';
import {
  DayBreakdown,
  fmtCompact,
  type DayHoliday,
  type DayPoint,
  type MonthlyRow,
} from './ContractsOpenedChart';

/* ───────────────────────────────────────────────────────────────────────────
 * Calendar view of รายงานเปิดสัญญา — the same month rows as the bar chart,
 * laid out Sunday→Saturday (the app's date pickers start on Sunday).
 * Each day: date · contracts (bold) · financed amount, abbreviated. The cell
 * background deepens with the day's contracts against the month's busiest day.
 * Saturday/Sunday columns are shaded; company holidays carry a label.
 * Hover (mouse) or tap (touch) a day → the same breakdown as the bar hover.
 * Spec: UI_FEEDBACK/2026-10-18_IMPLEMENT_report_contracts_opened_upgrade.md §2-3
 * ─────────────────────────────────────────────────────────────────────────── */

const HEAT_BG = ['', 'var(--chart-heat-1)', 'var(--chart-heat-2)', 'var(--chart-heat-3)', 'var(--chart-heat-4)'];

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Today's date in Bangkok as YYYY-MM-DD — days after it are left blank. */
function bangkokToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

interface Cell { iso: string; dayNum: number; inMonth: boolean; weekend: boolean }

export function ContractsOpenedCalendar({ month, points, branchRowsByDay, holidaysByDay, showCompany }: {
  month: Date;
  points: DayPoint[];
  branchRowsByDay?: Map<string, MonthlyRow[]>;
  holidaysByDay: Map<string, DayHoliday[]>;
  showCompany: boolean;
}) {
  const { t, i18n } = useTranslation();
  const today = bangkokToday();

  const pointByDay = useMemo(() => new Map(points.map(p => [p.day, p])), [points]);
  const maxContracts = useMemo(() => points.reduce((m, p) => Math.max(m, p.contracts), 0), [points]);

  const cells = useMemo<Cell[]>(() => {
    const y = month.getFullYear();
    const m = month.getMonth();
    const lead = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const total = Math.ceil((lead + daysInMonth) / 7) * 7;
    const out: Cell[] = [];
    for (let i = 0; i < total; i++) {
      const d = new Date(y, m, 1 - lead + i);
      const dow = d.getDay();
      out.push({
        iso: isoDate(d.getFullYear(), d.getMonth(), d.getDate()),
        dayNum: d.getDate(),
        inMonth: d.getMonth() === m,
        weekend: dow === 0 || dow === 6,
      });
    }
    return out;
  }, [month]);

  const weekdayLabels = useMemo(() => {
    const locale = i18n.language === 'th' ? 'th-TH' : 'en-GB';
    // 2023-01-01 is a Sunday.
    return Array.from({ length: 7 }, (_, i) =>
      new Date(2023, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }));
  }, [i18n.language]);

  // One popover for the whole grid, anchored to whichever day is open.
  const [openDay, setOpenDay] = useState<string | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const lastPointer = useRef<string>('mouse');
  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpenDay(null), 200);
  };
  // PopOver measures its anchor only when it opens, so moving to another day
  // closes it for a frame and reopens it on the new cell.
  const openAt = (el: HTMLElement, iso: string) => {
    cancelClose();
    if (openDay === iso) return;
    anchorRef.current = el;
    // flushSync so the close commits on its own — batched with the reopen,
    // the PopOver never sees it close and stays on the old cell.
    if (openDay) flushSync(() => setOpenDay(null));
    setOpenDay(iso);
  };

  const openPoint = openDay ? pointByDay.get(openDay) : undefined;

  return (
    <div className="select-none">
      <div className="grid grid-cols-7">
        {weekdayLabels.map((label, i) => (
          <div
            key={i}
            className={`text-center text-xs py-1.5 ${i === 0 || i === 6 ? 'bg-surface-hover text-subtle' : 'text-subtle'} ${i === 0 ? 'rounded-tl-md' : ''} ${i === 6 ? 'rounded-tr-md' : ''}`}
          >
            {label}
          </div>
        ))}

        {cells.map(c => {
          const p = c.inMonth ? pointByDay.get(c.iso) : undefined;
          const holidays = c.inMonth ? holidaysByDay.get(c.iso) : undefined;
          const future = c.iso > today;
          const contracts = p?.contracts ?? 0;
          const level = contracts > 0 && maxContracts > 0
            ? Math.min(4, Math.max(1, Math.ceil((contracts / maxContracts) * 4)))
            : 0;
          // A future holiday still opens, so its name is reachable on phones.
          const interactive = c.inMonth && !!p && (!future || !!holidays?.length);
          const isToday = c.iso === today;
          return (
            <div key={c.iso} className={`p-1 ${c.weekend ? 'bg-surface-hover' : ''}`}>
              <div
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                data-day={c.iso}
                className={`h-full min-h-14 sm:min-h-[4.5rem] rounded-md border px-1.5 py-1 flex flex-col
                  ${isToday ? 'border-primary' : 'border-line-subtle'}
                  ${interactive ? 'cursor-pointer hover:border-primary' : ''}
                  ${openDay === c.iso ? 'border-primary' : ''}
                  ${!c.inMonth ? 'opacity-40 border-transparent' : ''}
                  ${level === 4 ? 'text-primary-contrast' : ''}`}
                style={level ? { background: HEAT_BG[level] } : undefined}
                onPointerEnter={interactive ? (e) => { if (e.pointerType === 'mouse') openAt(e.currentTarget, c.iso); } : undefined}
                onPointerLeave={interactive ? (e) => { if (e.pointerType === 'mouse') scheduleClose(); } : undefined}
                onPointerDown={interactive ? (e) => { lastPointer.current = e.pointerType; } : undefined}
                onClick={interactive ? (e) => {
                  // Touch: tap toggles. Mouse: hover already opened it — keep it.
                  if (lastPointer.current !== 'mouse' && openDay === c.iso) { setOpenDay(null); return; }
                  openAt(e.currentTarget, c.iso);
                } : undefined}
                onKeyDown={interactive ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAt(e.currentTarget, c.iso); }
                } : undefined}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className={`text-xs tabular-nums ${level === 4 ? '' : isToday ? 'text-primary-fg font-semibold' : 'text-subtle'}`}>
                    {c.dayNum}
                  </span>
                  {holidays && holidays.length > 0 && (
                    <span className="text-[10px] leading-4 px-1 rounded bg-warning-soft text-warning-fg truncate min-w-0 max-sm:hidden">
                      {holidays.length > 1 && showCompany
                        ? t('contractsOpened.holidayCompanies', { count: holidays.length })
                        : holidays[0].description}
                    </span>
                  )}
                  {holidays && holidays.length > 0 && (
                    <span className="w-1.5 h-1.5 mt-1 rounded-full bg-warning sm:hidden" />
                  )}
                </div>
                {c.inMonth && !future && contracts > 0 && (
                  <div className="mt-auto flex flex-col items-end leading-tight">
                    <span className="text-base sm:text-lg font-semibold tabular-nums">{contracts}</span>
                    <span className={`text-[10px] tabular-nums max-sm:hidden ${level === 4 ? '' : 'text-subtle'}`}>
                      {fmtCompact(p!.agreed)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <PopOver
        isOpen={!!openPoint}
        onClose={() => setOpenDay(null)}
        triggerRef={anchorRef}
        placement="bottom"
        align="center"
        maxWidth="28rem"
        maxHeight="70vh"
        minWidth="12rem"
      >
        {/* The pointer may cross the gap onto the card and stay there — the
            short close delay covers the gap, entering the card cancels it. */}
        <div className="p-3 text-xs" onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
          {openPoint && (
            <DayBreakdown
              point={openPoint}
              branchRows={branchRowsByDay ? (branchRowsByDay.get(openPoint.day) ?? []) : undefined}
              holidays={holidaysByDay.get(openPoint.day)}
              showCompany={showCompany}
            />
          )}
        </div>
      </PopOver>
    </div>
  );
}
