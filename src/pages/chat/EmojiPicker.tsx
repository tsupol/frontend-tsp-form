import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from 'tsp-form';
import { Search, Clock } from 'lucide-react';
import {
  EMOJI_CATEGORIES,
  loadRecentEmojis,
  searchEmojis,
} from './emojiData';

interface Props {
  /** Called with the chosen emoji character. */
  onPick: (char: string) => void;
}

/**
 * Emoji grid with search + recent. Designed to live inside a PopOver opened
 * from the chat composer. Recents are persisted in localStorage and refreshed
 * each time the picker mounts (i.e. each open).
 */
export function EmojiPicker({ onPick }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setRecent(loadRecentEmojis());
    // Autofocus the search field on open.
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const results = useMemo<string[]>(() => searchEmojis(query), [query]);
  const isSearching = query.trim().length > 0;

  return (
    <div className="flex flex-col w-[18rem] max-w-[88vw]">
      <div className="p-2 border-b border-line">
        <Input
          ref={searchRef}
          size="sm"
          className="w-full"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('chat.emoji.searchPlaceholder')}
          startIcon={<Search size={14} />}
        />
      </div>

      <div className="overflow-auto better-scroll pb-1" style={{ maxHeight: '15rem' }}>
        {isSearching ? (
          results.length === 0 ? (
            <div className="text-center text-subtle text-xs py-6">
              {t('chat.emoji.noResults')}
            </div>
          ) : (
            <div className="px-2"><EmojiGrid emojis={results} onPick={onPick} /></div>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <Section label={t('chat.emoji.cat.recent')} icon={<Clock size={12} />}>
                <EmojiGrid emojis={recent} onPick={onPick} />
              </Section>
            )}
            {EMOJI_CATEGORIES.map(cat => (
              <Section key={cat.key} label={t(`chat.emoji.cat.${cat.key}`)}>
                <EmojiGrid emojis={cat.chars} onPick={onPick} />
              </Section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ label, icon, children }: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1 last:mb-0">
      {/* Full-bleed rectangular band: no top/side gap, padding lives inside. */}
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-subtle px-3 py-1.5 bg-surface sticky top-0 z-10">
        {icon}
        <span>{label}</span>
      </div>
      <div className="px-2 pt-1">{children}</div>
    </div>
  );
}

function EmojiGrid({ emojis, onPick }: { emojis: string[]; onPick: (char: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((char, i) => (
        <button
          key={`${char}-${i}`}
          type="button"
          onClick={() => onPick(char)}
          className="aspect-square flex items-center justify-center text-lg rounded hover:bg-surface-hover transition-colors leading-none"
          aria-label={char}
        >
          {char}
        </button>
      ))}
    </div>
  );
}
