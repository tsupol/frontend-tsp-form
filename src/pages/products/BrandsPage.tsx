import { useState, useEffect, useRef, useCallback, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, Button, Input, PopOver, MenuItem,
  MenuSeparator, Badge, Modal, Switch, useSnackbarContext, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import {
  Plus, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, XCircle, CheckCircle,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface Brand {
  id: number;
  holding_id: number;
  company_id: number | null;
  company_scope_id: number | null;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Brand Row Actions ────────────────────────────────────────────────────────

function BrandRowActions({ brand, onEdit, onToggle }: {
  brand: Brand;
  onEdit: (b: Brand) => void;
  onToggle: (b: Brand) => void;
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
          onClick={(e: MouseEvent) => { e.stopPropagation(); setOpen(!open); }}
        >
          <MoreHorizontal size={16} className="opacity-50" />
        </button>
      }
    >
      <div className="py-1 min-w-[140px]">
        <MenuItem
          icon={<Pencil size={14} />}
          label={t('common.edit')}
          onClick={() => { setOpen(false); onEdit(brand); }}
        />
        <MenuSeparator />
        <MenuItem
          icon={brand.is_active ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
          label={brand.is_active ? t('brandsModels.inactive') : t('brandsModels.active')}
          onClick={() => { setOpen(false); onToggle(brand); }}
        />
      </div>
    </PopOver>
  );
}

// ── Create Brand Modal ───────────────────────────────────────────────────────

interface BrandFormData {
  code: string;
  name: string;
}

function CreateBrandModal({ open, onClose, holdingId }: { open: boolean; onClose: () => void; holdingId: number | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<BrandFormData>({
    defaultValues: { code: '', name: '' },
  });

  const onSubmit = async (data: BrandFormData) => {
    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('ref_brand_create', {
        p_holding_id: holdingId,
        p_code: data.code,
        p_name: data.name,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('brandsModels.brandCreateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      reset();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  const handleClose = () => {
    reset();
    setErrorMessage('');
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth="24rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{t('brandsModels.addBrand')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          {errorMessage && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={18} />
              <div><div className="alert-description">{errorMessage}</div></div>
            </div>
          )}
          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label" htmlFor="cb-code">{t('brandsModels.brandCode')}</label>
              <Input
                id="cb-code"
                error={!!errors.code}
                {...register('code', { required: t('brandsModels.brandCode') + ' is required' })}
              />
              <FormErrorMessage error={errors.code} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="cb-name">{t('brandsModels.brandName')}</label>
              <Input
                id="cb-name"
                error={!!errors.name}
                {...register('name', { required: t('brandsModels.brandName') + ' is required' })}
              />
              <FormErrorMessage error={errors.name} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
          <Button type="submit" color="primary" disabled={isPending}>
            {isPending ? t('common.loading') : t('common.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Edit Brand Modal ─────────────────────────────────────────────────────────

interface EditBrandFormData {
  code: string;
  name: string;
  is_active: boolean;
}

function EditBrandModal({ brand, open, onClose }: { brand: Brand | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<EditBrandFormData>({
    defaultValues: { code: '', name: '', is_active: true },
  });

  useEffect(() => {
    if (brand && open) {
      reset({ code: brand.code, name: brand.name, is_active: brand.is_active });
      setErrorMessage('');
    }
  }, [brand, open, reset]);

  const onSubmit = async (data: EditBrandFormData) => {
    if (!brand) return;
    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('ref_brand_update', {
        p_brand_id: brand.id,
        p_code: data.code,
        p_name: data.name,
        p_is_active: data.is_active,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('brandsModels.brandUpdateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  const handleClose = () => {
    setErrorMessage('');
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth="24rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{t('brandsModels.editBrand')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          {errorMessage && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={18} />
              <div><div className="alert-description">{errorMessage}</div></div>
            </div>
          )}
          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label" htmlFor="eb-code">{t('brandsModels.brandCode')}</label>
              <Input
                id="eb-code"
                error={!!errors.code}
                {...register('code', { required: t('brandsModels.brandCode') + ' is required' })}
              />
              <FormErrorMessage error={errors.code} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="eb-name">{t('brandsModels.brandName')}</label>
              <Input
                id="eb-name"
                error={!!errors.name}
                {...register('name', { required: t('brandsModels.brandName') + ' is required' })}
              />
              <FormErrorMessage error={errors.name} />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0" htmlFor="eb-active">{t('brandsModels.active')}</label>
              <Controller
                name="is_active"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} id="eb-active" checked={value} onChange={(e) => onChange(e.target.checked)} />
                )}
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
          <Button type="submit" color="primary" disabled={isPending}>
            {isPending ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function BrandsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const holdingId = user?.holding_id ?? null;

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [editBrand, setEditBrand] = useState<Brand | null>(null);

  const buildEndpoint = useCallback(() => {
    const params: string[] = [];
    if (holdingId) params.push(`holding_id=eq.${holdingId}`);
    if (search.trim()) {
      const term = encodeURIComponent(search.trim());
      params.push(`or=(code.ilike.*${term}*,name.ilike.*${term}*)`);
    }
    if (sorting.length > 0) {
      const order = sorting.map(s => `${s.id}.${s.desc ? 'desc' : 'asc'}`).join(',');
      params.push(`order=${order}`);
    }
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    return `/v_ref_brand_list${qs}`;
  }, [holdingId, search, sorting]);

  const { data, isError, error, isFetching } = useQuery({
    queryKey: ['brands', pageIndex, pageSize, search, holdingId, sorting],
    queryFn: () => apiClient.getPaginated<Brand>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const brands = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPageIndex(0);
    }, 300);
  };

  const handleToggle = async (brand: Brand) => {
    const start = Date.now();
    try {
      await apiClient.rpc('ref_brand_set_active', {
        p_brand_id: brand.id,
        p_is_active: !brand.is_active,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('brandsModels.brandUpdateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['brands'] });
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
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
    }
  };

  const columns: ColumnDef<Brand>[] = [
    {
      accessorKey: 'code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('brandsModels.brandCode')} />,
      cell: ({ row }) => <span className="text-xs font-medium">{row.getValue('code')}</span>,
    },
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('brandsModels.brandName')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('name')}</span>,
    },
    {
      accessorKey: 'is_active',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.status')} />,
      cell: ({ row }) => {
        const active = row.getValue('is_active') as boolean;
        return (
          <Badge size="sm" color={active ? 'success' : 'danger'}>
            {active ? t('brandsModels.active') : t('brandsModels.inactive')}
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <BrandRowActions
          brand={row.original}
          onEdit={setEditBrand}
          onToggle={handleToggle}
        />
      ),
      enableSorting: false,
    },
  ];

  return (
    <div className="page-content h-dvh max-h-dvh max-w-[64rem] flex flex-col overflow-hidden">
      <div className="flex-none pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="heading-2">{t('brandsModels.brands')}</h1>
          <Button color="primary" startIcon={<Plus />} onClick={() => setCreateOpen(true)}>
            {t('brandsModels.addBrand')}
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Input
            placeholder={t('common.search')}
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            size="sm"
            className="shrink-0"
            style={{ width: '14rem' }}
          />
        </div>
      </div>

      {isError && (
        <div className="px-6">
          <div className="border border-line bg-surface p-6 rounded-lg text-center">
            <div className="text-danger mb-4">{error instanceof Error ? error.message : t('common.error')}</div>
          </div>
        </div>
      )}

      {!isError && (
        <DataTable
          data={brands}
          columns={columns}
          enableSorting
          manualSorting
          sorting={sorting}
          onSortingChange={(updater) => {
            const next = typeof updater === 'function' ? updater(sorting) : updater;
            setSorting(next);
            setPageIndex(0);
          }}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[10, 25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setPageIndex(pi);
            setPageSize(ps);
          }}
          className={`flex-1 min-h-0 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-control-label">
              {t('brandsModels.noBrands')}
            </div>
          }
        />
      )}

      <CreateBrandModal open={createOpen} onClose={() => setCreateOpen(false)} holdingId={holdingId} />
      <EditBrandModal brand={editBrand} open={!!editBrand} onClose={() => setEditBrand(null)} />
    </div>
  );
}
