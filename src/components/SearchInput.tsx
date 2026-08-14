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
 * See `lib/searchKeyword.ts` for why the floor exists: the fn_*_search RPCs
 * silently switch to browse-recent below it and hand back rows that look like
 * matches. On plain-ilike views the floor is a consistency + seq-scan call
 * rather than a correctness one — same UI either way, so staff learn one rule.
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
   *  (brand "RC"). Thai always uses its own lower floor regardless. */
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
