import { useState, useEffect, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Input, Switch, Select, Modal, useSnackbarContext, FormErrorMessage,
} from 'tsp-form';
import { CheckCircle, XCircle, Save } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { PhoneInput } from '../../components/PhoneInput';
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

export function CompanyConfigDetail({ companyId, isMobile, isDirtyRef }: {
  companyId: number;
  isMobile: boolean;
  /** The page's unsaved-changes guard reads this — see .claude/nav-guard-pattern.md. */
  isDirtyRef?: MutableRefObject<boolean>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [formValues, setFormValues] = useState<Record<string, number | boolean>>({});
  const [activeTab, setActiveTab] = useState<ConfigTab>('values');
  // Unsaved edits in the document-info section, which owns its own Save button.
  const [docDirty, setDocDirty] = useState(false);
  // Changes held back while the user confirms setting app removal to 0.
  const [confirmZero, setConfirmZero] = useState<Record<string, number | boolean> | null>(null);

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
    { key: 'late_fee_per_day', label: t('settings.config.lateFeePerDay'), type: 'number', group: 'money' },
    { key: 'late_fee_split_holding', label: t('settings.config.lateFeeSplitHolding'), type: 'number', group: 'money' },
    { key: 'late_fee_split_company', label: t('settings.config.lateFeeSplitCompany'), type: 'number', group: 'money' },
    { key: 'comm_min_active_days', label: t('settings.config.commMinActiveDays'), type: 'number', group: 'commission' },
    { key: 'comm_min_paid_installments', label: t('settings.config.commMinPaidInstallments'), type: 'number', group: 'commission' },
    { key: 'comm_require_no_overdue', label: t('settings.config.commRequireNoOverdue'), type: 'boolean', group: 'commission' },
    { key: 'pause_max_deferred', label: t('settings.config.pauseMaxDeferred'), type: 'number', group: 'contract' },
    { key: 'pause_enabled', label: t('settings.config.pauseEnabled'), type: 'boolean', group: 'contract' },
    { key: 'repo_fee_per_case', label: t('settings.config.repoFeePerCase'), type: 'number', group: 'money' },
    { key: 'buyback_auto_reject_days', label: t('settings.config.buybackAutoRejectDays'), type: 'number', group: 'device', min: 1, max: 365 },
    // pay_pending_limit: 0 = pay only what's due, 99 = allow pay-ahead (mig 533). Fill policy.
    {
      key: 'pay_pending_limit', label: t('settings.config.payPendingLimitShort'),
      hint: t('settings.config.payPendingLimitHint'),
      type: 'number', group: 'money', min: 0, max: 99,
    },
    // repair_pickup_max_days: default pickup window for new repair orders (mig 671).
    {
      key: 'repair_pickup_max_days', label: t('settings.config.repairPickupMaxDaysShort'),
      hint: t('settings.config.repairPickupMaxDaysHint'),
      type: 'number', group: 'device', min: 1, max: 365,
    },
    // icloud_device_cap: max devices bindable per Apple ID (Apple ceiling ~20).
    // BE enforces the same via CHECK; range check below rejects early.
    {
      key: 'icloud_device_cap', label: t('settings.config.icloudDeviceCapShort'),
      hint: t('settings.config.icloudDeviceCapHint'),
      type: 'number', group: 'device', min: 1, max: 20,
    },
    // Paid installments before the customer may delete apps on the device
    // (mig 1388). Owner put it in its own MDM group (IMPLEMENT 2026-10-06 §0.1)
    // so later MDM settings have a home. 100 = off, 0 = every device right away — so 0 asks first
    // (see handleSave) and a blank field never saves as 0 (see rangeError).
    {
      key: 'app_removal_min_paid_installments',
      label: t('settings.config.appRemovalMinPaidShort'),
      hint: t('settings.config.appRemovalMinPaidHint'),
      type: 'number', group: 'mdm', min: 0, max: 100,
    },
    // Ceiling on the discount a branch may ask for when a customer pays a FIN2
    // contract off early. 0 switches the discount off for the whole company;
    // the request still goes to a company admin for approval either way.
    {
      key: 'fin2_early_payoff_discount_max_pct',
      label: t('settings.config.fin2EarlyPayoffDiscountMaxPctShort'),
      hint: t('settings.config.fin2EarlyPayoffDiscountMaxPctHint'),
      type: 'number', group: 'money', min: 0, max: 100,
    },
    // Reward rate (mig 1378): every X baht of a fully-paid installment earns
    // Y points. Only paid out while the company's REWARD switch (Switches tab) is on.
    {
      key: 'reward_rate_baht',
      label: t('settings.config.rewardRateBaht'),
      hint: t('settings.config.rewardRateBahtHint'),
      type: 'number', group: 'reward', min: 1, max: 1000000,
    },
    {
      key: 'reward_rate_points',
      label: t('settings.config.rewardRatePoints'),
      hint: t('settings.config.rewardRatePointsHint'),
      type: 'number', group: 'reward', min: 0, max: 1000, step: 0.01,
    },
  ];

  const groups = [
    { key: 'contract', label: t('settings.config.groupContractTerms') },
    { key: 'money', label: t('settings.config.groupMoney') },
    { key: 'commission', label: t('settings.config.groupCommission') },
    { key: 'device', label: t('settings.config.groupDevice') },
    { key: 'mdm', label: t('settings.config.groupMdm') },
    { key: 'reward', label: t('settings.config.groupReward') },
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

  // Range check per field, run on every keystroke so a bad value shows under
  // its own field at once (the database enforces the same ranges).
  const rangeError = (f: EditableField): string | null => {
    if (f.type !== 'number') return null;
    const v = formValues[f.key] as number;
    // A cleared field holds NaN, not 0 — 0 is a real setting on some fields
    // (on app removal it frees every device), so a blank must block Save.
    if (Number.isNaN(v)) return t('settings.config.blank', { field: f.label });
    if ((f.min != null && v < f.min) || (f.max != null && v > f.max)) {
      return t('settings.config.outOfRange', { field: f.label, min: f.min, max: f.max });
    }
    return null;
  };
  const hasRangeError = fields.some(f => rangeError(f) !== null);

  const getValue = (key: string) => formValues[key];
  const setValue = (key: string, val: number | boolean) => setFormValues(prev => ({ ...prev, [key]: val }));

  const isDirty = useMemo(() => {
    if (!config) return false;
    return fields.some(f => formValues[f.key] !== (config[f.key] as number | boolean));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formValues, config]);

  // Report unsaved edits to the page so leaving asks first. Two tabs can hold
  // them independently — the numbers tab and the document fields, which save
  // through a different button — so the guard reads either being dirty.
  useEffect(() => {
    if (isDirtyRef) isDirtyRef.current = isDirty || docDirty;
  }, [isDirty, docDirty, isDirtyRef]);

  useEffect(() => () => { if (isDirtyRef) isDirtyRef.current = false; }, [isDirtyRef]);

  const handleSave = async () => {
    if (!config || !user) return;
    setSaving(true);
    setErrorMessage('');

    // Out-of-range fields already show their message and keep Save disabled.
    if (hasRangeError) {
      setSaving(false);
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

    // 0 lets every customer of the company delete apps (the NNF app included)
    // straight away — ask once more. No other value needs a confirm.
    if (changes.app_removal_min_paid_installments === 0) {
      setSaving(false);
      setConfirmZero(changes);
      return;
    }

    await submitChanges(changes);
  };

  const submitChanges = async (changes: Record<string, number | boolean>) => {
    if (!config || !user) return;
    setSaving(true);
    setErrorMessage('');
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
        <div className={activeTab === 'values' ? 'max-w-5xl mx-auto' : 'max-w-2xl mx-auto'}>
          {activeTab === 'values' ? (
            /* Groups sit side by side on a wide panel: each is only a handful of
               small number fields, so one column per group wasted the width. */
            /* The wrapper is the container; the grid inside it is what responds
               to the wrapper's width. An element cannot be both. */
            <div className="@container/values">
              <div className="grid gap-x-8 gap-y-6 @xl/values:grid-cols-2 items-start">
              {groups.map(group => {
                const groupFields = fields.filter(f => f.group === group.key);
                return (
                  <div key={group.key} className="@container/group min-w-0">
                    <h4 className="text-sm font-semibold text-fg uppercase tracking-wider mb-3 pb-2 border-b border-line">
                      {group.label}
                    </h4>
                    <div className="form-grid @md/group:grid-cols-2 gap-4">
                      {groupFields.map(field => (
                        <div key={field.key} className="flex flex-col min-w-0">
                          <label className="form-label">{field.label}</label>
                          {field.type === 'boolean' ? (
                            <Switch
                              checked={getValue(field.key) as boolean}
                              onChange={(e) => setValue(field.key, (e.target as HTMLInputElement).checked)}
                            />
                          ) : (
                            <>
                              <Input
                                type="number"
                                className="w-full"
                                min={field.min}
                                max={field.max}
                                step={field.step}
                                error={!!rangeError(field)}
                                value={Number.isNaN(getValue(field.key)) ? '' : String(getValue(field.key) ?? '')}
                                onChange={(e) => setValue(field.key, e.target.value === '' ? NaN : Number(e.target.value))}
                              />
                              {rangeError(field) && <FormErrorMessage error={{ message: rangeError(field)! }} />}
                            </>
                          )}
                          {/* The error line takes no height of its own, so it
                              replaces the hint rather than drawing over it. */}
                          {field.hint && !rangeError(field) && (
                            <span className="text-xs text-subtler mt-1">{field.hint}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              {/* The instant-save note sits on the sections it is true for.
                  The document fields above have their own Save button, so a
                  blanket "everything here saves on touch" would be a lie. */}
              <CompanyDocumentSection companyId={config.company_id} onDirtyChange={setDocDirty} />
              <hr className="border-line mt-6 mb-6" />
              <p className="text-xs text-subtle mb-5">{t('settings.config.instantHint')}</p>
              <ContractTemplateSection companyId={config.company_id} />
              <hr className="border-line mt-6 mb-6" />
              <FeatureSwitchesSection
                companyId={config.company_id}
                codes={['SAVING', 'CREDIT', 'INSURANCE']}
                title={t('settings.config.groupWallet')}
                hint={t('settings.config.walletHint')}
              />
              <hr className="border-line mt-6 mb-6" />
              <FeatureSwitchesSection
                companyId={config.company_id}
                codes={['REWARD']}
                title={t('settings.config.groupReward')}
                hint={t('settings.config.rewardHint')}
              />
              <hr className="border-line mt-6 mb-6" />
              <ChargeOwnerSection companyId={config.company_id} />
            </div>
          )}
        </div>
      </div>

      {/* Footer — belongs to the numbers tab only; the switches save themselves. */}
      {activeTab === 'values' && (
        /* On mobile the whole panel is one scroller (that is how the library
           lays it out), so the footer would sit at the end of the content —
           past several screens of fields. Stick it to the bottom there. */
        <div className={`flex-none border-t border-line px-4 py-3 bg-bg ${isMobile ? 'sticky bottom-0 z-10' : ''}`}>
          {errorMessage && (
            <div className="alert alert-danger mb-3">
              <XCircle size={16} />
              <div><div className="alert-description text-xs">{errorMessage}</div></div>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" onClick={handleReset} disabled={saving || !isDirty}>{t('common.cancel')}</Button>
            <Button size="sm" color="primary" startIcon={<Save size={14} />} onClick={handleSave} disabled={saving || !isDirty || hasRangeError}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      )}

      <Modal open={!!confirmZero} onClose={() => setConfirmZero(null)} maxWidth="26rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('settings.config.appRemovalZeroConfirmTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={() => setConfirmZero(null)}>&times;</button>
        </div>
        <div className="modal-content">
          <p className="text-sm">{t('settings.config.appRemovalZeroConfirmBody', { company: config.company_name })}</p>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmZero(null)}>{t('common.cancel')}</Button>
          <Button
            color="danger"
            onClick={() => {
              const changes = confirmZero;
              setConfirmZero(null);
              if (changes) submitChanges(changes);
            }}
          >
            {t('common.confirm')}
          </Button>
        </div>
      </Modal>
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

  // Names come from the view, not from our own i18n keys (mig 1349): the owner
  // renames a template in the database and the dropdown follows with no FE
  // release. Fall back to the code only if a row somehow arrives without a name.
  const options = templates.map(row => ({
    value: row.code,
    label: row.name || row.code,
  }));

  const labelFor = (code: string) =>
    templates.find(row => row.code === code)?.name || code;

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
  /** mig 1349 — the owner-facing name, set in the database. */
  name: string | null;
}

// ── Company feature switches (wallets, REWARD) ────────────────────────────────
// Each toggle writes immediately via fn_company_feature_set (no shared save
// button — one RPC per flip, like a settings switch). Default-safe: a company
// with no rows reads all-enabled from the view.
function FeatureSwitchesSection({ companyId, codes, title, hint }: {
  companyId: number;
  codes: CompanyFeatureCode[];
  title: string;
  hint: string;
}) {
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

  const byCode = (c: string) => rows.find(r => r.feature_code === c);

  return (
    <div>
      <h4 className="text-sm font-semibold text-fg uppercase tracking-wider mb-1">{title}</h4>
      <p className="text-xs text-subtle mb-3">{hint}</p>
      {error && (
        <div className="alert alert-danger mb-3"><XCircle size={16} /><div><div className="alert-description text-xs">{error}</div></div></div>
      )}
      <div className="form-grid md:grid-cols-3">
        {codes.map(code => {
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

// ── Document + customer contact details (mig 1348) ────────────────────────────
// The name customers know the company by, plus the contact channels a fund
// company has to print for them. Separate from the company's name in the system,
// which is what the team calls it internally. Nothing reads these yet — the DB
// team switches documents over in a later round — so the hint says so plainly
// rather than implying the next printed bill will change.
//
// Its own Save button, not the numbers tab's: this writes a different RPC and
// lives on the other tab.
function CompanyDocumentSection({ companyId, onDirtyChange }: {
  companyId: number;
  /** Reports unsaved edits up so leaving the page asks first. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CompanyDocumentFields>(EMPTY_DOC_FIELDS);

  const { data: row, isLoading } = useQuery({
    queryKey: ['company-document', companyId],
    queryFn: async () => {
      const rows = await apiClient.get<CompanyDocumentRow[]>(
        `/v_companies?id=eq.${companyId}&select=id,name,doc_name,address,phone,email,line_id`,
      );
      return rows[0] ?? null;
    },
  });

  useEffect(() => {
    if (!row) return;
    setForm({
      doc_name: row.doc_name ?? '',
      address: row.address ?? '',
      phone: row.phone ?? '',
      email: row.email ?? '',
      line_id: row.line_id ?? '',
    });
    setError('');
  }, [row?.id, row?.doc_name, row?.address, row?.phone, row?.email, row?.line_id]);

  const isDirty = !!row && DOC_FIELD_KEYS.some(k => form[k] !== (row[k] ?? ''));

  // This section has its own Save button, so the page's guard cannot see it
  // through the shared form state — report it, and clear on unmount so a
  // section left dirty does not block navigation forever.
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  const handleSave = async () => {
    if (!row) return;
    setSaving(true);
    setError('');
    try {
      // Only the fields the user actually changed. An omitted field is left
      // alone by the RPC; an empty string clears it.
      const params: Record<string, string | number> = { p_company_id: companyId };
      for (const k of DOC_FIELD_KEYS) {
        if (form[k] !== (row[k] ?? '')) params[`p_${k}`] = form[k];
      }
      await apiClient.rpc('fn_company_document_set', params);
      await queryClient.invalidateQueries({ queryKey: ['company-document', companyId] });
      addSnackbar({
        message: (
          <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.config.saved')}</span></div>
        ),
        type: 'success',
      });
    } catch (err) {
      if (err instanceof ApiError) setError(translateApiError(err, t) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!row) return;
    setForm({
      doc_name: row.doc_name ?? '',
      address: row.address ?? '',
      phone: row.phone ?? '',
      email: row.email ?? '',
      line_id: row.line_id ?? '',
    });
    setError('');
  };

  const set = (key: keyof CompanyDocumentFields, val: string) =>
    setForm(prev => ({ ...prev, [key]: val }));

  return (
    <div>
      <h4 className="text-sm font-semibold text-fg uppercase tracking-wider mb-1">{t('settings.config.groupDocumentInfo')}</h4>
      <p className="text-xs text-subtle mb-3">{t('settings.config.documentInfoHint')}</p>
      <div className="form-grid gap-4 md:grid-cols-2 max-w-3xl">
        <div className="flex flex-col">
          <label className="form-label">{t('settings.config.docName')}</label>
          <Input
            value={form.doc_name}
            onChange={(e) => set('doc_name', e.target.value)}
            disabled={isLoading || saving}
            size="md"
            className="w-full"
            placeholder={row?.name ?? ''}
          />
          <span className="text-xs text-subtler mt-1">{t('settings.config.docNameHint')}</span>
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('settings.config.docPhone')}</label>
          <PhoneInput
            value={form.phone}
            onChange={(raw) => set('phone', raw)}
            disabled={isLoading || saving}
            size="md"
            className="w-full"
          />
        </div>
        <div className="flex flex-col md:col-span-2">
          <label className="form-label">{t('settings.config.docAddress')}</label>
          <Input
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            disabled={isLoading || saving}
            size="md"
            className="w-full"
          />
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('settings.config.docEmail')}</label>
          <Input
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            disabled={isLoading || saving}
            size="md"
            className="w-full"
            inputMode="email"
          />
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('settings.config.docLineId')}</label>
          <Input
            value={form.line_id}
            onChange={(e) => set('line_id', e.target.value)}
            disabled={isLoading || saving}
            size="md"
            className="w-full"
          />
        </div>
      </div>
      {error && (
        <div className="alert alert-danger mb-3"><XCircle size={16} /><div><div className="alert-description text-xs">{error}</div></div></div>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" onClick={handleReset} disabled={saving || !isDirty}>{t('common.cancel')}</Button>
        <Button size="sm" color="primary" startIcon={<Save size={14} />} onClick={handleSave} disabled={saving || !isDirty}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

interface CompanyDocumentRow {
  id: number;
  name: string;
  doc_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  line_id: string | null;
}

type CompanyDocumentFields = Record<'doc_name' | 'address' | 'phone' | 'email' | 'line_id', string>;

const DOC_FIELD_KEYS = ['doc_name', 'address', 'phone', 'email', 'line_id'] as const;

const EMPTY_DOC_FIELDS: CompanyDocumentFields = {
  doc_name: '', address: '', phone: '', email: '', line_id: '',
};

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
