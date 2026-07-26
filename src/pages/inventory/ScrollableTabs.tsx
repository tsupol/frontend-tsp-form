// Horizontally-scrollable tab strip with edge fade-scroll buttons. Shared by
// the asset top-level tabs (AssetsPage) and the MDM sub-tab strip (AssetMdmTab),
// which needs the overflow handling for its 7 sub-tabs on narrow screens.

import { useRef, useState, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function ScrollableTabs<T extends string>({ tabs, activeTab, onTabChange, renderLabel }: {
  tabs: readonly T[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  renderLabel: (tab: T) => React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [checkScroll]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -120 : 120, behavior: 'smooth' });
  };

  return (
    <div className="flex-none relative border-b border-line">
      {canScrollLeft && (
        <button
          className="absolute left-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-bg border-r border-line cursor-pointer border-y-0 border-l-0"
          onClick={() => scroll('left')}
        >
          <ChevronLeft size={14} className="text-subtle" />
        </button>
      )}
      <div ref={scrollRef} className="flex px-2 overflow-x-auto hidden-scroll">
        {tabs.map(tab => (
          <button
            key={tab}
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === tab
                ? 'border-primary-fg text-primary-fg'
                : 'border-transparent text-fg'
            }`}
            onClick={() => onTabChange(tab)}
          >
            {renderLabel(tab)}
          </button>
        ))}
      </div>
      {canScrollRight && (
        <button
          className="absolute right-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-bg border-l border-line cursor-pointer border-y-0 border-r-0"
          onClick={() => scroll('right')}
        >
          <ChevronRight size={14} className="text-subtle" />
        </button>
      )}
    </div>
  );
}
