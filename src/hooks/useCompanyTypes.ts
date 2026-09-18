import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api';

/*
 * Company types (mig 1257 / 1269) — OPERATING vs FINANCIER.
 * Source: GET /v_ref_company_types?order=sort_order.
 *
 * The ONE rule of this feature (UI_SUMMARY 142): never hardcode the type codes
 * or the branch-type list. Which branch types a company may hold comes from
 * `allowed_branch_types` of its own type row — today OPERATING allows
 * INTERNAL/EXTERNAL and FINANCIER allows DEAL_PARTNER/INTERNAL, but that is
 * data, not a constant. Screens ask `allowedBranchTypes(companyType)` and render
 * whatever comes back.
 *
 * `can_hold_money` is what marks a fund company — the branch form uses it to
 * decide whether the "company warehouse" tick is mandatory, instead of
 * comparing against the literal string FINANCIER.
 */
export interface RefCompanyType {
  code: string;
  name_th: string;
  name_en: string | null;
  allowed_branch_types: string[];
  can_hold_money: boolean;
  sort_order: number;
}

export function useCompanyTypes() {
  const { i18n } = useTranslation();
  const query = useQuery({
    queryKey: ['ref-company-types'],
    queryFn: () => apiClient.get<RefCompanyType[]>('/v_ref_company_types?order=sort_order'),
    staleTime: 60 * 60 * 1000,
  });

  const types = query.data ?? [];

  const typeName = (code: string | null | undefined): string => {
    if (!code) return '';
    const row = types.find((r) => r.code === code);
    if (!row) return code;
    return i18n.language === 'th' ? row.name_th : (row.name_en ?? row.name_th);
  };

  const options = types.map((r) => ({ value: r.code, label: typeName(r.code) }));

  /** Branch types this company type may hold. Empty while the view is loading. */
  const allowedBranchTypes = (code: string | null | undefined): string[] =>
    (code ? types.find((r) => r.code === code)?.allowed_branch_types : undefined) ?? [];

  /** A company whose type holds the holding's money — the fund/warehouse rules apply. */
  const canHoldMoney = (code: string | null | undefined): boolean =>
    !!code && !!types.find((r) => r.code === code)?.can_hold_money;

  /** Default for a create form: the first type by sort order (OPERATING today). */
  const defaultType = types[0]?.code ?? '';

  return { types, options, typeName, allowedBranchTypes, canHoldMoney, defaultType, ...query };
}
