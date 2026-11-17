// ============================================================================
// RecentIntentsPanel — the command queue / history (131 §4). Shared surface:
// every action sub-tab fires a command, gets intent_id(s), then the user tracks
// them HERE. Queue == history (§4) — no separate history section.
//
// - Polls every 3s while any row is IN_PROGRESS (async devices report late).
// - One line per command: command_kind_th · result_code in words · time · who
//   (mig 480). Engineering codes (`MDM.…`, intent_type) never reach the screen.
// - Rows the user just triggered (highlightIds) get a ring for a beat.
// ============================================================================

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { CheckCircle, Loader2, Ban, RefreshCw, WifiOff, AlertTriangle } from 'lucide-react';
import { DateTime } from '../../../components/DateTime';
import {
  fetchRecentIntents, hasInFlightIntent,
  type MdmRecentIntent, type MdmIntentDisplayStatus, type MdmIntentResultCode,
} from './mdmApi';
import { MDM_NO_CACHE } from './useMdmStatus';

// result_code → icon + text colour (IMPLEMENT 2026-11-17 recent_intents_result_code_479).
// DEVICE_OFFLINE is a soft warning: the customer's phone is off the net, nothing broke.
const RESULT_META: Record<MdmIntentResultCode, { icon: typeof CheckCircle; className: string; spin?: boolean }> = {
  OK: { icon: CheckCircle, className: 'text-success-fg' },
  DEVICE_OFFLINE: { icon: WifiOff, className: 'text-warning-fg' },
  DEVICE_REFUSED: { icon: AlertTriangle, className: 'text-warning-fg' },
  CANCELED_BY_STATE: { icon: Ban, className: 'text-subtle' },
  IN_PROGRESS: { icon: Loader2, className: 'text-info-fg', spin: true },
  OTHER: { icon: AlertTriangle, className: 'text-warning-fg' },
};

// No result_code yet (a row from before mig 480): fall back on display_status.
const STATUS_FALLBACK: Record<MdmIntentDisplayStatus, MdmIntentResultCode> = {
  DONE: 'OK',
  IN_PROGRESS: 'IN_PROGRESS',
  FAILED: 'OTHER',
  CANCELED: 'CANCELED_BY_STATE',
};

export function RecentIntentsPanel({
  assetId,
  limit = 5,
  highlightIds = [],
  onViewAll,
}: {
  assetId: number;
  limit?: number;
  highlightIds?: number[];
  onViewAll?: () => void;
}) {
  const { t } = useTranslation();

  const { data: intents = [], isFetching, refetch } = useQuery({
    queryKey: ['mdm-recent-intents', assetId, limit],
    queryFn: () => fetchRecentIntents(assetId, limit),
    ...MDM_NO_CACHE,
    // Poll while anything is in flight — the device reports back async (§0.3).
    refetchInterval: (q) => (hasInFlightIntent(q.state.data ?? []) ? 3000 : false),
    refetchIntervalInBackground: false,
  });

  return (
    <div className="border border-line rounded-md">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
        <span className="text-xs font-semibold text-subtle">{t('asset.mdm.queue.title')}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="btn-icon-sm"
            startIcon={<RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />}
            onClick={() => refetch()}
            aria-label={t('common.refresh')}
          />
        </div>
      </div>

      {intents.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-subtler">{t('asset.mdm.queue.empty')}</div>
      ) : (
        <ul className="divide-y divide-line">
          {intents.map((it) => (
            <IntentRow key={it.intent_id} intent={it} highlighted={highlightIds.includes(it.intent_id)} t={t} />
          ))}
        </ul>
      )}

      {onViewAll && intents.length > 0 && (
        <div className="px-3 py-2 border-t border-line text-center">
          <button
            className="text-xs text-primary-fg underline cursor-pointer bg-transparent border-none"
            onClick={onViewAll}
          >
            {t('asset.mdm.queue.viewAll')}
          </button>
        </div>
      )}
    </div>
  );
}

function IntentRow({ intent, highlighted, t }: {
  intent: MdmRecentIntent;
  highlighted: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  // One row = one line: <kind> · <result> · <time> · <who> (§③).
  const result = intent.result_code ?? STATUS_FALLBACK[intent.display_status];
  const meta = RESULT_META[result] ?? RESULT_META.OTHER;
  const ResultIcon = meta.icon;

  return (
    <li className={`px-3 py-2 flex items-center gap-x-2 gap-y-0.5 flex-wrap text-sm transition-shadow ${highlighted ? 'ring-2 ring-primary ring-inset rounded-sm' : ''}`}>
      <span className="font-medium">{intent.command_kind_th ?? '—'}</span>
      <span className="text-subtler">·</span>
      <span className={`inline-flex items-center gap-1 ${meta.className}`}>
        <ResultIcon size={14} className={`shrink-0 ${meta.spin ? 'animate-spin' : ''}`} />
        {t(`asset.mdm.queue.result.${result}`)}
      </span>
      <span className="text-subtler">·</span>
      <span className="text-xs text-subtle"><DateTime value={intent.created_at} showTime /></span>
      <span className="text-subtler">·</span>
      <span className="text-xs text-subtle">{intent.created_by_name ?? t('asset.mdm.queue.system')}</span>
    </li>
  );
}
