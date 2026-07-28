// Data hook for the 4 Dunning Config tabs. Wraps the per-module list RPC and
// exposes mutations for set + reset. Same hook works for all 4 modules — the
// caller passes the module key and the hook resolves RPC names from
// MODULE_CONFIG.
//
// All RPCs are scoped to the caller's holding via JWT; we still pass
// p_holding_id explicitly because the BE requires it.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  MODULE_CONFIG,
  type DunningModule,
  type DunningStagesResponse,
  type DunningStageRow,
} from './dunningTypes';

const STALE_MS = 60_000;

export function useDunningStages(module: DunningModule) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const holdingId = user?.holding_id ?? null;
  const cfg = MODULE_CONFIG[module];

  const listQuery = useQuery({
    queryKey: ['dunning-stages', module, holdingId],
    queryFn: () => apiClient.rpc<DunningStagesResponse>(cfg.rpc.list, {
      p_holding_id: holdingId,
    }),
    enabled: holdingId != null,
    staleTime: STALE_MS,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['dunning-stages', module, holdingId] });
  };

  // _set body shape:
  //   { p_holding_id, p_stage, p_day_from?, p_day_to?, p_priority?, p_active?,
  //     p_<extraField>? }
  // Caller passes only the fields they're changing; null means no-touch on
  // numeric fields, but the BE uses COALESCE so omitting is the cleaner signal.
  interface SetVars {
    stage: string;
    day_from?: number;
    day_to?: number | null;
    priority?: number;
    active?: boolean;
    /** Module-specific extra (reason_code / action_code) */
    extra?: string;
  }

  const setMutation = useMutation({
    mutationFn: (vars: SetVars) => {
      const body: Record<string, unknown> = {
        p_holding_id: holdingId,
        p_stage: vars.stage,
      };
      if (vars.day_from !== undefined) body.p_day_from = vars.day_from;
      if (vars.day_to   !== undefined) body.p_day_to   = vars.day_to;
      if (vars.priority !== undefined) body.p_priority = vars.priority;
      if (vars.active   !== undefined) body.p_active   = vars.active;
      if (cfg.extraField && vars.extra !== undefined) {
        body[`p_${cfg.extraField}`] = vars.extra;
      }
      return apiClient.rpc<unknown>(cfg.rpc.set, body);
    },
    onSuccess: invalidate,
  });

  const resetMutation = useMutation({
    mutationFn: (stage: string) => apiClient.rpc<unknown>(cfg.rpc.reset, {
      p_holding_id: holdingId,
      p_stage: stage,
    }),
    onSuccess: invalidate,
  });

  const rows: DunningStageRow[] = listQuery.data?.stages ?? [];

  return {
    rows,
    isLoading: listQuery.isLoading,
    error: listQuery.error,
    config: cfg,
    save: setMutation,
    reset: resetMutation,
  };
}
