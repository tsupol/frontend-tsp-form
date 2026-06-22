// Curated emoji set for the chat composer.
//
// A full picker library is overkill — we hand-pick the common emojis and lay
// them out in our own categories/order. Search keywords (EN + Thai) are NOT
// hand-written: they're baked from Unicode CLDR data (emojibase-data) at build
// time into emojiKeywords.generated.ts. Edit EMOJI_LAYOUT here, then re-run
// `node scripts/bakeEmojiKeywords.mjs` to refresh keywords.
//
// `category` keys map to i18n keys under `chat.emoji.cat.*`.

import { EMOJI_KEYWORDS } from './emojiKeywords.generated';

export interface EmojiCategory {
  key: string;
  /** Emoji chars in display order. */
  chars: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    key: 'smileys',
    chars: [
      '😀', '😁', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋',
      '😎', '🤩', '😏', '😴', '😪', '🤔', '🤨', '😐', '😶', '🙄', '😬', '😅',
      '😢', '😭', '😞', '😔', '😟', '😣', '😤', '😠', '😡', '🤯', '😱', '😨',
      '😰', '😳', '🥺', '😷', '🤒', '🤕', '🥴', '😵', '🤗', '🤭', '🤫', '😜',
      '😝', '🤓',
    ],
  },
  {
    key: 'gestures',
    chars: [
      '👍', '👎', '👌', '🙏', '👏', '🙌', '👋', '🤝', '✌️', '🤞', '👈', '👉',
      '👆', '👇', '☝️', '✊', '👊', '🤛', '💪', '🙇',
    ],
  },
  {
    key: 'hearts',
    chars: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💕', '💖', '💗', '💔',
      '❣️', '💯', '✨', '⭐', '🌟', '🔥',
    ],
  },
  {
    key: 'objects',
    chars: [
      '✅', '❌', '❗', '❓', '⚠️', '📌', '📝', '📞', '📱', '💬', '📷', '📎',
      '📁', '📄', '🧾', '💰', '💵', '💳', '🏦', '🕐', '⏰', '📅', '🎉', '🎁',
      '🚗', '🏠', '☎️', '🔔', '🔒', '🔑',
    ],
  },
];

const RECENT_KEY = 'chat.emoji.recent';
const RECENT_MAX = 24;

export function loadRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecentEmoji(char: string): string[] {
  const next = [char, ...loadRecentEmojis().filter(c => c !== char)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / disabled storage
  }
  return next;
}

const ALL_CHARS: string[] = EMOJI_CATEGORIES.flatMap(c => c.chars);

export function searchEmojis(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ALL_CHARS.filter(ch =>
    ch === q || (EMOJI_KEYWORDS[ch] ?? []).some(k => k.includes(q)),
  );
}
