import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SCOPE_OPTIONS, SCOPE_TO_STATES, type ContractScope } from './contractUtils';
import { ContractListPane } from './ContractListPane';

export function ContractSearchPage() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<ContractScope>('OPEN');

  const scopeTabs = (
    <div className="flex-none flex border-b border-line">
      {SCOPE_OPTIONS.map(s => (
        <button
          key={s}
          className={`flex-1 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
            scope === s
              ? 'border-primary-fg text-primary-fg'
              : 'border-transparent text-fg'
          }`}
          onClick={() => setScope(s)}
        >
          {t(`contract.scope_${s}`)}
        </button>
      ))}
    </div>
  );

  return (
    <ContractListPane
      title={t('nav.contractSearch')}
      routePrefix="/admin/contracts/search"
      states={SCOPE_TO_STATES[scope]}
      headerSlot={scopeTabs}
      showNewButton
    />
  );
}
