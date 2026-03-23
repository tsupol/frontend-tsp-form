import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader,
  Button, Input, Modal, Badge, Switch,
  useSnackbarContext, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Plus, XCircle, CheckCircle, Pencil } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface DealPartnerRate {
  id: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  rate_percent: number;
  is_active: boolean;
  note: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

// ── Upsert Modal ─────────────────────────────────────────────────────────────

interface RateFormData {
  branch_id: string;
  rate_percent: string;
  note: string;
}

function RateModal({ open, onClose, editRate, onSuccess }: {
  open: boolean;
  onClose: () => void;
  editRate: DealPartnerRate | null;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();

  const { register, handleSubmit, formState: { errors, isDirty }, reset } = useForm<RateFormData>({
    defaultValues: { branch_id: '', rate_percent: '', note: '' },
  });

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  useEffect(() => {
    if (open) {
      if (editRate) {
        reset({
          branch_id: String(editRate.branch_id),
          rate_percent: String(editRate.rate_percent),
          note: editRate.note ?? '',
        });
      } else {
        reset({ branch_id: '', rate_percent: '', note: '' });
      }
      setErrorMessage('');
    }
  }, [open, editRate, reset]);

  const onSubmit = async (data: RateFormData) => {
    setIsSaving(true);
    setErrorMessage('');
    try {
      await apiClient.rpc('fn_deal_partner_rate_upsert', {
        p_branch_id: parseInt(data.branch_id),
        p_rate_percent: parseFloat(data.rate_percent),
        p_note: data.note.trim() || null,
      });
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
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
    reset({ branch_id: '', rate_percent: '', note: '' });
    setErrorMessage('');
    setConfirmCloseOpen(false);
    onClose();
  };

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
              <label className="form-label">{t('dealPartnerRate.branchId')}</label>
              <Input
                type="number"
                min={1}
                step={1}
                size="sm"
                disabled={!!editRate}
                {...register('branch_id', { required: t('dealPartnerRate.branchRequired') })}
              />
              <FormErrorMessage error={errors.branch_id} />
            </div>

            <div className="flex flex-col">
              <label className="form-label">{t('dealPartnerRate.ratePercent')}</label>
              <Input
                type="number"
                min={0}
                max={100}
                step="0.01"
                size="sm"
                {...register('rate_percent', { required: t('dealPartnerRate.rateRequired') })}
              />
              <FormErrorMessage error={errors.rate_percent} />
            </div>

            <div className="flex flex-col">
              <label className="form-label">{t('dealPartnerRate.note')}</label>
              <Input
                size="sm"
                {...register('note')}
                placeholder={t('dealPartnerRate.notePlaceholder')}
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="outline" size="sm" onClick={handleClose} type="button">
            {t('common.cancel')}
          </Button>
          <Button color="primary" size="sm" type="submit" disabled={isSaving}>
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

  const [sorting, setSorting] = useState<SortingState>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRate, setEditRate] = useState<DealPartnerRate | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const { data: rates = [], isFetching } = useQuery({
    queryKey: ['deal-partner-rates'],
    queryFn: () => apiClient.get<DealPartnerRate[]>('/v_deal_partner_rates?order=branch_name'),
    staleTime: 30 * 1000,
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

  const handleToggleActive = async (rate: DealPartnerRate) => {
    try {
      await apiClient.rpc('fn_deal_partner_rate_set_active', {
        p_rate_id: rate.id,
        p_is_active: !rate.is_active,
      });
      queryClient.invalidateQueries({ queryKey: ['deal-partner-rates'] });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">
              {t(rate.is_active ? 'dealPartnerRate.deactivated' : 'dealPartnerRate.activated')}
            </div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
    } catch (err) {
      const msg = err instanceof ApiError
        ? (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || err.message
        : t('common.error');
      addSnackbar({
        message: (
          <div className="alert alert-danger">
            <XCircle size={18} />
            <div><div className="alert-title">{msg}</div></div>
          </div>
        ),
        type: 'error',
        duration: 5000,
      });
    }
  };

  const handleSuccess = () => {
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <div><div className="alert-title">{t('dealPartnerRate.saved')}</div></div>
        </div>
      ),
      type: 'success',
      duration: 3000,
    });
    queryClient.invalidateQueries({ queryKey: ['deal-partner-rates'] });
  };

  const columns: ColumnDef<DealPartnerRate>[] = [
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.branch')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-sm font-medium">{row.original.branch_name}</div>
          <div className="text-[11px] text-control-label">ID: {row.original.branch_id}</div>
        </div>
      ),
    },
    {
      accessorKey: 'rate_percent',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.ratePercent')} />,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums font-medium">{row.original.rate_percent}%</span>
      ),
    },
    {
      accessorKey: 'note',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.note')} />,
      cell: ({ row }) => (
        <span className="text-sm text-control-label">{row.original.note ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'is_active',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.active')} />,
      cell: ({ row }) => (
        <Switch
          checked={row.original.is_active}
          onChange={() => handleToggleActive(row.original)}
          size="sm"
        />
      ),
      className: 'w-20',
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <button
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-surface-hover cursor-pointer text-control-label hover:text-fg"
          onClick={() => handleEdit(row.original)}
          aria-label={t('common.edit')}
        >
          <Pencil size={14} />
        </button>
      ),
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
          {t('dealPartnerRate.title')}
        </div>
        <div className="mobile-header-end px-2">
          <button
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-surface-hover cursor-pointer text-current"
            aria-label={t('dealPartnerRate.addRate')}
            onClick={handleCreate}
          >
            <Plus size={18} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header max-w-[64rem]">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('dealPartnerRate.title')}</h1>
          <Button color="primary" startIcon={<Plus size={16} />} onClick={handleCreate}>
            {t('dealPartnerRate.addRate')}
          </Button>
        </div>

        {/* Desktop: DataTable */}
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
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setPageIndex(pi);
            setPageSize(ps);
          }}
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-control-label">
              {t('dealPartnerRate.empty')}
            </div>
          }
        />

        {/* Mobile: Card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {rates.length === 0 ? (
              <div className="p-8 text-center text-control-label">
                {t('dealPartnerRate.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {paginatedRates.map((rate) => (
                  <div
                    key={rate.id}
                    className="px-1 py-3 cursor-pointer active:bg-surface-hover"
                    onClick={() => handleEdit(rate)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{rate.branch_name}</div>
                        <div className="text-xs text-control-label">ID: {rate.branch_id}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge size="sm" color={rate.is_active ? 'success' : 'default'}>
                          {rate.is_active ? t('dealPartnerRate.activeLabel') : t('dealPartnerRate.inactiveLabel')}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2 text-sm">
                      <span className="text-control-label">{t('dealPartnerRate.ratePercent')}</span>
                      <span className="tabular-nums font-medium">{rate.rate_percent}%</span>
                    </div>
                    {rate.note && (
                      <div className="text-xs text-control-label mt-1 truncate">{rate.note}</div>
                    )}
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
              pageSizeOptions={[10, 25, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
      </div>

      <RateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editRate={editRate}
        onSuccess={handleSuccess}
      />
    </>
  );
}
