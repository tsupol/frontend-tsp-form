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
//
// Filtering + paging: the model view carries no company/type columns, so the
// company and branch-type filters come from v_branches, joined in by branch id.
// Branch types are read from the ref view via useCompanyTypes (UI_SUMMARY 142:
// never hardcode DEAL_PARTNER / INTERNAL) — deal-partner shops keep growing, so
// isolating them is the filter that earns its place.

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Switch, MobileHeader, Button, MaskedInput, Select, Badge, Tooltip,
  DataTableFooter, useSnackbarContext,
} from 'tsp-form';
import { ArrowRightFromLine, Wallet, CheckCircle, XCircle, ChevronsRight, Percent } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { useAuth } from '../../contexts/AuthContext';
import { useCompanyTypes } from '../../hooks/useCompanyTypes';
import { SearchInput } from '../../components/SearchInput';
import { FilterBar } from '../../components/FilterBar';

interface BranchModelRow {
  branch_id: number;
  branch_code: string;
  branch_name: string;
  commercial_model: 'FIN1' | 'FIN2' | string;
  commercial_model_label: string;
  is_active: boolean;
}

interface BranchMeta {
  id: number;
  company_id: number;
  branch_type: string;
  is_active: boolean;
}

interface Company {
  id: number;
  name: string;
}

interface BranchGroup {
  branch_id: number;
  branch_name: string;
  branch_code: string;
  company_id: number | null;
  branch_type: string;
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

const BRANCH_TYPE_COLORS: Record<string, 'info' | 'warning' | 'secondary'> =
  { INTERNAL: 'info', EXTERNAL: 'warning', DEAL_PARTNER: 'secondary' };

/**
 * The FIN1 down-payment range for one branch. Only rendered while FIN1 is on.
 *
 * Two numbers, so this is an inline editor rather than a modal — Save appears
 * only once something actually changed, which keeps the row quiet in its
 * normal read-only state and means there is no dirty-form to guard on close.
 *
 * Laid out as a horizontal strip that sits beside the FIN1 switch: the page has
 * plenty of width and every vertical line here costs a branch on screen. The
 * holding-band hint is a tooltip on the label rather than its own line, and the
 * two validation messages share one line under the inputs.
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
    <div className="w-24 shrink-0">
      <MaskedInput
        mask="number"
        decimalScale={0}
        size="sm"
        value={value}
        onChange={(raw) => setValue(raw)}
        error={invalid && filled}
        suffix="%"
        aria-label={label}
        endIcon={<ChevronsRight size={14} />}
        onEndIconClick={() => setValue(String(fallback))}
      />
    </div>
  );

  const errorText = maxBelowMin
    ? t('financeModels.downMaxBelowMin')
    : outOfBand
      ? t('financeModels.downOutOfBand', { min: config.holding_min_down, max: config.holding_max_down })
      : null;

  return (
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      <Tooltip
        content={t('financeModels.downRangeHint', {
          min: config.holding_min_down,
          max: config.holding_max_down,
        })}
      >
        <span className="text-xs text-subtle flex items-center gap-1 shrink-0 cursor-default">
          <Percent size={12} />{t('financeModels.downRange')}
        </span>
      </Tooltip>

      {field(t('financeModels.downMin'), min, setMin, config.branch_min_down_default)}
      <span className="text-xs text-subtler shrink-0">–</span>
      {field(t('financeModels.downMax'), max, setMax, config.branch_max_down_default)}

      {dirty && (
        <Button size="sm" color="primary" disabled={invalid || isSaving} onClick={save}>
          {isSaving ? t('pricing.saving') : t('common.save')}
        </Button>
      )}

      {errorText && (
        <span className="text-xs text-danger-fg min-w-0">{errorText}</span>
      )}
      {!dirty && !errorText && isDefault && (
        <span className="text-xs text-subtler min-w-0">{t('financeModels.downResetDefault')}</span>
      )}
    </div>
  );
}

export function BranchFinanceModelsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();
  const isHoldingLevel = ['HOLDING_ADMIN', 'SYSTEM_DEV'].includes(user?.role_code ?? '');
  const [pending, setPending] = useState<Set<string>>(new Set());

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterType, setFilterType] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['branch-commercial-models-all'],
    queryFn: () => apiClient.get<BranchModelRow[]>(
      '/v_branch_commercial_models?order=branch_name,commercial_model',
    ),
  });

  // Company + branch type for the filters — the model view carries neither.
  const { data: branchMeta = [] } = useQuery({
    queryKey: ['finance-models-branch-meta'],
    queryFn: () => apiClient.get<BranchMeta[]>(
      '/v_branches?select=id,company_id,branch_type,is_active',
    ),
  });
  const metaByBranch = useMemo(
    () => new Map(branchMeta.map(b => [b.id, b])),
    [branchMeta],
  );

  const { data: companies = [] } = useQuery({
    queryKey: ['finance-models-companies'],
    queryFn: () => apiClient.get<Company[]>('/v_companies?order=name&select=id,name'),
  });

  // Branch-type options come from the ref view, never a hardcoded list (142).
  const { types: companyTypes } = useCompanyTypes();
  const allBranchTypes = useMemo(() => {
    const seen: string[] = [];
    for (const ct of companyTypes) {
      for (const bt of ct.allowed_branch_types) if (!seen.includes(bt)) seen.push(bt);
    }
    return seen;
  }, [companyTypes]);

  // One fetch for every branch's FIN1 range, rather than one per card. Rows
  // only exist for branches that have had FIN1 enabled at some point.
  const { data: fin1Configs = [] } = useQuery({
    queryKey: ['fin1-branch-configs'],
    queryFn: () => apiClient.get<Fin1BranchConfig[]>('/v_fin1_branch_configs'),
  });
  const fin1ConfigByBranch = new Map(fin1Configs.map(c => [c.branch_id, c]));

  // Collapse the row-per-model view into one card per branch.
  const groups: BranchGroup[] = useMemo(() => {
    const map = new Map<number, BranchGroup>();
    for (const r of rows) {
      let g = map.get(r.branch_id);
      if (!g) {
        const meta = metaByBranch.get(r.branch_id);
        g = {
          branch_id: r.branch_id,
          branch_name: r.branch_name,
          branch_code: r.branch_code,
          company_id: meta?.company_id ?? null,
          branch_type: meta?.branch_type ?? '',
          fin1: false,
          fin2: false,
        };
        map.set(r.branch_id, g);
      }
      if (r.commercial_model === 'FIN1') g.fin1 = r.is_active;
      if (r.commercial_model === 'FIN2') g.fin2 = r.is_active;
    }
    return [...map.values()];
  }, [rows, metaByBranch]);

  const filtered = useMemo(() => {
    let result = groups;
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      result = result.filter(g =>
        g.branch_name.toLowerCase().includes(term) ||
        g.branch_code.toLowerCase().includes(term)
      );
    }
    if (filterCompany) {
      result = result.filter(g => g.company_id === Number(filterCompany));
    }
    if (filterType) {
      result = result.filter(g => g.branch_type === filterType);
    }
    return result;
  }, [groups, search, filterCompany, filterType]);

  const totalCount = filtered.length;
  const paginated = filtered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  // Any filter change can shorten the list past the current page.
  useEffect(() => { setPageIndex(0); }, [search, filterCompany, filterType]);

  const activeFilterCount = (filterCompany ? 1 : 0) + (filterType ? 1 : 0);

  const showCompanyFilter = isHoldingLevel && companies.length > 1;

  const companySelect = (
    <Select
      options={companies.map(c => ({ value: String(c.id), label: c.name }))}
      value={filterCompany || null}
      onChange={(val) => setFilterCompany((val as string) ?? '')}
      placeholder={t('branches.allCompanies')}
      size="sm"
      showChevron
      clearable
      searchable={false}
    />
  );

  const typeSelect = (
    <Select
      options={allBranchTypes.map(bt => ({
        value: bt,
        label: t(`org.branchType.${bt}`, { defaultValue: bt }),
      }))}
      value={filterType || null}
      onChange={(val) => setFilterType((val as string) ?? '')}
      placeholder={t('branches.allTypes')}
      size="sm"
      showChevron
      clearable
      searchable={false}
    />
  );

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

        {/* Filters — the bar measures its own container, so the company and
            type Selects drop into the popover as the side menu opens. */}
        <FilterBar
          className="flex-none pb-4"
          leading={
            <SearchInput
              value={searchInput}
              onChange={setSearchInput}
              onDebouncedChange={setSearch}
              placeholder={t('financeModels.searchPlaceholder')}
              size="sm"
              className="w-full"
            />
          }
          leadingMinWidth={200}
          leadingMaxWidth={320}
          items={[
            ...(showCompanyFilter
              ? [{ key: 'company', width: 200, node: companySelect, priority: 40 }]
              : []),
            { key: 'type', width: 176, node: typeSelect, priority: 50 },
          ]}
          activeCount={activeFilterCount}
        />

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {isLoading ? (
              <div className="p-8 text-center text-subtle">{t('common.loading')}</div>
            ) : paginated.length === 0 ? (
              <div className="p-8 text-center text-subtle">{t('common.noData')}</div>
            ) : (
              // One row per branch. The page is wide, so the branch, both
              // switches and the FIN1 range sit side by side rather than
              // stacking — each stacked line cost a branch on screen. The model
              // descriptions and the always-on PRICEBOOK line moved into
              // tooltips: they repeat identically on every row, so they were
              // paying vertical space to say the same three things again.
              <div className="flex flex-col divide-y divide-line border-b border-line">
                {paginated.map(g => {
                  const fin1Config = fin1ConfigByBranch.get(g.branch_id);
                  return (
                    <div
                      key={g.branch_id}
                      className="flex items-center gap-x-4 gap-y-2 flex-wrap px-3 py-2"
                    >
                      {/* Branch identity — takes the slack so the switches line up. */}
                      <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1 basis-56">
                        <span className="font-medium text-sm truncate">{g.branch_name}</span>
                        <span className="text-[11px] text-subtle font-mono shrink-0">{g.branch_code}</span>
                        {g.branch_type && (
                          <Badge size="sm" color={BRANCH_TYPE_COLORS[g.branch_type] ?? 'default'}>
                            {t(`org.branchType.${g.branch_type}`, { defaultValue: g.branch_type })}
                          </Badge>
                        )}
                        <Tooltip content={t('financeModels.pricebookAlwaysOn')}>
                          <span className="text-[11px] text-subtler shrink-0 cursor-default">
                            PRICEBOOK
                          </span>
                        </Tooltip>
                      </div>

                      {/* The two switches, fixed width so they align down the list. */}
                      <div className="flex items-center gap-4 shrink-0">
                        {MODELS.map(model => {
                          const on = model === 'FIN1' ? g.fin1 : g.fin2;
                          const k = keyOf(g.branch_id, model);
                          return (
                            <Tooltip key={model} content={t(`financeModels.desc_${model}`)}>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <span className="text-xs font-medium">{model}</span>
                                <Switch
                                  size="sm"
                                  checked={on}
                                  disabled={pending.has(k)}
                                  onChange={(e) => toggle(g.branch_id, model, e.target.checked)}
                                />
                              </label>
                            </Tooltip>
                          );
                        })}
                      </div>

                      {/* The range column keeps its width even when FIN1 is off,
                          so the switches above sit in one straight column
                          instead of sliding right on every FIN1-off row. Down
                          range belongs to FIN1 and only means anything while it
                          is on (§7), so the slot is simply empty otherwise. */}
                      <div className="shrink-0 w-[27rem] max-w-full">
                        {g.fin1 && (
                          fin1Config
                            ? <DownRangeEditor
                                config={fin1Config}
                                onSaved={() => queryClient.invalidateQueries({ queryKey: ['fin1-branch-configs'] })}
                              />
                            : <span className="text-xs text-subtle">{t('financeModels.downLoading')}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {totalCount > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(totalCount / pageSize)}
              onPageChange={(p) => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[15, 25, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
              controlSize="sm"
            />
          )}
        </div>
      </div>
    </>
  );
}
