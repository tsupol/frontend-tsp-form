// The right half of the silent-watch console: everything the person checking a
// silent device needs to judge it and act, from ONE fn_silent_task_detail call
// (163 §5), in the order they think — who and when, how to reach them, where
// the phone has been, what the phone itself last said, then what others found.
// The bar at the bottom saves a check result (fn_silent_check_log, 163 §6).
//
// No device commands and no messages to the customer here (work order §6:
// the first version only looks and records).

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, TextArea, Tooltip, useSnackbarContext } from 'tsp-form';
import {
  AlertTriangle, CheckCircle, Clock, ExternalLink, History, Loader2, MapPin, MapPinOff, MessageSquare,
  Phone, RefreshCw, Save, Smartphone, Sunrise, Users, XCircle, Activity, Store, Home,
} from 'lucide-react';
import { DateTime } from '../../../components/DateTime';
import { DetailLine, DetailSection } from '../../../components/DetailLine';
import { EntityCodeLink } from '../../../components/EntityCodeLink';
import { TelLink } from '../../../components/TelLink';
import { ContactValue } from '../../../components/ContactValue';
import { CopyButton } from '../../../components/CopyButton';
import { RelativeDateTime } from '../../inventory/mdm/RelativeDateTime';
import { useLocationWhen } from '../../../components/deviceLocation/locationWhen';
import { fmtCurrency } from '../../../lib/format';
import { ApiError } from '../../../lib/api';
import { translateApiError } from '../../../lib/apiErrors';
import {
  refreshAfterCheck, silentCheckLog, useSilentTaskDetail,
  type SilentAddress, type SilentTaskDetail,
} from './silentWatchApi';
import { GroupBadge, LevelBadge, ResultBadge, TestDataBadge, useSilentDuration } from './silentWatchBits';

const LocationMap = lazy(() => import('../../../components/deviceLocation/LocationMap'));

const ANSWERED_PREVIEW = 8;

/** `embedded`: inside the device-watch scene's card (UI 165) — the card's title bar names the
 *  row, the card scrolls as a whole, and the check form sits right under the overview so it
 *  is in reach without scrolling past the map. */
export function SilentDetailPanel({ episodeId, embedded = false }: { episodeId: number; embedded?: boolean }) {
  const { t } = useTranslation();
  const { data, error, isLoading, isFetching, refetch } = useSilentTaskDetail(episodeId);

  if (embedded) {
    if (error) {
      return (
        <div className="alert alert-danger">
          <XCircle size={16} />
          <span className="alert-description">{error instanceof ApiError ? translateApiError(error, t) : t('common.error')}</span>
        </div>
      );
    }
    if (isLoading || !data) return <div className="py-10 flex justify-center text-subtler"><Loader2 size={20} className="animate-spin" /></div>;
    return (
      <div className={`flex flex-col gap-3 ${isFetching ? 'opacity-60' : ''} transition-opacity`}>
        <ClosedBand d={data} />
        <HeadSection d={data} />
        <CheckLogBar d={data} boxed />
        <ContactSection d={data} />
        <LocationSection d={data} />
        <DeviceTraceSection d={data} />
        <AppChatSection d={data} />
        <DeviceSection d={data} />
        <ChecksSection d={data} />
        <HistorySection d={data} />
      </div>
    );
  }

  return (
    <>
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2 min-w-0">
        {data ? (
          <>
            {/* No link icon here: in a narrow header it was the part that got cut off. The code is still the link. */}
            <EntityCodeLink to={`/admin/contracts/search/${data.contract.id}`} code={data.contract.code} icon={null} className="font-mono text-sm font-medium shrink-0" />
            <span className="text-sm text-subtle truncate">{data.customer.name ?? '—'}</span>
            {data.is_test_data && <TestDataBadge />}
          </>
        ) : <span className="text-sm text-subtle">{t('silentWatch.title')}</span>}
        <div className="ml-auto shrink-0">
          <Tooltip content={t('silentWatch.reload')} placement="bottom">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('silentWatch.reload')}
              startIcon={<RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />}
              disabled={isFetching}
              onClick={() => void refetch()}
            />
          </Tooltip>
        </div>
      </div>

      {error ? (
        <div className="flex-1 p-4">
          <div className="alert alert-danger">
            <XCircle size={16} />
            <span className="alert-description">{error instanceof ApiError ? translateApiError(error, t) : t('common.error')}</span>
          </div>
        </div>
      ) : isLoading || !data ? (
        <div className="flex-1 flex items-center justify-center text-subtler"><Loader2 size={20} className="animate-spin" /></div>
      ) : (
        <>
          <div className={`flex-1 overflow-auto better-scroll px-4 py-3 flex flex-col gap-3 ${isFetching ? 'opacity-60' : ''} transition-opacity`}>
            <ClosedBand d={data} />
            <HeadSection d={data} />
            <ContactSection d={data} />
            <LocationSection d={data} />
            <DeviceTraceSection d={data} />
            <AppChatSection d={data} />
            <DeviceSection d={data} />
            <ChecksSection d={data} />
            <HistorySection d={data} />
          </div>
          <CheckLogBar d={data} />
        </>
      )}
    </>
  );
}

/** The episode ended while someone was looking: say how, and that nothing more can be saved. */
function ClosedBand({ d }: { d: SilentTaskDetail }) {
  const { t } = useTranslation();
  const e = d.episode;
  if (e.status !== 'CLOSED') return null;
  return (
    <div className={`alert ${e.close_reason_code === 'DEVICE_RETURNED' ? 'alert-success' : 'alert-info'}`}>
      <CheckCircle size={16} />
      <div>
        <div className="alert-title">{t(`silentWatch.closed.${e.close_reason_code ?? 'DEVICE_RETURNED'}`)}</div>
        <div className="alert-description flex flex-wrap gap-x-2">
          {(e.returned_at ?? e.closed_at) && <DateTime value={(e.returned_at ?? e.closed_at)!} showTime />}
          {e.returned_after_check != null && (
            <span>· {e.returned_after_check ? t('silentWatch.closed.afterCheck') : t('silentWatch.closed.onItsOwn')}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function HeadSection({ d }: { d: SilentTaskDetail }) {
  const { t } = useTranslation();
  const dur = useSilentDuration();
  const e = d.episode;
  const c = d.contract;
  return (
    <DetailSection icon={<Clock size={14} />} title={t('silentWatch.sec.head')}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-lg font-semibold">{t('silentWatch.silentFor', { dur: dur(e.silent_hours) })}</span>
        <LevelBadge hours={e.level_hours} />
        <GroupBadge group={e.group_code} />
        <Badge size="xs" color={e.in_pool ? 'warning' : 'default'}>{e.in_pool ? t('silentWatch.isTask') : t('silentWatch.isWatch')}</Badge>
      </div>
      <DetailLine label={t('silentWatch.f.silentSince')}><RelativeDateTime value={e.silent_since} /></DetailLine>
      {e.as_of_silence?.contract_day != null && (
        <DetailLine label={t('silentWatch.f.contractDay')}>{t('silentWatch.contractDayValue', { n: e.as_of_silence.contract_day })}</DetailLine>
      )}
      <DetailLine label={t('silentWatch.f.contract')}>
        <EntityCodeLink to={`/admin/contracts/search/${c.id}`} code={c.code} className="font-mono" />
        <span className="text-xs text-subtle">{t(`contract.state_${c.state}`, { defaultValue: c.state })}</span>
      </DetailLine>
      <DetailLine label={t('silentWatch.f.installments')}>
        {t('silentWatch.paidOf', { paid: c.paid_count, total: c.total_installments })}
        {c.installment_amount != null && <span className="text-subtle">· {t('silentWatch.perInstallment', { amount: fmtCurrency(c.installment_amount) })}</span>}
      </DetailLine>
      <DetailLine label={t('silentWatch.f.nextDue')}>
        {c.next_due_date ? <DateTime value={c.next_due_date} showTime={false} /> : '—'}
        {c.next_due_amount != null && <span className="text-subtle">· {fmtCurrency(c.next_due_amount)}</span>}
      </DetailLine>
      <DetailLine label={t('silentWatch.f.overdue')}>
        {c.overdue_days > 0
          ? <span className="text-danger-fg font-medium">{t('silentWatch.overdueDays', { n: c.overdue_days })}</span>
          : <span className="text-success-fg">{t('silentWatch.notOverdue')}</span>}
      </DetailLine>
      {c.outstanding != null && <DetailLine label={t('silentWatch.f.outstanding')}>{fmtCurrency(c.outstanding)}</DetailLine>}
      <DetailLine label={t('silentWatch.f.shop')}>
        <Store size={12} className="text-subtle" />
        <span>{d.shop.branch_name}</span>
        <span className="text-xs text-subtle">· {d.shop.company_name}</span>
        {d.shop.branch_phone && <TelLink tel={d.shop.branch_phone} />}
      </DetailLine>
      {c.opened_by_username && <DetailLine label={t('silentWatch.f.openedBy')}>{c.opened_by_username}</DetailLine>}
    </DetailSection>
  );
}

function addressLine(a: SilentAddress): string {
  const keep = (v: string | null) => (v && v.trim() && v.trim() !== '-' ? v.trim() : null);
  return [keep(a.line1), keep(a.line2), keep(a.soi), keep(a.road), keep(a.sub_district), keep(a.district), keep(a.province), keep(a.postal_code)]
    .filter(Boolean).join(' ');
}

const PHONE_TYPES = new Set(['MOBILE', 'PHONE', 'TEL', 'HOME_PHONE', 'WORK_PHONE']);

function ContactSection({ d }: { d: SilentTaskDetail }) {
  const { t } = useTranslation();
  const cu = d.customer;
  const empty = !cu.tel && !cu.tel2 && !cu.facebook && !cu.line_id && cu.contacts.length === 0;
  return (
    <DetailSection icon={<Phone size={14} />} title={t('silentWatch.sec.contact')}>
      <DetailLine label={t('silentWatch.f.customer')}>
        <Link to={`/admin/customers/${cu.id}`} className="text-primary-fg hover:underline inline-flex items-center gap-1">
          {cu.name ?? '—'}<ExternalLink size={12} />
        </Link>
      </DetailLine>
      {cu.tel && <DetailLine label={t('silentWatch.f.tel')}><TelLink tel={cu.tel} /></DetailLine>}
      {cu.tel2 && <DetailLine label={t('silentWatch.f.tel2')}><TelLink tel={cu.tel2} /></DetailLine>}
      {cu.contacts.map((c, i) => (
        <DetailLine key={`c${i}`} label={c.label ?? t(`silentWatch.contactType.${c.type_code}`, { defaultValue: c.type_code })}>
          {PHONE_TYPES.has(c.type_code) ? <TelLink tel={c.value} /> : <ContactValue value={c.value} />}
        </DetailLine>
      ))}
      {cu.facebook && <DetailLine label="Facebook"><ContactValue value={cu.facebook} /></DetailLine>}
      {cu.line_id && <DetailLine label="LINE"><ContactValue value={cu.line_id} /></DetailLine>}
      {empty && <div className="text-sm text-subtler">{t('silentWatch.noContact')}</div>}

      <div className="text-xs font-medium text-subtle mt-1 inline-flex items-center gap-1"><Users size={12} />{t('silentWatch.references')}</div>
      {cu.references.length === 0 ? (
        <div className="text-sm text-subtler">{t('silentWatch.noReferences')}</div>
      ) : cu.references.map((r, i) => (
        <DetailLine key={`r${i}`} label={r.relation ?? '—'}>
          <span>{r.name ?? '—'}</span>
          {r.tel && <TelLink tel={r.tel} />}
          {r.facebook && <ContactValue value={r.facebook} text="Facebook" />}
          {r.line_id && <ContactValue value={r.line_id} text="LINE" />}
        </DetailLine>
      ))}

      <div className="text-xs font-medium text-subtle mt-1 inline-flex items-center gap-1"><Home size={12} />{t('silentWatch.addresses')}</div>
      {cu.addresses.length === 0 ? (
        <div className="text-sm text-subtler">{t('silentWatch.noAddresses')}</div>
      ) : cu.addresses.map((a, i) => (
        <DetailLine key={`a${i}`} label={a.label ?? t(`silentWatch.addressType.${a.type_code}`, { defaultValue: a.type_code })}>
          <span className="whitespace-normal">{addressLine(a) || '—'}</span>
          {a.note && <span className="text-xs text-subtle">· {a.note}</span>}
        </DetailLine>
      ))}
    </DetailSection>
  );
}

function useSourceLabel() {
  const { t } = useTranslation();
  return (code: string) => {
    const m = /^ACTIVE_D(\d+)$/.exec(code);
    if (m) return t('silentWatch.source.activeDay', { n: Number(m[1]) });
    return t(`silentWatch.source.${code}`, { defaultValue: code });
  };
}

function LocationSection({ d }: { d: SilentTaskDetail }) {
  const { t } = useTranslation();
  const when = useLocationWhen();
  const sourceLabel = useSourceLabel();
  const loc = d.location;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => { setSelectedId(null); }, [d.episode.episode_id]);

  const mapFixes = useMemo(() => loc.fixes.map((f) => ({
    id: f.id, lat: f.lat, lon: f.lon, clusterNo: null,
    label: `${when.at(f.when)} · ${sourceLabel(f.source_code)}`,
  })), [loc.fixes]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapClusters = useMemo(() => loc.clusters.map((c) => ({
    clusterNo: c.cluster_no, lat: c.lat, lon: c.lon, radiusM: c.radius_m, fixes: c.fixes,
    label: t('silentWatch.clusterLabel', { no: c.cluster_no, fixes: c.fixes, days: c.days, mornings: c.mornings }),
  })), [loc.clusters, t]);
  const home = loc.residence?.status_code === 'RESIDENT'
    ? { lat: loc.residence.lat, lon: loc.residence.lon, radiusM: loc.residence.radius_m } : null;
  const selected = loc.fixes.find((f) => f.id === selectedId) ?? null;

  const locate = loc.locate;
  const locateLine = locate && (
    <div className="text-xs text-subtle flex flex-wrap gap-x-3 gap-y-0.5">
      <span>{t('silentWatch.locate.attempts', { n: locate.attempts })}</span>
      <span>{t('silentWatch.locate.answered', { n: locate.answered })}</span>
      <span>{t('silentWatch.locate.offline', { n: locate.offline })}</span>
      {locate.last_attempt_at && (
        <span className="inline-flex items-center gap-1">{t('silentWatch.locate.last')} <DateTime value={locate.last_attempt_at} showTime /></span>
      )}
    </div>
  );

  return (
    <DetailSection icon={<MapPin size={14} />} title={t('silentWatch.sec.location')}>
      {loc.never_located ? (
        <div className="alert alert-warning" data-testid="silent-never-located">
          <MapPinOff size={16} />
          <div>
            <div className="alert-title">{t('silentWatch.neverLocated')}</div>
            <div className="alert-description">
              {locate ? t('silentWatch.neverLocatedTried', { n: locate.attempts }) : t('silentWatch.neverLocatedNoTry')}
            </div>
          </div>
        </div>
      ) : (
        <>
          {loc.residence && (
            <div className="text-sm flex items-center gap-2 flex-wrap">
              <Home size={14} className={loc.residence.status_code === 'RESIDENT' ? 'text-success-fg' : 'text-subtle'} />
              <span className="font-medium">{t(`silentWatch.residence.${loc.residence.status_code}`, { n: loc.residence.mornings_in_cluster })}</span>
              <a href={loc.residence.map_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1">
                Google Maps<ExternalLink size={11} />
              </a>
            </div>
          )}
          <Suspense fallback={<div className="h-64 rounded-md border border-line" />}>
            <LocationMap
              className="h-64 rounded-md border border-line overflow-hidden"
              fixes={mapFixes}
              clusters={mapClusters}
              selected={selected ? { id: selected.id, lat: selected.lat, lon: selected.lon, radiusM: selected.accuracy_m } : null}
              home={home}
              onSelectFix={setSelectedId}
              showAllLabel={t('deviceLocation.showAll')}
            />
          </Suspense>
          {locateLine}
          <div className="flex flex-col divide-y divide-line border border-line rounded-md">
            {loc.fixes.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedId(f.id)}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-3 cursor-pointer border-none ${
                  f.id === selectedId ? 'bg-table-row-selected' : 'bg-transparent hover:bg-surface-hover'
                }`}
              >
                <span className="min-w-0 flex-1 flex flex-col">
                  <span className="truncate">{when.at(f.when)}</span>
                  <span className="text-xs text-subtle inline-flex items-center gap-1">
                    {when.ago(f.when)}
                    {f.when.is_morning && <Sunrise size={12} className="text-warning-fg" aria-label={t('deviceLocation.morning')} />}
                  </span>
                </span>
                <span className="text-xs text-subtle shrink-0">{sourceLabel(f.source_code)}</span>
                <span className="text-xs tabular-nums text-subtle shrink-0 w-14 text-right">
                  {f.accuracy_m != null ? t('deviceLocation.accuracyValue', { m: Math.round(f.accuracy_m) }) : '—'}
                </span>
                <a
                  href={f.map_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-primary-fg shrink-0 inline-flex"
                  aria-label={t('deviceLocation.openGoogleMaps')}
                >
                  <ExternalLink size={13} />
                </a>
              </button>
            ))}
          </div>
        </>
      )}
      {loc.never_located && locateLine}
    </DetailSection>
  );
}

function DeviceTraceSection({ d }: { d: SilentTaskDetail }) {
  const { t } = useTranslation();
  const when = useLocationWhen();
  const [showAll, setShowAll] = useState(false);
  const answered = d.checkins.answered_minutes;
  const shown = showAll ? answered : answered.slice(0, ANSWERED_PREVIEW);
  return (
    <DetailSection icon={<Activity size={14} />} title={t('silentWatch.sec.trace')}>
      <DetailLine label={t('silentWatch.f.lastSeen')}><RelativeDateTime value={d.checkins.last_seen_at ?? d.device.last_seen_at} staleAfterDays={2} /></DetailLine>
      <DetailLine label={t('silentWatch.f.battery')}>
        {d.device.battery_percent != null
          ? <span className={d.device.battery_percent <= 20 ? 'text-danger-fg font-medium' : ''}>{d.device.battery_percent}%</span>
          : '—'}
        <span className="text-xs text-subtle">{t('silentWatch.batteryNote')}</span>
      </DetailLine>

      <div className="text-xs font-medium text-subtle mt-1">{t('silentWatch.sims')}</div>
      {d.sim.length === 0 ? (
        <div className="text-sm text-subtler">{t('silentWatch.noSims')}</div>
      ) : d.sim.map((s, i) => (
        <div key={i} className={`rounded-md px-3 py-2 flex flex-col gap-1 border ${
          s.also_seen_on.length > 0 ? 'border-danger-border bg-danger-soft' : 'border-line'
        }`}>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-medium tabular-nums">{s.phone_number ?? '—'}</span>
            {s.carrier && <span className="text-xs text-subtle">{s.carrier}</span>}
            {s.matches_customer_tel === true && <Badge size="xs" color="success">{t('silentWatch.simMatches')}</Badge>}
            {s.matches_customer_tel === false && <Badge size="xs" color="warning">{t('silentWatch.simNotMatches')}</Badge>}
            <span className="ml-auto text-xs text-subtle"><DateTime value={s.observed_at} showTime /></span>
          </div>
          {s.also_seen_on.length > 0 && (
            <div className="text-xs text-danger-fg flex items-center gap-1 flex-wrap">
              <AlertTriangle size={12} />
              <span className="font-medium">{t('silentWatch.simAlsoSeen')}</span>
              {s.also_seen_on.map((o) => (
                <EntityCodeLink key={o.contract_id} to={`/admin/contracts/search/${o.contract_id}`} code={o.contract_code} className="font-mono" />
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="text-xs font-medium text-subtle mt-1">{t('silentWatch.answered', { n: answered.length })}</div>
      {answered.length === 0 ? (
        <div className="text-sm text-subtler">{t('silentWatch.noAnswered')}</div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {shown.map((a) => (
            <div key={a.at} className="text-sm flex items-center gap-2">
              <span>{when.at(a.when)}</span>
              {a.when.is_morning && <Sunrise size={12} className="text-warning-fg" aria-label={t('deviceLocation.morning')} />}
              <span className="text-xs text-subtle">{when.ago(a.when)}</span>
              <span className="ml-auto text-xs text-subtle tabular-nums">{t('silentWatch.commands', { n: a.commands })}</span>
            </div>
          ))}
          {answered.length > ANSWERED_PREVIEW && (
            <button type="button" className="self-start text-xs text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer" onClick={() => setShowAll((v) => !v)}>
              {showAll ? t('silentWatch.showLess') : t('silentWatch.showAll', { n: answered.length })}
            </button>
          )}
        </div>
      )}
    </DetailSection>
  );
}

function AppChatSection({ d }: { d: SilentTaskDetail }) {
  const { t } = useTranslation();
  const chat = d.contract.chat;
  return (
    <DetailSection
      icon={<MessageSquare size={14} />}
      title={t('silentWatch.sec.appChat')}
      action={chat.total > 0 ? (
        <Link to={`/admin/chat?contract=${d.contract.id}`} className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1">
          {t('silentWatch.openChat')}<ExternalLink size={11} />
        </Link>
      ) : undefined}
    >
      <DetailLine label={t('silentWatch.f.appUsed')}>
        {d.customer.app_last_used_at ? <RelativeDateTime value={d.customer.app_last_used_at} /> : <span className="text-subtler">{t('silentWatch.never')}</span>}
      </DetailLine>
      <DetailLine label={t('silentWatch.f.appLogin')}>
        {d.customer.app_last_login_at ? <RelativeDateTime value={d.customer.app_last_login_at} /> : <span className="text-subtler">{t('silentWatch.never')}</span>}
      </DetailLine>
      <DetailLine label={t('silentWatch.f.chat')}>
        {chat.total === 0 ? <span className="text-subtler">{t('silentWatch.noChat')}</span> : t('silentWatch.chatTotal', { n: chat.total })}
      </DetailLine>
      {chat.last_customer_chat_at && (
        <DetailLine label={t('silentWatch.f.customerChat')}><RelativeDateTime value={chat.last_customer_chat_at} /></DetailLine>
      )}
      {chat.last_staff_chat_at && (
        <DetailLine label={t('silentWatch.f.staffChat')}><RelativeDateTime value={chat.last_staff_chat_at} /></DetailLine>
      )}
    </DetailSection>
  );
}

/** true / false / null (never checked) are three different answers. */
function YesNo({ value, good, field }: { value: boolean | null; good: boolean; field: string }) {
  const { t } = useTranslation();
  if (value == null) return <span className="text-subtler">{t('silentWatch.notChecked')}</span>;
  const ok = value === good;
  return <span className={ok ? 'text-success-fg' : 'text-danger-fg font-medium'}>{t(`silentWatch.bool.${field}.${value ? 'yes' : 'no'}`)}</span>;
}

function DeviceSection({ d }: { d: SilentTaskDetail }) {
  const { t } = useTranslation();
  const dv = d.device;
  return (
    <DetailSection
      icon={<Smartphone size={14} />}
      title={t('silentWatch.sec.device')}
      action={
        <Link to={`/admin/inventory/assets/${dv.asset_id}?tab=mdm`} className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1">
          {dv.asset_code}<ExternalLink size={11} />
        </Link>
      }
    >
      <DetailLine label={t('silentWatch.f.model')}>{dv.product_name ?? '—'}{dv.color && <span className="text-xs text-subtle">· {dv.color}</span>}</DetailLine>
      <DetailLine label="Serial">
        <span className="font-mono">{dv.serial_number ?? '—'}</span>
        {dv.serial_number && <CopyButton value={dv.serial_number} size={12} />}
      </DetailLine>
      <DetailLine label="IMEI">
        <span className="font-mono">{dv.imei ?? '—'}</span>
        {dv.imei && <CopyButton value={dv.imei} size={12} />}
      </DetailLine>
      {dv.ios_version && <DetailLine label="iOS">{dv.ios_version}</DetailLine>}
      <DetailLine label={t('silentWatch.f.orgLock')}><YesNo value={dv.org_lock_applied} good field="orgLock" /></DetailLine>
      <DetailLine label={t('silentWatch.f.nnfApp')}><YesNo value={dv.nnf_app_installed} good field="nnfApp" /></DetailLine>
      <DetailLine label={t('silentWatch.f.lostMode')}><YesNo value={dv.lost_mode_on} good={false} field="lostMode" /></DetailLine>
    </DetailSection>
  );
}

function ChecksSection({ d }: { d: SilentTaskDetail }) {
  const { t } = useTranslation();
  return (
    <DetailSection icon={<CheckCircle size={14} />} title={t('silentWatch.sec.checks', { n: d.checks.length })}>
      {d.checks.length === 0 ? (
        <div className="text-sm text-subtler">{t('silentWatch.noChecks')}</div>
      ) : (
        <ol className="flex flex-col gap-2 border-l-2 border-line pl-3 ml-1">
          {d.checks.map((c) => (
            <li key={c.log_id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <ResultBadge code={c.result_code} />
                <span className="text-xs text-subtle"><DateTime value={c.at} showTime /></span>
                {c.actor_username && <span className="text-xs text-subtle">· {c.actor_username}</span>}
                {c.episode_id !== d.episode.episode_id && <Badge size="xs" color="default">{t('silentWatch.otherEpisode')}</Badge>}
              </div>
              {c.note && <div className="text-sm whitespace-pre-wrap">{c.note}</div>}
            </li>
          ))}
        </ol>
      )}
    </DetailSection>
  );
}

function HistorySection({ d }: { d: SilentTaskDetail }) {
  const { t } = useTranslation();
  const dur = useSilentDuration();
  const rows = d.customer_history;
  return (
    <DetailSection icon={<History size={14} />} title={t('silentWatch.sec.history', { n: rows.length })}>
      {rows.length <= 1 && <div className="text-sm text-subtler">{t('silentWatch.firstTime')}</div>}
      {rows.length > 1 && rows.map((h) => (
        <div key={h.episode_id} className={`rounded-md border px-3 py-2 flex flex-col gap-0.5 ${h.is_this ? 'border-primary-border bg-primary-soft' : 'border-line'}`}>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <EntityCodeLink to={`/admin/contracts/search/${h.contract_id}`} code={h.contract_code} className="font-mono" />
            <LevelBadge hours={h.level_hours} />
            {h.is_this && <Badge size="xs" color="primary">{t('silentWatch.thisOne')}</Badge>}
            {h.last_result_code && <ResultBadge code={h.last_result_code} />}
          </div>
          <div className="text-xs text-subtle flex flex-wrap gap-x-2">
            <span>{t('silentWatch.since')} <DateTime value={h.silent_since} showTime={false} /></span>
            {h.silent_hours != null && <span>· {t('silentWatch.lasted', { dur: dur(h.silent_hours) })}</span>}
            {h.status === 'CLOSED' && h.close_reason_code && <span>· {t(`silentWatch.closeReason.${h.close_reason_code}`)}</span>}
            {h.product_name && <span className="truncate">· {h.product_name}</span>}
          </div>
        </div>
      ))}
    </DetailSection>
  );
}

/** The result buttons come from `result_codes[]`; a code with `note_required`
 *  cannot be sent without a note. Saved results do not take the row off the
 *  queue — only the device coming back does. */
function CheckLogBar({ d, boxed = false }: { d: SilentTaskDetail; boxed?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A different row opened: start clean.
  useEffect(() => { setCode(null); setNote(''); setError(null); }, [d.episode.episode_id]);

  if (!d.can_log) {
    return (
      <div className={boxed ? 'rounded-md border border-line px-3 py-2 text-sm text-subtle' : 'flex-none border-t border-line px-4 py-3 text-sm text-subtle'}>
        {t('silentWatch.cannotLog')}
      </div>
    );
  }

  const chosen = d.result_codes.find((r) => r.code === code) ?? null;
  const noteMissing = !!chosen?.note_required && note.trim() === '';
  const canSave = !!chosen && !noteMissing && !saving;

  const save = async () => {
    if (!chosen) return;
    setSaving(true);
    setError(null);
    try {
      await silentCheckLog(d.episode.episode_id, chosen.code, note.trim() || null);
      setCode(null);
      setNote('');
      refreshAfterCheck(qc);
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('silentWatch.saved', { result: t(`silentWatch.result.${chosen.code}`) })}</span></div>,
        type: 'success',
      });
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : t('common.error'));
      // Closed under us (device came back): the queue and this row are stale.
      if (err instanceof ApiError && (err.code ?? '').toUpperCase() === 'MDM.STATE.SILENT_EPISODE_CLOSED') refreshAfterCheck(qc);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${boxed ? 'rounded-md border border-line px-3 py-3' : 'flex-none border-t border-line px-4 py-3'} flex flex-col gap-2 bg-surface`} data-testid="silent-log-bar">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t('silentWatch.logTitle')}</span>
        <span className="text-xs text-subtle">{t('silentWatch.autoCloseNote')}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {d.result_codes.map((r) => (
          <Button
            key={r.code}
            size="sm"
            variant={code === r.code ? 'primary' : 'outline'}
            onClick={() => setCode(code === r.code ? null : r.code)}
            disabled={saving}
            data-result={r.code}
          >
            {t(`silentWatch.result.${r.code}`, { defaultValue: r.code })}
          </Button>
        ))}
      </div>
      <TextArea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={chosen?.note_required ? t('silentWatch.noteRequired') : t('silentWatch.notePlaceholder')}
        rows={2}
        size="sm"
        error={noteMissing && note.length > 0}
        disabled={saving}
      />
      {error && (
        <div className="alert alert-danger"><XCircle size={16} /><span className="alert-description">{error}</span></div>
      )}
      <div className="flex items-center gap-2">
        {chosen?.note_required && noteMissing && <span className="text-xs text-warning-fg">{t('silentWatch.noteRequiredHint')}</span>}
        <Button
          className="ml-auto"
          size="sm"
          variant="primary"
          startIcon={saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          disabled={!canSave}
          onClick={() => void save()}
        >
          {t('silentWatch.save')}
        </Button>
      </div>
    </div>
  );
}
