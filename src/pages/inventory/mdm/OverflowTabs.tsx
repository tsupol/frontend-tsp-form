// ============================================================================
// OverflowTabs — a tab strip that shows as many tabs as fit the container and
// folds the rest into a "More ▾" popover. Built for the MDM sub-tabs (up to 7)
// in a narrow detail panel where a plain strip would always be cramped.
//
// How it fits: an off-screen measurement pass renders every tab once to learn
// its width, then a ResizeObserver on the container decides how many fit
// (reserving room for the More button). The active tab is always guaranteed
// visible — if it would overflow, it's swapped to the last visible slot so you
// never lose sight of where you are.
// ============================================================================

import { useRef, useState, useLayoutEffect, useCallback } from 'react';
import { PopOver } from 'tsp-form';
import { ChevronDown, Check } from 'lucide-react';

const MORE_BTN_WIDTH = 52; // px reserved for the "More ▾" trigger
const GAP = 0;

export function OverflowTabs<T extends string>({
  tabs, activeTab, onTabChange, renderLabel,
}: {
  tabs: readonly T[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  renderLabel: (tab: T) => React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const widthsRef = useRef<number[]>([]);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const [moreOpen, setMoreOpen] = useState(false);

  // Measure each tab's natural width once (and whenever the tab set changes).
  const measure = useCallback(() => {
    const m = measureRef.current;
    if (!m) return;
    widthsRef.current = Array.from(m.children).map((c) => (c as HTMLElement).offsetWidth);
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recompute = useCallback(() => {
    const container = containerRef.current;
    const widths = widthsRef.current;
    if (!container || widths.length === 0) return;
    const avail = container.offsetWidth;

    // Everything fits → no More button.
    const total = widths.reduce((s, w) => s + w + GAP, 0);
    if (total <= avail) {
      setVisibleCount(widths.length);
      return;
    }
    // Otherwise fit as many as possible, leaving room for the More button.
    let used = 0;
    let count = 0;
    for (let i = 0; i < widths.length; i++) {
      if (used + widths[i] + MORE_BTN_WIDTH > avail) break;
      used += widths[i] + GAP;
      count++;
    }
    setVisibleCount(Math.max(1, count));
  }, []);

  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container) return;

    // The first synchronous measure is unreliable on a fresh load: the detail
    // panel may not have settled its width yet, and Thai web-fonts may still be
    // swapping in (glyph widths change) — both make the tabs look like they fit
    // when they don't, so the chevron never appears. Nothing resizes afterwards,
    // so a one-shot measure can latch the wrong answer. Re-measure across the
    // first handful of frames to capture the settled layout, plus on fonts.ready.
    let frame = 0;
    let raf = 0;
    const settle = () => {
      measure();
      if (++frame < 8) raf = requestAnimationFrame(settle);
    };
    raf = requestAnimationFrame(settle);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready?.then(() => measure());

    // ResizeObserver on the container covers later panel/window resizes; on the
    // measurement rail it covers a font swap changing the tab widths themselves.
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    if (measureRef.current) ro.observe(measureRef.current);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [measure, recompute, tabs.length]);

  // Guarantee the active tab is visible: if it sits in the overflow region,
  // swap it into the last visible slot so the current context is never hidden.
  let visible = tabs.slice(0, visibleCount);
  let overflow = tabs.slice(visibleCount);
  if (overflow.includes(activeTab) && visible.length > 0) {
    const swapOut = visible[visible.length - 1];
    visible = [...visible.slice(0, -1), activeTab];
    overflow = [swapOut, ...overflow.filter((t) => t !== activeTab)];
  }

  const activeInOverflow = overflow.includes(activeTab);

  return (
    <div className="flex-none relative border-b border-line">
      {/* Off-screen measurement rail — renders all tabs to learn their widths. */}
      <div ref={measureRef} className="absolute opacity-0 pointer-events-none flex" aria-hidden style={{ top: -9999, left: 0 }}>
        {tabs.map((tab) => (
          <span key={tab} className="py-2 px-3 text-sm font-medium whitespace-nowrap">{renderLabel(tab)}</span>
        ))}
      </div>

      <div ref={containerRef} className="flex items-stretch px-2">
        {visible.map((tab) => (
          <button
            key={tab}
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === tab ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
            }`}
            onClick={() => onTabChange(tab)}
          >
            {renderLabel(tab)}
          </button>
        ))}

        {overflow.length > 0 && (
          <div className="ml-auto self-center pl-1 pr-0.5">
            <button
              ref={moreTriggerRef}
              className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors cursor-pointer ${
                activeInOverflow || moreOpen
                  ? 'border-primary-fg text-primary-fg'
                  : 'border-line text-subtle hover:bg-surface-hover'
              }`}
              onClick={() => setMoreOpen((v) => !v)}
              aria-label="More tabs"
            >
              <ChevronDown size={15} />
            </button>
          </div>
        )}
      </div>

      <PopOver
        isOpen={moreOpen}
        onClose={() => setMoreOpen(false)}
        triggerRef={moreTriggerRef}
        placement="bottom"
        align="end"
        maxWidth="16rem"
      >
        <div className="flex flex-col py-1 min-w-[12rem]">
          {overflow.map((tab) => (
            <button
              key={tab}
              className={`px-3 py-2 text-sm text-left cursor-pointer flex items-center gap-2 transition-colors ${
                activeTab === tab ? 'text-primary-fg bg-primary-soft' : 'text-fg hover:bg-surface-hover'
              }`}
              onClick={() => { onTabChange(tab); setMoreOpen(false); }}
            >
              <span className="w-4 shrink-0">{activeTab === tab && <Check size={14} />}</span>
              <span className="truncate">{renderLabel(tab)}</span>
            </button>
          ))}
        </div>
      </PopOver>
    </div>
  );
}
