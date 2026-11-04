// The D-score and device price block of a contract's money section, shared by
// the contract, draft and saving panels. Every figure is shown exactly as the
// view sends it (UI_SUMMARY/158 §2): no margin or difference is worked out from
// them, and `device_price_total` on a fund contract is what the shop sells the
// phone to the fund for, not what the shop paid.

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtCurrency } from '../../lib/format';
import { DScoreStars } from '../../components/DScore';

export interface ContractDevicePriceFields {
  d_score?: number | null;
  /** Staff and fund only, the shop's view has no such key. Null = no uplift, no second row. */
  d_score_ex_uplift?: number | null;
  device_price_kind?: 'COST' | 'SHOP_SALE' | null;
  device_price_base?: number | null;
  device_uplift?: number | null;
  device_price_total?: number | null;
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-subtle">{label}</div>
      <div className="text-sm font-medium tabular-nums">{children}</div>
    </div>
  );
}

/** Goes under the panel's own figures; draws nothing on a draft with no plan or price yet. */
export function ContractDevicePriceBlock({ contract }: { contract: ContractDevicePriceFields }) {
  const { t } = useTranslation();
  const hasPrice = contract.device_price_base != null;
  if (contract.d_score == null && !hasPrice) return null;
  return (
    <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-line">
      {contract.d_score != null && (
        <div className="flex flex-col gap-3">
          <Cell label={t('dScore.label')}><DScoreStars score={contract.d_score} /></Cell>
          {contract.d_score_ex_uplift != null && (
            <Cell label={t('dScore.exUplift')}><DScoreStars score={contract.d_score_ex_uplift} /></Cell>
          )}
        </div>
      )}
      {hasPrice && contract.device_price_kind === 'COST' && (
        <Cell label={t('contract.deviceCost')}>{fmtCurrency(contract.device_price_total)}</Cell>
      )}
      {hasPrice && contract.device_price_kind === 'SHOP_SALE' && (
        <>
          <Cell label={t('contract.devicePriceBase')}>{fmtCurrency(contract.device_price_base)}</Cell>
          <Cell label={t('contract.deviceUplift')}>{fmtCurrency(contract.device_uplift)}</Cell>
          <Cell label={t('contract.deviceShopSale')}>{fmtCurrency(contract.device_price_total)}</Cell>
        </>
      )}
    </div>
  );
}
