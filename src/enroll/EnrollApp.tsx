// ============================================================================
// The standalone enrollment page — the QR link holder's whole world.
//
// WHO IS LOOKING: staff at another branch, on the SAME ABM, who simply do not
// use NNF. The owner's framing (2026-08-17): the link says "be MDM staff for
// this one device — the customer walked into your shop." So they get ALL SEVEN
// STEPS with nothing read-only. It is safe because the ceremony is impossible
// without the physical handset AND the device being in our ABM; the token only
// names WHICH device. Someone outside the ABM can hold this link and do nothing
// with it — the scan fails and the device never appears.
//
// ⭐ IT RENDERS THE SAME COMPONENTS AS MDM TAB-1. EnrollChecklist,
//    EnrollReadinessSteps and SerialHero are imported from
//    pages/inventory/mdm/shared/, not reimplemented. This file used to carry its
//    own Steps / StatusBand / KeyBanner / SerialHero, on the reasoning that the
//    two screens shared WORDING but not markup — and they immediately drifted.
//    The rule now: if a step needs changing, it changes in shared/ and both
//    screens move together. Do not add a lookalike here for any reason.
//
// What legitimately stays local: the boot splash hand-off, the reveal
// animation, the link-expiry countdown, the offline/dead terminal screens, the
// viewer controls, and the polling — none of which tab-1 has.
//
// ⛔ NO PII. The page renders only what fn_mdm_remote_enroll_status returns, and
//    fromRemoteStatus copies field-by-field so nothing else can arrive. The
//    "issued to" note stays on tab-1 — BE forbids it in the URL, the QR and this
//    page.
// ============================================================================

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle } from 'lucide-react';
import { usePoll } from './usePoll';
import { useLang, useTheme, ViewerControls } from './Controls';
import { requestPrepare, remoteEnrollApplyLight, EnrollLinkDead, type DeadReason } from './api';
import { MOCK_SCENARIOS, ScenarioPicker, useMockScenario } from './mockScenarios';
import { EnrollChecklist } from '../pages/inventory/mdm/shared/EnrollChecklist';
import { EnrollReadinessSteps } from '../pages/inventory/mdm/shared/EnrollReadinessSteps';
import { SerialHero } from '../pages/inventory/mdm/shared/SerialDisplay';
import { fromRemoteStatus, isReadyToHandOver } from '../pages/inventory/mdm/shared/enrollView';

// ── Boot splash hand-off ────────────────────────────────────────────────────
// Held a minimum from FIRST PAINT (stamped in enroll.html), not from when this
// module parsed: on a warm cache React mounts in ~200ms and a splash that
// appears and vanishes in the same breath reads as a glitch, not a load.
const BOOT_MIN_DWELL = 900;

function useDismissSplash(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const boot = document.getElementById('enroll-boot');
    // No splash (already dismissed, or an entry that never had one) — release
    // the reveal immediately. Without this the paused animations never start
    // and the whole page stays invisible.
    if (!boot) {
      document.documentElement.classList.add('enroll-revealing');
      return;
    }
    const started = (window as unknown as { __enrollBootAt?: number }).__enrollBootAt ?? Date.now();
    const id = setTimeout(() => {
      // Start the content reveal at the same moment the splash begins to fade,
      // NOT on mount: the splash is opaque for its whole dwell, so an earlier
      // reveal plays underneath it and the curtain rises on a page that has
      // already arrived. Running them together reads as one hand-off.
      document.documentElement.classList.add('enroll-revealing');
      boot.classList.add('is-done');
      boot.addEventListener('transitionend', () => boot.remove(), { once: true });
      setTimeout(() => boot.remove(), 500); // reduced-motion / background tab
    }, Math.max(0, BOOT_MIN_DWELL - (Date.now() - started)));
    return () => clearTimeout(id);
  }, [ready]);
}

/** Re-render on an interval, for values that must age on screen. */
function useTicker(active: boolean, ms = 1000) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

function Shell({ children, controls }: { children: React.ReactNode; controls: React.ReactNode }) {
  return (
    // max-w-md, not 100vw: layout.css sets body{width:100vw}, which includes the
    // scrollbar and produces a horizontal gutter on some phones.
    // pt-2 (not py-6): the controls are chrome and belong near the top edge,
    // out of the way of the serial. The generous bottom padding stays so the
    // last card never sits flush against the bottom of the screen.
    // pt-[max(0.5rem,env(safe-area-inset-top)] keeps them clear of a notch.
    <div
      className="min-h-dvh flex justify-center px-4 pb-8"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      <div className="w-full max-w-md flex flex-col gap-4 min-w-0">
        {/* Tight to the controls: they are a toolbar, not a content block, so
            the 1rem column gap below them would read as a gap in the content. */}
        <div className="-mb-2">{controls}</div>
        {children}
      </div>
    </div>
  );
}

/** Icon, headline, body — staged, so it reads in the order the eye moves. */
function Terminal({ icon, title, body, action }: {
  icon: string; title: string; body: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-3 pt-10">
      <div className="text-5xl enroll-reveal" aria-hidden>{icon}</div>
      <h1 className="heading-2 enroll-reveal enroll-reveal-1">{title}</h1>
      <p className="text-subtle enroll-reveal enroll-reveal-2">{body}</p>
      {action && <div className="enroll-reveal enroll-reveal-3">{action}</div>}
    </div>
  );
}

export function EnrollApp() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  const { t, i18n } = useTranslation();
  const [lang, setLang] = useLang();
  const [theme, setTheme] = useTheme();

  // The language pill drives i18next. Kept in an effect rather than calling
  // changeLanguage inside setLang so the URL's ?lang= (applied at init) and a
  // later click go through exactly one path.
  useEffect(() => {
    if (i18n.language !== lang) i18n.changeLanguage(lang);
  }, [lang, i18n]);

  // Dev-only: drive the page through every state without a device.
  const mock = useMockScenario();

  const live = usePoll(mock.active ? null : token);
  const status = mock.active ? mock.status : live.data;
  const dead: DeadReason | null = mock.active ? mock.dead : live.dead;
  const offline = mock.active ? mock.offline : live.offline;
  const loading = mock.active ? false : live.loading;

  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  useDismissSplash(!loading);
  useTicker(true, 1000); // ages the "updated Ns ago" line and the expiry countdown

  const onPrepare = async () => {
    if (!token || mock.active) return;
    setPreparing(true);
    setPrepareError(null);
    try {
      await requestPrepare(token);
      live.refetch();
    } catch (err) {
      if (err instanceof EnrollLinkDead) live.refetch();
      else setPrepareError(t('remoteEnroll.offline.body'));
    } finally {
      setPreparing(false);
    }
  };

  const picker = <ScenarioPicker mock={mock} />;
  const controls = (
    <ViewerControls lang={lang} onLang={setLang} theme={theme} onTheme={setTheme} />
  );

  if (!token && !mock.active) {
    return (
      <Shell controls={controls}>
        {picker}
        <Terminal icon="⚠️" title={t('remoteEnroll.dead.NOT_FOUND.title')} body={t('remoteEnroll.dead.NOT_FOUND.body')} />
      </Shell>
    );
  }

  // A dead link is terminal — expiry, revoke, or replace. There is no COMPLETED
  // case any more (mig 251 stopped links closing themselves on success); an old
  // link that was already closed before the migration can still report it, so it
  // falls through to the generic NOT_FOUND wording rather than crashing on a
  // missing key.
  if (dead) {
    const key = dead === 'COMPLETED' ? 'NOT_FOUND' : dead;
    return (
      <Shell controls={controls}>
        {picker}
        <Terminal icon="⚠️" title={t(`remoteEnroll.dead.${key}.title`)} body={t(`remoteEnroll.dead.${key}.body`)} />
      </Shell>
    );
  }

  // Offline with nothing to show yet — a first load that never landed.
  if (!status && offline) {
    return (
      <Shell controls={controls}>
        {picker}
        <Terminal
          icon="📡"
          title={t('remoteEnroll.offline.title')}
          body={t('remoteEnroll.offline.body')}
          action={
            <button type="button" onClick={live.refetch}
              className="px-3 py-1.5 rounded-md border border-line bg-surface text-sm cursor-pointer">
              {t('common.refresh')}
            </button>
          }
        />
      </Shell>
    );
  }

  if (!status) {
    // The splash is still up; render nothing rather than a competing spinner.
    return <Shell controls={controls}>{picker}</Shell>;
  }

  const view = fromRemoteStatus(status);
  const finished = isReadyToHandOver(view);

  const expirySecs = status.link_expires_at
    ? Math.max(0, Math.floor((new Date(status.link_expires_at).getTime() - Date.now()) / 1000))
    : null;

  const applyLight = (mock.active || !token)
    ? undefined
    : (preview: boolean) => remoteEnrollApplyLight(token, preview);

  return (
    <Shell controls={controls}>
      {picker}

      <div className="enroll-reveal">
        <SerialHero serial={status.serial_number} />
      </div>

      {expirySecs != null && (
        <div className={`text-center text-xs enroll-reveal enroll-reveal-1 ${expirySecs < 900 ? 'text-warning-fg' : 'text-subtle'}`}>
          <span className="tabular-nums">
            {expirySecs >= 3600
              ? t('remoteEnroll.expiresInHm', { h: Math.floor(expirySecs / 3600), m: Math.floor((expirySecs % 3600) / 60) })
              : t('remoteEnroll.expiresInM', { m: Math.floor(expirySecs / 60) })}
          </span>
        </div>
      )}

      {/* ⭐ Handover banner — the "you're done" moment. It replaces the old
          full-screen success page, which keyed off a `completed` field mig 251
          removed (so it could never appear again) and which also hid the
          checklist the holder may still need. A banner above the live steps says
          "finished" without taking the device off screen. */}
      {finished && (
        <div className="alert alert-success enroll-reveal enroll-reveal-1">
          <CheckCircle size={20} className="shrink-0" />
          <div className="min-w-0">
            <div className="alert-title">{t('remoteEnroll.done.title')}</div>
            <div className="alert-description">{t('remoteEnroll.done.tellBranch')}</div>
          </div>
        </div>
      )}

      {prepareError && (
        <div className="alert alert-danger enroll-reveal enroll-reveal-2"><span>{prepareError}</span></div>
      )}

      {/* All 7 steps, from the same components tab-1 renders. */}
      <div className="enroll-reveal enroll-reveal-2">
        <EnrollChecklist
          view={view}
          onPrepare={onPrepare}
          preparing={preparing}
        >
          <EnrollReadinessSteps
            view={view}
            onApplyLight={applyLight}
            onApplied={live.refetch}
            // No apiErrors namespace on this page and no MDM error catalogue —
            // a dead link is the one failure the holder can act on, and it is
            // already terminal via polling. Everything else is "try again".
            formatError={(err) => (err instanceof EnrollLinkDead
              ? t('remoteEnroll.dead.NOT_FOUND.body')
              : t('remoteEnroll.offline.body'))}
          />
        </EnrollChecklist>
      </div>

      <div className="flex items-center justify-center gap-2 text-xs text-subtle">
        <span className={`w-1.5 h-1.5 rounded-full ${offline ? 'bg-warning-fg' : 'bg-success-fg'}`} aria-hidden />
        <span className="tabular-nums">
          {mock.active ? 'mock' : offline ? t('remoteEnroll.offline.title')
            : live.updatedAt === 0 ? t('remoteEnroll.watching')
              : (() => {
                const s = Math.floor((Date.now() - live.updatedAt) / 1000);
                return s < 5 ? t('remoteEnroll.updatedJustNow') : t('remoteEnroll.updatedAgo', { seconds: s });
              })()}
        </span>
      </div>
    </Shell>
  );
}

export { MOCK_SCENARIOS };
