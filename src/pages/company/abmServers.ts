// ABM organisations this holding may use — the dropdown feed for binding an
// OTP account to an org, and for the holding-wide default switch.
// Spec: UI_FEEDBACK/2026-09-11_IMPLEMENT_mdm_abm_account_and_enroll_email_picker.md.
//
// Naming trap the ticket calls out (§3): the SAME value is spelled three ways
// across three views — `display_name` here, `abm_tenant_name` on
// v_abm_otp_sources, `abm_display_name` on v_mdm_enroll_accounts. Render
// whichever the view gave you; never reconstruct it from dep_name.

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

export interface AbmServer {
  abm_tenant_id: number;
  /** e.g. "RICH (NNF-MDM-1)" — already display-ready. */
  display_name: string;
  dep_name: string;
  lifecycle_status: string;
  /** The holding's current fallback org. Preselect this when creating. */
  is_default: boolean;
}

export function useAbmServers(enabled = true) {
  return useQuery({
    queryKey: ['abm-servers'],
    queryFn: () => apiClient.get<AbmServer[]>('/v_mdm_prepare_abm_servers'),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
