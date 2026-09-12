// "Which email did you scan this device with?" — the ABM account picker feed.
// Spec: UI_FEEDBACK/2026-09-11_IMPLEMENT_mdm_abm_account_and_enroll_email_picker.md §2.
//
// Why any of this exists: a branch signs into Apple Configurator with one email,
// and that email decides which ABM organisation the device lands in. We must
// push the DEP profile to THAT org — aim at the wrong one and Apple answers
// NOT_ACCESSIBLE. Since 2026-09-10 there are two live orgs (RICH, TRW), so the
// system's guess (holding default / Apple mirror) is wrong for a whole branch's
// worth of devices. Hence: ask, and always send p_source_id.
//
// ⛔ Never sort these rows. The view already orders them: the single is_default
//    row first (branch default beats company default — the view resolves that),
//    then by org name then label. Re-sorting would bury the row we want preselected.
//
// `label` is a nickname someone typed and can be wrong; the email is the thing
// staff actually recognise, so the email is the option text and the label is
// only ever a tooltip.

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';

export interface MdmEnrollAccount {
  /** The value to send as p_source_id. */
  source_id: number;
  login_email: string;
  /** Nickname — tooltip only, never a substitute for the email. */
  label: string | null;
  company_id: number;
  branch_id: number | null;
  owner_scope: 'COMPANY' | 'BRANCH';
  abm_tenant_id: number;
  /** e.g. "TRW (NNF-MDM-2)" — shown after the email. */
  abm_display_name: string;
  dep_name: string;
  /** Exactly one row carries this; it is the preselection. */
  is_default: boolean;
  abm_is_holding_default: boolean;
}

/**
 * Accounts the signed-in user may enroll with. The view already filters by
 * JWT scope (a branch account is invisible to other branches) and drops any
 * account without a usable org, so every row that comes back is selectable.
 */
export function useEnrollAccounts(enabled = true) {
  return useQuery({
    queryKey: ['mdm-enroll-accounts'],
    queryFn: () => apiClient.get<MdmEnrollAccount[]>('/v_mdm_enroll_accounts'),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** The row to preselect: the default if the view marked one, else the first. */
export function defaultAccountId(rows: MdmEnrollAccount[]): number | null {
  if (rows.length === 0) return null;
  return (rows.find(r => r.is_default) ?? rows[0]).source_id;
}
