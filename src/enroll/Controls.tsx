// ============================================================================
// The page's two viewer controls: language and theme.
//
// Both belong to the READER, not to us. This page is opened by someone outside
// the company, on their own phone, in whatever lighting the shop has — so the
// choice has to be on screen, not inherited from an admin session they do not
// have.
//
// ⛔ Neither writes to localStorage under the app's own keys. A staffer who
//    opens the QR link on the same browser they use for the admin app must not
//    find its language or theme silently changed afterwards. These are stored
//    under enroll-specific keys, so the page remembers across a reload without
//    touching the admin app's preferences.
// ============================================================================

import { useEffect, useState } from 'react';
import { LANGS, type Lang } from './strings';

export type ThemeChoice = 'dark' | 'light';

const LANG_KEY = 'enrollLang';
const THEME_KEY = 'enrollTheme';

function readStored<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — the choice simply won't survive a reload */
  }
}

/**
 * The page's starting language: ?lang, else the stored choice, else Thai — the
 * reader is standing in a Thai shop.
 *
 * Exported because main.tsx needs it BEFORE the first render to seed i18next;
 * having one function rather than two copies of the precedence keeps the
 * pre-render language and the hook's initial state from disagreeing.
 *
 * ⛔ Never reads the admin app's `i18nextLng`, and nothing here writes it.
 */
export function readInitialLang(): Lang {
  const req = new URLSearchParams(window.location.search).get('lang');
  if (req === 'en' || req === 'th') return req;
  return readStored<Lang>(LANG_KEY, LANGS) ?? 'th';
}

/** Thai default: the reader is standing in a Thai shop. ?lang=en overrides. */
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(readInitialLang);
  const setLang = (l: Lang) => {
    write(LANG_KEY, l);
    setLangState(l);
  };
  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);
  return [lang, setLang];
}

/**
 * Theme. The inline script in enroll.html already resolved one before paint
 * (stored choice, else the OS preference) so there is no flash; this hook adopts
 * whatever it decided and lets the reader override it.
 */
export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [theme, setThemeState] = useState<ThemeChoice>(() => {
    const stored = readStored<ThemeChoice>(THEME_KEY, ['dark', 'light']);
    if (stored) return stored;
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = (t: ThemeChoice) => {
    write(THEME_KEY, t);
    setThemeState(t);
  };
  return [theme, setTheme];
}

/**
 * A single segmented control carrying both choices, right-aligned above the
 * content. Two separate widgets competed with the serial for attention; one
 * quiet strip reads as chrome, which is what it is.
 */
export function ViewerControls({
  lang, onLang, theme, onTheme,
}: {
  lang: Lang;
  onLang: (l: Lang) => void;
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
}) {
  return (
    <div className="flex justify-end items-center gap-1">
      <div className="inline-flex rounded-full border border-line overflow-hidden bg-surface">
        {LANGS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onLang(l)}
            aria-pressed={lang === l}
            className={`px-3 py-1 text-xs font-medium cursor-pointer border-none transition-colors ${
              lang === l ? 'bg-primary text-primary-contrast' : 'bg-transparent text-subtle'
            }`}
          >
            {l === 'th' ? 'ไทย' : 'EN'}
          </button>
        ))}
      </div>

      {/* Ghost: no border, no fill. The language pill is the choice worth
          drawing a box around — two boxed controls side by side compete with
          each other and with the serial below. Giving the toggle a larger glyph
          instead of a frame keeps it easy to hit without adding weight.
          The icon shows what you'd switch TO — the usual toggle convention. */}
      <button
        type="button"
        onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        className="w-9 h-9 rounded-full bg-transparent border-none text-subtle hover:text-fg cursor-pointer inline-flex items-center justify-center text-lg leading-none transition-colors"
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </div>
  );
}
