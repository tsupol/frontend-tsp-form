// Company-admin: enable/disable FIN1 (fixed interest) and FIN2 (fixed profit)
// per branch. PRICEBOOK (retail) is always available and not configurable here.
//
// Backend (UI_FEEDBACK 2026-06-28 GUIDE):
//   GET  api.v_branch_commercial_models?branch_id=eq.{b}  → one row per branch×model
//   POST /rpc/fn_branch_commercial_model_set { p_branch_id, p_commercial_model, p_is_active }
//        company-admin only (perm BRANCH.UPDATE). Re-fetch the view after a save.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch, MobileHeader, useSnackbarContext } from 'tsp-form';
import { ArrowRightFromLine, Wallet, CheckCircle, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';

interface BranchModelRow {
  branch_id: number;
  branch_code: string;
  branch_name: string;
  commercial_model: 'FIN1' | 'FIN2' | string;
  commercial_model_label: string;
  is_active: boolean;
}

interface BranchGroup {
  branch_id: number;
  branch_name: string;
  branch_code: string;
  fin1: boolean;
  fin2: boolean;
}

const MODELS: ('FIN1' | 'FIN2')[] = ['FIN1', 'FIN2'];

export function BranchFinanceModelsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [pending, setPending] = useState<Set<string>>(new Set());

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['branch-commercial-models-all'],
    queryFn: () => apiClient.get<BranchModelRow[]>(
      '/v_branch_commercial_models?order=branch_name,commercial_model',
    ),
  });

  // Collapse the row-per-model view into one card per branch.
  const groups: BranchGroup[] = (() => {
    const map = new Map<number, BranchGroup>();
    for (const r of rows) {
      let g = map.get(r.branch_id);
      if (!g) {
        g = { branch_id: r.branch_id, branch_name: r.branch_name, branch_code: r.branch_code, fin1: false, fin2: false };
        map.set(r.branch_id, g);
      }
      if (r.commercial_model === 'FIN1') g.fin1 = r.is_active;
      if (r.commercial_model === 'FIN2') g.fin2 = r.is_active;
    }
    return [...map.values()];
  })();

  const keyOf = (branchId: number, model: string) => `${branchId}:${model}`;

  const toggle = async (branchId: number, model: 'FIN1' | 'FIN2', next: boolean) => {
    const k = keyOf(branchId, model);
    setPending(prev => new Set(prev).add(k));
    try {
      await apiClient.rpc('fn_branch_commercial_model_set', {
        p_branch_id: branchId,
        p_commercial_model: model,
        p_is_active: next,
      });
      await queryClient.invalidateQueries({ queryKey: ['branch-commercial-models-all'] });
      // Pricing / wizard read these — refresh so show/hide reflects immediately.
      queryClient.invalidateQueries({ queryKey: ['branch-commercial-models'] });
      queryClient.invalidateQueries({ queryKey: ['my-branch-commercial-models'] });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('financeModels.saved')}</span>
          </div>
        ),
      });
    } catch (err) {
      let msg = t('common.error');
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        msg = translated || err.message;
      }
      addSnackbar({
        message: (
          <div className="alert alert-danger">
            <XCircle size={16} />
            <span>{msg}</span>
          </div>
        ),
      });
    } finally {
      setPending(prev => { const n = new Set(prev); n.delete(k); return n; });
    }
  };

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('financeModels.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="mb-4 flex-none max-md:hidden">
          <h1 className="heading-2 flex items-center gap-2"><Wallet size={20} /> {t('financeModels.title')}</h1>
          <p className="text-sm text-subtle mt-1">{t('financeModels.description')}</p>
        </div>

        <div className="flex-1 overflow-auto better-scroll pb-8">
          {isLoading ? (
            <div className="p-8 text-center text-subtle">{t('common.loading')}</div>
          ) : groups.length === 0 ? (
            <div className="p-8 text-center text-subtle">{t('common.noData')}</div>
          ) : (
            <div className="flex flex-col gap-3 max-w-2xl">
              {groups.map(g => (
                <div key={g.branch_id} className="border border-line rounded-md px-4 py-3">
                  <div className="font-semibold text-sm mb-3">
                    {g.branch_name}
                    <span className="text-xs font-normal text-subtle ml-2 font-mono">{g.branch_code}</span>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {MODELS.map(model => {
                      const on = model === 'FIN1' ? g.fin1 : g.fin2;
                      const k = keyOf(g.branch_id, model);
                      return (
                        <div key={model} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{model}</div>
                            <div className="text-xs text-subtle">{t(`financeModels.desc_${model}`)}</div>
                          </div>
                          <Switch
                            size="sm"
                            checked={on}
                            disabled={pending.has(k)}
                            onChange={(e) => toggle(g.branch_id, model, e.target.checked)}
                          />
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between gap-3 opacity-60">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">PRICEBOOK</div>
                        <div className="text-xs text-subtle">{t('financeModels.desc_PRICEBOOK')}</div>
                      </div>
                      <span className="text-xs text-subtle">{t('financeModels.alwaysOn')}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
