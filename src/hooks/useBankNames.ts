// Bank name by code, from v_ref_banks — for rows that carry only `bank_code`
// (fund cash position, fund bill payments, shop payouts). Looked up by code,
// never guessed from a name.

import { useCallback } from 'react';
import { useRefBanks } from '../components/DealPartnerPayoutAccountField';

export function useBankNames() {
  const { data: banks = [] } = useRefBanks();
  return useCallback((code: string | null | undefined) => {
    const b = code ? banks.find(x => x.code === code) : null;
    return { bank_name: b?.name_th ?? null, bank_name_en: b?.name_en ?? null };
  }, [banks]);
}
