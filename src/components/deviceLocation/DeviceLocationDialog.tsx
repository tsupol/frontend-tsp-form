// The system's one location viewer (UI_SUMMARY 159): contract page, device page,
// the collector's device panel, the repo job and the customer map all open it.
//   left  = the groups of fixes (clusters) and every fix, newest first
//   right = the map with every fix, the groups as rings, a pin on the chosen fix,
//           and under it when that fix was taken (weekday, date, time, days ago)
// Above both, the backend's verdict on where the customer lives (159 §1b) and a
// one-line summary. Every figure, day and group comes from the RPC (mig 434).
// Contract page (nnf-mdm 473): fixes of every phone the contract has used —
// primary, loaner, former — each row naming its phone, and a fix taken while the
// phone was away from the customer (e.g. in repair) labelled, never hidden.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, DataTable, Modal, Tooltip } from 'tsp-form';
import { AlertTriangle, ExternalLink, Home, Loader2, MapPin, MapPinOff, RefreshCw, Smartphone, Sunrise, Wrench } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { DateTime } from '../DateTime';
import {
  useBucketName, useDeviceLocations, useLocationViewCan,
  type DeviceLocations, type LocationCluster, type LocationPhone, type LocationRow, type LocationRowPhone,
  type LocationTarget, type PhoneRole, type ResidenceVerdict,
} from './deviceLocationApi';
import { useLocationWhen } from './locationWhen';
import { AWAY_COLOR, clusterColor } from './mapColors';
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

function ClusterDot({ no, away }: { no: number | null; away?: boolean }) {
  if (away) {
    return <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0 border-2 border-dashed bg-transparent" style={{ borderColor: AWAY_COLOR }} aria-hidden />;
  }
  return <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: clusterColor(no) }} aria-hidden />;
}

const ROLE_COLOR: Record<PhoneRole, 'default' | 'info' | 'secondary'> = { PRIMARY: 'default', LOANER: 'info', FORMER: 'secondary' };

/** Which phone gave a fix: "เครื่องสำรอง · NQ0XWNNWN3". */
function PhoneTag({ phone }: { phone: LocationRowPhone }) {
  const { t } = useTranslation();
  return (
    <Badge size="xs" color={ROLE_COLOR[phone.role] ?? 'default'} data-phone-role={phone.role}>
      {t(`deviceLocation.phone.role.${phone.role}`, { defaultValue: phone.role })}
      {phone.serial_number ? ` · ${phone.serial_number}` : null}
    </Badge>
  );
}

/** Where the phone was when a fix was taken, shown only when it was not with the customer. */
function AwayTag({ bucket }: { bucket: string | null | undefined }) {
  const bucketName = useBucketName();
  return (
    <Badge size="xs" color="warning" data-away-bucket={bucket ?? ''}>
      <span className="inline-flex items-center gap-0.5"><Wrench size={10} />{bucketName(bucket) || '—'}</span>
    </Badge>
  );
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
  const bucketName = useBucketName();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  /** One phone picked from the phone list; null = every phone. */
  const [phoneId, setPhoneId] = useState<number | null>(null);

  useEffect(() => {
    if (open) { setSelectedId(null); setFocus(null); setPhoneId(null); }
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

  const phones = data?.phones ?? [];
  const multiPhone = phones.length > 1;
  // Picking a phone only narrows what is listed and drawn; groups and the home
  // verdict stay the contract's, as the backend worked them out.
  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    return phoneId == null ? all : all.filter((r) => r.phone?.asset_id === phoneId);
  }, [data?.rows, phoneId]);
  const clusters = data?.clusters ?? [];
  // Opens on the newest; a fix that is gone after a refresh falls back to it.
  const selected: LocationRow | null = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;
  const residence = data?.residence ?? null;
  const home = residence?.status === 'RESIDENT' && residence.lat != null && residence.lon != null
    ? { lat: residence.lat, lon: residence.lon, radiusM: residence.radius_m }
    : null;

  const mapFixes = useMemo(() => rows.map((r) => ({
    id: r.id, lat: r.lat, lon: r.lon, clusterNo: r.cluster_no,
    away: r.with_customer === false,
    label: [
      `${when.at(r.when)} · ${when.ago(r.when)}`,
      multiPhone && r.phone
        ? `${t(`deviceLocation.phone.role.${r.phone.role}`, { defaultValue: r.phone.role })}${r.phone.serial_number ? ` ${r.phone.serial_number}` : ''}`
        : null,
      r.with_customer === false ? bucketName(r.asset_bucket) : null,
    ].filter(Boolean).join(' · '),
  })), [rows, multiPhone, bucketName]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapClusters = useMemo(() => clusters.map((c) => ({
    clusterNo: c.cluster_no, lat: c.lat, lon: c.lon, radiusM: c.radius_m, fixes: c.fixes,
    label: t('deviceLocation.cluster.mapLabel', { no: c.cluster_no, fixes: c.fixes, days: c.days }),
  })), [clusters]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusOn = (lat: number, lon: number, radiusM?: number | null) =>
    setFocus((f) => ({ tick: (f?.tick ?? 0) + 1, lat, lon, radiusM }));

  const ready = !error && !isLoading && !!data;
  const showSplit = ready && !data.reason_code;
  const summary = data?.summary && data.summary.first_when && data.summary.last_when ? data.summary : null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="72rem" width="100%" ariaLabel={t('deviceLocation.title')}>
      {/* A fixed height on wider screens, so each half scrolls on its own. */}
      <div className={`flex flex-col overflow-hidden ${showSplit ? 'md:h-[88dvh]' : ''}`} style={{ maxHeight: '92dvh' }}>
        <div className="modal-header items-start">
          <div className="min-w-0 flex flex-col gap-0.5">
            <h2 className="modal-title inline-flex items-center gap-2"><MapPin size={16} />{t('deviceLocation.title')}</h2>
            {data && <DeviceLine data={data} />}
          </div>
          <div className="flex items-center gap-1 shrink-0">
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

        {!showSplit ? (
          <div className="modal-content min-w-0 flex flex-col gap-3">
            {error ? (
              <div className="alert alert-danger"><AlertTriangle size={16} /><span>{errorText(error, t)}</span></div>
            ) : !ready ? (
              <div className="py-10 flex justify-center text-subtler"><Loader2 size={20} className="animate-spin" /></div>
            ) : (
              <div className="py-8 flex flex-col items-center gap-2 text-subtle text-sm">
                <MapPinOff size={24} className="text-subtler" />
                {t(`deviceLocation.reason.${data.reason_code}`, { defaultValue: data.reason_code })}
              </div>
            )}
          </div>
        ) : (
          // Phone: one column that scrolls as a whole, map first. Wider: two halves.
          <div className="flex-1 min-h-0 flex flex-col md:flex-row max-md:overflow-y-auto">
            {/* Right half: the map fills it and the chosen fix stays under it. */}
            <div className="md:order-2 md:w-1/2 min-w-0 md:min-h-0 flex flex-col gap-2 p-4 md:pl-2 md:overflow-y-auto">
              <Suspense fallback={<div className="h-64 md:h-auto md:flex-1 rounded-md border border-line" />}>
                <LocationMap
                  className="h-64 md:h-auto md:flex-1 md:min-h-64 rounded-md border border-line overflow-hidden"
                  fixes={mapFixes}
                  clusters={mapClusters}
                  selected={selected ? { id: selected.id, lat: selected.lat, lon: selected.lon, radiusM: selected.accuracy_m } : null}
                  home={home}
                  focus={focus}
                  onSelectFix={setSelectedId}
                  showAllLabel={t('deviceLocation.showAll')}
                />
              </Suspense>
              {selected && <div className="shrink-0"><FixCard row={selected} multiPhone={multiPhone} /></div>}
            </div>

            {/* Left half: the answer stays on top, groups and fixes scroll under it. */}
            <div className="md:order-1 md:w-1/2 min-w-0 md:min-h-0 flex flex-col md:border-r border-line">
              {(residence || summary) && (
                <div className="shrink-0 px-4 pt-4 md:pt-3 pb-3 flex flex-col gap-2 md:border-b border-line" data-testid="location-pinned">
                  {residence && (
                    <ResidenceBand residence={residence} canFocus={home != null} onFocus={() => home && focusOn(home.lat, home.lon, home.radiusM)} />
                  )}
                  {summary && summary.first_when && summary.last_when && (
                    <div className="text-sm text-subtle flex flex-wrap gap-x-3 gap-y-0.5" data-testid="location-summary">
                      <span><span className="font-medium text-fg">{summary.fixes}</span> {t('deviceLocation.summary.fixes')}</span>
                      <span><span className="font-medium text-fg">{summary.days}</span> {t('deviceLocation.summary.days')}</span>
                      <span>{when.day(summary.first_when)} – {when.day(summary.last_when)}</span>
                      <span><span className="font-medium text-fg">{summary.clusters}</span> {t('deviceLocation.summary.clusters')}</span>
                      {multiPhone && (
                        <span><span className="font-medium text-fg">{phones.length}</span> {t('deviceLocation.summary.phones')}</span>
                      )}
                      {(summary.away_fixes ?? 0) > 0 && (
                        <span className="text-warning-fg">{t('deviceLocation.summary.away', { n: summary.away_fixes })}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="md:flex-1 md:min-h-0 md:overflow-y-auto better-scroll px-4 pb-4 flex flex-col gap-3" data-testid="location-left-scroll">
                {/* Top spacing that scrolls away: padding on the scroller would
                    leave a strip above the sticky header where rows show through. */}
                <div aria-hidden className="max-md:hidden shrink-0 h-0" />
                {multiPhone && (
                  <PhoneList
                    phones={phones}
                    pickedId={phoneId}
                    onPick={(id) => { setPhoneId((cur) => (cur === id ? null : id)); setSelectedId(null); }}
                  />
                )}
                {clusters.length > 0 && (
                  <ClusterList clusters={clusters} onPick={(c) => focusOn(c.lat, c.lon, c.radius_m)} />
                )}
                {/* The table does not scroll by itself: this half scrolls, and its
                    header sticks to the top of it. `overflow-clip` keeps the
                    rounded frame without breaking the sticky header. */}
                <div className="border border-line rounded-md overflow-clip shrink-0">
                  <DataTable<LocationRow>
                    data={rows}
                    renderHeader={() => (
                      <div className={`${ROW_GRID} px-3 py-2 text-xs font-medium text-subtle`}>
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
                          <ClusterDot no={r.cluster_no} away={r.with_customer === false} />
                          <span className="min-w-0 flex flex-col gap-0.5">
                            <span className="truncate">{when.at(r.when)}</span>
                            <span className="text-xs leading-5 text-subtle inline-flex items-center gap-1">
                              {when.ago(r.when)}
                              {r.when.is_morning && <Sunrise size={12} className="text-warning-fg -translate-y-0.5" aria-label={t('deviceLocation.morning')} />}
                            </span>
                          </span>
                          <span className="min-w-0 text-xs text-subtle flex flex-col items-start gap-0.5">
                            <span>{t(`deviceLocation.source.${r.source_code}`, { defaultValue: r.source_code })}</span>
                            {(multiPhone && r.phone) || r.with_customer === false ? (
                              <span className="flex flex-wrap gap-1">
                                {multiPhone && r.phone && <PhoneTag phone={r.phone} />}
                                {r.with_customer === false && <AwayTag bucket={r.asset_bucket} />}
                              </span>
                            ) : null}
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
                    className={`h-auto! [&_.data-table-content]:overflow-visible! [&_.data-table-content]:pb-0! ${isFetching ? 'opacity-60' : ''} transition-opacity`}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** When the chosen fix was taken, where it came from and how sure it is. */
function FixCard({ row, multiPhone }: { row: LocationRow; multiPhone: boolean }) {
  const { t } = useTranslation();
  const when = useLocationWhen();
  const away = row.with_customer === false;
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
          <ClusterDot no={row.cluster_no} away={away} />
          {away ? t('deviceLocation.cluster.away')
            : row.cluster_no != null ? t('deviceLocation.cluster.name', { no: row.cluster_no }) : t('deviceLocation.cluster.none')}
        </span>
      </div>
      {((multiPhone && row.phone) || away) && (
        <div className="flex items-center gap-1.5 flex-wrap text-xs text-subtle" data-testid="location-fix-phone">
          {multiPhone && row.phone && <PhoneTag phone={row.phone} />}
          {multiPhone && row.phone && <span>{row.phone.asset_code}</span>}
          {away && <AwayTag bucket={row.asset_bucket} />}
        </div>
      )}
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
    <div className="border border-line rounded-md shrink-0" data-testid="location-clusters">
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

/** Every phone the contract has used, the one held now first. Picking one shows
 *  only its fixes; picking it again shows every phone. */
function PhoneList({ phones, pickedId, onPick }: {
  phones: LocationPhone[];
  pickedId: number | null;
  onPick: (assetId: number) => void;
}) {
  const { t } = useTranslation();
  const bucketName = useBucketName();
  return (
    <div className="border border-line rounded-md shrink-0" data-testid="location-phones">
      <div className="px-3 py-1.5 text-xs font-medium text-subtle border-b border-line flex items-center gap-2">
        <span>{t('deviceLocation.phone.title', { count: phones.length })}</span>
        {pickedId == null ? (
          <span className="font-normal text-subtler">{t('deviceLocation.phone.pickHint')}</span>
        ) : (
          <button
            type="button"
            className="ml-auto text-xs font-normal text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer"
            onClick={() => onPick(pickedId)}
          >
            {t('deviceLocation.phone.showEvery')}
          </button>
        )}
      </div>
      <div className="divide-y divide-line">
        {phones.map((p) => (
          <button
            key={p.asset_id}
            type="button"
            data-asset-id={p.asset_id}
            data-state={p.asset_id === pickedId ? 'selected' : undefined}
            className={`w-full text-left px-3 py-1.5 flex items-start gap-2 border-none cursor-pointer ${
              p.asset_id === pickedId ? 'bg-table-row-selected' : 'bg-transparent hover:bg-surface-hover'
            }`}
            onClick={() => onPick(p.asset_id)}
          >
            <Smartphone size={14} className="mt-0.5 shrink-0 text-subtle" />
            <span className="min-w-0 flex flex-col gap-0.5">
              <span className="text-sm flex items-center gap-1.5 flex-wrap">
                <span className="font-medium">{t(`deviceLocation.phone.role.${p.role}`, { defaultValue: p.role })}</span>
                {p.serial_number && <span className="font-mono text-xs">SN {p.serial_number}</span>}
                {p.held_now && <Badge size="xs" color="success">{t('deviceLocation.phone.heldNow')}</Badge>}
              </span>
              <span className="text-xs text-subtle">
                {[
                  p.product_display_name,
                  t('deviceLocation.phone.fixes', { n: p.fixes }),
                  !p.held_now && p.current_bucket ? t('deviceLocation.phone.nowAt', { bucket: bucketName(p.current_bucket) }) : null,
                ].filter(Boolean).join(' · ')}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The phone and its contract, as one line under the window's title. */
function DeviceLine({ data }: { data: DeviceLocations }) {
  const { t } = useTranslation();
  const { device, contract } = data;
  // An unbound phone answers no serial on `device`; the phone list still has it.
  const serial = device?.serial_number ?? data.phones?.find((p) => p.asset_id === device?.asset_id)?.serial_number ?? null;
  const unbound = !!device && !device.is_bound && data.phones != null && data.total > 0;
  return (
    <div className="text-xs text-subtle flex items-baseline gap-x-3 gap-y-0.5 flex-wrap font-normal" data-testid="location-device-line">
      {device && (
        // A new tab: this window sits on a page the person is working on.
        <Link to={`/admin/inventory/assets/${device.asset_id}`} target="_blank" className="text-primary-fg hover:underline inline-flex items-center gap-1">
          {device.asset_code}<ExternalLink size={11} />
        </Link>
      )}
      {device?.product_display_name && <span className="text-fg">{device.product_display_name}</span>}
      {serial && <span className="font-mono">SN {serial}</span>}
      {contract && <span>{t('deviceLocation.contract')} {contract.code}</span>}
      {unbound && <Badge size="xs" color="default" data-testid="location-unbound">{t('deviceLocation.unbound')}</Badge>}
      {device?.last_seen_at && <span>{t('deviceLocation.lastSeen')} <DateTime value={device.last_seen_at} /></span>}
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
