import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MobileHeader, Button, Input, Select, Switch, Badge, useSnackbarContext,
} from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, XCircle, Save } from 'lucide-react';
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
  level: number;
  overdue_days: string;
  action: string;
  description: string;
  is_active: boolean;
  // Read-only from server
  channel: string;
  updated_by_name: string | null;
  updated_at: string | null;
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

const MAX_LEVELS = 9;

function createEmptyRows(): EditableRow[] {
  return Array.from({ length: MAX_LEVELS }, (_, i) => ({
    level: i + 1,
    overdue_days: '',
    action: '',
    description: '',
    is_active: true,
    channel: '',
    updated_by_name: null,
    updated_at: null,
    dirty: false,
  }));
}

function serverToEditable(rows: DunningConfigRow[]): EditableRow[] {
  const base = createEmptyRows();
  for (const r of rows) {
    const idx = r.level - 1;
    if (idx >= 0 && idx < MAX_LEVELS) {
      base[idx] = {
        level: r.level,
        overdue_days: String(r.overdue_days),
        action: r.action,
        description: r.description,
        is_active: r.is_active,
        channel: r.channel,
        updated_by_name: r.updated_by_name,
        updated_at: r.updated_at,
        dirty: false,
      };
    }
  }
  return base;
}

// ── Component ────────────────────────────────────────────────────────────────

export function DunningConfigPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const queryClient = useQueryClient();

  const [selectedCompany, setSelectedCompany] = useState('');
  const [rows, setRows] = useState<EditableRow[]>(createEmptyRows);
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

  // Auto-select single company
  useEffect(() => {
    if (companies.length === 1 && !selectedCompany) {
      setSelectedCompany(String(companies[0].company_id));
    }
  }, [companies, selectedCompany]);

  // Sync server data to editable rows
  useEffect(() => {
    if (serverRows) {
      setRows(serverToEditable(serverRows));
    }
  }, [serverRows]);

  // ── Handlers ──

  const handleCompanyChange = (val: string | string[] | null) => {
    setSelectedCompany((val as string) ?? '');
    setRows(createEmptyRows());
    setErrorMessage('');
  };

  const updateRow = useCallback((level: number, field: keyof EditableRow, value: string | boolean) => {
    setRows(prev => prev.map(r =>
      r.level === level ? { ...r, [field]: value, dirty: true } : r
    ));
  }, []);

  const dirtyRows = rows.filter(r => r.dirty && r.action);

  // Validation: check days ascending for filled rows
  const filledRows = rows.filter(r => r.action);
  const daysWarning = (() => {
    const days = filledRows.map(r => Number(r.overdue_days) || 0);
    for (let i = 1; i < days.length; i++) {
      if (days[i] <= days[i - 1]) return true;
    }
    return false;
  })();

  const handleSave = async () => {
    if (!user || !selectedCompany || dirtyRows.length === 0) return;

    setSaving(true);
    setErrorMessage('');

    try {
      for (const row of dirtyRows) {
        await apiClient.rpc('fn_dunning_config_upsert', {
          p_company_id: Number(selectedCompany),
          p_level: row.level,
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
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content">
        {/* Desktop header */}
        <div className="mb-6 max-md:hidden">
          <h1 className="heading-2">{t('settings.dunning.title')}</h1>
          <p className="text-sm text-fg/60 mt-1">{t('settings.dunning.description')}</p>
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
              <div className="alert alert-warning mb-4">
                <div className="alert-description">{t('settings.dunning.daysWarning')}</div>
              </div>
            )}

            {/* Levels */}
            <div className="flex flex-col gap-3 pb-4">
              {rows.map(row => {
                const isFilled = !!row.action;
                const isConfigured = !!row.channel; // has server data

                return (
                  <div
                    key={row.level}
                    className={`border rounded-lg p-4 transition-colors ${
                      !row.is_active && isFilled ? 'border-line/50 opacity-60' :
                      row.dirty ? 'border-primary/40 bg-primary/3' :
                      isFilled ? 'border-line' :
                      'border-dashed border-line/50'
                    }`}
                  >
                    {/* Row header */}
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-xs font-semibold text-subtle uppercase w-16 shrink-0">
                        {t('settings.dunning.level')} {row.level}
                      </span>
                      {isConfigured && row.channel && (
                        <Badge size="sm" color="default">{CHANNEL_LABELS[row.channel] ?? row.channel}</Badge>
                      )}
                      {!row.is_active && isFilled && (
                        <Badge size="sm" color="default">{t('common.inactive')}</Badge>
                      )}
                      {row.dirty && (
                        <span className="text-xs text-primary">{t('settings.dunning.modified')}</span>
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        {isFilled && (
                          <Switch
                            checked={row.is_active}
                            onChange={(e) => updateRow(row.level, 'is_active', (e.target as HTMLInputElement).checked)}
                          />
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
                          onChange={(e) => updateRow(row.level, 'overdue_days', e.target.value)}
                          placeholder="0"
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="form-label">{t('settings.dunning.action')}</label>
                        <Select
                          value={row.action || null}
                          onChange={(val) => updateRow(row.level, 'action', (val as string) ?? '')}
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
                          onChange={(e) => updateRow(row.level, 'description', e.target.value)}
                          placeholder={t('settings.dunning.descriptionPlaceholder')}
                        />
                      </div>
                    </div>

                    {/* Last updated info */}
                    {isConfigured && row.updated_at && (
                      <div className="mt-2 text-[11px] text-subtle">
                        {t('settings.dunning.lastUpdated')} {row.updated_by_name ?? '—'} · {new Date(row.updated_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                );
              })}
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
                disabled={saving || dirtyRows.length === 0}
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
