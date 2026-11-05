// The system's one location viewer (UI_SUMMARY 159): contract page, device page,
// the collector's device panel, the repo job and the customer map all open it.
//   left  = the groups of fixes (clusters) and every fix, newest first
//   right = the map with every fix, the groups as rings, a pin on the chosen fix,
//           and under it when that fix was taken (weekday, date, time, days ago)
// Above both, the backend's verdict on where the customer lives (159 §1b) and a
// one-line summary. Every figure, day and group comes from the RPC (mig 434).

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, DataTable, Modal, Tooltip } from 'tsp-form';
import { AlertTriangle, ExternalLink, Home, Loader2, MapPin, MapPinOff, RefreshCw, Sunrise } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { DateTime } from '../DateTime';
import {
  useDeviceLocations, useLocationViewCan,
  type DeviceLocations, type LocationCluster, type LocationRow, type LocationTarget, type ResidenceVerdict,
} from './deviceLocationApi';
import { useLocationWhen } from './locationWhen';
import { clusterColor } from './mapColors';
import type { MapFocus } from './LocationMap';

const LocationMap = lazy(() => import('./LocationMap'));

const ROW_GRID = 'grid grid-cols-[0.75rem_minmax(0,1fr)_minmax(0,0.8fr)_3.5rem] gap-2 items-center';

function errorText(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    if (err.code === 'MDM.AUTH.LOCATION_VIEW_NOT_GRANTED') return t('deviceLocation.error.notGranted');
    if (err.code === 'MDM.AUTH.LOCATION_VIEW_NOT_VISIBLE') return t('deviceLocation.error.notVisible');
  }
  return translateApiError(err, t);
}

function ClusterDot({ no }: { no: number | null }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: clusterColor(no) }} aria-hidden />;
}

export function DeviceLocationDialog({ open, target, lastFixAt, onClose }: {
  open: boolean;
  target: LocationTarget;
  /** The newest fix the host knows of, from a free read: when it moves while
   *  this window is open the list is read again, once. */
  lastFixAt?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const when = useLocationWhen();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);

  useEffect(() => {
    if (open) { setSelectedId(null); setFocus(null); }
  }, [open]);

  const { data, error, isLoading, isFetching, refetch } = useDeviceLocations(target, open);

  // A newer fix landed while the window is open → read it once.
  const seenFix = useRef<string | null>(null);
  useEffect(() => {
    if (!open) { seenFix.current = null; return; }
    if (!lastFixAt) return;
    if (seenFix.current && lastFixAt > seenFix.current) void refetch();
    seenFix.current = lastFixAt;
  }, [open, lastFixAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data?.rows ?? [];
  const clusters = data?.clusters ?? [];
  // Opens on the newest; a fix that is gone after a refresh falls back to it.
  const selected: LocationRow | null = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;
  const residence = data?.residence ?? null;
  const home = residence?.status === 'RESIDENT' && residence.lat != null && residence.lon != null
    ? { lat: residence.lat, lon: residence.lon, radiusM: residence.radius_m }
    : null;

  const mapFixes = useMemo(() => rows.map((r) => ({
    id: r.id, lat: r.lat, lon: r.lon, clusterNo: r.cluster_no,
    label: `${when.at(r.when)} · ${when.ago(r.when)}`,
  })), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapClusters = useMemo(() => clusters.map((c) => ({
    clusterNo: c.cluster_no, lat: c.lat, lon: c.lon, radiusM: c.radius_m,
    label: t('deviceLocation.cluster.mapLabel', { no: c.cluster_no, fixes: c.fixes, days: c.days }),
  })), [clusters]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusOn = (lat: number, lon: number, radiusM?: number | null) =>
    setFocus((f) => ({ tick: (f?.tick ?? 0) + 1, lat, lon, radiusM }));

  return (
    <Modal open={open} onClose={onClose} maxWidth="72rem" width="100%" ariaLabel={t('deviceLocation.title')}>
      <div className="flex flex-col overflow-hidden" style={{ maxHeight: '92dvh' }}>
        <div className="modal-header">
          <h2 className="modal-title inline-flex items-center gap-2"><MapPin size={16} />{t('deviceLocation.title')}</h2>
          <div className="flex items-center gap-1">
            <Tooltip content={t('deviceLocation.refresh')} placement="bottom">
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('deviceLocation.refresh')}
                startIcon={<RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />}
                disabled={isFetching}
                onClick={() => void refetch()}
              />
            </Tooltip>
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>×</button>
          </div>
        </div>

        <div className="modal-content min-w-0 flex flex-col gap-3">
          {error ? (
            <div className="alert alert-danger"><AlertTriangle size={16} /><span>{errorText(error, t)}</span></div>
          ) : isLoading || !data ? (
            <div className="py-10 flex justify-center text-subtler"><Loader2 size={20} className="animate-spin" /></div>
          ) : (
            <>
              <DeviceBox data={data} />
              {residence && (
                <ResidenceBand residence={residence} canFocus={home != null} onFocus={() => home && focusOn(home.lat, home.lon, home.radiusM)} />
              )}
              {data.reason_code ? (
                <div className="py-8 flex flex-col items-center gap-2 text-subtle text-sm">
                  <MapPinOff size={24} className="text-subtler" />
                  {t(`deviceLocation.reason.${data.reason_code}`, { defaultValue: data.reason_code })}
                </div>
              ) : (
                <>
                  {data.summary && data.summary.first_when && data.summary.last_when && (
                    <div className="text-sm text-subtle flex flex-wrap gap-x-3 gap-y-0.5" data-testid="location-summary">
                      <span><span className="font-medium text-fg">{data.summary.fixes}</span> {t('deviceLocation.summary.fixes')}</span>
                      <span><span className="font-medium text-fg">{data.summary.days}</span> {t('deviceLocation.summary.days')}</span>
                      <span>{when.day(data.summary.first_when)} – {when.day(data.summary.last_when)}</span>
                      <span><span className="font-medium text-fg">{data.summary.clusters}</span> {t('deviceLocation.summary.clusters')}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
                    {/* On a phone the map comes first, so a tapped row moves a pin that is on screen. */}
                    <div className="md:order-2 min-w-0 flex flex-col gap-2">
                      <Suspense fallback={<div className="h-64 md:h-[24rem] rounded-md border border-line" />}>
                        <LocationMap
                          className="h-64 md:h-[24rem] rounded-md border border-line overflow-hidden"
                          fixes={mapFixes}
                          clusters={mapClusters}
                          selected={selected ? { id: selected.id, lat: selected.lat, lon: selected.lon, radiusM: selected.accuracy_m } : null}
                          home={home}
                          focus={focus}
                          onSelectFix={setSelectedId}
                        />
                      </Suspense>
                      {selected && <FixCard row={selected} />}
                    </div>
                    <div className="md:order-1 min-w-0 md:h-[31rem] flex flex-col gap-2">
                      {clusters.length > 0 && (
                        <ClusterList clusters={clusters} onPick={(c) => focusOn(c.lat, c.lon, c.radius_m)} />
                      )}
                      <div className="flex-1 min-h-48 flex flex-col border border-line rounded-md overflow-hidden">
                        <DataTable<LocationRow>
                          data={rows}
                          renderHeader={() => (
                            <div className={`${ROW_GRID} px-3 py-2 text-xs font-medium text-subtle border-b border-line`}>
                              <span />
                              <span>{t('deviceLocation.col.time')}</span>
                              <span>{t('deviceLocation.col.source')}</span>
                              <span className="text-right">{t('deviceLocation.col.accuracy')}</span>
                            </div>
                          )}
                          renderRow={(row) => {
                            const r = row.original;
                            return (
                              <button
                                type="button"
                                className={`${ROW_GRID} w-full text-left px-3 py-1.5 text-sm cursor-pointer bg-transparent border-none`}
                                onClick={() => setSelectedId(r.id)}
                              >
                                <ClusterDot no={r.cluster_no} />
                                <span className="min-w-0 flex flex-col">
                                  <span className="truncate">{when.at(r.when)}</span>
                                  <span className="text-xs text-subtle inline-flex items-center gap-1">
                                    {when.ago(r.when)}
                                    {r.when.is_morning && <Sunrise size={12} className="text-warning-fg" aria-label={t('deviceLocation.morning')} />}
                                  </span>
                                </span>
                                <span className="min-w-0 text-xs text-subtle">
                                  {t(`deviceLocation.source.${r.source_code}`, { defaultValue: r.source_code })}
                                </span>
                                <span className="text-right text-xs tabular-nums text-subtle">
                                  {r.accuracy_m != null ? t('deviceLocation.accuracyValue', { m: Math.round(r.accuracy_m) }) : '—'}
                                </span>
                              </button>
                            );
                          }}
                          getRowProps={(row) => ({ 'data-state': row.original.id === selected?.id ? 'selected' : undefined })}
                          enableKeyboardNav
                          onRowActivate={(row) => setSelectedId(row.original.id)}
                          className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60' : ''} transition-opacity`}
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** When the chosen fix was taken, where it came from and how sure it is. */
function FixCard({ row }: { row: LocationRow }) {
  const { t } = useTranslation();
  const when = useLocationWhen();
  return (
    <div className="px-3 py-2 rounded-md border border-line bg-surface flex flex-col gap-1" data-testid="location-fix-card">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold">{when.at(row.when)}</span>
        <Badge size="xs" color={row.when.days_ago <= 1 ? 'success' : 'default'}>{when.ago(row.when)}</Badge>
        {row.when.is_morning && (
          <span className="inline-flex items-center gap-1 text-xs text-warning-fg"><Sunrise size={13} />{t('deviceLocation.morning')}</span>
        )}
      </div>
      <div className="text-xs text-subtle flex items-center gap-x-3 gap-y-0.5 flex-wrap">
        <span>{t(`deviceLocation.source.${row.source_code}`, { defaultValue: row.source_code })}</span>
        {row.accuracy_m != null && <span>{t('deviceLocation.accuracyValue', { m: Math.round(row.accuracy_m) })}</span>}
        <span className="inline-flex items-center gap-1">
          <ClusterDot no={row.cluster_no} />
          {row.cluster_no != null ? t('deviceLocation.cluster.name', { no: row.cluster_no }) : t('deviceLocation.cluster.none')}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-subtle flex-wrap">
        <span className="font-mono">{row.lat}, {row.lon}</span>
        <a href={row.map_url} target="_blank" rel="noreferrer" className="text-primary-fg hover:underline inline-flex items-center gap-1 shrink-0">
          {t('deviceLocation.openGoogleMaps')}<ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

/** Places the phone keeps coming back to; group 1 has the most fixes. */
function ClusterList({ clusters, onPick }: { clusters: LocationCluster[]; onPick: (c: LocationCluster) => void }) {
  const { t } = useTranslation();
  const when = useLocationWhen();
  return (
    <div className="border border-line rounded-md shrink-0 max-h-44 overflow-y-auto" data-testid="location-clusters">
      <div className="px-3 py-1.5 text-xs font-medium text-subtle border-b border-line">
        {t('deviceLocation.cluster.title', { count: clusters.length })}
      </div>
      <div className="divide-y divide-line">
        {clusters.map((c) => (
          <button
            key={c.cluster_no}
            type="button"
            className="w-full text-left px-3 py-1.5 flex items-start gap-2 bg-transparent border-none cursor-pointer hover:bg-surface-hover"
            onClick={() => onPick(c)}
          >
            <span className="mt-1.5"><ClusterDot no={c.cluster_no} /></span>
            <span className="min-w-0 flex flex-col">
              <span className="text-sm">
                <span className="font-medium">{t('deviceLocation.cluster.name', { no: c.cluster_no })}</span>
                {' · '}{t('deviceLocation.cluster.stats', { fixes: c.fixes, days: c.days, mornings: c.mornings, m: c.radius_m })}
              </span>
              <span className="text-xs text-subtle">
                {t('deviceLocation.cluster.span', {
                  first: when.day(c.first_when),
                  last: when.day(c.last_when),
                  ago: when.ago(c.last_when),
                })}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DeviceBox({ data }: { data: DeviceLocations }) {
  const { t } = useTranslation();
  const { device, contract } = data;
  return (
    <div className="px-3 py-2.5 rounded-md bg-surface border border-line flex flex-col gap-0.5">
      {device ? (
        <>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            {/* A new tab: this window sits on a page the person is working on. */}
            <Link to={`/admin/inventory/assets/${device.asset_id}`} target="_blank" className="font-medium text-primary-fg hover:underline inline-flex items-center gap-1">
              {device.asset_code}<ExternalLink size={12} />
            </Link>
            {device.product_display_name && <span>{device.product_display_name}</span>}
          </div>
          <div className="text-xs text-subtle flex items-center gap-x-3 gap-y-0.5 flex-wrap">
            {device.serial_number && <span className="font-mono">SN {device.serial_number}</span>}
            {contract && <span>{t('deviceLocation.contract')} {contract.code}</span>}
            {device.last_seen_at && <span>{t('deviceLocation.lastSeen')} <DateTime value={device.last_seen_at} /></span>}
          </div>
        </>
      ) : (
        <div className="font-medium text-sm">{contract?.code ?? '—'}</div>
      )}
    </div>
  );
}

function ResidenceBand({ residence, canFocus, onFocus }: {
  residence: ResidenceVerdict;
  canFocus: boolean;
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  const { status, mornings, mornings_in_cluster: inCluster } = residence;
  const isResident = status === 'RESIDENT';
  return (
    <div className={`px-3 py-2 rounded-md border flex items-center gap-x-3 gap-y-1 flex-wrap text-sm ${
      isResident ? 'bg-success-soft border-success-border' : 'bg-surface border-line'
    }`}>
      <span className={`inline-flex items-center gap-2 font-medium ${isResident ? 'text-success-fg' : 'text-subtle'}`}>
        <Home size={15} className="shrink-0" />
        {t(`deviceLocation.residence.${status}`, { inCluster, mornings })}
      </span>
      {isResident && residence.radius_m != null && (
        <span className="text-xs text-subtle">{t('deviceLocation.residence.radius', { m: residence.radius_m })}</span>
      )}
      {isResident && (
        <span className="ml-auto inline-flex items-center gap-3 shrink-0">
          {canFocus && (
            <button type="button" className="text-xs text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer" onClick={onFocus}>
              {t('deviceLocation.residence.showOnMap')}
            </button>
          )}
          {residence.map_url && (
            <a href={residence.map_url} target="_blank" rel="noreferrer" className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1">
              {t('deviceLocation.openGoogleMaps')}<ExternalLink size={12} />
            </a>
          )}
        </span>
      )}
    </div>
  );
}

/** The "ดูตำแหน่ง" button + its window. Drawn from `can_view` asked at login, or
 *  from `allowed` where the host holds a per-device answer (may_location). */
export function DeviceLocationButton({ contractId, assetId, allowed, lastFixAt }: LocationTarget & {
  allowed?: boolean;
  lastFixAt?: string | null;
}) {
  const { t } = useTranslation();
  const { data: can } = useLocationViewCan();
  const [open, setOpen] = useState(false);
  if (!(allowed ?? can?.can_view === true)) return null;
  return (
    <>
      <Button variant="outline" size="sm" startIcon={<MapPin size={14} />} onClick={() => setOpen(true)} data-action="DEVICE_LOCATION_VIEW">
        {t('deviceLocation.button')}
      </Button>
      <DeviceLocationDialog open={open} target={{ contractId, assetId }} lastFixAt={lastFixAt} onClose={() => setOpen(false)} />
    </>
  );
}
