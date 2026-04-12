import { useTranslation } from 'react-i18next';
import { Input, Switch } from 'tsp-form';
import { PiggyBank } from 'lucide-react';
import { fmtCurrency } from '../contractUtils';
import { useWorkspace } from './WorkspaceContext';

export function CardSaving() {
  const { t } = useTranslation();
  const { data, updateData, isReadOnly } = useWorkspace();

  const suggestedAmount = data.selectedQuote
    ? Math.round(data.selectedQuote.retail_price * 0.25)
    : 0;

  return (
    <div className={`border rounded-lg transition-colors ${
      data.savingEnabled ? 'border-info/30 bg-info/3' : 'border-line bg-bg'
    }`}>
      <div className="flex items-center gap-2 px-4 py-3">
        <Switch
          size="sm"
          checked={data.savingEnabled}
          onChange={e => updateData({ savingEnabled: (e.target as HTMLInputElement).checked })}
          disabled={isReadOnly}
        />
        <PiggyBank size={16} className={data.savingEnabled ? 'text-info' : 'text-fg/40'} />
        <span className="font-medium text-sm">{t('workspace.savingContract')}</span>
      </div>

      {data.savingEnabled && (
        <div className="px-4 pb-3 flex items-center gap-3">
          <label className="form-label text-xs shrink-0 mb-0">{t('workspace.savingTarget')}</label>
          <Input
            type="number"
            value={String(data.savingTargetAmount || '')}
            onChange={e => updateData({ savingTargetAmount: parseFloat(e.target.value) || 0 })}
            size="sm"
            className="w-32"
            disabled={isReadOnly}
          />
          {suggestedAmount > 0 && (
            <span className="text-xs text-subtle">
              {t('workspace.savingSuggested')}: {fmtCurrency(suggestedAmount)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
