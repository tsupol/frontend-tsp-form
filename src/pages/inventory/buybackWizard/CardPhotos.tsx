import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { SummaryCard } from '../../contracts/workspace/SummaryCard';
import { apiClient } from '../../../lib/api';
import { getLine, statusIconColor } from './useBuyback';
import type { BuybackDraft, CardStatus } from './types';

interface EntityMediaCountRow { entity_media_id: number }

export function CardPhotos({
  draft,
  active,
  onEdit,
}: {
  draft: BuybackDraft | null;
  active: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const line = getLine(draft);
  const lineId = line?.po_line_id ?? null;

  // Live count from v_entity_media (line.images is the snapshot at submit time
  // and stays empty during DRAFT). Driving the card off the real link rows.
  // Distinct queryKey from PanelPhotos so the stub `select=entity_media_id`
  // payload doesn't poison the panel's full-row cache.
  const { data: photos = [] } = useQuery({
    queryKey: ['buyback-photos-count', lineId],
    queryFn: () => apiClient.get<EntityMediaCountRow[]>(
      `/v_entity_media?entity_type=eq.PO_LINE&entity_id=eq.${lineId}&usage_type=eq.BUYBACK_CONDITION&select=entity_media_id`,
    ),
    enabled: lineId != null,
    staleTime: 30 * 1000,
  });

  const count = photos.length;
  const status: CardStatus = !line
    ? 'locked'
    : count >= 4 ? 'complete'
    : count > 0 ? 'partial'
    : 'empty';

  return (
    <SummaryCard
      title={t('buybackWizard.cardPhotos', { defaultValue: 'Photos' })}
      status={status}
      icon={<Camera size={16} className={`${statusIconColor(status)} shrink-0`} />}
      onEdit={status === 'locked' ? undefined : onEdit}
      active={active}
      disabled={status === 'locked'}
    >
      {status === 'locked' ? (
        <div className="text-subtle text-xs">{t('buybackWizard.lockedNeedsSetup', { defaultValue: 'Save Setup first.' })}</div>
      ) : (
        <div className="text-subtle text-xs">
          {t('buybackWizard.photosCount', { defaultValue: '{{count}} photo(s)', count })}
        </div>
      )}
    </SummaryCard>
  );
}
