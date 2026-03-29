import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MobileHeader, Button, Input, Switch, useSnackbarContext,
} from 'tsp-form';
import { ArrowLeft, CheckCircle, XCircle, Save } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import type { CompanyConfig, EditableField } from './companyConfigTypes';

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
    { key: 'max_guarantors', label: t('settings.config.maxGuarantors'), type: 'number', group: 'contract' },
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
  ];

  const groups = [
    { key: 'contract', label: t('settings.config.groupContract') },
    { key: 'lateFee', label: t('settings.config.groupLateFee') },
    { key: 'commission', label: t('settings.config.groupCommission') },
    { key: 'pause', label: t('settings.config.groupPause') },
    { key: 'legal', label: t('settings.config.groupLegal') },
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
          <div className="mobile-header-end" />
        </MobileHeader>
        <div className="page-content">
          <div className="p-8 text-center text-control-label">
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
            className="flex items-center gap-1 text-sm text-fg/60 hover:text-fg transition-colors cursor-pointer"
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

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-2 py-3 bg-bg border-t border-line md:border-t-0">
          <Button onClick={handleReset} disabled={saving || !isDirty}>{t('common.cancel')}</Button>
          <Button color="primary" startIcon={<Save size={16} />} onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </>
  );
}
