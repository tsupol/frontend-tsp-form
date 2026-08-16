// ============================================================================
// The page's language set.
//
// ⭐ THE ONE RULE, unchanged: the copy comes from the SAME locale files as the
// admin app. Branch A watches tab-1 and reads it down the phone to whoever is
// holding the device at branch B; if the two word things differently the call
// goes in circles. Since 2026-08-17 the two screens no longer merely share
// wording — they render the SAME components (EnrollChecklist et al.), so the
// wording cannot drift by construction.
//
// The lookup itself now lives in i18n.ts: the shared components call
// useTranslation() like the rest of the app, so this page runs a small i18next
// instance seeded from the build-time slice (virtual:enroll-strings). The slice
// is still a subset of the real en.json/th.json, keyed by enrollStringKeys.ts,
// and a key missing there still FAILS THE BUILD.
// ============================================================================

export type Lang = 'th' | 'en';

/** Thai first — this page is read in a Thai shop, usually not by our staff. */
export const LANGS: Lang[] = ['th', 'en'];
