import './lib/pdfjsPolyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ModalProvider, SnackbarProvider } from 'tsp-form';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { NavGuardProvider } from './contexts/NavGuardContext';
import { queryClient } from './lib/queryClient';
import { installRemoteLog } from './lib/remoteLog';
import App from './App';
import './i18n/config';
import './app-theme.css';
import './styles/typography.css';
import './styles/layout.css';
import './app.css';
import './chart-theme.css';

installRemoteLog();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <SnackbarProvider defaults={{ position: 'top-right' }}>
            <ModalProvider>
              <BrowserRouter>
                <NavGuardProvider>
                  <App />
                </NavGuardProvider>
              </BrowserRouter>
            </ModalProvider>
          </SnackbarProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// ── Boot splash hand-off ────────────────────────────────────────────────────
// Retire the splash from index.html once React has actually painted, but never
// so fast that it flickers.
//
// MIN_DWELL exists because a warm cache is the bad case, not the good one: the
// bundle is already local, React paints in ~200ms, and a splash that appears and
// disappears inside a quarter second reads as a glitch — the screen flashes and
// the user distrusts it. Holding it for a beat makes a fast load look
// deliberate. Measured from window.__bootAt (set in the HTML, i.e. first paint)
// rather than from here, or the dwell would start after the very download it is
// meant to cover.
const MIN_DWELL = 1000;
const FADE_MS = 420;

function dismissBoot() {
  const boot = document.getElementById('app-boot');
  if (!boot) return;

  const started = (window as unknown as { __bootAt?: number }).__bootAt ?? Date.now();
  const wait = Math.max(0, MIN_DWELL - (Date.now() - started));

  setTimeout(() => {
    const root = document.documentElement;
    // booting → revealing: #root transitions up into place as the splash lifts,
    // so the two overlap and read as one motion rather than a fade that
    // finishes and THEN a slide.
    root.classList.add('app-revealing');
    root.classList.remove('app-booting');

    boot.classList.add('is-done');
    boot.addEventListener('transitionend', () => boot.remove(), { once: true });

    // Belt and braces: if a transition never fires (reduced motion, tab in the
    // background), the splash must still go — it would otherwise trap clicks —
    // and `app-revealing` must still be cleared. Leaving it on keeps a
    // `transform` on #root, which would make it the containing block for every
    // position:fixed modal, drawer and popover in the app.
    setTimeout(() => {
      boot.remove();
      root.classList.remove('app-revealing');
    }, FADE_MS + 200);
  }, wait);
}

// Two frames, not one: the first only guarantees the commit is scheduled, so
// starting the hand-off on it can reveal an empty root for a frame — the flash
// we are here to remove.
requestAnimationFrame(() => requestAnimationFrame(dismissBoot));
