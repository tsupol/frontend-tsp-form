// ============================================================================
// i18next for the standalone enrollment page.
//
// WHY A LIBRARY HERE AT ALL. This page renders the SAME components as MDM tab-1
// (EnrollChecklist, SerialDisplay, the step-6/7 badges), and those call
// useTranslation() like every other component in the app. The alternative was to
// keep this page's hand-rolled lookup and hand every shared component a `t`
// prop — which means tab-1 threading a translator down through a dozen badges,
// and every future edit paying that tax. The owner's whole point in sharing the
// component was "change it in one place", so the plumbing gives way, not the
// components.
//
// ⭐ The WORDS still come from the build-time slice of the same en.json/th.json
//    the admin app uses (virtual:enroll-strings, keys listed in
//    enrollStringKeys.ts). Importing the locale files whole would ship ~810kB of
//    admin vocabulary to a stranger's phone. Only the delivery mechanism is
//    i18next; the single-source guarantee is unchanged.
//
// The slice is already FLAT ('a.b.c' → string), so keySeparator/nsSeparator are
// off — otherwise i18next would try to walk 'asset.mdm.step.serial' as a tree
// and find nothing.
//
// ⛔ NO LanguageDetector. The admin app's detector caches under `i18nextLng`; a
//    staffer who opens a QR link in the browser they use for the admin app must
//    not find its language changed afterwards. Language comes from ?lang, else
//    the enroll-specific localStorage key, else Thai — see Controls.tsx.
// ============================================================================

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import STRINGS from 'virtual:enroll-strings';
import type { Lang } from './strings';

export function initEnrollI18n(lang: Lang) {
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: STRINGS.en },
      th: { translation: STRINGS.th },
    },
    lng: lang,
    fallbackLng: 'th', // this page is read in a Thai shop
    supportedLngs: ['en', 'th'],
    // The slice emits flat dotted keys, not a nested tree.
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
  });
  return i18n;
}

export default i18n;
