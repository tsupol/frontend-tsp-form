// ============================================================================
// RecentIntentsPanel — the command queue / history (131 §4). Shared surface:
// every action sub-tab fires a command, gets intent_id(s), then the user tracks
// them HERE. Queue == history (§4) — no separate history section.
//
// - Polls every 3s while any row is IN_PROGRESS (async devices report late).
// - display_status → coloured badge · outcome_code → a real sentence (§12),
//   never bare "failed". Unknown outcome codes render raw (§12: don't hide).
// - Rows the user just triggered (highlightIds) get a ring for a beat.
// ============================================================================

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from 'tsp-form';
import { CheckCircle, Loader2, XCircle, Ban, RefreshCw, Bot, Wrench, User } from 'lucide-react';
import { DateTime } from '../../../components/DateTime';
import {
  fetchRecentIntents, hasInFlightIntent,
  type MdmRecentIntent, type MdmIntentDisplayStatus, type MdmIntentSourceLayer,
} from './mdmApi';

const STATUS_META: Record<MdmIntentDisplayStatus, { color: 'success' | 'info' | 'danger' | 'default'; icon: typeof CheckCircle; spin?: boolean }> = {
  DONE: { color: 'success', icon: CheckCircle },
  IN_PROGRESS: { color: 'info', icon: Loader2, spin: true },
  FAILED: { color: 'danger', icon: XCircle },
  CANCELED: { color: 'default', icon: Ban },
};

const SOURCE_ICON: Record<MdmIntentSourceLayer, typeof User> = {
  STAFF: User,
  AUTO: Bot,
  ENGINEER: Wrench,
};

/** intent_type → a staff-readable label; unknown types fall back to the raw code. */
function intentTypeLabel(type: string, t: ReturnType<typeof useTranslation>['t']): string {
  return t(`asset.mdm.intentType.${type}`, { defaultValue: type });
}

/** outcome_code → sentence (§12). Unknown → raw code (never hidden). */
function outcomeLabel(code: string, t: ReturnType<typeof useTranslation>['t']): string {
  return t(`asset.mdm.outcome.${code}`, { defaultValue: code });
}

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
  const meta = STATUS_META[intent.display_status];
  const StatusIcon = meta.icon;
  const SourceIcon = SOURCE_ICON[intent.source_layer] ?? User;
  const isBad = intent.display_status === 'FAILED' || intent.display_status === 'CANCELED';

  return (
    <li className={`px-3 py-2 flex items-start gap-2.5 transition-shadow ${highlighted ? 'ring-2 ring-primary ring-inset rounded-sm' : ''}`}>
      <StatusIcon size={15} className={`shrink-0 mt-0.5 ${meta.spin ? 'animate-spin' : ''} ${
        intent.display_status === 'DONE' ? 'text-success'
          : intent.display_status === 'FAILED' ? 'text-danger'
          : intent.display_status === 'CANCELED' ? 'text-subtle' : 'text-info-fg'
      }`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{intentTypeLabel(intent.intent_type, t)}</span>
          <Badge color={meta.color} size="xs">{t(`asset.mdm.queue.status.${intent.display_status}`)}</Badge>
        </div>
        {/* Failure/cancel reason — always a sentence, never bare "failed". */}
        {isBad && intent.outcome_code && (
          <div className="text-xs text-subtle mt-0.5">{outcomeLabel(intent.outcome_code, t)}</div>
        )}
        <div className="text-[11px] text-subtler mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <SourceIcon size={11} />
            {intent.source_layer === 'STAFF'
              ? (intent.created_by_name ?? t('asset.mdm.queue.staff'))
              : intent.source_layer === 'AUTO'
                ? t('asset.mdm.queue.system')
                : (intent.created_by_name ?? t('asset.mdm.queue.engineer'))}
          </span>
          <span>·</span>
          <DateTime value={intent.created_at} showTime />
          {(intent.attempt_no ?? 0) > 1 && (
            <>
              <span>·</span>
              <span>{t('asset.mdm.queue.attempt', { n: intent.attempt_no, max: intent.max_attempts })}</span>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
