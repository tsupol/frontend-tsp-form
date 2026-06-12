import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, PopOver } from 'tsp-form';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface FilterBarItem {
  key: string;
  /** Width in px when rendered inline. Used for fit calculation. */
  width: number;
  /** The control node (Select / DatePicker / …). Must always render the same DOM whether inline or in the popover. */
  node: ReactNode;
  /**
   * Drop order. Higher priority = inlined first / dropped last.
   * Items with no priority default to 0.
   */
  priority?: number;
}

interface FilterBarProps {
  /** Always-inline leading slot (date range etc.). Takes remaining space when items are wide enough. */
  leading?: ReactNode;
  /** Minimum px the leading slot needs before items start filling */
  leadingMinWidth?: number;
  /** Optional cap on the leading slot's width — keeps a wide date picker from eating the whole bar */
  leadingMaxWidth?: number;
  items: FilterBarItem[];
  /** Gap between siblings, px. Should match the className gap. */
  gap?: number;
  /** Number of currently-set filters (for the overflow button badge) */
  activeCount?: number;
  className?: string;
}

const OVERFLOW_BUTTON_WIDTH = 36; // sm outline icon button

export function FilterBar({
  leading,
  leadingMinWidth = 200,
  leadingMaxWidth,
  items,
  gap = 8,
  activeCount = 0,
  className = '',
}: FilterBarProps) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [barWidth, setBarWidth] = useState(0);
  const [popoverOpen, setPopoverOpen] = useState(false);

  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    setBarWidth(el.clientWidth);
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setBarWidth(prev => (Math.abs(prev - w) < 1 ? prev : w));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Decide which items fit inline.
  // Strategy: sort by priority desc, greedily inline. If at least one item ends up
  // overflowing we reserve OVERFLOW_BUTTON_WIDTH + gap for the button.
  const { inlineKeys, overflowKeys } = useMemo(() => {
    if (barWidth === 0) {
      // First paint — hide everything inline (avoid flash). Items render in the popover.
      return { inlineKeys: new Set<string>(), overflowKeys: items.map(i => i.key) };
    }

    const sorted = [...items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    // Pass 1: assume no overflow button.
    const tryFit = (reserveOverflow: boolean): string[] => {
      const inline: string[] = [];
      const reservedLeading = leading ? leadingMinWidth + gap : 0;
      const reservedOverflow = reserveOverflow ? OVERFLOW_BUTTON_WIDTH + gap : 0;
      let used = reservedLeading + reservedOverflow;
      for (const it of sorted) {
        const cost = it.width + gap;
        if (used + cost <= barWidth) {
          inline.push(it.key);
          used += cost;
        }
      }
      return inline;
    };

    let inlineList = tryFit(false);
    if (inlineList.length < items.length) {
      // Some overflow — re-fit reserving space for the overflow button.
      inlineList = tryFit(true);
    }

    const inline = new Set(inlineList);
    const overflow = items.filter(it => !inline.has(it.key)).map(it => it.key);
    return { inlineKeys: inline, overflowKeys: overflow };
  }, [items, barWidth, gap, leading, leadingMinWidth]);

  // Close popover if it becomes empty after a resize.
  useEffect(() => {
    if (overflowKeys.length === 0 && popoverOpen) setPopoverOpen(false);
  }, [overflowKeys.length, popoverOpen]);

  const inlineItems = items.filter(it => inlineKeys.has(it.key));
  const overflowItems = items.filter(it => overflowKeys.includes(it.key));

  return (
    <div
      ref={barRef}
      className={`flex items-center gap-2 ${className}`}
    >
      {leading && (
        <div
          className="flex-1 min-w-0"
          style={leadingMaxWidth ? { maxWidth: leadingMaxWidth } : undefined}
        >
          {leading}
        </div>
      )}
      {inlineItems.map(it => (
        <div key={it.key} className="shrink-0" style={{ width: it.width }}>
          {it.node}
        </div>
      ))}
      {overflowItems.length > 0 && (
        <div className="relative shrink-0 ml-auto">
          <Button
            ref={triggerRef}
            variant="outline"
            size="sm"
            startIcon={<SlidersHorizontal size={16} />}
            aria-label={t('common.filters', { defaultValue: 'Filters' })}
            onClick={() => setPopoverOpen(v => !v)}
          />
          {activeCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[1rem] h-4 px-1 rounded-full bg-primary-fg text-white text-[10px] leading-4 text-center font-semibold pointer-events-none">
              {activeCount}
            </span>
          )}
          <PopOver
            isOpen={popoverOpen}
            onClose={() => setPopoverOpen(false)}
            triggerRef={triggerRef}
            placement="bottom"
            align="end"
            maxWidth="20rem"
          >
            <div className="flex flex-col gap-3 p-3 min-w-[16rem]">
              {overflowItems.map(it => (
                <div key={it.key}>{it.node}</div>
              ))}
            </div>
          </PopOver>
        </div>
      )}
    </div>
  );
}
