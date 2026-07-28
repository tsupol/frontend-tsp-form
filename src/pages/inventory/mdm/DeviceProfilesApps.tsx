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
  Smartphone, Signal, Copy, Check,
} from 'lucide-react';
import { RelativeDateTime } from './RelativeDateTime';
import { AppIcon, MdmErrorAlert } from './MdmSharedBits';
import { MDM_NO_CACHE } from './useMdmStatus';
import { useMdmCommand } from './useMdmCommand';
import {
  fetchDeviceProfiles, fetchDeviceApps, fetchAssetCellular,
  queryProfiles, queryApps, queryDeviceInfo,
  type MdmDeviceProfile, type MdmDeviceApp, type MdmAssetCellular,
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
      {/* Identity before status: IMEI/SIM says WHICH device this is (§3.4). */}
      <CellularSection assetId={assetId} actorId={actorId} onNotEnrolled={onNotEnrolled} />
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

// ── IMEI & SIM (§3.4) ────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-subtle hover:text-fg cursor-pointer bg-transparent border-none p-0"
      onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      aria-label={label}
    >
      {copied ? <Check size={12} className="text-success-fg" /> : <Copy size={12} />}
    </button>
  );
}

function CellularSection({ assetId, actorId, onNotEnrolled }: {
  assetId: number; actorId: number | null; onNotEnrolled: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true); // identity — worth showing by default
  const qc = useQueryClient();
  const queryKey = ['mdm-asset-cellular', assetId];

  const q = useQuery<MdmAssetCellular[]>({
    queryKey,
    queryFn: () => fetchAssetCellular(assetId),
    enabled: open,
    ...MDM_NO_CACHE,
  });

  const observedAt = q.data ? newestObserved(q.data) : null;
  const cmd = useMdmCommand({ onNotEnrolled });
  const pulling = usePullPoll({ enabled: open, observedAt, refetch: () => qc.invalidateQueries({ queryKey }) });

  const pull = () => {
    if (actorId == null) return;
    if (!open) setOpen(true);
    pulling.start();
    cmd.run(() => queryDeviceInfo(assetId, actorId));
  };

  const rows = q.data ?? [];

  return (
    <div>
      <SectionHeader
        open={open}
        onToggle={() => setOpen((v) => !v)}
        title={t('asset.mdm.cellular.title')}
        count={rows.length || null}
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
          ) : rows.length === 0 ? (
            // In MDM but never queried — 0 rows (§3.4 empty state 2).
            <div className="text-xs text-subtle py-2">{t('asset.mdm.cellular.neverPulled')}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.length > 1 && (
                <div className="text-xs text-subtler">{t('asset.mdm.cellular.dualImeiNote')}</div>
              )}
              {rows.map((r) => <SimCard key={r.slot} sim={r} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SimCard({ sim }: { sim: MdmAssetCellular }) {
  const { t } = useTranslation();
  const Icon = sim.sim_kind === 'ESIM' ? Signal : Smartphone;
  const hasSim = sim.phone_number != null || sim.carrier_network != null;
  return (
    <div className="border border-line rounded-md p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Icon size={14} className="text-subtle" />
        {t(`asset.mdm.cellular.kind.${sim.sim_kind}`)}
        {sim.is_voice_preferred && <Badge label={t('asset.mdm.cellular.voice')} />}
        {sim.is_data_preferred && <Badge label={t('asset.mdm.cellular.data')} />}
      </div>
      <Row label="IMEI">
        <span className="font-mono">{sim.imei_display || sim.imei}</span>
        <CopyButton value={sim.imei} label={t('asset.mdm.cellular.copyImei')} />
      </Row>
      <Row label={t('asset.mdm.cellular.phone')}>
        {sim.phone_number ?? <span className="text-subtler">{t('asset.mdm.cellular.noSim')}</span>}
      </Row>
      <Row label={t('asset.mdm.cellular.carrier')}>
        {sim.carrier_network ?? (hasSim ? '—' : <span className="text-subtler">—</span>)}
      </Row>
      {sim.iccid && (
        <Row label={t('asset.mdm.cellular.iccid')}>
          <span className="font-mono text-xs truncate" title={sim.iccid}>{sim.iccid}</span>
          <CopyButton value={sim.iccid} label={t('asset.mdm.cellular.copyIccid')} />
        </Row>
      )}
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-info-soft text-info-fg font-medium">{label}</span>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-xs text-subtle w-16 shrink-0">{label}</span>
      <span className="min-w-0 inline-flex items-center gap-1.5 truncate">{children}</span>
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
                  <AppIcon bundleId={a.bundle_id} appName={a.app_name} size={30} />
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
