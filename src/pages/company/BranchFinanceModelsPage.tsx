// Company-admin: enable/disable FIN1 (fixed interest) and FIN2 (fixed profit)
// per branch. PRICEBOOK (retail) is always available and not configurable here.
//
// Backend (UI_FEEDBACK 2026-06-28 GUIDE):
//   GET  api.v_branch_commercial_models?branch_id=eq.{b}  → one row per branch×model
//   POST /rpc/fn_branch_commercial_model_set { p_branch_id, p_commercial_model, p_is_active }
//        company-admin only (perm BRANCH.UPDATE). Re-fetch the view after a save.
//
// FIN1 down-payment range (2026-09-07 DELIVERY_config_system §7, mig 1173):
// there is no separate "branch FIN1 settings" page — the range lives HERE,
// next to the switch that turns FIN1 on, because it is meaningless without it.
// The row is created by the DB the moment FIN1 is enabled, so the fields appear
// on toggle-on and disappear on toggle-off.
//   GET  api.v_fin1_branch_configs        → min/max + the holding band to stay inside
//   POST /rpc/fn_fin1_branch_config_set { p_branch_id, p_min_down_percent?, p_max_down_percent? }
// Permission is the SAME as the FIN1 switch itself (BRANCH.UPDATE on that
// branch) — no separate grant, so anyone who can flip FIN1 can set its range.

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch, MobileHeader, Button, MaskedInput, useSnackbarContext } from 'tsp-form';
import { ArrowRightFromLine, Wallet, CheckCircle, XCircle, ChevronsRight, Percent } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';

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

interface Fin1BranchConfig {
  branch_id: number;
  fin1_active: boolean;
  min_down_percent: number;
  max_down_percent: number;
  holding_min_down: number;
  holding_max_down: number;
  branch_min_down_default: number;
  branch_max_down_default: number;
}

const MODELS: ('FIN1' | 'FIN2')[] = ['FIN1', 'FIN2'];

/**
 * The FIN1 down-payment range for one branch. Only rendered while FIN1 is on.
 *
 * Two numbers, so this is an inline editor rather than a modal — Save appears
 * only once something actually changed, which keeps the card quiet in its
 * normal read-only state and means there is no dirty-form to guard on close.
 */
function DownRangeEditor({ config, onSaved }: {
  config: Fin1BranchConfig;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [min, setMin] = useState(String(config.min_down_percent));
  const [max, setMax] = useState(String(config.max_down_percent));
  const [isSaving, setIsSaving] = useState(false);

  // Re-seed when the saved row changes (our own save, or another admin's).
  useEffect(() => {
    setMin(String(config.min_down_percent));
    setMax(String(config.max_down_percent));
  }, [config.min_down_percent, config.max_down_percent]);

  const vMin = parseFloat(min);
  const vMax = parseFloat(max);
  const filled = !Number.isNaN(vMin) && !Number.isNaN(vMax);
  const maxBelowMin = filled && vMax < vMin;
  const outOfBand = filled && !maxBelowMin
    && (vMin < config.holding_min_down || vMax > config.holding_max_down);
  const invalid = !filled || maxBelowMin || outOfBand;

  const dirty = filled
    && (vMin !== config.min_down_percent || vMax !== config.max_down_percent);
  const isDefault = filled
    && vMin === config.branch_min_down_default && vMax === config.branch_max_down_default;

  const save = async () => {
    setIsSaving(true);
    try {
      await apiClient.rpc('fn_fin1_branch_config_set', {
        p_branch_id: config.branch_id,
        p_min_down_percent: vMin,
        p_max_down_percent: vMax,
      });
      onSaved();
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('financeModels.downSaved')}</span>
          </div>
        ),
      });
    } catch (err) {
      let msg = t('common.error');
      if (err instanceof ApiError) msg = translateApiError(err, t) || err.message;
      addSnackbar({
        message: (
          <div className="alert alert-danger">
            <XCircle size={16} />
            <span>{msg}</span>
          </div>
        ),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const field = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    fallback: number,
  ) => (
    <div className="flex flex-col min-w-0">
      <label className="form-label">{label}</label>
      <MaskedInput
        mask="number"
        decimalScale={0}
        size="sm"
        value={value}
        onChange={(raw) => setValue(raw)}
        error={invalid && filled}
        suffix="%"
        endIcon={<ChevronsRight size={14} />}
        onEndIconClick={() => setValue(String(fallback))}
      />
    </div>
  );

  return (
    <div className="mt-1 pt-3 border-t border-line-subtle">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="text-sm font-medium flex items-center gap-1">
            <Percent size={13} />{t('financeModels.downRange')}
          </div>
          <div className="text-xs text-subtle">
            {t('financeModels.downRangeHint', {
              min: config.holding_min_down,
              max: config.holding_max_down,
            })}
          </div>
        </div>
        {dirty && (
          <Button size="sm" color="primary" disabled={invalid || isSaving} onClick={save}>
            {isSaving ? t('pricing.saving') : t('common.save')}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 max-w-sm">
        {field(t('financeModels.downMin'), min, setMin, config.branch_min_down_default)}
        {field(t('financeModels.downMax'), max, setMax, config.branch_max_down_default)}
      </div>

      {maxBelowMin && (
        <p className="text-xs text-danger-fg mt-1.5">{t('financeModels.downMaxBelowMin')}</p>
      )}
      {outOfBand && (
        <p className="text-xs text-danger-fg mt-1.5">
          {t('financeModels.downOutOfBand', {
            min: config.holding_min_down,
            max: config.holding_max_down,
          })}
        </p>
      )}
      {!dirty && isDefault && (
        <p className="text-xs text-subtle mt-1.5">{t('financeModels.downResetDefault')}</p>
      )}
    </div>
  );
}

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

  // One fetch for every branch's FIN1 range, rather than one per card. Rows
  // only exist for branches that have had FIN1 enabled at some point.
  const { data: fin1Configs = [] } = useQuery({
    queryKey: ['fin1-branch-configs'],
    queryFn: () => apiClient.get<Fin1BranchConfig[]>('/v_fin1_branch_configs'),
  });
  const fin1ConfigByBranch = new Map(fin1Configs.map(c => [c.branch_id, c]));

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
      // Enabling FIN1 makes the DB create the branch's down-range row, so the
      // editor below has something to show the moment the switch lands.
      if (model === 'FIN1') {
        await queryClient.invalidateQueries({ queryKey: ['fin1-branch-configs'] });
      }
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
        const translated = translateApiError(err, t);
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
                      const fin1Config = model === 'FIN1' ? fin1ConfigByBranch.get(g.branch_id) : undefined;
                      return (
                        <div key={model} className="flex flex-col">
                          <div className="flex items-center justify-between gap-3">
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
                          {/* Down range belongs to FIN1 and only means anything
                              while it is on (§7). */}
                          {model === 'FIN1' && on && (
                            fin1Config
                              ? <DownRangeEditor
                                  config={fin1Config}
                                  onSaved={() => queryClient.invalidateQueries({ queryKey: ['fin1-branch-configs'] })}
                                />
                              : <div className="mt-1 pt-3 border-t border-line-subtle text-xs text-subtle">
                                  {t('financeModels.downLoading')}
                                </div>
                          )}
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
