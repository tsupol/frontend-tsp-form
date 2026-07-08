import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MobileHeader, Button, Input, Switch, Badge, useSnackbarContext,
} from 'tsp-form';
import { ArrowLeft, CheckCircle, XCircle, Save } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import type { CompanyConfig, EditableField } from './companyConfigTypes';
import type { CompanyFeatureCode } from '../../hooks/useCompanyFeatures';

// ── Detail Page ──────────────────────────────────────────────────────────────

export function CompanyConfigDetailPage() {
  const { t } = useTranslation();
  const { companyId } = useParams<{ companyId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [formValues, setFormValues] = useState<Record<string, number | boolean>>({});

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
  ];

  const groups = [
    { key: 'contract', label: t('settings.config.groupContract') },
    { key: 'lateFee', label: t('settings.config.groupLateFee') },
    { key: 'commission', label: t('settings.config.groupCommission') },
    { key: 'pause', label: t('settings.config.groupPause') },
    { key: 'legal', label: t('settings.config.groupLegal') },
    { key: 'buyback', label: t('settings.config.groupBuyback') },
    { key: 'policy', label: t('settings.config.groupPolicy') },
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
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
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

  const goBack = () => navigate('/admin/company/config');

  if (isLoading || !config) {
    return (
      <>
        <MobileHeader className="mobile-header-bordered md:hidden">
          <div className="mobile-header-start">
            <button
              className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
              aria-label="Go back"
              onClick={goBack}
            >
              <ArrowLeft size={20} />
            </button>
          </div>
          <div className="mobile-header-title" />
          <div className="mobile-header-end w-nav" />
        </MobileHeader>
        <div className="page-content">
          <div className="p-8 text-center text-subtle">
            {isLoading ? t('common.loading') : t('settings.config.empty')}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Mobile header */}
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Go back"
            onClick={goBack}
          >
            <ArrowLeft size={20} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {config.company_name}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content max-w-2xl mx-auto pb-0">
        {/* Desktop header */}
        <div className="flex items-center gap-3 mb-6 max-md:hidden">
          <button
            className="flex items-center gap-1 text-sm text-subtle hover:text-fg transition-colors cursor-pointer"
            onClick={goBack}
          >
            <ArrowLeft size={14} />
            {t('settings.config.title')}
          </button>
          <span className="text-fg/30">/</span>
          <h1 className="heading-2">{config.company_name}</h1>
        </div>

        {errorMessage && (
          <div className="alert alert-danger mb-4">
            <XCircle size={16} />
            <div><div className="alert-description text-xs">{errorMessage}</div></div>
          </div>
        )}

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

        {/* Footer (config fields — saves via fn_config_update) */}
        <div className="sticky bottom-0 flex items-center justify-end gap-2 py-3 bg-bg border-t border-line md:border-t-0 z-10">
          <Button onClick={handleReset} disabled={saving || !isDirty}>{t('common.cancel')}</Button>
          <Button color="primary" startIcon={<Save size={16} />} onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>

        {/* Wallet features + bill-line owner — separate views/RPCs, own save flow. */}
        <hr className="border-line mt-2 mb-6" />
        <WalletFeaturesSection companyId={config.company_id} />
        <hr className="border-line mt-6 mb-6" />
        <ChargeOwnerSection companyId={config.company_id} />
      </div>
    </>
  );
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
        setError((err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '') || err.message);
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
// Coarse wildcard override: book EVERY charge to HOLDING or to COMPANY via a
// single '*' row. When no '*' row exists, money books by each charge type's own
// owner_type (= TPA default) — shown as "ตามค่าเริ่มต้น" but not selectable, since
// the current fn_company_charge_owner_set can only set HOLDING/COMPANY, not clear
// the row. (Clearing needs a BE clear-RPC — see note.)
function ChargeOwnerSection({ companyId }: { companyId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['company-charge-owners', companyId],
    queryFn: () => apiClient.get<ChargeOwnerRow[]>(`/v_company_charge_owners?company_id=eq.${companyId}`),
  });

  const wildcard = rows.find(r => r.charge_type_code === '*');
  // 'default' = no '*' override present (books per charge type).
  const mode: 'default' | 'HOLDING' | 'COMPANY' = wildcard?.owner_type ?? 'default';

  const apply = async (owner: 'HOLDING' | 'COMPANY') => {
    if (owner === mode) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_company_charge_owner_set', {
        p_company_id: companyId,
        p_charge_type_code: '*',
        p_owner_type: owner,
      });
      await queryClient.invalidateQueries({ queryKey: ['company-charge-owners', companyId] });
      addSnackbar({
        message: (
          <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.config.saved')}</span></div>
        ),
        type: 'success',
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError((err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '') || err.message);
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
      <div className="flex items-center gap-2">
        <span className="text-sm text-subtle shrink-0">{t('settings.config.ownerCurrent')}:</span>
        <Badge color={mode === 'HOLDING' ? 'warning' : mode === 'COMPANY' ? 'info' : 'default'}>
          {mode === 'default' ? t('settings.config.ownerDefault') : t(`settings.config.owner_${mode}`)}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <Button
          variant={mode === 'HOLDING' ? undefined : 'outline'}
          color={mode === 'HOLDING' ? 'primary' : undefined}
          disabled={isLoading || saving}
          onClick={() => apply('HOLDING')}
        >
          {t('settings.config.ownerAllHolding')}
        </Button>
        <Button
          variant={mode === 'COMPANY' ? undefined : 'outline'}
          color={mode === 'COMPANY' ? 'primary' : undefined}
          disabled={isLoading || saving}
          onClick={() => apply('COMPANY')}
        >
          {t('settings.config.ownerAllCompany')}
        </Button>
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

interface ChargeOwnerRow {
  company_id: number;
  company_code: string;
  charge_type_code: string;
  owner_type: 'HOLDING' | 'COMPANY';
  note: string | null;
  updated_at: string;
}
