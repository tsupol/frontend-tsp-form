import { useMemo, useRef, useState } from 'react';
import { PopOver } from 'tsp-form';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/* ───────────────────────────────────────────────────────────────────────────
 * MonthPicker — month-only selector (no day concept). Shows "กรกฎาคม 2026" with
 * prev/next arrows; the label opens a year-stepper + 12-month grid popover.
 * Used by month-scoped reports whose RPCs only care about the month.
 * ─────────────────────────────────────────────────────────────────────────── */
/** Heights match tsp-form's form-control sizes, so a MonthPicker sitting next
 *  to a `size="sm"` Select lines up instead of standing 4px taller. */
const SIZE_H = { sm: 'h-7', md: 'h-8', lg: 'h-10' } as const;

export function MonthPicker({ value, onChange, lang, size = 'sm' }: {
  value: Date;
  onChange: (d: Date) => void;
  lang: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const locale = lang === 'th' ? 'th-TH' : 'en-GB';

  const monthLabel = value.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const monthNames = useMemo(
    () => Array.from({ length: 12 }, (_, m) =>
      new Date(2000, m, 1).toLocaleDateString(locale, { month: 'short' })),
    [locale],
  );

  const step = (delta: number) => onChange(new Date(value.getFullYear(), value.getMonth() + delta, 1));
  const pick = (m: number) => { onChange(new Date(viewYear, m, 1)); setOpen(false); };

  return (
    <div className={`input-group ${SIZE_H[size]}`}>
      <button
        type="button"
        className="flex items-center justify-center px-1.5 text-subtle hover:text-fg cursor-pointer bg-transparent border-none"
        aria-label="Previous month"
        onClick={() => step(-1)}
      >
        <ChevronLeft size={16} />
      </button>
      <div className="input-group-divider" />
      <button
        ref={triggerRef}
        type="button"
        className="flex-1 flex items-center justify-center px-2 text-sm cursor-pointer bg-transparent border-none whitespace-nowrap"
        onClick={() => { setViewYear(value.getFullYear()); setOpen(v => !v); }}
      >
        <span className="font-medium">{monthLabel}</span>
      </button>
      <div className="input-group-divider" />
      <button
        type="button"
        className="flex items-center justify-center px-1.5 text-subtle hover:text-fg cursor-pointer bg-transparent border-none"
        aria-label="Next month"
        onClick={() => step(1)}
      >
        <ChevronRight size={16} />
      </button>

      <PopOver isOpen={open} onClose={() => setOpen(false)} triggerRef={triggerRef} placement="bottom" align="center" maxWidth="18rem">
        <div className="p-2 w-64">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              className="btn-icon-sm cursor-pointer text-subtle hover:text-fg bg-transparent border-none"
              aria-label="Previous year"
              onClick={() => setViewYear(y => y - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-semibold text-sm tabular-nums">{viewYear}</span>
            <button
              type="button"
              className="btn-icon-sm cursor-pointer text-subtle hover:text-fg bg-transparent border-none"
              aria-label="Next year"
              onClick={() => setViewYear(y => y + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {monthNames.map((name, m) => {
              const selected = viewYear === value.getFullYear() && m === value.getMonth();
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => pick(m)}
                  className={`py-1.5 rounded-md text-sm cursor-pointer border-none transition-colors ${
                    selected
                      ? 'bg-item-active-bg text-item-active-fg font-medium'
                      : 'bg-transparent text-fg hover:bg-item-hover-bg'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      </PopOver>
    </div>
  );
}
