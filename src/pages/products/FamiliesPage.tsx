import { useState, useEffect, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, Button, Input, Select, PopOver, MenuItem,
  MenuSeparator, Badge, Modal, Switch, useSnackbarContext, FormErrorMessage,
  type ColumnDef,
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
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ModelFamily {
  id: number;
  holding_id: number;
  brand_id: number;
  brand_code: string;
  brand_name: string;
  category_id: number;
  category_code: string;
  category_name: string;
  family_code: string;
  display_name: string;
  default_model_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ProductCategory {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

interface ListResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

function useFamilyList(holdingId: number | null, brandFilter: number | null, search: string, page: number, pageSize: number) {
  return useQuery({
    queryKey: ['families', holdingId, brandFilter, search, page, pageSize],
    queryFn: () => apiClient.rpc<ListResult<ModelFamily>>('ref_family_list', {
      p_holding_id: holdingId,
      p_brand_id: brandFilter || null,
      p_q: search || null,
      p_is_active: null,
      p_limit: pageSize,
      p_offset: page * pageSize,
    }),
    staleTime: 5 * 60 * 1000,
  });
}

function useAllBrands(holdingId: number | null) {
  return useQuery({
    queryKey: ['brands', 'all', holdingId],
    queryFn: () => apiClient.rpc<ListResult<Brand>>('ref_brand_list', {
      p_holding_id: holdingId,
      p_q: null,
      p_is_active: null,
      p_limit: 500,
      p_offset: 0,
    }),
    staleTime: 5 * 60 * 1000,
  });
}

function useProductCategories() {
  return useQuery({
    queryKey: ['product-categories'],
    queryFn: () => apiClient.get<ProductCategory[]>('/v_product_categories?is_active=is.true&order=sort_order'),
    staleTime: 30 * 60 * 1000,
  });
}

// ── Family Row Actions ───────────────────────────────────────────────────────

function FamilyRowActions({ family, onEdit, onToggle }: {
  family: ModelFamily;
  onEdit: (f: ModelFamily) => void;
  onToggle: (f: ModelFamily) => void;
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
          onClick={() => { setOpen(false); onEdit(family); }}
        />
        <MenuSeparator />
        <MenuItem
          icon={family.is_active ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
          label={family.is_active ? t('brandsModels.inactive') : t('brandsModels.active')}
          onClick={() => { setOpen(false); onToggle(family); }}
        />
      </div>
    </PopOver>
  );
}

// ── Create Family Modal ──────────────────────────────────────────────────────

interface FamilyFormData {
  brand_id: string;
  category_id: string;
  family_code: string;
  display_name: string;
  default_model_name: string;
}

function CreateFamilyModal({ open, onClose, holdingId, brands }: {
  open: boolean;
  onClose: () => void;
  holdingId: number | null;
  brands: Brand[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const { data: categories = [] } = useProductCategories();
  const brandOptions = brands.filter(b => b.is_active).map(b => ({ value: String(b.id), label: b.name }));
  const categoryOptions = categories.map(c => ({ value: String(c.id), label: c.name }));

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<FamilyFormData>({
    defaultValues: { brand_id: '', category_id: '', family_code: '', display_name: '', default_model_name: '' },
  });

  const brandId = watch('brand_id');
  const categoryId = watch('category_id');

  const onSubmit = async (data: FamilyFormData) => {
    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('ref_family_create', {
        p_holding_id: holdingId,
        p_brand_id: Number(data.brand_id),
        p_category_id: Number(data.category_id),
        p_family_code: data.family_code,
        p_display_name: data.display_name,
        p_default_model_name: data.default_model_name || null,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('brandsModels.familyCreateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['families'] });
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
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{t('brandsModels.addFamily')}</h2>
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
              <label className="form-label">{t('brandsModels.brand')}</label>
              <Select
                options={brandOptions}
                value={brandId || null}
                onChange={(val) => setValue('brand_id', (val as string) ?? '', { shouldValidate: true })}
                placeholder={t('brandsModels.selectBrand')}
                showChevron
                error={!!errors.brand_id}
              />
              <input type="hidden" {...register('brand_id', { required: t('brandsModels.selectBrand') })} />
              <FormErrorMessage error={errors.brand_id} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('brandsModels.category')}</label>
              <Select
                options={categoryOptions}
                value={categoryId || null}
                onChange={(val) => setValue('category_id', (val as string) ?? '', { shouldValidate: true })}
                placeholder={t('brandsModels.selectCategory')}
                showChevron
                error={!!errors.category_id}
              />
              <input type="hidden" {...register('category_id', { required: t('brandsModels.selectCategory') })} />
              <FormErrorMessage error={errors.category_id} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="cf-code">{t('brandsModels.familyCode')}</label>
              <Input
                id="cf-code"
                error={!!errors.family_code}
                {...register('family_code', { required: t('brandsModels.familyCode') + ' is required' })}
              />
              <FormErrorMessage error={errors.family_code} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="cf-display">{t('brandsModels.displayName')}</label>
              <Input
                id="cf-display"
                error={!!errors.display_name}
                {...register('display_name', { required: t('brandsModels.displayName') + ' is required' })}
              />
              <FormErrorMessage error={errors.display_name} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="cf-default">{t('brandsModels.defaultModelName')}</label>
              <Input
                id="cf-default"
                {...register('default_model_name')}
              />
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

// ── Edit Family Modal ────────────────────────────────────────────────────────

interface EditFamilyFormData {
  brand_id: string;
  category_id: string;
  family_code: string;
  display_name: string;
  default_model_name: string;
  is_active: boolean;
}

function EditFamilyModal({ family, open, onClose, brands }: {
  family: ModelFamily | null;
  open: boolean;
  onClose: () => void;
  brands: Brand[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const { data: categories = [] } = useProductCategories();
  const brandOptions = brands.filter(b => b.is_active).map(b => ({ value: String(b.id), label: b.name }));
  const categoryOptions = categories.map(c => ({ value: String(c.id), label: c.name }));

  const { register, handleSubmit, control, setValue, watch, reset, formState: { errors } } = useForm<EditFamilyFormData>({
    defaultValues: { brand_id: '', category_id: '', family_code: '', display_name: '', default_model_name: '', is_active: true },
  });

  const brandId = watch('brand_id');
  const categoryId = watch('category_id');

  useEffect(() => {
    if (family && open) {
      reset({
        brand_id: String(family.brand_id),
        category_id: String(family.category_id),
        family_code: family.family_code,
        display_name: family.display_name,
        default_model_name: family.default_model_name ?? '',
        is_active: family.is_active,
      });
      setErrorMessage('');
    }
  }, [family, open, reset]);

  const onSubmit = async (data: EditFamilyFormData) => {
    if (!family) return;
    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('ref_family_update', {
        p_family_id: family.id,
        p_brand_id: Number(data.brand_id),
        p_category_id: Number(data.category_id),
        p_family_code: data.family_code,
        p_display_name: data.display_name,
        p_default_model_name: data.default_model_name || null,
        p_is_active: data.is_active,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('brandsModels.familyUpdateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['families'] });
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
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{t('brandsModels.editFamily')}</h2>
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
              <label className="form-label">{t('brandsModels.brand')}</label>
              <Select
                options={brandOptions}
                value={brandId || null}
                onChange={(val) => setValue('brand_id', (val as string) ?? '', { shouldValidate: true })}
                placeholder={t('brandsModels.selectBrand')}
                showChevron
                error={!!errors.brand_id}
              />
              <input type="hidden" {...register('brand_id', { required: t('brandsModels.selectBrand') })} />
              <FormErrorMessage error={errors.brand_id} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('brandsModels.category')}</label>
              <Select
                options={categoryOptions}
                value={categoryId || null}
                onChange={(val) => setValue('category_id', (val as string) ?? '', { shouldValidate: true })}
                placeholder={t('brandsModels.selectCategory')}
                showChevron
                error={!!errors.category_id}
              />
              <input type="hidden" {...register('category_id', { required: t('brandsModels.selectCategory') })} />
              <FormErrorMessage error={errors.category_id} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="ef-code">{t('brandsModels.familyCode')}</label>
              <Input
                id="ef-code"
                error={!!errors.family_code}
                {...register('family_code', { required: t('brandsModels.familyCode') + ' is required' })}
              />
              <FormErrorMessage error={errors.family_code} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="ef-display">{t('brandsModels.displayName')}</label>
              <Input
                id="ef-display"
                error={!!errors.display_name}
                {...register('display_name', { required: t('brandsModels.displayName') + ' is required' })}
              />
              <FormErrorMessage error={errors.display_name} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="ef-default">{t('brandsModels.defaultModelName')}</label>
              <Input
                id="ef-default"
                {...register('default_model_name')}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0" htmlFor="ef-active">{t('brandsModels.active')}</label>
              <Controller
                name="is_active"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} id="ef-active" checked={value} onChange={(e) => onChange(e.target.checked)} />
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

export function FamiliesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const holdingId = user?.holding_id ?? null;

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [brandFilter, setBrandFilter] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editFamily, setEditFamily] = useState<ModelFamily | null>(null);

  const { data: allBrandData } = useAllBrands(holdingId);
  const allBrands = allBrandData?.items ?? [];

  const { data: familyData, isFetching } = useFamilyList(holdingId, brandFilter, search, page, pageSize);
  const families = familyData?.items ?? [];
  const total = familyData?.total ?? 0;

  const brandFilterOptions = allBrands.map(b => ({ value: String(b.id), label: b.name }));

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPage(0);
    }, 300);
  };

  const handleToggle = async (family: ModelFamily) => {
    const start = Date.now();
    try {
      await apiClient.rpc('ref_family_set_active', {
        p_family_id: family.id,
        p_is_active: !family.is_active,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('brandsModels.familyUpdateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['families'] });
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

  const columns: ColumnDef<ModelFamily>[] = [
    {
      accessorKey: 'family_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('brandsModels.familyCode')} />,
      cell: ({ row }) => <span className="text-xs font-medium">{row.getValue('family_code')}</span>,
    },
    {
      accessorKey: 'display_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('brandsModels.displayName')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('display_name')}</span>,
    },
    {
      accessorKey: 'brand_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('brandsModels.brand')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('brand_name')}</span>,
    },
    {
      accessorKey: 'category_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('brandsModels.category')} />,
      cell: ({ row }) => (
        <Badge size="sm" className="capitalize">{row.getValue('category_name')}</Badge>
      ),
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
        <FamilyRowActions
          family={row.original}
          onEdit={setEditFamily}
          onToggle={handleToggle}
        />
      ),
      enableSorting: false,
    },
  ];

  return (
    <div className="page-content max-w-[64rem] flex flex-col gap-6 pb-8">
      <h1 className="heading-2">{t('brandsModels.models')}</h1>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Input
              placeholder={t('common.search')}
              value={searchInput}
              onChange={(e) => handleSearch(e.target.value)}
              size="sm"
              style={{ width: '14rem' }}
            />
            <div style={{ width: '14rem' }}>
              <Select
                options={brandFilterOptions}
                value={brandFilter ? String(brandFilter) : null}
                onChange={(val) => {
                  setBrandFilter(val ? Number(val) : null);
                  setPage(0);
                }}
                placeholder={t('brandsModels.selectBrand')}
                size="sm"
                showChevron
                clearable
              />
            </div>
          </div>
          <Button color="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            {t('brandsModels.addFamily')}
          </Button>
        </div>

        <DataTable
          data={families}
          columns={columns}
          enablePagination
          pageIndex={page}
          pageSize={pageSize}
          pageSizeOptions={[10, 25, 50]}
          rowCount={total}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setPage(pi);
            setPageSize(ps);
          }}
          className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}
          noResults={
            <div className="p-8 text-center text-control-label">
              {t('brandsModels.noFamilies')}
            </div>
          }
        />
      </section>

      <CreateFamilyModal open={createOpen} onClose={() => setCreateOpen(false)} holdingId={holdingId} brands={allBrands} />
      <EditFamilyModal family={editFamily} open={!!editFamily} onClose={() => setEditFamily(null)} brands={allBrands} />
    </div>
  );
}
