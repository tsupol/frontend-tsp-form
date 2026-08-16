// ============================================================================
// /mdm-enroll?token=… — the public shadow of MDM tab-1.
// IMPLEMENT 2026-08-15_mdm_remote_enroll_delegation.md §2
//
// WHO IS LOOKING: not our staff. A customer of branch A collects the handset at
// branch B, which may have no NNF login at all — often it is another financier's
// employee. They scanned a QR on a phone and have never seen this system. So:
// no nav, no chrome, one column, big targets, and every instruction spelled out.
//
// WHO IS ALSO LOOKING: branch A, on tab-1, on the telephone to them. The whole
// design rule is that both screens show the same facts changing at the same
// moment — hence the shared EnrollChecklist and the shared poll cadence. If the
// two disagree, the phone call goes in circles and that is the feature failing.
//
// ⛔ NO PII, EVER. This page is anonymous (the token self-authenticates), so it
//    renders only what fromRemoteStatus lets through: serial and device state.
//    issued_to_note is internal — BE forbids it in the URL, the QR, and here.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button, Skeleton, Checkmark } from 'tsp-form';
import { AlertCircle, RefreshCw, Clock, PartyPopper } from 'lucide-react';
import {
  remoteEnrollStatus, remoteEnrollRetry, enrollLinkInvalidReason, parseMdmError,
  type EnrollLinkInvalidReason,
} from '../inventory/mdm/mdmApi';
import { fromRemoteStatus, type RemoteEnrollStatus } from '../inventory/mdm/shared/enrollView';
import { EnrollChecklist, KeyBanner } from '../inventory/mdm/shared/EnrollChecklist';
import { SerialHero } from '../inventory/mdm/shared/SerialDisplay';
import { useEnrollPoll } from '../inventory/mdm/shared/useEnrollPoll';
import { useTicker, secondsUntil, splitDuration } from '../inventory/mdm/shared/useTicker';

// ── Language ────────────────────────────────────────────────────────────────
// The app-wide i18n config falls back to English and caches the admin user's
// choice in localStorage. Neither is right here: this page is read by someone
// standing in a Thai shop, usually not our staff, and the admin app's language
// says nothing about what THEY read. So Thai is the default, chosen once on
// mount unless the URL asks otherwise (?lang=en).
//
// The switch is deliberately NOT written to localStorage — flipping this page
// to English must not silently change the language of the admin app for a
// staffer who opened the link on their own phone to check it.
const PAGE_LANGS = ['th', 'en'] as const;
type PageLang = (typeof PAGE_LANGS)[number];

// Module-level, NOT component state. The shell is rendered by five different
// branches (loading / dead / offline / finished / main), so a useState inside it
// resets to Thai every time the page changes state — silently throwing away the
// choice of someone who had just switched to English. Keeping it here means the
// selection survives those swaps for the life of the page.
let currentLang: PageLang = 'th';

function useRemoteEnrollLanguage(): [PageLang, (l: PageLang) => void] {
  const { i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('lang');

  const [lang, setLangState] = useState<PageLang>(() => {
    currentLang = PAGE_LANGS.includes(requested as PageLang)
      ? (requested as PageLang)
      : currentLang;
    return currentLang;
  });

  const setLang = (l: PageLang) => {
    currentLang = l;
    setLangState(l);
  };

  // ⛔ i18n.changeLanguage would PERSIST this. The app's detector is configured
  // with caches:['localStorage'], so forcing Thai here — or a visitor tapping
  // EN — would rewrite the stored preference and silently flip the whole admin
  // app for a staffer who merely opened the QR link in their own browser to
  // check it. Restore whatever was cached immediately afterwards so this page's
  // language stays local to this page.
  useEffect(() => {
    if (i18n.language === lang) return;
    let cached: string | null = null;
    try {
      cached = localStorage.getItem('i18nextLng');
    } catch {
      cached = null;
    }
    i18n.changeLanguage(lang).finally(() => {
      try {
        if (cached === null) localStorage.removeItem('i18nextLng');
        else localStorage.setItem('i18nextLng', cached);
      } catch {
        /* private mode — nothing to restore into */
      }
    });
  }, [i18n, lang]);

  return [lang, setLang];
}

/** Two-up toggle. Small and quiet — it must not compete with the serial. */
function LanguageSwitch({
  lang, onChange,
}: {
  lang: PageLang;
  onChange: (l: PageLang) => void;
}) {
  return (
    <div className="flex justify-end">
      <div className="inline-flex rounded-md border border-line overflow-hidden">
        {PAGE_LANGS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onChange(l)}
            aria-pressed={lang === l}
            className={`px-2.5 py-1 text-xs font-medium cursor-pointer border-none transition-colors ${
              lang === l
                ? 'bg-primary text-primary-contrast'
                : 'bg-surface text-subtle hover:bg-surface-hover'
            }`}
          >
            {l === 'th' ? 'ไทย' : 'EN'}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Page shell — one column, centred, comfortable on a phone held one-handed.
 *
 * The language switch lives HERE rather than in the main view, so it is present
 * on every state including the dead-link and success screens. Someone who lands
 * on "ลิงก์หมดอายุ" and cannot read it needs the toggle most of all.
 */
function Shell({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useRemoteEnrollLanguage();
  return (
    <div className="min-h-dvh bg-bg flex justify-center px-4 py-6">
      <div className="w-full max-w-md flex flex-col gap-4">
        <LanguageSwitch lang={lang} onChange={setLang} />
        {children}
      </div>
    </div>
  );
}

/**
 * First paint. A skeleton of the REAL layout, not a spinner: the page then fills
 * in place instead of jumping from a centred spinner to a full page. Matching
 * the final geometry is the point — a mismatched skeleton produces exactly the
 * shift that reads as jank even when the load was quick.
 */
function LoadingSkeleton() {
  return (
    <Shell>
      <div className="flex flex-col items-center gap-2 pt-2">
        <Skeleton width="7rem" height="0.75rem" />
        <Skeleton width="85%" height="2.5rem" />
        <Skeleton width="60%" height="0.75rem" />
      </div>
      <Skeleton variant="rectangular" height="5rem" className="rounded-md" />
      <Skeleton variant="rectangular" height="16rem" className="rounded-md" />
    </Shell>
  );
}

/** The link is dead. Four reasons, and COMPLETED is a happy ending, not a fault. */
function DeadLink({ reason }: { reason: EnrollLinkInvalidReason }) {
  const { t } = useTranslation();
  if (reason === 'COMPLETED') return <Finished />;
  return (
    <Shell>
      <div className="flex flex-col items-center text-center gap-3 pt-10">
        <AlertCircle size={56} className="text-warning-fg" />
        <h1 className="heading-2">{t(`remoteEnroll.dead.${reason}.title`)}</h1>
        <p className="text-subtle">{t(`remoteEnroll.dead.${reason}.body`)}</p>
      </div>
    </Shell>
  );
}

/**
 * The ending. This is the moment B turns the phone around to show A, so it gets
 * a real success state rather than a badge flip — the checkmark draws itself in
 * (motion-safe), which is the only decorative animation on the page.
 */
function Finished({ serial }: { serial?: string | null }) {
  const { t } = useTranslation();
  return (
    <Shell>
      <div className="flex flex-col items-center text-center gap-4 pt-10">
        <div className="w-20 h-20 rounded-full bg-success-soft border border-success-border flex items-center justify-center">
          <Checkmark className="w-10 h-10 text-success-fg remote-enroll-check" />
        </div>
        <h1 className="heading-2">{t('remoteEnroll.done.title')}</h1>
        <p className="text-subtle">{t('remoteEnroll.done.body')}</p>
        {serial && (
          <div className="font-mono text-sm text-subtle tracking-widest select-all">{serial}</div>
        )}
        <div className="alert alert-success mt-2 text-left">
          <PartyPopper size={18} className="shrink-0" />
          <span>{t('remoteEnroll.done.tellBranch')}</span>
        </div>
      </div>
    </Shell>
  );
}

/** Live "this link dies in …". Three hours is short; nobody should be surprised. */
function ExpiryLine({ expiresAt }: { expiresAt: string | null }) {
  const { t } = useTranslation();
  useTicker(!!expiresAt, 30_000); // minute-resolution: 30s keeps it honest, cheaply
  const left = secondsUntil(expiresAt);
  if (left == null) return null;
  const { h, m } = splitDuration(left);
  const text = h > 0
    ? t('remoteEnroll.expiresInHm', { h, m })
    : t('remoteEnroll.expiresInM', { m });
  return (
    <div className={`flex items-center justify-center gap-1.5 text-xs ${
      left < 15 * 60 ? 'text-warning-fg' : 'text-subtle'
    }`}>
      <Clock size={12} className="shrink-0" />
      <span className="tabular-nums">{text}</span>
    </div>
  );
}

/**
 * Retire the boot splash from index.html, which is scoped to this path only.
 *
 * Lives here rather than in main.tsx so the admin app's startup is untouched —
 * it has no splash by design. Held for a minimum dwell measured from first paint
 * (window.__enrollBootAt): on a warm cache React paints in ~200ms, and a splash
 * that appears and vanishes in the same breath reads as a glitch, not a load.
 */
const BOOT_MIN_DWELL = 900;

function useDismissBootSplash() {
  useEffect(() => {
    const boot = document.getElementById('enroll-boot');
    if (!boot) return;
    const started = (window as unknown as { __enrollBootAt?: number }).__enrollBootAt ?? Date.now();
    const wait = Math.max(0, BOOT_MIN_DWELL - (Date.now() - started));
    const id = setTimeout(() => {
      boot.classList.add('is-done');
      boot.addEventListener('transitionend', () => boot.remove(), { once: true });
      // If the transition never fires (reduced motion, background tab) the
      // splash must still go, or it sits over the page eating every tap.
      setTimeout(() => {
        boot.remove();
        document.documentElement.classList.remove('enroll-booting');
      }, 500);
    }, wait);
    return () => clearTimeout(id);
  }, []);
}

/**
 * The "we are watching" pulse. Fires when DATA ARRIVES, not on a loop — so a
 * stalled fetch leaves the dot still, and the signal stays honest. Without it a
 * page that polls every 5s looks frozen, which is precisely how staff concluded
 * "done" or "broken" and walked away on 2026-08-01 (134 §5).
 */
function Heartbeat({ dataUpdatedAt }: { dataUpdatedAt: number }) {
  const { t } = useTranslation();
  const [beat, setBeat] = useState(0);
  useTicker(true); // re-render each second so the "N seconds ago" counts up

  useEffect(() => {
    if (!dataUpdatedAt) return;
    setBeat((n) => n + 1);
  }, [dataUpdatedAt]);

  const secs = dataUpdatedAt ? Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 1000)) : null;

  return (
    <div className="flex items-center justify-center gap-2 text-xs text-subtle">
      <span
        key={beat}
        className="w-1.5 h-1.5 rounded-full bg-success-fg motion-safe:animate-ping-once"
        aria-hidden
      />
      <span className="tabular-nums">
        {secs == null ? t('remoteEnroll.watching')
          : secs < 5 ? t('remoteEnroll.updatedJustNow')
            : t('remoteEnroll.updatedAgo', { seconds: secs })}
      </span>
    </div>
  );
}

export function RemoteEnrollPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  // Hand off from the inline splash. Unconditional and first: every branch below
  // returns early, and the splash must lift no matter which one wins.
  useDismissBootSplash();

  // A dead link is FINAL — stop polling and stop retrying. Anything else (a
  // flaky phone signal at branch B) must keep trying, so the two are split.
  const [deadReason, setDeadReason] = useState<EnrollLinkInvalidReason | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useEnrollPoll<RemoteEnrollStatus>({
    queryKey: ['remote-enroll', token],
    queryFn: () => remoteEnrollStatus(token!),
    enabled: !!token && !deadReason,
    // The link closes itself on completion; polling on would just collect
    // COMPLETED rejections (§2.1).
    stop: (d) => !!d?.completed,
    retry: false,
  });

  // Classify failures once, here: link-dead vs merely-offline.
  useEffect(() => {
    if (!query.error) return;
    const reason = enrollLinkInvalidReason(query.error);
    if (reason) setDeadReason(reason);
  }, [query.error]);

  const retry = useMutation({
    mutationFn: () => remoteEnrollRetry(token!),
    onSuccess: () => {
      setActionError(null);
      query.refetch();
    },
    onError: (err) => {
      const reason = enrollLinkInvalidReason(err);
      if (reason) { setDeadReason(reason); return; }
      setActionError(parseMdmError(err, t).message);
    },
  });

  const view = useMemo(
    () => (query.data ? fromRemoteStatus(query.data) : null),
    [query.data],
  );

  if (!token) return <DeadLink reason="NOT_FOUND" />;
  if (deadReason) return <DeadLink reason={deadReason} />;

  // Skeleton only on the FIRST load. Binding it to isFetching would flash the
  // whole page every 5 seconds forever.
  if (query.isLoading || !view) {
    if (query.isError) {
      return (
        <Shell>
          <div className="flex flex-col items-center text-center gap-3 pt-10">
            <AlertCircle size={56} className="text-danger-fg" />
            <h1 className="heading-2">{t('remoteEnroll.offline.title')}</h1>
            <p className="text-subtle">{t('remoteEnroll.offline.body')}</p>
            <Button
              variant="outline"
              startIcon={<RefreshCw size={16} />}
              onClick={() => query.refetch()}
            >
              {t('common.refresh')}
            </Button>
          </div>
        </Shell>
      );
    }
    return <LoadingSkeleton />;
  }

  if (query.data?.completed) return <Finished serial={view.serial_number} />;

  return (
    <Shell>
      {/* Serial first and biggest — the link holder has nothing else on screen
          to match against the box in their hand. */}
      <div className="pt-2">
        <SerialHero serial={view.serial_number} />
      </div>

      <ExpiryLine expiresAt={query.data?.link_expires_at ?? null} />

      {/* motion-safe fade so arriving data settles instead of snapping. The
          skeleton above already reserved this geometry, so nothing shifts. */}
      <div className="motion-safe:animate-fade-in">
        <EnrollChecklist
          view={view}
          audience="remote"
          onPrepare={() => retry.mutate()}
          preparing={retry.isPending}
          errorMessage={actionError}
          hideKeyBanner
        />
      </div>

      {/* Handover readiness sits BELOW the steps here: it is the last thing that
          matters to a delegate, and only once the device is actually in. */}
      {view.in_mdm && <KeyBanner view={view} />}

      <Heartbeat dataUpdatedAt={query.dataUpdatedAt} />
    </Shell>
  );
}
