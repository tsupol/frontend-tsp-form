import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from 'tsp-form';
import { Search } from 'lucide-react';
import { isSearchableLoose, isBelowSearchMinLoose, searchMinFor } from '../lib/searchKeyword';

/**
 * The one search box. Owns the three things every search on this app needs and
 * that 16 screens had each re-derived by hand: the debounce, the minimum-length
 * guard, and the "at least N chars" hint riding inside the field.
 *
 * `onDebouncedChange` fires with the keyword ONLY once it is long enough to
 * search, and with '' otherwise — so a caller can pass the value straight into a
 * query key and never think about the threshold again. Clearing the box reports
 * '' immediately-ish (after the debounce), which every list treats as unfiltered.
 *
 * See `lib/searchKeyword.ts` for why the floor exists and why the number differs
 * per screen. Short version: at ONE character three of the RPCs drop the keyword
 * and hand back browse results that look like matches. On plain-ilike views
 * nothing breaks — the floor there keeps the result set meaningful (a 1-char OR
 * matches nearly every row), not to save time; BE measured 2 and 3 as equally
 * cheap. Same UI either way, so staff learn one rule.
 */
export function SearchInput({
  value,
  onChange,
  onDebouncedChange,
  placeholder,
  delay = 300,
  size = 'sm',
  startIcon,
  endIcon,
  onEndIconClick,
  minChars,
  className = '',
  disabled,
  autoFocus,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Fires with the trimmed keyword when searchable, '' when too short or empty. */
  onDebouncedChange: (next: string) => void;
  placeholder?: string;
  delay?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Defaults to the magnifier. Pass null for none. */
  startIcon?: ReactNode | null;
  /** Shown when the keyword is long enough; the hint takes over below the floor. */
  endIcon?: ReactNode;
  /** Only fires while the caller's endIcon is the one on screen, not the hint. */
  onEndIconClick?: () => void;
  /** Lower the Latin floor for a screen whose own data is legitimately short
   *  (brand "RC") or a model generation ("16"/"17"). */
  minChars?: number;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  'aria-label'?: string;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const next = isSearchableLoose(value, minChars) ? value.trim() : '';
    const timer = setTimeout(() => onDebouncedChange(next), delay);
    return () => clearTimeout(timer);
    // onDebouncedChange is intentionally excluded: callers pass inline arrows,
    // so including it would reset the timer on every render and never settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delay, minChars]);

  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? t('common.search')}
      size={size}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      startIcon={startIcon === null ? undefined : (startIcon ?? <Search size={16} />)}
      // Hint rides inside the field, right-aligned, so the rows below can't
      // shift as the user types. A caller's own endIcon returns once the
      // keyword clears the floor.
      endIcon={isBelowSearchMinLoose(value, minChars)
        ? <span className="text-[11px] whitespace-nowrap">
            {t('common.searchMinCharsShort', { n: searchMinFor(value, minChars) })}
          </span>
        : endIcon}
      // Paired with the icon above: the hint is text, not a button, so the
      // caller's handler must not be live while the hint is what's showing.
      onEndIconClick={isBelowSearchMinLoose(value, minChars) ? undefined : onEndIconClick}
      className={`search-min-hint ${className}`.trim()}
    />
  );
}
