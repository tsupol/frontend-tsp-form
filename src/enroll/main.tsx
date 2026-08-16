// Entry for the standalone enrollment page (enroll.html).
//
// Note what is NOT here, compared with src/main.tsx: no QueryClientProvider, no
// AuthProvider, no BrowserRouter, no ModalProvider/SnackbarProvider, no
// NavGuardProvider. This page has one fetch on a timer and no session — every
// one of those providers would be weight in front of a stranger's phone for no
// behaviour.
//
// i18next IS here, and it is the one thing that came back. The page renders the
// same components as MDM tab-1, and those call useTranslation() like the rest of
// the app; the alternative was threading a `t` prop through every shared
// component and badge, which is a permanent tax on the thing this sharing exists
// to make easy. The words still come from the build-time slice of the same
// locale files (see i18n.ts) — only the lookup mechanism changed.
//
// The theme CSS still comes in, because the page uses the same tokens (bg,
// surface, alert, primary) and should look like the product.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { EnrollApp } from './EnrollApp';
import { initEnrollI18n } from './i18n';
import { readInitialLang } from './Controls';
import '../app-theme.css';
import '../styles/typography.css';
// layout.css is NOT optional: it carries the `body` rule that sets the page
// background, the default TEXT COLOUR (var(--color-fg)) and the Noto Sans Thai
// family. Without it every unstyled string falls back to browser-default black
// on the dark background, and the whole page renders in a system font.
import '../styles/layout.css';
import '../app.css';

// Resolved before the first render so nothing flashes in the wrong language.
// Same precedence the page has always used: ?lang, then the enroll-specific
// localStorage key, then Thai. ⛔ Never the admin app's `i18nextLng`.
const i18n = initEnrollI18n(readInitialLang());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <EnrollApp />
    </I18nextProvider>
  </StrictMode>,
);
