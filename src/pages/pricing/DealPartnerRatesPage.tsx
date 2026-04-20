import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader,
  Button, Select, Modal, Badge, TextArea, MaskedInput,
  useSnackbarContext, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Plus, XCircle, CheckCircle, Pencil } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface DealPartnerRate {
  id: number;
  holding_id: number;
  holding_name: string;
  company_id: number;
  company_name: string;
  branch_id: number | null;
  branch_name: string | null;
  rate_percent: number;
  is_active: boolean;
  note: string | null;
  scope_level: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

interface BranchLookup {
  id: number;
  name: string;
}

// ── Upsert Modal ────────────────────────────────────────────────────────────

interface RateFormData {
  scope: string;
  branch_id: string;
  rate_percent: string;
  note: string;
}

function RateModal({ open, onClose, editRate, branches, onSuccess }: {
  open: boolean;
  onClose: () => void;
  editRate: DealPartnerRate | null;
  branches: BranchLookup[];
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const { register, handleSubmit, control, formState: { errors, isDirty }, reset, watch, setValue } = useForm<RateFormData>({
    defaultValues: { scope: 'BRANCH', branch_id: '', rate_percent: '', note: '' },
  });

  // Register scope and branch_id so they participate in form data + validation
  register('scope');
  register('branch_id', {
    validate: (val) => {
      if (watch('scope') === 'BRANCH' && !val) return t('dealPartnerRate.branchRequired');
      return true;
    },
  });

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const scope = watch('scope');

  useEffect(() => {
    if (open) {
      if (editRate) {
        reset({
          scope: editRate.scope_level,
          branch_id: editRate.branch_id ? String(editRate.branch_id) : '',
          rate_percent: String(editRate.rate_percent),
          note: editRate.note ?? '',
        });
      } else {
        reset({ scope: 'BRANCH', branch_id: '', rate_percent: '', note: '' });
      }
      setErrorMessage('');
    }
  }, [open, editRate, reset]);

  const onSubmit = async (data: RateFormData) => {
    setIsSaving(true);
    setErrorMessage('');
    try {
      await apiClient.rpc('fn_deal_partner_rate_upsert', {
        p_rate_percent: parseFloat(data.rate_percent),
        p_scope: data.scope,
        p_branch_id: data.scope === 'BRANCH' ? parseInt(data.branch_id) : null,
        p_note: data.note.trim() || null,
        p_updated_by: user?.user_id,
      });
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (isDirty) { setConfirmCloseOpen(true); return; }
    forceClose();
  };

  const forceClose = () => {
    reset({ scope: 'BRANCH', branch_id: '', rate_percent: '', note: '' });
    setErrorMessage('');
    setConfirmCloseOpen(false);
    onClose();
  };

  const scopeOptions = [
    { value: 'BRANCH', label: t('dealPartnerRate.scopeBranch') },
    { value: 'COMPANY', label: t('dealPartnerRate.scopeCompany') },
    { value: 'HOLDING', label: t('dealPartnerRate.scopeHolding') },
  ];

  const branchOptions = useMemo(
    () => branches.map(b => ({ value: String(b.id), label: b.name })),
    [branches],
  );

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="24rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">
            {editRate ? t('dealPartnerRate.editRate') : t('dealPartnerRate.addRate')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          <div className="form-grid">
            {errorMessage && (
              <div className="alert alert-danger">
                <XCircle size={16} />
                <div><div className="alert-description text-xs">{errorMessage}</div></div>
              </div>
            )}

            <div className="flex flex-col">
              <label className="form-label">{t('dealPartnerRate.scope')}</label>
              <Select
                options={scopeOptions}
                value={scope}
                onChange={val => { setValue('scope', val as string, { shouldDirty: true }); if (val !== 'BRANCH') setValue('branch_id', ''); }}
                showChevron
                searchable={false}
                disabled={!!editRate}
              />
            </div>

            {scope === 'BRANCH' && (
              <div className="flex flex-col">
                <label className="form-label">{t('dealPartnerRate.branch')}</label>
                <Select
                  options={branchOptions}
                  value={watch('branch_id')}
                  onChange={val => setValue('branch_id', val as string, { shouldDirty: true })}
                  placeholder={t('dealPartnerRate.selectBranch')}
                  searchable
                  showChevron
                  disabled={!!editRate}
                />
                <FormErrorMessage error={errors.branch_id} />
              </div>
            )}

            <div className="flex flex-col">
              <label className="form-label">{t('dealPartnerRate.ratePercent')}</label>
              <Controller
                name="rate_percent"
                control={control}
                rules={{ required: t('dealPartnerRate.rateRequired') }}
                render={({ field }) => (
                  <MaskedInput
                    mask="number"
                    decimalScale={2}
                    value={field.value}
                    onChange={(raw) => field.onChange(raw)}
                    suffix="%"
                  />
                )}
              />
              <FormErrorMessage error={errors.rate_percent} />
            </div>

            <div className="flex flex-col">
              <label className="form-label">{t('dealPartnerRate.note')}</label>
              <TextArea
                rows={2}
                {...register('note')}
                placeholder={t('dealPartnerRate.notePlaceholder')}
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="outline" onClick={handleClose} type="button">
            {t('common.cancel')}
          </Button>
          <Button color="primary" type="submit" disabled={isSaving}>
            {isSaving ? t('pricing.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>

    <Modal open={confirmCloseOpen} onClose={() => setConfirmCloseOpen(false)} maxWidth="24rem" width="100%">
      <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
      <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => setConfirmCloseOpen(false)}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
      </div>
    </Modal>
    </>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function DealPartnerRatesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();
  const canManage = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(user?.role_code ?? '');

  const [sorting, setSorting] = useState<SortingState>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRate, setEditRate] = useState<DealPartnerRate | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const { data: rates = [], isFetching } = useQuery({
    queryKey: ['deal-partner-rates'],
    queryFn: () => apiClient.get<DealPartnerRate[]>('/v_deal_partner_rates?order=scope_level,branch_name.asc.nullslast'),
    staleTime: 30 * 1000,
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-deal-partner'],
    queryFn: () => apiClient.get<BranchLookup[]>('/v_branches?select=id,name&branch_type=eq.DEAL_PARTNER&is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
  });

  const totalCount = rates.length;
  const paginatedRates = rates.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const handleCreate = () => {
    setEditRate(null);
    setModalOpen(true);
  };

  const handleEdit = (rate: DealPartnerRate) => {
    setEditRate(rate);
    setModalOpen(true);
  };



  const handleSuccess = () => {
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <span>{t('dealPartnerRate.saved')}</span>
        </div>
      ),
    });
    queryClient.invalidateQueries({ queryKey: ['deal-partner-rates'] });
  };

  const scopeLabel = (level: string) => {
    switch (level) {
      case 'BRANCH': return t('dealPartnerRate.scopeBranch');
      case 'COMPANY': return t('dealPartnerRate.scopeCompany');
      case 'HOLDING': return t('dealPartnerRate.scopeHolding');
      default: return level;
    }
  };

  const scopeBadgeColor = (scope: string): 'info' | 'warning' | 'success' => {
    switch (scope) {
      case 'HOLDING': return 'warning';
      case 'COMPANY': return 'info';
      case 'BRANCH': return 'success';
      default: return 'info';
    }
  };

  const columns: ColumnDef<DealPartnerRate>[] = [
    {
      accessorKey: 'scope_level',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.scope')} />,
      cell: ({ row }) => <Badge size="sm" color={scopeBadgeColor(row.original.scope_level)}>{scopeLabel(row.original.scope_level)}</Badge>,
      className: 'w-24',
    },
    {
      accessorKey: 'company_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.company')} />,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.company_name ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.branch')} />,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.branch_name ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'rate_percent',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.ratePercent')} />,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.rate_percent}%</span>
      ),
      className: 'w-28',
    },
    {
      accessorKey: 'note',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.note')} />,
      cell: ({ row }) => (
        <span className="text-sm text-control-label truncate max-w-40 block">{row.original.note ?? '—'}</span>
      ),
      className: 'max-md:hidden',
    },
    {
      accessorKey: 'is_active',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.active')} />,
      cell: ({ row }) => row.original.is_active
        ? <Badge size="sm" color="success" startIcon={<CheckCircle />} />
        : <Badge size="sm" color="default" startIcon={<XCircle />} />,
      className: 'w-16',
    },
    ...(canManage ? [{
      id: 'actions',
      header: () => null,
      cell: ({ row }: { row: { original: DealPartnerRate } }) => (
        <button
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-surface-hover cursor-pointer text-control-label hover:text-fg"
          onClick={() => handleEdit(row.original)}
          aria-label={t('common.edit')}
        >
          <Pencil size={14} />
        </button>
      ),
      enableSorting: false,
      className: 'w-10',
    }] : []),
  ];

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
          {t('dealPartnerRate.title')}
        </div>
        <div className="mobile-header-end px-2">
          {canManage && (
            <button
              className="flex items-center justify-center w-8 h-8 rounded hover:bg-surface-hover cursor-pointer text-current"
              onClick={handleCreate}
            >
              <Plus size={18} />
            </button>
          )}
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('dealPartnerRate.title')}</h1>
          {canManage && (
            <Button color="primary" startIcon={<Plus size={16} />} onClick={handleCreate}>
              {t('dealPartnerRate.addRate')}
            </Button>
          )}
        </div>

        <DataTable<DealPartnerRate>
          data={paginatedRates}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[10, 25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={<div className="p-8 text-center text-control-label">{t('dealPartnerRate.empty')}</div>}
        />

        {/* Mobile cards */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {rates.length === 0 ? (
              <div className="p-8 text-center text-control-label">{t('dealPartnerRate.empty')}</div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {paginatedRates.map(rate => (
                  <div
                    key={rate.id}
                    className="px-1 py-3 cursor-pointer active:bg-surface-hover"
                    onClick={() => canManage && handleEdit(rate)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{rate.branch_name ?? scopeLabel(rate.scope_level)}</div>
                        {rate.company_name && <div className="text-xs text-control-label">{rate.company_name}</div>}
                      </div>
                      <Badge size="sm" color={rate.is_active ? 'success' : 'default'}>
                        {rate.is_active ? t('dealPartnerRate.activeLabel') : t('dealPartnerRate.inactiveLabel')}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between mt-1 text-sm">
                      <Badge size="xs" color="info">{scopeLabel(rate.scope_level)}</Badge>
                      <span className="tabular-nums font-medium">{rate.rate_percent}%</span>
                    </div>
                    {rate.note && <div className="text-xs text-control-label mt-1 truncate">{rate.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {totalCount > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(totalCount / pageSize)}
              onPageChange={p => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50]}
              onPageSizeChange={ps => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
      </div>

      <RateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editRate={editRate}
        branches={branches}
        onSuccess={handleSuccess}
      />
    </>
  );
}
