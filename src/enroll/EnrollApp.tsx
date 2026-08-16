// ============================================================================
// The standalone enrollment page — branch B's whole world.
//
// WHO IS LOOKING: not our staff. A customer of branch A collects the handset at
// branch B, which may have no NNF login at all. They scanned a QR on a phone and
// have never seen this system. One column, big targets, plain language.
//
// WHY IT DOESN'T IMPORT THE ADMIN COMPONENTS: it shares WORDING, not markup
// (see strings.ts). Pulling in EnrollChecklist would drag tsp-form, i18next and
// the theme layer back in, which is exactly the weight this entry exists to
// avoid. The visual design is free to differ; the sentences are not.
//
// ⛔ NO PII. The page renders only what fn_mdm_remote_enroll_status returns:
//    serial and device state. The "issued to" note stays on tab-1 — BE forbids
//    it in the URL, the QR and this page.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { usePoll } from './usePoll';
import { makeT, type T } from './strings';
import { useLang, useTheme, ViewerControls } from './Controls';
import { requestPrepare, EnrollLinkDead, type DeadReason } from './api';
import { MOCK_SCENARIOS, ScenarioPicker, useMockScenario } from './mockScenarios';
import type { RemoteEnrollStatus } from '../pages/inventory/mdm/shared/enrollView';

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

// ── Presentation ────────────────────────────────────────────────────────────

/** Serial sized off its own length so it never wraps — a wrapped serial is useless. */
function SerialHero({ serial, t }: { serial: string | null; t: T }) {
  if (!serial) return null;
  const size = `min(11vw, ${(90 / Math.max(serial.length * 0.82, 1)).toFixed(2)}vw, 2.75rem)`;
  return (
    <div className="flex flex-col items-center gap-1.5 w-full min-w-0 enroll-reveal">
      <div className="text-xs text-subtle">{t('remoteEnroll.serialLabel')}</div>
      <div
        className="font-mono font-bold text-center leading-tight whitespace-nowrap w-full select-all"
        style={{ fontSize: size, letterSpacing: '0.18em', textIndent: '0.18em' }}
      >
        {serial}
      </div>
      <p className="text-xs text-subtle text-center">{t('remoteEnroll.serialHint')}</p>
    </div>
  );
}

const STEP_KEYS = ['serial', 'scan', 'send', 'wipe', 'enrolled'] as const;

/** How many of steps 1–5 are done. Same mapping as tab-1. */
function doneCount(s: RemoteEnrollStatus): number {
  switch (s.mdm_status) {
    case 'NO_SERIAL': return 0;
    case 'NOT_STARTED': return 1;
    case 'PREPARING': return 2;
    case 'PROFILE_READY': return 3;
    case 'PREPARE_FAILED': return 1;
    case 'IN_MDM': return 5;
    default: return 0;
  }
}

function Steps({ status, t }: { status: RemoteEnrollStatus; t: T }) {
  const done = doneCount(status);
  return (
    <div className="border border-line rounded-md p-4 flex flex-col">
      {STEP_KEYS.map((key, i) => {
        const state = i < done ? 'done' : i === done ? 'current' : 'todo';
        const last = i === STEP_KEYS.length - 1;
        return (
          <div key={key} className="flex gap-3">
            <div className="flex flex-col items-center shrink-0">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 text-xs font-semibold ${
                state === 'current' ? 'bg-primary border-primary text-primary-contrast'
                  : state === 'done' ? 'bg-success border-success text-success-contrast'
                    : 'bg-surface border-line text-subtle'
              }`}>
                {state === 'done' ? '✓' : i + 1}
              </div>
              {!last && <div className={`w-0.5 flex-1 min-h-[0.75rem] my-0.5 ${state === 'done' ? 'bg-success' : 'bg-line'}`} />}
            </div>
            <div className="pb-3 min-w-0 flex-1">
              <div className={`text-sm font-medium leading-snug ${
                state === 'current' ? 'text-primary-fg' : state === 'done' ? 'text-success-fg' : 'text-fg'
              }`}>
                {t(`asset.mdm.step.${key}`)}
              </div>
              <div className="text-xs text-subtle leading-snug mt-0.5">
                {t(`asset.mdm.stepWhere.${key === 'scan' || key === 'wipe' ? 'device' : key === 'enrolled' ? 'auto' : 'system'}`)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The headline state. PROFILE_READY is an INSTRUCTION, never a spinner: the
 * system finished its half in ~10 seconds and is now waiting on a PERSON to
 * wipe the device (134 §5.1). A spinner there makes people sit and watch
 * instead of going and wiping the handset.
 */
function bandKey(s: RemoteEnrollStatus): { key: string; tone: string; instruction: boolean } {
  if (s.prepare_is_reenroll && s.prepare_status === 'READY') {
    return { key: 'REENROLL_READY', tone: 'warning', instruction: true };
  }
  switch (s.mdm_status) {
    case 'NO_SERIAL': return { key: 'NO_SERIAL', tone: 'info', instruction: false };
    case 'NOT_STARTED': return { key: 'NOT_STARTED', tone: 'info', instruction: false };
    case 'PREPARING': return { key: 'PREPARING', tone: 'info', instruction: false };
    case 'PROFILE_READY': return { key: 'PROFILE_READY', tone: 'warning', instruction: true };
    // B cannot scan a device into ABM — telling them to is a dead end.
    case 'PREPARE_FAILED': return { key: 'PREPARE_FAILED_REMOTE', tone: 'danger', instruction: false };
    case 'IN_MDM': return { key: 'IN_MDM', tone: 'success', instruction: false };
    default: return { key: 'NOT_STARTED', tone: 'info', instruction: false };
  }
}

function waitStage(requestedAt: string | null): 'FRESH' | 'PROBABLY_NOT_WIPED' | 'CHECK_SERIAL' {
  if (!requestedAt) return 'FRESH';
  const ms = Date.now() - new Date(requestedAt).getTime();
  if (!Number.isFinite(ms)) return 'FRESH';
  if (ms > 60 * 60_000) return 'CHECK_SERIAL';
  if (ms > 10 * 60_000) return 'PROBABLY_NOT_WIPED';
  return 'FRESH';
}

function fmtWait(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function StatusBand({ status, t }: { status: RemoteEnrollStatus; t: T }) {
  const band = bandKey(status);
  const waiting = status.prepare_status === 'READY' && !status.in_mdm;
  useTicker(waiting);
  const waited = waiting && status.prepare_requested_at
    ? Math.max(0, Math.floor((Date.now() - new Date(status.prepare_requested_at).getTime()) / 1000))
    : null;

  return (
    <div className={`alert alert-${band.tone} enroll-reveal enroll-reveal-2`}>
      <div className="min-w-0 flex-1">
        <div className="alert-title">{t(`asset.mdm.band.${band.key}.title`)}</div>
        <div className="alert-description">{t(`asset.mdm.band.${band.key}.body`)}</div>
        {band.instruction && (
          <ol className="mt-2 flex flex-col gap-1 text-sm list-decimal pl-4">
            <li>{t('asset.mdm.wipeSteps.s1')}</li>
            <li>{t('asset.mdm.wipeSteps.s2')}</li>
            <li>{t('asset.mdm.wipeSteps.s3')}</li>
          </ol>
        )}
        {waited != null && waited >= 30 && (
          <div className="alert-description mt-1 tabular-nums">
            {t('asset.mdm.waitHint.waiting', { time: fmtWait(waited) })}
          </div>
        )}
      </div>
    </div>
  );
}

/** 🍎 Apple key unlocks the customer's iCloud · 🏢 org key survives a wipe. */
function KeyBanner({ status, t }: { status: RemoteEnrollStatus; t: T }) {
  const pull = status.has_pull_key;
  // Three states, not two: holding the key ≠ Apple confirming it landed.
  const push = !status.has_push_key ? 'missing' : !status.push_key_applied_at ? 'pending' : 'ok';
  return (
    <div className={`alert alert-${status.lock_ready ? 'success' : 'warning'} enroll-reveal enroll-reveal-3`}>
      <div className="min-w-0 flex-1">
        <div className="alert-title">
          {t(status.lock_ready ? 'asset.mdm.keys.readyTitle' : 'asset.mdm.keys.notReadyTitle')}
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-sm">
          <span>🍎 {t('asset.mdm.keys.appleShort')} {pull ? '✓' : '✕'}</span>
          <span>🏢 {t('asset.mdm.keys.orgShort')} {push === 'ok' ? '✓' : push === 'pending' ? '⏳' : '✕'}</span>
        </div>
        {!status.lock_ready && status.lock_verdict_code && (
          <div className="alert-description mt-1.5">
            {t(`asset.mdm.lockVerdict.${status.lock_verdict_code}`)}
          </div>
        )}
      </div>
    </div>
  );
}

function Shell({ children, controls }: { children: React.ReactNode; controls: React.ReactNode }) {
  return (
    // max-w-md, not 100vw: layout.css sets body{width:100vw}, which includes the
    // scrollbar and produces a horizontal gutter on some phones.
    <div className="min-h-dvh flex justify-center px-4 py-6">
      <div className="w-full max-w-md flex flex-col gap-4 min-w-0">
        {controls}
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

  const [lang, setLang] = useLang();
  const [theme, setTheme] = useTheme();
  const t = useMemo(() => makeT(lang), [lang]);

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
  useTicker(true, 1000); // ages the "updated Ns ago" line

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

  if (dead && dead !== 'COMPLETED') {
    return (
      <Shell controls={controls}>
        {picker}
        <Terminal icon="⚠️" title={t(`remoteEnroll.dead.${dead}.title`)} body={t(`remoteEnroll.dead.${dead}.body`)} />
      </Shell>
    );
  }

  if (dead === 'COMPLETED' || status?.completed) {
    return (
      <Shell controls={controls}>
        {picker}
        <div className="flex flex-col items-center text-center gap-4 pt-10">
          <div className="w-20 h-20 rounded-full bg-success-soft border border-success-border flex items-center justify-center enroll-reveal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                 strokeLinecap="round" strokeLinejoin="round"
                 className="w-10 h-10 text-success-fg remote-enroll-check" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="flex flex-col items-center gap-2 enroll-reveal enroll-reveal-2">
            <h1 className="heading-2">{t('remoteEnroll.done.title')}</h1>
            <p className="text-subtle">{t('remoteEnroll.done.body')}</p>
            {status?.serial_number && (
              <div className="font-mono text-sm text-subtle tracking-widest select-all">{status.serial_number}</div>
            )}
          </div>
          <div className="alert alert-success mt-2 text-left enroll-reveal enroll-reveal-3">
            <span>🎉 {t('remoteEnroll.done.tellBranch')}</span>
          </div>
        </div>
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

  const stage = status.prepare_status === 'READY' && !status.in_mdm
    ? waitStage(status.prepare_requested_at)
    : 'FRESH';

  const expirySecs = status.link_expires_at
    ? Math.max(0, Math.floor((new Date(status.link_expires_at).getTime() - Date.now()) / 1000))
    : null;

  return (
    <Shell controls={controls}>
      {picker}

      <SerialHero serial={status.serial_number} t={t} />

      {expirySecs != null && (
        <div className={`text-center text-xs enroll-reveal enroll-reveal-1 ${expirySecs < 900 ? 'text-warning-fg' : 'text-subtle'}`}>
          <span className="tabular-nums">
            {expirySecs >= 3600
              ? t('remoteEnroll.expiresInHm', { h: Math.floor(expirySecs / 3600), m: Math.floor((expirySecs % 3600) / 60) })
              : t('remoteEnroll.expiresInM', { m: Math.floor(expirySecs / 60) })}
          </span>
        </div>
      )}

      <StatusBand status={status} t={t} />

      {stage !== 'FRESH' && (
        <div className="alert alert-info enroll-reveal enroll-reveal-2">
          <div className="min-w-0">
            <div className="alert-title">{t(`asset.mdm.waitHint.${stage}.title`)}</div>
            <div className="alert-description">
              {t(stage === 'CHECK_SERIAL'
                ? 'asset.mdm.waitHint.CHECK_SERIAL.bodyRemote'
                : `asset.mdm.waitHint.${stage}.body`)}
            </div>
          </div>
        </div>
      )}

      {prepareError && (
        <div className="alert alert-danger"><span>{prepareError}</span></div>
      )}

      {status.can_prepare && (
        <div className="enroll-reveal enroll-reveal-2">
          <button
            type="button"
            onClick={onPrepare}
            disabled={preparing}
            className="w-full px-4 py-2.5 rounded-md bg-primary text-primary-contrast font-medium cursor-pointer border-none disabled:opacity-60"
          >
            {status.mdm_status === 'PREPARE_FAILED'
              ? t('asset.mdm.button.retry')
              : status.prepare_is_reenroll
                ? t('asset.mdm.button.reenroll')
                : t('asset.mdm.button.prepare')}
          </button>
        </div>
      )}

      <Steps status={status} t={t} />

      {status.in_mdm && <KeyBanner status={status} t={t} />}

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
