import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MobileHeader, Button, Input, Select, Switch, Badge, useSnackbarContext,
} from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, XCircle, Save, Plus, Trash2, Info, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface DunningConfigRow {
  id: number;
  level: number;
  overdue_days: number;
  action: string;
  channel: string;
  description: string;
  is_active: boolean;
  updated_by_name: string | null;
  updated_at: string;
}

interface CompanyOption {
  company_id: number;
  company_name: string;
}

interface EditableRow {
  _key: number; // stable React key
  level: string;
  overdue_days: string;
  action: string;
  description: string;
  is_active: boolean;
  channel: string;
  updated_by_name: string | null;
  updated_at: string | null;
  isNew: boolean;
  dirty: boolean;
}

const ACTION_OPTIONS = [
  { value: 'REMIND', labelKey: 'settings.dunning.actionRemind' },
  { value: 'COLLECT', labelKey: 'settings.dunning.actionCollect' },
  { value: 'RESTRICT', labelKey: 'settings.dunning.actionRestrict' },
  { value: 'REPO_CASE', labelKey: 'settings.dunning.actionRepoCase' },
  { value: 'BLACKLIST', labelKey: 'settings.dunning.actionBlacklist' },
];

const CHANNEL_LABELS: Record<string, string> = {
  APP: 'App',
  SMS: 'SMS',
  CALL_CENTER: 'Call Center',
  MDM: 'MDM',
  LEGAL: 'Legal',
  SYSTEM: 'System',
};

let nextKey = 1;

function serverToEditable(rows: DunningConfigRow[]): EditableRow[] {
  return rows.map(r => ({
    _key: nextKey++,
    level: String(r.level),
    overdue_days: String(r.overdue_days),
    action: r.action,
    description: r.description,
    is_active: r.is_active,
    channel: r.channel,
    updated_by_name: r.updated_by_name,
    updated_at: r.updated_at,
    isNew: false,
    dirty: false,
  }));
}

function nextLevel(rows: EditableRow[]): number {
  const levels = rows.map(r => Number(r.level) || 0);
  return levels.length > 0 ? Math.max(...levels) + 1 : 1;
}

// ── Component ────────────────────────────────────────────────────────────────

export function DunningConfigPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const queryClient = useQueryClient();

  const [selectedCompany, setSelectedCompany] = useState('');
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // ── Data ──

  const { data: companies = [] } = useQuery({
    queryKey: ['company-config-list'],
    queryFn: () => apiClient.get<CompanyOption[]>('/v_company_config?select=company_id,company_name&order=company_name'),
  });

  const { data: serverRows, isFetching } = useQuery({
    queryKey: ['dunning-config', selectedCompany],
    queryFn: () => apiClient.get<DunningConfigRow[]>(`/v_dunning_config?company_id=eq.${selectedCompany}&order=level`),
    enabled: !!selectedCompany,
  });

  useEffect(() => {
    if (companies.length === 1 && !selectedCompany) {
      setSelectedCompany(String(companies[0].company_id));
    }
  }, [companies, selectedCompany]);

  useEffect(() => {
    if (serverRows) {
      setRows(serverToEditable(serverRows));
    }
  }, [serverRows]);

  // ── Handlers ──

  const handleCompanyChange = (val: string | string[] | null) => {
    setSelectedCompany((val as string) ?? '');
    setRows([]);
    setErrorMessage('');
  };

  const updateRow = useCallback((key: number, field: keyof EditableRow, value: string | boolean) => {
    setRows(prev => prev.map(r =>
      r._key === key ? { ...r, [field]: value, dirty: true } : r
    ));
  }, []);

  const addRow = useCallback(() => {
    setRows(prev => [...prev, {
      _key: nextKey++,
      level: String(nextLevel(prev)),
      overdue_days: '',
      action: '',
      description: '',
      is_active: true,
      channel: '',
      updated_by_name: null,
      updated_at: null,
      isNew: true,
      dirty: true,
    }]);
  }, []);

  const removeRow = useCallback((key: number) => {
    setRows(prev => prev.filter(r => r._key !== key));
  }, []);

  const dirtyRows = rows.filter(r => r.dirty && r.action && r.level);

  // Validation: check days ascending
  const daysWarning = (() => {
    const sorted = [...rows].filter(r => r.action).sort((a, b) => (Number(a.level) || 0) - (Number(b.level) || 0));
    const days = sorted.map(r => Number(r.overdue_days) || 0);
    for (let i = 1; i < days.length; i++) {
      if (days[i] <= days[i - 1]) return true;
    }
    return false;
  })();

  // Check duplicate levels
  const duplicateLevels = (() => {
    const levels = rows.map(r => r.level).filter(Boolean);
    return levels.length !== new Set(levels).size;
  })();

  const handleSave = async () => {
    if (!user || !selectedCompany || dirtyRows.length === 0) return;
    if (duplicateLevels) return;

    setSaving(true);
    setErrorMessage('');

    try {
      for (const row of dirtyRows) {
        await apiClient.rpc('fn_dunning_config_upsert', {
          p_company_id: Number(selectedCompany),
          p_level: Number(row.level),
          p_overdue_days: Number(row.overdue_days) || 0,
          p_action: row.action,
          p_description: row.description.trim(),
          p_is_active: row.is_active,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['dunning-config', selectedCompany] });
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
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──

  const actionOptions = ACTION_OPTIONS.map(a => ({ value: a.value, label: t(a.labelKey) }));

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('settings.dunning.title')}
        </div>
        <div className="mobile-header-end">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-subtle hover:text-fg"
            onClick={() => navigate('/admin/legal/dunning')}
          >
            <ExternalLink size={18} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-6 max-md:hidden">
          <div>
            <h1 className="heading-2">{t('settings.dunning.title')}</h1>
            <p className="text-sm text-subtle mt-1">{t('settings.dunning.description')}</p>
          </div>
          <Button variant="ghost" size="sm" startIcon={<ExternalLink size={14} />} onClick={() => navigate('/admin/legal/dunning')}>
            {t('settings.dunning.viewTargets')}
          </Button>
        </div>

        {/* Company selector — only show if multiple */}
        {companies.length > 1 && (
          <div className="flex flex-col mb-6">
            <label className="form-label">{t('settings.dunning.company')}</label>
            <div style={{ width: '20rem' }}>
              <Select
                value={selectedCompany || null}
                onChange={handleCompanyChange}
                placeholder={t('settings.dunning.selectCompany')}
                options={companies.map(c => ({ value: String(c.company_id), label: c.company_name }))}
                showChevron
              />
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="alert alert-danger mb-4">
            <XCircle size={16} />
            <div className="alert-description">{errorMessage}</div>
          </div>
        )}

        {!selectedCompany ? (
          <div className="p-8 text-center text-subtle text-sm">
            {t('settings.dunning.selectCompany')}
          </div>
        ) : isFetching && !serverRows ? (
          <div className="p-8 text-center text-subtle text-sm">{t('common.loading')}</div>
        ) : (
          <>
            {daysWarning && (
              <div className="alert alert-info mb-4">
                <Info size={16} />
                <div className="alert-description">{t('settings.dunning.daysWarning')}</div>
              </div>
            )}

            {duplicateLevels && (
              <div className="alert alert-danger mb-4">
                <XCircle size={16} />
                <div className="alert-description">{t('settings.dunning.duplicateLevel')}</div>
              </div>
            )}

            {/* Levels */}
            <div className="flex flex-col gap-3 pb-4">
              {rows.length === 0 && (
                <div className="p-8 text-center text-subtle text-sm">{t('settings.dunning.empty')}</div>
              )}
              {rows.map(row => (
                <div
                  key={row._key}
                  className={`border rounded-lg p-4 transition-colors ${
                    !row.is_active ? 'border-line/50 opacity-60' :
                    row.dirty ? 'border-primary/40 bg-primary/3' :
                    'border-line'
                  }`}
                >
                  {/* Row header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-subtle uppercase shrink-0">
                        {t('settings.dunning.level')}
                      </span>
                      <Input
                        type="number"
                        size="sm"
                        className="w-16"
                        value={row.level}
                        onChange={(e) => updateRow(row._key, 'level', e.target.value)}
                        min={1}
                      />
                    </div>
                    {row.channel && (
                      <Badge size="sm" color="default">{CHANNEL_LABELS[row.channel] ?? row.channel}</Badge>
                    )}
                    {row.dirty && (
                      <span className="text-xs text-primary">{t('settings.dunning.modified')}</span>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <Switch
                        checked={row.is_active}
                        onChange={(e) => updateRow(row._key, 'is_active', (e.target as HTMLInputElement).checked)}
                      />
                      {row.isNew && (
                        <button
                          className="p-1 rounded hover:bg-danger/10 cursor-pointer bg-transparent border-none text-subtle hover:text-danger"
                          onClick={() => removeRow(row._key)}
                          title={t('common.delete')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-[6rem_1fr_1fr] gap-3">
                    <div className="flex flex-col">
                      <label className="form-label">{t('settings.dunning.overdueDays')}</label>
                      <Input
                        type="number"
                        size="sm"
                        className="w-full"
                        value={row.overdue_days}
                        onChange={(e) => updateRow(row._key, 'overdue_days', e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="form-label">{t('settings.dunning.action')}</label>
                      <Select
                        value={row.action || null}
                        onChange={(val) => updateRow(row._key, 'action', (val as string) ?? '')}
                        options={actionOptions}
                        placeholder={t('settings.dunning.selectAction')}
                        size="sm"
                        showChevron
                        clearable
                        searchable={false}
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="form-label">{t('settings.dunning.actionDescription')}</label>
                      <Input
                        size="sm"
                        className="w-full"
                        value={row.description}
                        onChange={(e) => updateRow(row._key, 'description', e.target.value)}
                        placeholder={t('settings.dunning.descriptionPlaceholder')}
                      />
                    </div>
                  </div>

                  {/* Last updated info */}
                  {!row.isNew && row.updated_at && (
                    <div className="mt-2 text-[11px] text-subtle">
                      {t('settings.dunning.lastUpdated')} {row.updated_by_name ?? '—'} · {new Date(row.updated_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
              ))}

              {/* Add level button */}
              <button
                className="border border-dashed border-line rounded-lg p-3 flex items-center justify-center gap-2 text-sm text-subtle hover:text-fg hover:border-fg/30 cursor-pointer bg-transparent transition-colors"
                onClick={addRow}
              >
                <Plus size={16} />
                {t('settings.dunning.addLevel')}
              </button>
            </div>

            {/* Sticky save footer */}
            <div className="sticky bottom-0 flex items-center justify-between gap-2 py-3 bg-bg border-t border-line">
              <span className="text-xs text-subtle">
                {dirtyRows.length > 0 && t('settings.dunning.pendingChanges', { count: dirtyRows.length })}
              </span>
              <Button
                color="primary"
                size="sm"
                startIcon={<Save size={16} />}
                onClick={handleSave}
                disabled={saving || dirtyRows.length === 0 || duplicateLevels}
              >
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
