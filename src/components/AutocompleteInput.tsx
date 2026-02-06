import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { Input, PopOver, Skeleton } from 'tsp-form';
import type { InputProps } from 'tsp-form';

export interface AutocompleteSuggestion {
  value: string;
  label: string;
}

interface AutocompleteInputProps extends Omit<InputProps, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => Promise<AutocompleteSuggestion[]>;
  minSearchLength?: number;
  debounceMs?: number;
  noResultsText?: string;
}

export const AutocompleteInput = forwardRef<HTMLInputElement, AutocompleteInputProps>(
  (
    {
      value,
      onChange,
      onSearch,
      minSearchLength = 3,
      debounceMs = 300,
      noResultsText = 'No results found',
      ...inputProps
    },
    ref
  ) => {
    const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
    const [loading, setLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => inputRef.current!, []);

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        onChange(newValue);

        if (debounceRef.current) clearTimeout(debounceRef.current);

        if (newValue.length < minSearchLength) {
          setSuggestions([]);
          setLoading(false);
          setIsOpen(false);
          return;
        }

        setLoading(true);
        setIsOpen(true);
        debounceRef.current = setTimeout(() => {
          onSearch(newValue).then((results) => {
            setSuggestions(results);
            setLoading(false);
          });
        }, debounceMs);
      },
      [onChange, onSearch, minSearchLength, debounceMs]
    );

    const handleSuggestionClick = (suggestion: AutocompleteSuggestion) => {
      onChange(suggestion.value);
      setIsOpen(false);
      setSuggestions([]);
      // Trigger blur then focus to run validation
      inputRef.current?.blur();
      setTimeout(() => inputRef.current?.focus(), 0);
    };

    const handleFocus = () => {
      if (value.length >= minSearchLength && suggestions.length > 0) {
        setIsOpen(true);
      }
    };

    const handleBlur = () => {
      // Delay close to allow click on suggestion
      setTimeout(() => setIsOpen(false), 150);
    };

    return (
      <PopOver
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        trigger={
          <div ref={containerRef} className="grid">
            <Input
              ref={inputRef}
              value={value}
              onChange={handleInputChange}
              onFocus={handleFocus}
              onBlur={handleBlur}
              {...inputProps}
            />
          </div>
        }
        placement="bottom"
        align="start"
        width={containerRef.current?.offsetWidth ? `${containerRef.current.offsetWidth}px` : '100%'}
      >
        <div className="select-popover">
          {loading ? (
            <div className="p-2 space-y-2">
              <Skeleton width="60%" />
              <Skeleton width="80%" />
              <Skeleton width="40%" />
            </div>
          ) : suggestions.length > 0 ? (
            suggestions.map((suggestion) => (
              <div
                key={suggestion.value}
                className="select-popover-item cursor-pointer"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSuggestionClick(suggestion)}
              >
                {suggestion.label}
              </div>
            ))
          ) : (
            <div className="px-4 py-2 text-sm text-control-label">{noResultsText}</div>
          )}
        </div>
      </PopOver>
    );
  }
);

AutocompleteInput.displayName = 'AutocompleteInput';
