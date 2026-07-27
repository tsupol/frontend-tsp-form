// ============================================================================
// §3.4 — device-reported profiles & apps, as collapsible sections.
//
// Each section header carries the two things the doc requires: the COUNT and how
// STALE the data is (observed_at, via RelativeDateTime). The "pull" button fires
// the async query command (§0.3) — after it acks, we poll the view until its
// newest observed_at moves past what we had, then the count/time update on their
// own. This is the render target the previous round was missing: the pull button
// existed but had nowhere to show its result.
//
// Collapsed by default (narrow screen). Expanding a section loads its view (also
// re-loaded on tab entry per §0.25 when already open — handled by MDM_NO_CACHE).
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import {
  ChevronRight, RefreshCw, Lock, ShieldCheck, KeyRound, Loader2, FileText,
} from 'lucide-react';
import { RelativeDateTime } from './RelativeDateTime';
import { AppIcon, MdmErrorAlert } from './MdmSharedBits';
import { MDM_NO_CACHE } from './useMdmStatus';
import { useMdmCommand } from './useMdmCommand';
import {
  fetchDeviceProfiles, fetchDeviceApps, queryProfiles, queryApps,
  type MdmDeviceProfile, type MdmDeviceApp,
} from './mdmApi';

const POLL_MS = 3000;
const POLL_MAX = 20; // §8.2 stop-after ceiling — then user pulls again manually.

/** newest observed_at across a list (ISO string), or null. */
function newestObserved(rows: { observed_at?: string | null; last_observed_at?: string | null }[]): string | null {
  let max: string | null = null;
  for (const r of rows) {
    const v = r.observed_at ?? r.last_observed_at ?? null;
    if (v && (max === null || v > max)) max = v;
  }
  return max;
}

export function DeviceProfilesApps({
  assetId,
  actorId,
  onNotEnrolled,
}: {
  assetId: number;
  actorId: number | null;
  onNotEnrolled: () => void;
}) {
  return (
    <div className="border border-line rounded-md divide-y divide-line">
      <ProfilesSection assetId={assetId} actorId={actorId} onNotEnrolled={onNotEnrolled} />
      <AppsSection assetId={assetId} actorId={actorId} onNotEnrolled={onNotEnrolled} />
    </div>
  );
}

// ── Section shell ────────────────────────────────────────────────────────────

function SectionHeader({
  open, onToggle, title, count, observedAt, onPull, pulling, canPull,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  count: number | null;
  observedAt: string | null;
  onPull: () => void;
  pulling: boolean;
  canPull: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 min-w-0 flex-1 bg-transparent border-none cursor-pointer text-left p-0 text-current"
      >
        <ChevronRight size={15} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-sm font-medium shrink-0">
          {title}{count != null && <span className="text-subtle"> ({count})</span>}
        </span>
        <span className="text-xs text-subtle truncate ml-1">
          {observedAt
            ? <>{t('asset.mdm.devInfo.observedAt')} <RelativeDateTime value={observedAt} /></>
            : t('asset.mdm.devInfo.neverPulled')}
        </span>
      </button>
      <Button
        variant="outline"
        size="sm"
        disabled={pulling || !canPull}
        onClick={onPull}
        startIcon={pulling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
      >
        {t('asset.mdm.devInfo.pull')}
      </Button>
    </div>
  );
}

// ── Profiles ─────────────────────────────────────────────────────────────────

function ProfilesSection({ assetId, actorId, onNotEnrolled }: {
  assetId: number; actorId: number | null; onNotEnrolled: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const queryKey = ['mdm-device-profiles', assetId];

  const q = useQuery<MdmDeviceProfile[]>({
    queryKey,
    queryFn: () => fetchDeviceProfiles(assetId),
    enabled: open,
    ...MDM_NO_CACHE,
  });

  const observedAt = q.data ? newestObserved(q.data) : null;
  const cmd = useMdmCommand({ onNotEnrolled });
  const pulling = usePullPoll({
    enabled: open, observedAt, refetch: () => qc.invalidateQueries({ queryKey }),
  });

  const pull = () => {
    if (actorId == null) return;
    if (!open) setOpen(true);
    pulling.start();
    cmd.run(() => queryProfiles(assetId, actorId));
  };

  return (
    <div>
      <SectionHeader
        open={open}
        onToggle={() => setOpen((v) => !v)}
        title={t('asset.mdm.devInfo.profiles')}
        count={q.data?.length ?? null}
        observedAt={observedAt}
        onPull={pull}
        pulling={pulling.active}
        canPull={actorId != null}
      />
      {open && (
        <div className="px-3 pb-3">
          {cmd.error && <div className="mb-2"><MdmErrorAlert error={cmd.error} onGoToEnroll={onNotEnrolled} /></div>}
          {q.isLoading ? (
            <div className="text-xs text-subtle py-2">{t('common.loading')}</div>
          ) : (q.data?.length ?? 0) === 0 ? (
            <div className="text-xs text-subtle py-2">{t('asset.mdm.devInfo.noProfiles')}</div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {q.data!.map((p) => (
                <li key={p.id} className="flex items-start gap-2 text-sm">
                  <FileText size={15} className="shrink-0 mt-0.5 text-subtle" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate" title={p.payload_identifier ?? undefined}>
                        {p.payload_display_name || p.payload_identifier || '—'}
                      </span>
                      {p.removal_disallowed && <Lock size={12} className="text-warning-fg shrink-0" aria-label={t('asset.mdm.devInfo.lockedProfile')} />}
                      {p.is_encrypted && <KeyRound size={12} className="text-subtler shrink-0" aria-label={t('asset.mdm.devInfo.encrypted')} />}
                      {p.is_managed && <ShieldCheck size={12} className="text-info-fg shrink-0" aria-label={t('asset.mdm.devInfo.managed')} />}
                    </div>
                    {p.payload_organization && (
                      <div className="text-xs text-subtle truncate">{p.payload_organization}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Apps ─────────────────────────────────────────────────────────────────────

function AppsSection({ assetId, actorId, onNotEnrolled }: {
  assetId: number; actorId: number | null; onNotEnrolled: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const queryKey = ['mdm-device-apps', assetId];

  const q = useQuery<MdmDeviceApp[]>({
    queryKey,
    queryFn: () => fetchDeviceApps(assetId),
    enabled: open,
    ...MDM_NO_CACHE,
  });

  const observedAt = q.data ? newestObserved(q.data) : null;
  const cmd = useMdmCommand({ onNotEnrolled });
  const pulling = usePullPoll({
    enabled: open, observedAt, refetch: () => qc.invalidateQueries({ queryKey }),
  });

  const pull = () => {
    if (actorId == null) return;
    if (!open) setOpen(true);
    pulling.start();
    cmd.run(() => queryApps(assetId, actorId));
  };

  return (
    <div>
      <SectionHeader
        open={open}
        onToggle={() => setOpen((v) => !v)}
        title={t('asset.mdm.devInfo.apps')}
        count={q.data?.length ?? null}
        observedAt={observedAt}
        onPull={pull}
        pulling={pulling.active}
        canPull={actorId != null}
      />
      {open && (
        <div className="px-3 pb-3">
          {cmd.error && <div className="mb-2"><MdmErrorAlert error={cmd.error} onGoToEnroll={onNotEnrolled} /></div>}
          {q.isLoading ? (
            <div className="text-xs text-subtle py-2">{t('common.loading')}</div>
          ) : (q.data?.length ?? 0) === 0 ? (
            <div className="text-xs text-subtle py-2">{t('asset.mdm.devInfo.noApps')}</div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {q.data!.map((a) => (
                <li key={a.bundle_id} className="flex items-center gap-2 min-w-0">
                  <AppIcon bundleId={a.bundle_id} size={30} />
                  <div className="min-w-0">
                    <div className="text-sm truncate flex items-center gap-1.5">
                      {a.app_name || a.bundle_id}
                      {a.is_managed && <ShieldCheck size={12} className="text-info-fg shrink-0" aria-label={t('asset.mdm.devInfo.managed')} />}
                    </div>
                    <div className="text-xs text-subtler truncate">
                      {a.bundle_id}{(a.short_version || a.version) && <> · {a.short_version || a.version}</>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Poll-until-observed helper ───────────────────────────────────────────────
// After a pull acks, poll the view until its newest observed_at moves past the
// value we had at fire time (§3.4). Bounded by POLL_MAX so an offline device
// doesn't spin forever — then the user pulls again.

function usePullPoll({
  enabled, observedAt, refetch,
}: {
  enabled: boolean;
  observedAt: string | null;
  refetch: () => void;
}) {
  const [active, setActive] = useState(false);
  const baselineRef = useRef<string | null>(null);
  const ticksRef = useRef(0);
  // Track the current observedAt without retriggering the interval effect.
  const observedRef = useRef(observedAt);
  observedRef.current = observedAt;

  const start = () => {
    baselineRef.current = observedRef.current;
    ticksRef.current = 0;
    setActive(true);
  };

  useEffect(() => {
    if (!active || !enabled) return;
    const id = setInterval(() => {
      ticksRef.current += 1;
      const cur = observedRef.current;
      const moved = cur != null && cur !== baselineRef.current
        && (baselineRef.current == null || cur > baselineRef.current);
      if (moved || ticksRef.current >= POLL_MAX) {
        setActive(false);
        return;
      }
      refetch();
    }, POLL_MS);
    return () => clearInterval(id);
    // queryKey identity is stable per section; refetch is a fresh closure each
    // render but only invoked inside the interval — fine to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, enabled]);

  return { active, start };
}
