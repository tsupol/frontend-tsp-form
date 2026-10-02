// "Device & app" panel — what the collector / repo team needs to decide on one
// contract: when MDM last saw the device the customer holds, how long it has
// been silent, and when the customer last opened the NNF app.
//
// Backend: api.v_contract_device_signals (one row per contract) —
// UI_FEEDBACK/2026-10-01_DELIVERY_collector_device_signals_send_to_repo_and_repo_locate.md §1
//  · ALWAYS filter by contract_id (unfiltered = seconds).
//  · 0 rows = the user has no access to this contract → render nothing.
//  · The DB sends facts, not verdicts: numbers are shown as they are, and the
//    only colouring is for facts that are abnormal by themselves (app deleted,
//    pushes can't reach the customer, lost mode on).
//  · mdm_enrolled = false means "this device has no MDM", never "the customer
//    removed it" — most devices never had one.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge } from 'tsp-form';
import { Smartphone, Loader2 } from 'lucide-react';
import { apiClient } from '../lib/api';
import { DateTime } from './DateTime';
import { DetailLine } from './DetailLine';

export interface ContractDeviceSignals {
  contract_id: number;
  contract_code_display: string;
  company_id: number;
  branch_id: number | null;
  device_id: number | null;
  device_code_display: string | null;
  device_is_loaner: boolean;
  mdm_enrolled: boolean;
  mdm_last_seen_at: string | null;
  mdm_silent_days: number | null;
  mdm_battery_level: number | null;
  mdm_lock_level: number | null;
  mdm_wallpaper_on: boolean;
  mdm_pause_mode: string | null;
  mdm_nnf_app_installed: boolean | null;
  mdm_nnf_app_checked_at: string | null;
  mdm_lost_mode_on: boolean;
  mdm_lost_mode_pending: boolean;
  locate_loop_ends_at: string | null;
  mdm_last_location_at: string | null;
  app_ever_opened: boolean;
  app_last_seen_at: string | null;
  app_silent_days: number | null;
  app_has_push_device: boolean;
}

export const deviceSignalsKey = (contractId: number) => ['device-signals', contractId] as const;

export function fetchDeviceSignals(contractId: number): Promise<ContractDeviceSignals | null> {
  return apiClient
    .get<ContractDeviceSignals[]>(`/v_contract_device_signals?contract_id=eq.${contractId}`)
    .then((rows) => rows[0] ?? null);
}

/** Something sent to the device is still under way: a lock command the device
 *  hasn't answered, or a location loop still running. The repo screen polls
 *  every 15 s while this is true (§3.2) and stops when it isn't. */
export function signalsBusy(s: ContractDeviceSignals | null | undefined): boolean {
  return !!s && (s.mdm_lost_mode_pending || s.locate_loop_ends_at != null);
}

export function useDeviceSignals(contractId: number, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: deviceSignalsKey(contractId),
    queryFn: () => fetchDeviceSignals(contractId),
    // Device state changes without anyone touching this screen.
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (q) => (opts.poll && signalsBusy(q.state.data) ? 15_000 : false),
    refetchIntervalInBackground: false,
  });
}

/** Minutes until `iso`, re-evaluated every 30 s. */
function useMinutesLeft(iso: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 60_000)) : null;
}

/** The panel for one contract. Renders nothing while loading or when the user
 *  has no access (0 rows). `signals` lets a host that already holds the row
 *  pass it in instead of re-querying.
 *  `bare` drops the frame and title so the lines can sit inside a box that
 *  already shows the device (collector overview, repo job card) — the device
 *  is not repeated there. */
export function DeviceSignalsPanel({
  contractId, signals, showDeviceCode = true, bare = false, className = '',
}: {
  contractId: number;
  signals?: ContractDeviceSignals | null;
  showDeviceCode?: boolean;
  bare?: boolean;
  className?: string;
}) {
  const { data: fetched } = useDeviceSignals(contractId);
  const s = signals !== undefined ? signals : fetched;
  if (!s) return null;
  return <DeviceSignalsBody s={s} showDeviceCode={showDeviceCode} bare={bare} className={className} />;
}

function DeviceSignalsBody({ s, showDeviceCode, bare, className }: {
  s: ContractDeviceSignals; showDeviceCode: boolean; bare: boolean; className: string;
}) {
  const { t } = useTranslation();
  const loopMinutes = useMinutesLeft(s.locate_loop_ends_at);
  const battery = s.mdm_battery_level != null ? Math.round(s.mdm_battery_level * 100) : null;

  return (
    <div className={`${bare ? '' : 'border border-line rounded-md p-3'} flex flex-col gap-2 ${className}`}>
      {!bare && <div className="flex items-center gap-2 flex-wrap">
        <Smartphone size={15} className="text-subtle shrink-0" />
        <span className="text-sm font-medium">{t('deviceSignals.title')}</span>
        {showDeviceCode && s.device_code_display && (
          <span className="text-xs font-mono text-subtle">{s.device_code_display}</span>
        )}
        {s.device_is_loaner && <Badge size="sm" color="warning">{t('deviceSignals.loaner')}</Badge>}
        {s.mdm_lost_mode_on && <Badge size="sm" color="danger">{t('deviceSignals.lostModeOn')}</Badge>}
      </div>}

      {/* MDM */}
      {!s.mdm_enrolled ? (
        <DetailLine label={t('deviceSignals.mdm')}>
          <span className="text-subtler">{t('deviceSignals.noMdm')}</span>
        </DetailLine>
      ) : (
        <>
          <DetailLine label={t('deviceSignals.mdmLastSeen')}>
            {s.mdm_last_seen_at ? <DateTime value={s.mdm_last_seen_at} /> : <span className="text-subtler">{t('deviceSignals.neverSeen')}</span>}
            {s.mdm_silent_days != null && (
              <span className="text-xs text-subtle">
                {s.mdm_silent_days === 0 ? t('deviceSignals.seenToday') : t('deviceSignals.silentDays', { count: s.mdm_silent_days })}
              </span>
            )}
          </DetailLine>
          {battery != null && (
            <DetailLine label={t('deviceSignals.battery')}>
              <span>{battery}%</span>
              <span className="text-xs text-subtler">{t('deviceSignals.batteryAsOfLastSeen')}</span>
            </DetailLine>
          )}
          <DetailLine label={t('deviceSignals.lock')}>
            <span>{t(`deviceSignals.lockLevel.${s.mdm_lock_level ?? 0}`, { defaultValue: String(s.mdm_lock_level ?? '—') })}</span>
            {bare && s.mdm_lost_mode_on && <Badge size="sm" color="danger">{t('deviceSignals.lostModeOn')}</Badge>}
            {s.mdm_wallpaper_on && <Badge size="sm" color="warning">{t('deviceSignals.wallpaperOn')}</Badge>}
            {s.mdm_pause_mode && <Badge size="sm" color="info">{t('deviceSignals.paused')}</Badge>}
            {s.mdm_lost_mode_pending && (
              <span className="text-xs text-warning-fg inline-flex items-center gap-1">
                <Loader2 size={11} className="animate-spin" />{t('deviceSignals.lostModePending')}
              </span>
            )}
          </DetailLine>
          <DetailLine label={t('deviceSignals.nnfAppOnDevice')}>
            {s.mdm_nnf_app_installed == null ? (
              <span className="text-subtler">{t('deviceSignals.notCheckedYet')}</span>
            ) : s.mdm_nnf_app_installed ? (
              <span>{t('deviceSignals.installed')}</span>
            ) : (
              <span className="text-danger-fg font-medium">{t('deviceSignals.appRemoved')}</span>
            )}
            {s.mdm_nnf_app_checked_at && (
              <span className="text-xs text-subtler">{t('deviceSignals.checkedAt')} <DateTime value={s.mdm_nnf_app_checked_at} /></span>
            )}
          </DetailLine>
          {(s.locate_loop_ends_at || s.mdm_last_location_at) && (
            <DetailLine label={t('deviceSignals.location')}>
              {s.locate_loop_ends_at && (
                <span className="text-info-fg inline-flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" />
                  {t('deviceSignals.locating', { count: loopMinutes ?? 0 })}
                </span>
              )}
              {s.mdm_last_location_at && (
                <span className="text-xs text-subtle">{t('deviceSignals.lastFix')} <DateTime value={s.mdm_last_location_at} /></span>
              )}
            </DetailLine>
          )}
        </>
      )}

      {/* NNF app */}
      <div className="border-t border-line-subtle pt-2 flex flex-col gap-2">
        <DetailLine label={t('deviceSignals.nnfApp')}>
          {!s.app_ever_opened ? (
            <span className="text-subtler">{t('deviceSignals.appNeverOpened')}</span>
          ) : (
            <>
              {/* Day resolution only — never show a time here. */}
              {s.app_last_seen_at && <DateTime value={s.app_last_seen_at} showTime={false} />}
              {s.app_silent_days != null && (
                <span className="text-xs text-subtle">
                  {s.app_silent_days === 0 ? t('deviceSignals.appToday') : t('deviceSignals.appSilentDays', { count: s.app_silent_days })}
                </span>
              )}
            </>
          )}
        </DetailLine>
        <DetailLine label={t('deviceSignals.push')}>
          {s.app_has_push_device
            ? <span>{t('deviceSignals.pushOk')}</span>
            : <span className="text-warning-fg">{t('deviceSignals.pushNone')}</span>}
        </DetailLine>
      </div>
    </div>
  );
}
