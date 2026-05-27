import { useTranslation } from 'react-i18next';
import { Camera, Construction } from 'lucide-react';
import { SummaryCard } from '../../contracts/workspace/SummaryCard';
import { getLine, getPhotosStatus, statusIconColor } from './useBuyback';
import type { BuybackDraft } from './types';

export function CardPhotos({ draft }: { draft: BuybackDraft | null }) {
  const { t } = useTranslation();
  const status = getPhotosStatus(draft);
  const line = getLine(draft);
  const count = Array.isArray(line?.images) ? (line!.images as unknown[]).length : 0;

  return (
    <SummaryCard
      title={t('buybackWizard.cardPhotos', { defaultValue: 'Photos' })}
      status={status}
      icon={<Camera size={16} className={`${statusIconColor(status)} shrink-0`} />}
      onEdit={undefined}
      disabled
    >
      <div className="flex items-center gap-2 text-xs text-subtle">
        <Construction size={14} />
        <span>{t('buybackWizard.photosComingSoon', { defaultValue: 'Photos editor coming soon.' })}</span>
        {count > 0 && <span className="text-fg">· {count}</span>}
      </div>
    </SummaryCard>
  );
}
