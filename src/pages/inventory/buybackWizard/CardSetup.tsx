import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import { SummaryCard } from '../../contracts/workspace/SummaryCard';
import { fmtCurrency } from '../../../lib/format';
import { getLine, getSetupStatus, statusIconColor } from './useBuyback';
import type { BuybackDraft } from './types';

export function CardSetup({
  draft,
  active,
  onEdit,
}: {
  draft: BuybackDraft | null;
  active: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const status = getSetupStatus(draft);
  const line = getLine(draft);

  return (
    <SummaryCard
      title={t('buybackWizard.cardSetup', { defaultValue: 'Setup' })}
      status={status}
      icon={<Package size={16} className={`${statusIconColor(status)} shrink-0`} />}
      onEdit={onEdit}
      active={active}
    >
      {!draft ? (
        <div className="text-subtle text-xs">{t('buybackWizard.setupEmpty', { defaultValue: 'Pick model, seller, and buyback price.' })}</div>
      ) : (
        <div className="flex flex-col gap-0.5 text-xs">
          {line?.brand_name || line?.family_name || line?.model_name ? (
            <>
              <div className="text-sm font-medium truncate">
                {[line.brand_name, line.family_name, line.model_name].filter(Boolean).join(' ')}
              </div>
              {line.variant_name && (
                <div className="text-subtle truncate">{line.variant_name}</div>
              )}
            </>
          ) : (
            <div className="text-subtle italic">{t('buybackWizard.noProductYet', { defaultValue: 'No product picked' })}</div>
          )}
          <div className="text-subtle">
            {t('buyback.seller')}: <span className="text-fg">{draft.supplier_name || '—'}</span>
          </div>
          <div className="text-subtle">
            {t('buybackWizard.price', { defaultValue: 'Price' })}: <span className="font-medium tabular-nums text-fg">{line?.buyback_price ? fmtCurrency(line.buyback_price) : '—'}</span>
          </div>
        </div>
      )}
    </SummaryCard>
  );
}
