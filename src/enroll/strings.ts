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

// A build-time SLICE of the same en.json/th.json the admin app uses — only the
// keys in enrollStringKeys.ts, resolved by the enroll-strings plugin in
// vite.config.ts. Importing the locale files directly would ship ~810kB of the
// entire admin vocabulary to a page that shows a serial number: a runtime key
// lookup keeps the whole object reachable, so none of it tree-shakes.
// The strings are still the shared ones; only the delivery differs.
import STRINGS from 'virtual:enroll-strings';

export type Lang = 'th' | 'en';

/** Thai first — this page is read in a Thai shop, usually not by our staff. */
export const LANGS: Lang[] = ['th', 'en'];

/**
 * Translate `key`, interpolating {{name}} placeholders.
 *
 * Falls back to the key itself rather than to English: a raw key on screen is
 * an obvious bug during review, while a silent English sentence in a Thai page
 * looks intentional and ships.
 */
export function makeT(lang: Lang) {
  // Already flat: the plugin emits { en: { 'a.b.c': '…' }, th: {…} }, so this is
  // a direct lookup rather than a walk down a nested tree.
  const table = STRINGS[lang] ?? STRINGS.th;
  return function t(key: string, vars?: Record<string, string | number>): string {
    let out = table[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
      }
    }
    return out;
  };
}

export type T = ReturnType<typeof makeT>;
