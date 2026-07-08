import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import th from './locales/th.json';
import errorsEn from './locales/errors.en.json';
import errorsTh from './locales/errors.th.json';
import billActionsEn from './locales/billActions.en.json';
import billActionsTh from './locales/billActions.th.json';
import contractActionsEn from './locales/contractActions.en.json';
import contractActionsTh from './locales/contractActions.th.json';
import assetActionsEn from './locales/assetActions.en.json';
import assetActionsTh from './locales/assetActions.th.json';
import lotActionsEn from './locales/lotActions.en.json';
import lotActionsTh from './locales/lotActions.th.json';

const resources = {
  en: {
    translation: en,
    apiErrors: errorsEn,
    billActions: billActionsEn,
    contractActions: contractActionsEn,
    assetActions: assetActionsEn,
    lotActions: lotActionsEn,
  },
  th: {
    translation: th,
    apiErrors: errorsTh,
    billActions: billActionsTh,
    contractActions: contractActionsTh,
    assetActions: assetActionsTh,
    lotActions: lotActionsTh,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    // Normalize region tags (e.g. navigator's "th-TH" / "en-US") down to the
    // base language. Without this, i18n.language stays "th-TH" for users who
    // never toggled the switcher, so every `i18n.language === 'th'` check reads
    // false and they see English name_en labels. supportedLngs keeps the
    // detected value inside the two we ship.
    load: 'languageOnly',
    supportedLngs: ['en', 'th'],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  });

// One-time repair for users who cached a region tag ("th-TH") in localStorage
// before load:'languageOnly' shipped. The localStorage detector reads that raw
// value back on boot, so i18n.language can still resolve to "th-TH" for them and
// every `=== 'th'` check keeps failing. Collapse it to the base language once so
// they self-heal on next load without having to toggle the switcher.
if (i18n.language && i18n.language.includes('-')) {
  i18n.changeLanguage(i18n.language.split('-')[0]);
}

export default i18n;
