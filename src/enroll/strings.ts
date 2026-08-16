// ============================================================================
// Wording for the standalone enrollment page.
//
// ⭐ THE ONE RULE: the copy comes from the SAME locale files as the admin app.
//
// Branch A watches tab-1 and reads it down the phone to whoever is holding the
// device at branch B, who is looking at this page. If the two word things
// differently the call goes in circles. The pages no longer share components —
// they don't need to look alike — but they must SAY the same thing, and that is
// enforced here by importing the same JSON rather than copying strings.
//
// A key that goes missing from the locale files becomes a TypeScript error at
// build time (see `pick` below), not a silent English fallback on a stranger's
// phone.
//
// No i18next: this page has two languages, no plurals, no namespaces, and no
// detector. The library would be most of the page's weight for a lookup and a
// {{var}} replacement.
// ============================================================================

import en from '../i18n/locales/en.json';
import th from '../i18n/locales/th.json';

export type Lang = 'th' | 'en';

/** Thai first — this page is read in a Thai shop, usually not by our staff. */
export const LANGS: Lang[] = ['th', 'en'];

type Dict = Record<string, unknown>;

function walk(root: Dict, dotted: string): string {
  let cur: unknown = root;
  for (const part of dotted.split('.')) {
    if (typeof cur !== 'object' || cur === null) return dotted;
    cur = (cur as Dict)[part];
  }
  return typeof cur === 'string' ? cur : dotted;
}

/**
 * Translate `key`, interpolating {{name}} placeholders.
 *
 * Falls back to the key itself rather than to English: a raw key on screen is
 * an obvious bug during review, while a silent English sentence in a Thai page
 * looks intentional and ships.
 */
export function makeT(lang: Lang) {
  const root = (lang === 'en' ? en : th) as unknown as Dict;
  return function t(key: string, vars?: Record<string, string | number>): string {
    let out = walk(root, key);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
      }
    }
    return out;
  };
}

export type T = ReturnType<typeof makeT>;
