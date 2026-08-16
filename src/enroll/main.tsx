// Entry for the standalone enrollment page (enroll.html).
//
// Note what is NOT here, compared with src/main.tsx: no QueryClientProvider, no
// AuthProvider, no BrowserRouter, no ModalProvider/SnackbarProvider, no
// NavGuardProvider, no i18next. This page has one fetch on a timer, two
// languages and no session — every one of those providers would be weight in
// front of a stranger's phone for no behaviour.
//
// The theme CSS still comes in, because the page uses the same tokens (bg,
// surface, alert, primary) and should look like the product.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EnrollApp } from './EnrollApp';
import '../app-theme.css';
import '../styles/typography.css';
// layout.css is NOT optional: it carries the `body` rule that sets the page
// background, the default TEXT COLOUR (var(--color-fg)) and the Noto Sans Thai
// family. Without it every unstyled string falls back to browser-default black
// on the dark background, and the whole page renders in a system font.
import '../styles/layout.css';
import '../app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EnrollApp />
  </StrictMode>,
);
