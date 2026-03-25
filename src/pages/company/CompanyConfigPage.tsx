import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader, Modal,
  Button, Input, Switch, PopOver, MenuItem, useSnackbarContext,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, MoreHorizontal, Pencil, CheckCircle, XCircle, Save } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface CompanyConfig {
  company_id: number;
  company_name: string;
  holding_id: number;
  draft_expiry_days: number;
  draft_expiry_warn_days: number;
  grace_period_days: number;
  late_fee_per_day: number;
  late_fee_split_holding: number;
  late_fee_split_company: number;
  comm_min_active_days: number;
  comm_min_paid_installments: number;
  comm_require_no_overdue: boolean;
  pause_enabled: boolean;
  pause_max_deferred: number;
  repo_fee_per_case: number;
  max_guarantors: number;
  deposit_max_days: number;
  updated_by: number | null;
  updated_at: string;
}

type EditableField = {
  key: keyof CompanyConfig;
  label: string;
  type: 'number' | 'boolean';
  group: string;
};

// ── Edit Modal ───────────────────────────────────────────────────────────────

function EditConfigModal({ config, open, onClose, onSaved }: {
  config: CompanyConfig | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [formValues, setFormValues] = useState<Record<string, number | boolean>>({});

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
    { key: 'pause_enabled', label: t('settings.config.pauseEnabled'), type: 'boolean', group: 'pause' },
    { key: 'pause_max_deferred', label: t('settings.config.pauseMaxDeferred'), type: 'number', group: 'pause' },
    { key: 'repo_fee_per_case', label: t('settings.config.repoFeePerCase'), type: 'number', group: 'legal' },
  ];

  const groups = [
    { key: 'contract', label: t('settings.config.groupContract') },
    { key: 'lateFee', label: t('settings.config.groupLateFee') },
    { key: 'commission', label: t('settings.config.groupCommission') },
    { key: 'pause', label: t('settings.config.groupPause') },
    { key: 'legal', label: t('settings.config.groupLegal') },
  ];

  // Initialize form values when modal opens
  useEffect(() => {
    if (open && config) {
      const vals: Record<string, number | boolean> = {};
      for (const f of fields) {
        vals[f.key] = config[f.key] as number | boolean;
      }
      setFormValues(vals);
      setErrorMessage('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config]);

  const getValue = (key: string) => formValues[key];
  const setValue = (key: string, val: number | boolean) => setFormValues(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    if (!config || !user) return;
    setSaving(true);
    setErrorMessage('');

    // Build changes — only include fields that differ from original
    const changes: Record<string, number | boolean> = {};
    for (const f of fields) {
      const current = formValues[f.key];
      const original = config[f.key];
      if (current !== undefined && current !== original) {
        changes[f.key] = current;
      }
    }

    if (Object.keys(changes).length === 0) {
      onClose();
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
      });
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setErrorMessage(translated || err.message);
      }
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('settings.config.editTitle', { company: config?.company_name })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {errorMessage && (
          <div className="alert alert-danger mb-4">
            <XCircle size={16} />
            <div><div className="alert-description text-xs">{errorMessage}</div></div>
          </div>
        )}
        <div className="flex flex-col gap-6">
          {groups.map(group => {
            const groupFields = fields.filter(f => f.group === group.key);
            return (
              <div key={group.key}>
                <h4 className="text-xs font-semibold text-control-label uppercase tracking-wider mb-3">{group.label}</h4>
                <div className="form-grid gap-3">
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
      </div>
      <div className="modal-footer">
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button color="primary" startIcon={<Save size={16} />} onClick={handleSave} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Row Actions ──────────────────────────────────────────────────────────────

function ConfigRowActions({ config, onEdit }: {
  config: CompanyConfig;
  onEdit: (c: CompanyConfig) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <PopOver
      isOpen={open}
      onClose={() => setOpen(false)}
      placement="bottom"
      align="end"
      offset={4}
      openDelay={0}
      trigger={
        <button
          className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); setOpen(!open); }}
        >
          <MoreHorizontal size={16} className="opacity-50" />
        </button>
      }
    >
      <div className="py-1 min-w-[140px]">
        <MenuItem
          icon={<Pencil size={14} />}
          label={t('common.edit')}
          onClick={() => { setOpen(false); onEdit(config); }}
        />
      </div>
    </PopOver>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function CompanyConfigPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editConfig, setEditConfig] = useState<CompanyConfig | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { data: configs = [], isFetching } = useQuery({
    queryKey: ['company-config'],
    queryFn: () => apiClient.get<CompanyConfig[]>('/v_company_config?order=company_name'),
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return configs;
    const term = search.trim().toLowerCase();
    return configs.filter(c => c.company_name.toLowerCase().includes(term));
  }, [configs, search]);

  const totalCount = filtered.length;
  const paginatedConfigs = filtered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPageIndex(0);
    }, 300);
  };

  const handleEdit = (config: CompanyConfig) => {
    setEditConfig(config);
  };

  const columns: ColumnDef<CompanyConfig>[] = [
    {
      accessorKey: 'company_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.config.companyName')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.company_name}</span>,
    },
    {
      accessorKey: 'grace_period_days',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.config.gracePeriodDays')} />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.grace_period_days} {t('settings.config.days')}</span>,
      className: 'w-28',
    },
    {
      accessorKey: 'late_fee_per_day',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.config.lateFeePerDay')} />,
      cell: ({ row }) => <span className="tabular-nums">฿{row.original.late_fee_per_day.toLocaleString()}</span>,
      className: 'w-28',
    },
    {
      id: 'late_fee_split',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.config.lateFeeSplit')} />,
      cell: ({ row }) => (
        <span className="tabular-nums text-sm">
          {row.original.late_fee_split_holding}/{row.original.late_fee_split_company}
        </span>
      ),
      className: 'w-24',
    },
    {
      accessorKey: 'pause_enabled',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.config.pauseEnabled')} />,
      cell: ({ row }) => row.original.pause_enabled
        ? <CheckCircle size={16} className="text-success" />
        : <XCircle size={16} className="text-fg/30" />,
      className: 'w-20',
    },
    {
      accessorKey: 'pause_max_deferred',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.config.pauseMaxDeferred')} />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.pause_max_deferred}</span>,
      className: 'w-20',
    },
    {
      accessorKey: 'draft_expiry_days',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.config.draftExpiryDays')} />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.draft_expiry_days} {t('settings.config.days')}</span>,
      className: 'w-28',
    },
    {
      accessorKey: 'comm_min_active_days',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.config.commMinActiveDays')} />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.comm_min_active_days} {t('settings.config.days')}</span>,
      className: 'w-28',
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <ConfigRowActions config={row.original} onEdit={handleEdit} />
      ),
      enableSorting: false,
      className: 'w-10',
    },
  ];

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
          {t('settings.config.title')}
        </div>
        <div className="mobile-header-end" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('settings.config.title')}</h1>
            <p className="text-sm text-fg/60 mt-1">{t('settings.config.description')}</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex-none pb-4">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 md:max-w-56">
              <Input
                placeholder={t('common.search')}
                value={searchInput}
                onChange={(e) => handleSearch(e.target.value)}
                size="sm"
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Desktop: DataTable */}
        <DataTable<CompanyConfig>
          data={paginatedConfigs}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[15, 30, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setPageIndex(pi);
            setPageSize(ps);
          }}
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-control-label">
              {t('settings.config.empty')}
            </div>
          }
        />

        {/* Mobile: Card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-control-label">
                {t('settings.config.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {paginatedConfigs.map((config) => (
                  <div
                    key={config.company_id}
                    className="px-4 py-3 cursor-pointer active:bg-surface-hover"
                    onClick={() => handleEdit(config)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{config.company_name}</span>
                      {config.pause_enabled
                        ? <CheckCircle size={14} className="text-success shrink-0" />
                        : <XCircle size={14} className="text-fg/30 shrink-0" />
                      }
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
                      <div>
                        <div className="text-[10px] text-control-label">{t('settings.config.gracePeriodDays')}</div>
                        <div className="tabular-nums font-medium">{config.grace_period_days}d</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-control-label">{t('settings.config.lateFeePerDay')}</div>
                        <div className="tabular-nums font-medium">฿{config.late_fee_per_day}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-control-label">{t('settings.config.lateFeeSplit')}</div>
                        <div className="tabular-nums font-medium">{config.late_fee_split_holding}/{config.late_fee_split_company}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-1 text-sm">
                      <div>
                        <div className="text-[10px] text-control-label">{t('settings.config.draftExpiryDays')}</div>
                        <div className="tabular-nums font-medium">{config.draft_expiry_days}d</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-control-label">{t('settings.config.pauseMaxDeferred')}</div>
                        <div className="tabular-nums font-medium">{config.pause_max_deferred}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-control-label">{t('settings.config.commMinActiveDays')}</div>
                        <div className="tabular-nums font-medium">{config.comm_min_active_days}d</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {totalCount > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(totalCount / pageSize)}
              onPageChange={(p) => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[15, 30, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
      </div>

      <EditConfigModal
        config={editConfig}
        open={!!editConfig}
        onClose={() => setEditConfig(null)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['company-config'] })}
      />
    </>
  );
}
