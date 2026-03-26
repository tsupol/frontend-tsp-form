import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  MobileHeader, Button, Input, Select, Switch, useSnackbarContext,
} from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, XCircle, Save } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface CompanyOption {
  company_id: number;
  company_name: string;
}

interface DunningLevel {
  level: number;
  overdue_days: number | '';
  action: string;
  description: string;
  is_active: boolean;
}

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function createEmptyLevels(): DunningLevel[] {
  return LEVELS.map(level => ({
    level,
    overdue_days: '',
    action: '',
    description: '',
    is_active: true,
  }));
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function DunningConfigPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();

  const [selectedCompany, setSelectedCompany] = useState('');
  const [levels, setLevels] = useState<DunningLevel[]>(createEmptyLevels);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const { data: companies = [] } = useQuery({
    queryKey: ['company-config-list'],
    queryFn: () => apiClient.get<CompanyOption[]>('/v_company_config?select=company_id,company_name&order=company_name'),
  });

  const companyOptions = companies.map(c => ({
    label: c.company_name,
    value: String(c.company_id),
  }));

  const handleCompanyChange = (val: string | string[] | null) => {
    setSelectedCompany((val as string) ?? '');
    setLevels(createEmptyLevels());
    setErrorMessage('');
  };

  const updateLevel = (index: number, field: keyof DunningLevel, value: number | string | boolean) => {
    setLevels(prev => prev.map((lvl, i) => i === index ? { ...lvl, [field]: value } : lvl));
  };

  const filledLevels = levels.filter(l => l.overdue_days !== '' || l.action.trim() !== '');

  const handleSave = async () => {
    if (!user || !selectedCompany) return;
    if (filledLevels.length === 0) return;

    setSaving(true);
    setErrorMessage('');

    const start = Date.now();
    try {
      for (const lvl of filledLevels) {
        await apiClient.rpc('fn_dunning_config_upsert', {
          p_company_id: Number(selectedCompany),
          p_level: lvl.level,
          p_overdue_days: Number(lvl.overdue_days) || 0,
          p_action: lvl.action.trim(),
          p_description: lvl.description.trim(),
          p_is_active: lvl.is_active,
          p_updated_by: user.user_id,
        });
      }
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span className="alert-description">{t('settings.dunning.saved')}</span>
          </div>
        ),
        type: 'success',
      });
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setSaving(false);
    }
  };

  return (
    <>
      {/* Mobile header */}
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
          {t('settings.dunning.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content max-w-3xl mx-auto pb-0">
        {/* Desktop header */}
        <div className="mb-6 max-md:hidden">
          <h1 className="heading-2">{t('settings.dunning.title')}</h1>
          <p className="text-sm text-fg/60 mt-1">{t('settings.dunning.description')}</p>
        </div>

        {/* Company selector */}
        <div className="flex flex-col mb-6">
          <label className="form-label">{t('settings.dunning.company')}</label>
          <div style={{ width: '20rem' }}>
            <Select
              value={selectedCompany}
              onChange={handleCompanyChange}
              placeholder={t('settings.dunning.selectCompany')}
              options={companyOptions}
            />
          </div>
        </div>

        {errorMessage && (
          <div className="alert alert-danger mb-4 animate-pop-in">
            <XCircle size={16} />
            <div><div className="alert-description">{errorMessage}</div></div>
          </div>
        )}

        {!selectedCompany ? (
          <div className="p-8 text-center text-control-label">
            {t('settings.dunning.selectCompany')}
          </div>
        ) : (
          <>
            {/* Dunning levels table */}
            <div className="overflow-x-auto better-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="py-2 px-2 font-medium text-fg/60 w-16">{t('settings.dunning.level')}</th>
                    <th className="py-2 px-2 font-medium text-fg/60 w-28">{t('settings.dunning.overdueDays')}</th>
                    <th className="py-2 px-2 font-medium text-fg/60 w-36">{t('settings.dunning.action')}</th>
                    <th className="py-2 px-2 font-medium text-fg/60">{t('settings.dunning.actionDescription')}</th>
                    <th className="py-2 px-2 font-medium text-fg/60 w-20 text-center">{t('settings.dunning.isActive')}</th>
                  </tr>
                </thead>
                <tbody>
                  {levels.map((lvl, idx) => (
                    <tr key={lvl.level} className="border-b border-line/50">
                      <td className="py-2 px-2">
                        <span className="font-medium tabular-nums">{lvl.level}</span>
                      </td>
                      <td className="py-2 px-2">
                        <Input
                          type="number"
                          size="sm"
                          className="w-full"
                          value={lvl.overdue_days === '' ? '' : String(lvl.overdue_days)}
                          onChange={(e) => updateLevel(idx, 'overdue_days', e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="0"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <Input
                          size="sm"
                          className="w-full"
                          value={lvl.action}
                          onChange={(e) => updateLevel(idx, 'action', e.target.value)}
                          placeholder="SMS, Call..."
                        />
                      </td>
                      <td className="py-2 px-2">
                        <Input
                          size="sm"
                          className="w-full"
                          value={lvl.description}
                          onChange={(e) => updateLevel(idx, 'description', e.target.value)}
                        />
                      </td>
                      <td className="py-2 px-2 text-center">
                        <div className="flex justify-center">
                          <Switch
                            checked={lvl.is_active}
                            onChange={(e) => updateLevel(idx, 'is_active', (e.target as HTMLInputElement).checked)}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Sticky footer */}
            <div className="sticky bottom-0 flex items-center justify-end gap-2 py-3 bg-bg border-t border-line md:border-t-0">
              <Button
                color="primary"
                startIcon={<Save size={16} />}
                onClick={handleSave}
                disabled={saving || filledLevels.length === 0}
              >
                {saving ? t('common.saving') : t('settings.dunning.save')}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
