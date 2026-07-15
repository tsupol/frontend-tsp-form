import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { formatCid } from '../../../lib/format';
import type { MatchResult, MatchedCustomer } from './useCustomerMatch';

/*
 * Renders fn_customer_match output. Two shapes:
 *  - ID_MATCH_NAME_MISMATCH → a danger banner naming the real CID owner; NO
 *    selectable row (staff must fix the CID, they can't attach this person).
 *  - everything else → a selectable list, with a verdict-specific hint on top.
 * Doc: UI_FEEDBACK/2026-07-14_DELIVERY_fn_customer_match_dedupe.md
 */
export function CustomerMatchResults({ result, selectedId, onSelect }: {
  result: MatchResult;
  selectedId: number | null;
  onSelect: (c: MatchedCustomer) => void;
}) {
  const { t } = useTranslation();
  const { verdict, customers } = result;

  // The CID belongs to a different-named person. Block — do not offer a row to
  // pick, or the register call would overwrite that customer.
  if (verdict === 'ID_MATCH_NAME_MISMATCH') {
    const owner = customers[0];
    return (
      <div className="alert alert-danger mt-3">
        <AlertTriangle size={16} />
        <div className="alert-description text-sm">
          {t('workspace.customerMatch.idMismatch', {
            name: owner?.full_name ?? '—',
            count: owner?.contracts.count ?? 0,
            cid: owner ? formatCid(owner.id_number) : '',
          })}
        </div>
      </div>
    );
  }

  if (verdict === 'NO_MATCH') {
    return <div className="text-sm text-subtle text-center py-2 mt-3">{t('workspace.customerMatch.noMatch')}</div>;
  }

  // ID_EXACT_MATCH / NAME_EXACT_MATCH / PARTIAL_MATCH → selectable list.
  return (
    <div className="flex flex-col gap-1 mt-3">
      <div className="text-xs text-subtle px-1">{t(`workspace.customerMatch.hint_${verdict}`)}</div>
      <div className="border border-line rounded-lg divide-y divide-line overflow-hidden max-h-56 overflow-y-auto better-scroll">
        {customers.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`w-full text-left px-4 py-2.5 hover:bg-surface-hover transition-colors cursor-pointer flex items-center justify-between gap-2 ${
              selectedId === c.id ? 'bg-primary-soft border-l-2 border-l-primary' : ''
            }`}
            onClick={() => onSelect(c)}
          >
            <div className="min-w-0">
              <div className="font-medium text-sm flex items-center gap-1.5">
                <span className="truncate">{c.full_name}</span>
                {c.contracts.count > 0 && (
                  <span className="text-[11px] text-subtle shrink-0">
                    {t('workspace.customerMatch.contractsCount', { count: c.contracts.count })}
                  </span>
                )}
              </div>
              <div className="text-xs text-subtle tabular-nums">
                {c.id_type === 'CITIZEN_ID' ? formatCid(c.id_number) : c.id_number}
                {c.tel ? ` · ${c.tel}` : ''}
              </div>
            </div>
            {selectedId === c.id && <CheckCircle size={14} className="text-primary-fg shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}
