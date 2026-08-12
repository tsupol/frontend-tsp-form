// ============================================================================
// Asset ↔ contract binding history (IMPLEMENT 2026-08-12, mig 1069).
//
// One event list, two entry points — same row shape either way:
//   • asset page   → RPC fn_asset_contract_timeline(p_asset_id). It's an RPC and
//                    not a view because a device shows up on BOTH sides of a swap
//                    (as the one removed and the one put in); the RPC unions both
//                    directions so the asset sees its whole life, not half of it.
//   • contract page → view v_asset_contract_timeline?contract_id=eq.N, a plain
//                    indexed read — one contract only ever has one side.
//
// Which device a row is about depends on the action: BIND/SWAP put a device on
// (read new_*), UNBIND takes one off (read old_*). SWAP does both, so it prints
// old → new. Every action is shown, loaners and ownership transfers included —
// the owner asked for the complete history, not just the primary-device story.
// ============================================================================

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge } from 'tsp-form';
import { ArrowRight, ExternalLink, History } from 'lucide-react';
import { apiClient } from '../lib/api';
import { DateTime } from './DateTime';
import { getStateColor } from '../pages/contracts/contractUtils';

export interface AssetContractEvent {
  event_id: number;
  contract_id: number;
  contract_code: string | null;
  contract_state: string | null;
  action: string;
  reason: string | null;
  note: string | null;
  device_role: 'PRIMARY' | 'LOANER' | null;
  old_device_id: number | null;
  old_asset_code: string | null;
  old_serial_no: string | null;
  new_device_id: number | null;
  new_asset_code: string | null;
  new_serial_no: string | null;
  signing_id: number | null;
  created_by: number | null;
  created_by_username: string | null;
  created_at: string;
}

/** Colour by what the action does to the binding, not by severity. */
function actionColor(action: string): 'success' | 'danger' | 'warning' | 'info' | 'default' {
  switch (action) {
    case 'BIND':
    case 'LOAN_ASSIGN':
      return 'success';
    case 'UNBIND':
    case 'LOAN_RETURN':
      return 'danger';
    case 'SWAP':
      return 'warning';
    case 'OWNERSHIP_TRANSFER':
    case 'UNBIND_UNDO':
      return 'info';
    default:
      return 'default';
  }
}

/** Timeline of one ASSET's binds/unbinds across every contract it has been on. */
export function AssetContractTimeline({ assetId }: { assetId: number }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['asset-contract-timeline', assetId],
    queryFn: () => apiClient.rpc<{ asset_id: number; count: number; events: AssetContractEvent[] }>(
      'fn_asset_contract_timeline', { p_asset_id: assetId },
    ),
    staleTime: 30 * 1000,
  });

  return (
    <TimelineList
      events={data?.events ?? []}
      isLoading={isLoading}
      // On the asset page the contract is the thing that varies — lead with it.
      lead="contract"
      // Printing this asset's own code on every row is noise; it's the page you
      // are on. Only the OTHER side of a swap is worth naming.
      selfAssetId={assetId}
      title={t('deviceLog.assetTimelineTitle')}
      t={t}
    />
  );
}

/** Timeline of one CONTRACT's device changes. */
export function ContractDeviceTimeline({ contractId }: { contractId: number }) {
  const { t } = useTranslation();
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['contract-device-timeline', contractId],
    queryFn: () => apiClient.get<AssetContractEvent[]>(
      `/v_asset_contract_timeline?contract_id=eq.${contractId}&order=created_at.desc`,
    ),
    staleTime: 30 * 1000,
  });

  return (
    <TimelineList
      events={events}
      isLoading={isLoading}
      // On the contract page the contract is a given — lead with the device.
      lead="device"
      title={t('deviceLog.contractTimelineTitle')}
      t={t}
    />
  );
}

function TimelineList({
  events, isLoading, lead, title, selfAssetId, t,
}: {
  events: AssetContractEvent[];
  isLoading: boolean;
  lead: 'contract' | 'device';
  title: string;
  selfAssetId?: number;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  // Nothing recorded is the normal case for a device that has never been on a
  // contract — say so rather than leaving a bare heading.
  return (
    <section className="border border-line rounded-md">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
        <History size={16} className="text-subtle" />
        <h3 className="text-sm font-semibold">{title}</h3>
        {events.length > 0 && <span className="text-xs text-subtle">({events.length})</span>}
      </header>
      {isLoading ? (
        <div className="px-4 py-3 text-sm text-subtle">{t('common.loading')}</div>
      ) : events.length === 0 ? (
        <div className="px-4 py-3 text-sm text-subtle">{t('deviceLog.empty')}</div>
      ) : (
        <div className="divide-y divide-line">
          {events.map(ev => (
            <EventRow key={ev.event_id} ev={ev} lead={lead} selfAssetId={selfAssetId} t={t} />
          ))}
        </div>
      )}
    </section>
  );
}

function EventRow({ ev, lead, selfAssetId, t }: {
  ev: AssetContractEvent;
  lead: 'contract' | 'device';
  selfAssetId?: number;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <div className="px-4 py-2.5 flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge size="xs" color={actionColor(ev.action)}>
            {t(`deviceLog.${ev.action}`, { defaultValue: ev.action })}
          </Badge>
          {/* LOANER is worth calling out — a loaner bind is not the contract's
              real device and reads as confusing without the label. */}
          {ev.device_role === 'LOANER' && (
            <Badge size="xs" color="default">{t('deviceLog.role_LOANER')}</Badge>
          )}
          {lead === 'contract' && ev.contract_code && (
            <>
              <Link
                to={`/admin/contracts/search/${ev.contract_id}`}
                className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 whitespace-nowrap"
              >
                {ev.contract_code}
                <ExternalLink size={11} />
              </Link>
              {ev.contract_state && (
                <Badge size="xs" color={getStateColor(ev.contract_state)}>
                  {t(`contract.state_${ev.contract_state}`, { defaultValue: ev.contract_state })}
                </Badge>
              )}
            </>
          )}
        </div>

        <DevicePair
          ev={ev}
          showBoth={lead === 'device' || ev.action === 'SWAP'}
          selfAssetId={selfAssetId}
        />

        {/* `reason` is free text, NOT an enum — live data holds "SWAP" next to
            "COMPLETE: EARLY_PAYOFF", "คืนเครื่อง" and "aaa". Print it as typed;
            running it through t() would invent keys that never resolve. Only
            `action` above is a real enum. */}
        {(ev.reason || ev.note) && (
          <div className="text-xs text-subtle">
            {ev.reason}
            {ev.reason && ev.note && ' · '}
            {ev.note && <span className="italic">{ev.note}</span>}
          </div>
        )}
      </div>

      {/* Automation writes rows with a created_by that has no username on the
          view (e.g. the activation job) — fall back to the id so the actor
          column is never silently blank. */}
      <div className="text-xs text-subtle shrink-0 text-right flex flex-col gap-0.5">
        <DateTime value={ev.created_at} showTime />
        {(ev.created_by_username || ev.created_by != null) && (
          <span className="text-subtler">{ev.created_by_username ?? `#${ev.created_by}`}</span>
        )}
      </div>
    </div>
  );
}

/** old → new when both sides exist (a swap), otherwise just the side that moved.
 *  On an asset's own timeline the row is by definition about that asset, so its
 *  code is dropped and only the counterpart in a swap is named. */
function DevicePair({ ev, showBoth, selfAssetId }: {
  ev: AssetContractEvent;
  showBoth: boolean;
  selfAssetId?: number;
}) {
  const isSelf = (id: number | null) => selfAssetId != null && id === selfAssetId;
  const from = ev.old_asset_code;
  const to = ev.new_asset_code;

  if (showBoth && from && to) {
    // A swap where one side is this asset: name only the other device, with an
    // arrow showing which way it went.
    if (isSelf(ev.old_device_id) && !isSelf(ev.new_device_id)) {
      return (
        <div className="flex items-center gap-1.5 text-sm min-w-0">
          <ArrowRight size={12} className="text-subtle shrink-0" />
          <DeviceLink id={ev.new_device_id} code={to} />
        </div>
      );
    }
    if (isSelf(ev.new_device_id) && !isSelf(ev.old_device_id)) {
      return (
        <div className="flex items-center gap-1.5 text-sm min-w-0">
          <DeviceLink id={ev.old_device_id} code={from} />
          <ArrowRight size={12} className="text-subtle shrink-0" />
        </div>
      );
    }
    if (isSelf(ev.old_device_id) && isSelf(ev.new_device_id)) return null;
    return (
      <div className="flex items-center gap-1.5 text-sm min-w-0">
        <DeviceLink id={ev.old_device_id} code={from} />
        <ArrowRight size={12} className="text-subtle shrink-0" />
        <DeviceLink id={ev.new_device_id} code={to} />
      </div>
    );
  }

  const code = to ?? from;
  const id = to ? ev.new_device_id : ev.old_device_id;
  if (!code || isSelf(id)) return null;
  return <DeviceLink id={id} code={code} />;
}

function DeviceLink({ id, code }: { id: number | null; code: string }) {
  if (id == null) return <span className="text-sm font-mono whitespace-nowrap">{code}</span>;
  return (
    <Link
      to={`/admin/inventory/assets/${id}`}
      className="text-sm font-mono text-primary-fg hover:underline inline-flex items-center gap-1 whitespace-nowrap"
    >
      {code}
      <ExternalLink size={11} />
    </Link>
  );
}
