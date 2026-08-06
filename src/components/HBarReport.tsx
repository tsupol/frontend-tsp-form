import type { ReactNode } from 'react';

/* ───────────────────────────────────────────────────────────────────────────
 * HBarReport — horizontal ranked-bar list. One row per category/model, bar
 * length proportional to `value`, a text label on the left and a free-form
 * `endLabel` on the right. Rows are rendered in the order given (callers must
 * NOT re-sort — the backend RPCs already return the intended order).
 *
 * A bar can be a single fill or a two-segment stack (`segments`): the segments
 * sum to `value` and lay out left→right, each with its own colour. Used by:
 *   - "เปิดสัญญาตามรุ่น" (opened-by-model): financed + down = agreed
 *   - "สัดส่วนค่าใช้จ่าย" (expense-by-category): single fill = total_amount
 * ─────────────────────────────────────────────────────────────────────────── */

export interface HBarSegment {
  value: number;
  /** CSS colour for this segment. */
  color: string;
  /** Legend/tooltip label for this segment. */
  label?: string;
}

export interface HBarRow {
  key: string | number;
  label: string;
  /** Total bar length driver — max across rows becomes 100%. */
  value: number;
  /** Optional 2+ segment breakdown; when omitted the bar is a single fill. */
  segments?: HBarSegment[];
  /** Right-aligned text (count · ฿amount · pct). */
  endLabel: ReactNode;
  /** Optional muted second line under the label. */
  sublabel?: string;
}

interface HBarReportProps {
  rows: HBarRow[];
  /** Single-fill colour when a row has no segments. */
  barColor?: string;
  /** Highlight a row (e.g. the "others" aggregate) with a fainter look. */
  isMuted?: (row: HBarRow) => boolean;
}

export function HBarReport({
  rows,
  barColor = 'var(--color-primary)',
  isMuted,
}: HBarReportProps) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const pctOfMax = (row.value / max) * 100;
        const muted = isMuted?.(row) ?? false;
        return (
          <div key={row.key} className="flex flex-col gap-0.5">
            {/* Label row: name left, end label right */}
            <div className="flex items-baseline justify-between gap-3 min-w-0">
              <div className="min-w-0">
                <span className={`text-sm truncate ${muted ? 'text-subtle italic' : 'text-fg'}`}>
                  {row.label}
                </span>
                {row.sublabel && (
                  <span className="ml-1.5 text-xs text-subtler">{row.sublabel}</span>
                )}
              </div>
              <div className="shrink-0 text-xs tabular-nums text-subtle whitespace-nowrap">
                {row.endLabel}
              </div>
            </div>
            {/* Bar track — deliberately slim. A ranked list is read down the
                labels; a tall bar turns each row into a block and the page
                stops scanning as a list. */}
            <div className="h-1.5 rounded bg-surface-soft overflow-hidden flex" style={{ width: `${pctOfMax}%`, minWidth: row.value > 0 ? '2px' : 0 }}>
              {row.segments && row.segments.length > 0 ? (
                row.segments.map((seg, i) => (
                  <div
                    key={i}
                    style={{
                      width: row.value > 0 ? `${(seg.value / row.value) * 100}%` : 0,
                      background: seg.color,
                    }}
                  />
                ))
              ) : (
                <div className="w-full" style={{ background: muted ? 'var(--color-subtler)' : barColor }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Small legend chips for the segment colours. */
export function HBarLegend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-4 text-xs text-subtle">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
