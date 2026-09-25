import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Input, Switch, Select, Modal, useSnackbarContext,
} from 'tsp-form';
import { CheckCircle, XCircle, Save } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import type { CompanyConfig, EditableField } from './companyConfigTypes';
import type { CompanyFeatureCode } from '../../hooks/useCompanyFeatures';
import { translateApiError } from '../../lib/apiErrors';

// Two tabs, split by how a setting is saved: 'values' are typed numbers that
// share one Save button; 'instant' are the pickers/switches that write the
// moment they are touched.
type ConfigTab = 'values' | 'instant';
const TABS: ConfigTab[] = ['values', 'instant'];

// ── Detail panel ─────────────────────────────────────────────────────────────
// Rendered inside the settings page's right panel. The company comes in as a
// prop (the rail owns the selection); on mobile the panel is the whole screen
// and the page's own header carries the back button, so this renders fields only.

export function CompanyConfigDetail({ companyId, isMobile }: { companyId: number; isMobile: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [formValues, setFormValues] = useState<Record<string, number | boolean>>({});
  const [activeTab, setActiveTab] = useState<ConfigTab>('values');

  const { data: config, isLoading } = useQuery({
    queryKey: ['company-config-detail', companyId],
    queryFn: async () => {
      const rows = await apiClient.get<CompanyConfig[]>(`/v_company_config?company_id=eq.${companyId}`);
      return rows[0] ?? null;
    },
  });

  const fields: EditableField[] = [
    { key: 'draft_expiry_days', label: t('settings.config.draftExpiryDays'), type: 'number', group: 'contract' },
    { key: 'draft_expiry_warn_days', label: t('settings.config.draftExpiryWarnDays'), type: 'number', group: 'contract' },
    { key: 'grace_period_days', label: t('settings.config.gracePeriodDays'), type: 'number', group: 'contract' },
    { key: 'max_co_lessees', label: t('settings.config.maxCoLessees'), type: 'number', group: 'contract' },
    { key: 'deposit_max_days', label: t('settings.config.depositMaxDays'), type: 'number', group: 'contract' },
    { key: 'late_fee_per_day', label: t('settings.config.lateFeePerDay'), type: 'number', group: 'lateFee' },
    { key: 'late_fee_split_holding', label: t('settings.config.lateFeeSplitHolding'), type: 'number', group: 'lateFee' },
    { key: 'late_fee_split_company', label: t('settings.config.lateFeeSplitCompany'), type: 'number', group: 'lateFee' },
    { key: 'comm_min_active_days', label: t('settings.config.commMinActiveDays'), type: 'number', group: 'commission' },
    { key: 'comm_min_paid_installments', label: t('settings.config.commMinPaidInstallments'), type: 'number', group: 'commission' },
    { key: 'comm_require_no_overdue', label: t('settings.config.commRequireNoOverdue'), type: 'boolean', group: 'commission' },
    { key: 'pause_max_deferred', label: t('settings.config.pauseMaxDeferred'), type: 'number', group: 'pause' },
    { key: 'pause_enabled', label: t('settings.config.pauseEnabled'), type: 'boolean', group: 'pause' },
    { key: 'repo_fee_per_case', label: t('settings.config.repoFeePerCase'), type: 'number', group: 'legal' },
    { key: 'buyback_auto_reject_days', label: t('settings.config.buybackAutoRejectDays'), type: 'number', group: 'buyback', min: 1, max: 365 },
    // pay_pending_limit: 0 = pay only what's due, 99 = allow pay-ahead (mig 533). Fill policy.
    { key: 'pay_pending_limit', label: t('settings.config.payPendingLimit'), type: 'number', group: 'policy', min: 0, max: 99 },
    // repair_pickup_max_days: default pickup window for new repair orders (mig 671).
    { key: 'repair_pickup_max_days', label: t('settings.config.repairPickupMaxDays'), type: 'number', group: 'repair', min: 1, max: 365 },
    // icloud_device_cap: max devices bindable per Apple ID (Apple ceiling ~20).
    // BE enforces the same via CHECK; range check below rejects early.
    { key: 'icloud_device_cap', label: t('settings.config.icloudDeviceCap'), type: 'number', group: 'icloud', min: 1, max: 20 },
    // Ceiling on the discount a branch may ask for when a customer pays a FIN2
    // contract off early. 0 switches the discount off for the whole company;
    // the request still goes to a company admin for approval either way.
    {
      key: 'fin2_early_payoff_discount_max_pct',
      label: t('settings.config.fin2EarlyPayoffDiscountMaxPct'),
      type: 'number', group: 'payoff', min: 0, max: 100,
    },
  ];

  const groups = [
    { key: 'contract', label: t('settings.config.groupContract') },
    { key: 'lateFee', label: t('settings.config.groupLateFee') },
    { key: 'commission', label: t('settings.config.groupCommission') },
    { key: 'pause', label: t('settings.config.groupPause') },
    { key: 'legal', label: t('settings.config.groupLegal') },
    { key: 'buyback', label: t('settings.config.groupBuyback') },
    { key: 'policy', label: t('settings.config.groupPolicy') },
    { key: 'repair', label: t('settings.config.groupRepair') },
    { key: 'icloud', label: t('settings.config.groupIcloud') },
    { key: 'payoff', label: t('settings.config.groupPayoff') },
  ];

  // Initialize form when config loads
  useEffect(() => {
    if (config) {
      const vals: Record<string, number | boolean> = {};
      for (const f of fields) {
        vals[f.key] = config[f.key] as number | boolean;
      }
      setFormValues(vals);
      setErrorMessage('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.company_id, config?.updated_at]);

  const getValue = (key: string) => formValues[key];
  const setValue = (key: string, val: number | boolean) => setFormValues(prev => ({ ...prev, [key]: val }));

  const isDirty = useMemo(() => {
    if (!config) return false;
    return fields.some(f => formValues[f.key] !== (config[f.key] as number | boolean));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formValues, config]);

  const handleSave = async () => {
    if (!config || !user) return;
    setSaving(true);
    setErrorMessage('');

    // Client-side range check for fields that declare min/max (DB enforces the
    // same via CHECK, but reject early with a clear message).
    const outOfRange = fields.find(f => {
      if (f.type !== 'number') return false;
      const v = formValues[f.key] as number;
      return (f.min != null && v < f.min) || (f.max != null && v > f.max);
    });
    if (outOfRange) {
      setSaving(false);
      setErrorMessage(t('settings.config.outOfRange', {
        field: outOfRange.label,
        min: outOfRange.min,
        max: outOfRange.max,
        defaultValue: '{{field}} must be between {{min}} and {{max}}',
      }));
      return;
    }

    const changes: Record<string, number | boolean> = {};
    for (const f of fields) {
      const current = formValues[f.key];
      const original = config[f.key];
      if (current !== undefined && current !== original) {
        changes[f.key] = current;
      }
    }

    if (Object.keys(changes).length === 0) {
      setSaving(false);
      return;
    }

    const start = Date.now();
    try {
      await apiClient.rpc('fn_config_update', {
        p_company_id: config.company_id,
        p_changes: changes,
        p_updated_by: user.user_id,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span className="alert-description">{t('settings.config.saved')}</span>
          </div>
        ),
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['company-config-detail', companyId] });
      queryClient.invalidateQueries({ queryKey: ['company-config-list'] });
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setErrorMessage(translated || err.message);
      }
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!config) return;
    const vals: Record<string, number | boolean> = {};
    for (const f of fields) {
      vals[f.key] = config[f.key] as number | boolean;
    }
    setFormValues(vals);
    setErrorMessage('');
  };

  if (isLoading || !config) {
    return (
      <div className="flex-1 h-full flex items-center justify-center text-subtler">
        <div className="text-sm">
          {isLoading ? t('common.loading') : t('settings.config.empty')}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Panel header — the company being edited, fixed above the scrolling fields. */}
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <h2 className="text-sm font-semibold truncate">{config.company_name}</h2>
        </div>
      )}

      {/* Split by how a setting saves, not by topic: the numbers tab shares one
          Save button (so it owns the footer), the switches tab writes on touch
          (so it has no footer at all — a Save there would be a lie). */}
      <div className="flex-none border-b border-line">
        <div className="flex px-2">
          {TABS.map(tab => (
            <button
              key={tab}
              type="button"
              className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
                activeTab === tab
                  ? 'border-primary-fg text-primary-fg'
                  : 'border-transparent text-fg'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {t(`settings.config.tab_${tab}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto better-scroll px-4 py-3">
        <div className="max-w-2xl mx-auto">
          {activeTab === 'values' ? (
            <div className="flex flex-col">
              {groups.map((group, i) => {
                const groupFields = fields.filter(f => f.group === group.key);
                return (
                  <div key={group.key}>
                    {i > 0 && <hr className="border-line mt-0 mb-6" />}
                    <h4 className="text-sm font-semibold text-fg uppercase tracking-wider mb-3">{group.label}</h4>
                    <div className="form-grid md:grid-cols-2">
                      {groupFields.map(field => (
                        <div key={field.key} className="flex flex-col">
                          <label className="form-label">{field.label}</label>
                          {field.type === 'boolean' ? (
                            <Switch
                              checked={getValue(field.key) as boolean}
                              onChange={(e) => setValue(field.key, (e.target as HTMLInputElement).checked)}
                            />
                          ) : (
                            <Input
                              type="number"
                              className="w-full"
                              min={field.min}
                              max={field.max}
                              value={String(getValue(field.key) ?? '')}
                              onChange={(e) => setValue(field.key, Number(e.target.value))}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col">
              <p className="text-xs text-subtle mb-5">{t('settings.config.instantHint')}</p>
              <ContractTemplateSection companyId={config.company_id} />
              <hr className="border-line mt-6 mb-6" />
              <WalletFeaturesSection companyId={config.company_id} />
              <hr className="border-line mt-6 mb-6" />
              <ChargeOwnerSection companyId={config.company_id} />
            </div>
          )}
        </div>
      </div>

      {/* Footer — belongs to the numbers tab only; the switches save themselves. */}
      {activeTab === 'values' && (
        <div className="flex-none border-t border-line px-4 py-3">
          {errorMessage && (
            <div className="alert alert-danger mb-3">
              <XCircle size={16} />
              <div><div className="alert-description text-xs">{errorMessage}</div></div>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button onClick={handleReset} disabled={saving || !isDirty}>{t('common.cancel')}</Button>
            <Button color="primary" startIcon={<Save size={16} />} onClick={handleSave} disabled={saving || !isDirty}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Contract template (mig 1343) ───────────────────────────────────────────────
// Which master lease form this company's NEW contracts print as. The code is
// stamped onto a contract when it is created, so changing it here never touches
// a contract that already exists — including an unsigned draft left open. That
// is the whole reason this field carries a permanent hint AND a confirm step
// instead of riding the page's shared Save button.
function ContractTemplateSection({ companyId }: { companyId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  const { data: templates = [] } = useQuery({
    queryKey: ['contract-templates'],
    queryFn: () => apiClient.get<ContractTemplateRow[]>('/v_contract_templates?order=sort_order'),
  });

  const { data: current = null, isLoading } = useQuery({
    queryKey: ['company-contract-template', companyId],
    queryFn: async () => {
      const rows = await apiClient.get<{ contract_template_code: string | null }[]>(
        `/v_company_config?company_id=eq.${companyId}&select=contract_template_code`,
      );
      return rows[0]?.contract_template_code ?? null;
    },
  });

  const options = templates.map(row => ({
    value: row.code,
    label: t(`settings.config.template_${row.code}`, { defaultValue: row.code }),
  }));

  const labelFor = (code: string) =>
    t(`settings.config.template_${code}`, { defaultValue: code });

  const confirmSave = async () => {
    if (!pendingCode) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_config_update', {
        p_company_id: companyId,
        p_changes: { contract_template_code: pendingCode },
      });
      await queryClient.invalidateQueries({ queryKey: ['company-contract-template', companyId] });
      queryClient.invalidateQueries({ queryKey: ['company-config-detail', companyId] });
      setPendingCode(null);
      addSnackbar({
        message: (
          <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.config.saved')}</span></div>
        ),
        type: 'success',
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(translateApiError(err, t) || err.message);
      }
      setPendingCode(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h4 className="text-sm font-semibold text-fg uppercase tracking-wider mb-1">{t('settings.config.groupContractTemplate')}</h4>
      <p className="text-xs text-subtle mb-3">{t('settings.config.contractTemplateHint')}</p>
      {error && (
        <div className="alert alert-danger mb-3"><XCircle size={16} /><div><div className="alert-description text-xs">{error}</div></div></div>
      )}
      <div className="max-w-sm">
        <Select
          options={options}
          value={current}
          onChange={(val) => {
            const next = val as string | null;
            if (!next || next === current) return;
            setError('');
            setPendingCode(next);
          }}
          disabled={isLoading || saving}
          placeholder={t('settings.config.contractTemplatePlaceholder')}
          searchable={false}
        />
      </div>

      {/* Confirm before switching — the change only reaches contracts opened after it. */}
      <Modal
        open={!!pendingCode}
        onClose={() => setPendingCode(null)}
        maxWidth="26rem"
        width="100%"
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('settings.config.contractTemplateConfirmTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={() => setPendingCode(null)}>&times;</button>
        </div>
        <div className="modal-content">
          <p className="text-sm">
            {t('settings.config.contractTemplateConfirmBody', { template: pendingCode ? labelFor(pendingCode) : '' })}
          </p>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setPendingCode(null)} disabled={saving}>{t('common.cancel')}</Button>
          <Button color="primary" onClick={confirmSave} disabled={saving}>
            {saving ? t('common.saving') : t('common.confirm')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

interface ContractTemplateRow {
  code: string;
  sort_order: number;
}

// ── Wallet features (SAVING / CREDIT / INSURANCE) ──────────────────────────────
// Each toggle writes immediately via fn_company_feature_set (no shared save
// button — one RPC per flip, like a settings switch). Default-safe: a company
// with no rows reads all-enabled from the view.
function WalletFeaturesSection({ companyId }: { companyId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['company-features', companyId],
    queryFn: () => apiClient.get<CompanyFeatureRow[]>(`/v_company_features?company_id=eq.${companyId}`),
  });

  const setFeature = async (code: string, enabled: boolean) => {
    setPending(code);
    setError('');
    try {
      await apiClient.rpc('fn_company_feature_set', {
        p_company_id: companyId,
        p_feature_code: code,
        p_enabled: enabled,
      });
      await queryClient.invalidateQueries({ queryKey: ['company-features', companyId] });
      addSnackbar({
        message: (
          <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.config.saved')}</span></div>
        ),
        type: 'success',
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(translateApiError(err, t) || err.message);
      }
    } finally {
      setPending(null);
    }
  };

  const order: CompanyFeatureCode[] = ['SAVING', 'CREDIT', 'INSURANCE'];
  const byCode = (c: string) => rows.find(r => r.feature_code === c);

  return (
    <div>
      <h4 className="text-sm font-semibold text-fg uppercase tracking-wider mb-1">{t('settings.config.groupWallet')}</h4>
      <p className="text-xs text-subtle mb-3">{t('settings.config.walletHint')}</p>
      {error && (
        <div className="alert alert-danger mb-3"><XCircle size={16} /><div><div className="alert-description text-xs">{error}</div></div></div>
      )}
      <div className="form-grid md:grid-cols-3">
        {order.map(code => {
          const row = byCode(code);
          const enabled = row ? row.is_enabled : true;
          return (
            <div key={code} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border border-line">
              <span className="text-sm">{t(`settings.config.feature_${code}`)}</span>
              <Switch
                size="sm"
                checked={enabled}
                disabled={isLoading || pending === code}
                onChange={(e) => setFeature(code, (e.target as HTMLInputElement).checked)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Bill-line owner override ───────────────────────────────────────────────────
// One boolean (mig 546): override_owner_to_holding. On = force every bill line of
// the company to HOLDING; off (default) = each line keeps its natural owner, like
// TPA. Toggling off IS the "back to default" — there's no stored COMPANY state.
function ChargeOwnerSection({ companyId }: { companyId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: override = false, isLoading } = useQuery({
    queryKey: ['company-owner-override', companyId],
    queryFn: async () => {
      const rows = await apiClient.get<{ override_owner_to_holding: boolean }[]>(
        `/v_company_config?company_id=eq.${companyId}&select=override_owner_to_holding`,
      );
      return rows[0]?.override_owner_to_holding ?? false;
    },
  });

  const setOverride = async (next: boolean) => {
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_company_set_owner_override', {
        p_company_id: companyId,
        p_override: next,
      });
      await queryClient.invalidateQueries({ queryKey: ['company-owner-override', companyId] });
      addSnackbar({
        message: (
          <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.config.saved')}</span></div>
        ),
        type: 'success',
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(translateApiError(err, t) || err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-6">
      <h4 className="text-sm font-semibold text-fg uppercase tracking-wider mb-1">{t('settings.config.groupOwner')}</h4>
      <p className="text-xs text-subtle mb-3">{t('settings.config.ownerHint')}</p>
      {error && (
        <div className="alert alert-danger mb-3"><XCircle size={16} /><div><div className="alert-description text-xs">{error}</div></div></div>
      )}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border border-line">
        <span className="text-sm">{t('settings.config.ownerAllHolding')}</span>
        <Switch
          size="sm"
          checked={override}
          disabled={isLoading || saving}
          onChange={(e) => setOverride((e.target as HTMLInputElement).checked)}
        />
      </div>
    </div>
  );
}

interface CompanyFeatureRow {
  company_id: number;
  company_code: string;
  feature_code: CompanyFeatureCode;
  feature_name_th: string;
  is_enabled: boolean;
}
