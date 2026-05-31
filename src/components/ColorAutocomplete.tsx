import { useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input, Badge, PopOver } from 'tsp-form';
import { apiClient } from '../lib/api';
import { fuzzyScore } from '../lib/fuzzy';

/** Distinct manufacturer_color values across the holding, frequency-ranked.
 *  Lets type-in colour fields stay consistent ("Jet Black", not
 *  "jet-black" / "JetBlack"). */
export function useManufacturerColorSuggestions() {
  return useQuery({
    queryKey: ['manufacturer-color-distinct'],
    queryFn: async () => {
      const rows = await apiClient.get<{ manufacturer_color: string | null }[]>(
        '/v_product_variant_list?select=manufacturer_color&manufacturer_color=not.is.null&limit=10000',
      );
      const counts = new Map<string, number>();
      for (const r of rows) {
        const c = r.manufacturer_color?.trim();
        if (!c) continue;
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([color]) => color);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useColorMatch(value: string) {
  const { data: allColors = [] } = useManufacturerColorSuggestions();
  const trimmed = value.trim();
  const isKnown = !!trimmed && allColors.some(c => c.toLowerCase() === trimmed.toLowerCase());
  return { allColors, trimmed, isKnown, isNew: !!trimmed && !isKnown };
}

export function ColorMatchBadge({ value }: { value: string }) {
  const { t } = useTranslation();
  const { trimmed, isKnown } = useColorMatch(value);
  if (!trimmed) return null;
  return (
    <Badge size="xs" color={isKnown ? 'default' : 'info'}>
      {isKnown ? t('models.existingColor') : t('models.newColor')}
    </Badge>
  );
}

export function ColorAutocomplete({
  id,
  value,
  onChange,
  placeholder,
  autoFocus,
  endIcon,
  onEndIconClick,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  endIcon?: React.ReactNode;
  onEndIconClick?: () => void;
}) {
  const { allColors, trimmed, isKnown } = useColorMatch(value);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = trimmed.toLowerCase();
    if (q.length === 0) return [];
    const tokens = q.split(/\s+/).filter(Boolean);

    const scored: { color: string; tier: number; index: number; fuzzy: number }[] = [];
    const matchedIndex = new Set<number>();
    allColors.forEach((color, index) => {
      const hay = color.toLowerCase();
      if (!tokens.every(tok => hay.includes(tok))) return;
      let tier = 3;
      if (hay === q) tier = 0;
      else if (hay.startsWith(q)) tier = 1;
      else if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay)) tier = 2;
      scored.push({ color, tier, index, fuzzy: 1 });
      matchedIndex.add(index);
    });

    if (q.length >= 2) {
      const threshold = q.length >= 3 ? 0.6 : 0.8;
      allColors.forEach((color, index) => {
        if (matchedIndex.has(index)) return;
        const score = fuzzyScore(q, color);
        if (score >= threshold) {
          scored.push({ color, tier: 4, index, fuzzy: 1 - score });
        }
      });
    }

    scored.sort((a, b) =>
      a.tier - b.tier
      || (a.tier === 4 ? a.fuzzy - b.fuzzy : 0)
      || a.index - b.index
    );
    const matches = scored.map(s => s.color);

    if (isKnown && matches.length === 1) return [];
    return matches.slice(0, 8);
  }, [allColors, trimmed, isKnown]);

  const triggerWidth = wrapperRef.current?.offsetWidth;
  const showPopover = open && suggestions.length > 0;

  const commit = (val: string) => {
    onChange(val);
    setOpen(false);
    setHighlighted(-1);
  };

  return (
    <div ref={wrapperRef}>
      <PopOver
        isOpen={showPopover}
        onClose={() => setOpen(false)}
        triggerRef={wrapperRef}
        placement="bottom"
        align="start"
        width={triggerWidth ? `${triggerWidth}px` : undefined}
        offset={4}
        zIndex={2000}
        trigger={
          <Input
            id={id}
            className="w-full"
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            autoFocus={autoFocus}
            endIcon={endIcon}
            onEndIconClick={onEndIconClick}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
              setHighlighted(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (suggestions.length === 0) return;
                setOpen(true);
                setHighlighted((i) => (i < suggestions.length - 1 ? i + 1 : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (suggestions.length === 0) return;
                setHighlighted((i) => (i > 0 ? i - 1 : suggestions.length - 1));
              } else if (e.key === 'Enter') {
                if (highlighted >= 0 && highlighted < suggestions.length) {
                  e.preventDefault();
                  commit(suggestions[highlighted]);
                } else {
                  setOpen(false);
                }
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
        }
      >
        <div onMouseDown={(e) => e.preventDefault()} className="py-1">
          {suggestions.map((s, i) => (
            <div
              key={s}
              className={`select-popover-item ${i === highlighted ? 'highlighted' : ''}`}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => commit(s)}
            >
              {s}
            </div>
          ))}
        </div>
      </PopOver>
    </div>
  );
}
