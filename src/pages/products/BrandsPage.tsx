import { useState, useEffect, useCallback, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, Button, Input, PopOver, MenuItem, Select,
  MenuSeparator, Badge, Modal, Switch, useSnackbarContext, FormErrorMessage,
  MobileHeader, DataTableFooter,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import {
  Plus, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, XCircle, CheckCircle,
  ArrowRightFromLine, SlidersHorizontal,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { translateApiError } from '../../lib/apiErrors';
import { SearchInput } from '../../components/SearchInput';

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

  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<BrandFormData>({
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
        const translated = translateApiError(err, t);
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
    if (isDirty) { setConfirmCloseOpen(true); return; }
    forceClose();
  };

  const forceClose = () => {
    reset();
    setErrorMessage('');
    setConfirmCloseOpen(false);
    onClose();
  };

  return (
    <>
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
                placeholder={t('brandsModels.brandCodePlaceholder')}
                error={!!errors.code}
                {...register('code', { required: t('brandsModels.brandCode') + ' is required' })}
              />
              <FormErrorMessage error={errors.code} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="cb-name">{t('brandsModels.brandName')}</label>
              <Input
                id="cb-name"
                placeholder={t('brandsModels.brandNamePlaceholder')}
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

  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const { register, handleSubmit, control, reset, formState: { errors, isDirty } } = useForm<EditBrandFormData>({
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
        const translated = translateApiError(err, t);
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
    if (isDirty) { setConfirmCloseOpen(true); return; }
    forceClose();
  };

  const forceClose = () => {
    setErrorMessage('');
    setConfirmCloseOpen(false);
    onClose();
  };

  return (
    <>
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
                placeholder={t('brandsModels.brandCodePlaceholder')}
                error={!!errors.code}
                {...register('code', { required: t('brandsModels.brandCode') + ' is required' })}
              />
              <FormErrorMessage error={errors.code} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="eb-name">{t('brandsModels.brandName')}</label>
              <Input
                id="eb-name"
                placeholder={t('brandsModels.brandNamePlaceholder')}
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
    setSearch(value);
    setPageIndex(0);
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
        ? (translateApiError(err, t)) || err.message
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
      className: 'w-10',
    },
  ];

  const [filterOpen, setFilterOpen] = useState(false);
  const activeFilterCount = sorting.length > 0 ? 1 : 0;

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
          {t('brandsModels.brands')}
        </div>
        <div className="mobile-header-end px-2">
          <button
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-surface-hover cursor-pointer text-current"
            aria-label={t('brandsModels.addBrand')}
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={18} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('brandsModels.brands')}</h1>
          <Button color="primary" size="sm" startIcon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
            {t('brandsModels.addBrand')}
          </Button>
        </div>

        {/* Filters bar */}
        <div className="flex-none pb-4">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 md:max-w-56">
              <SearchInput
                value={searchInput}
                onChange={setSearchInput}
                onDebouncedChange={handleSearch}
                size="sm"
                className="w-full"
              />
            </div>
            {/* Sort popover — visible <md (no column headers on mobile) */}
            <div className="md:hidden shrink-0">
              <PopOver
                isOpen={filterOpen}
                onClose={() => setFilterOpen(false)}
                placement="bottom"
                align="end"
                maxWidth="300px"
                trigger={
                  <div className="relative inline-flex">
                    <Button
                      variant="outline"
                      size="sm"
                      startIcon={<SlidersHorizontal size={16} />}
                      onClick={() => setFilterOpen(!filterOpen)}
                    />
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none pointer-events-none">
                        {activeFilterCount}
                      </span>
                    )}
                  </div>
                }
              >
                <div className="flex flex-col gap-3 p-3">
                  <div className="text-xs font-medium text-subtle uppercase tracking-wide">{t('common.sortBy')}</div>
                  <Select
                    options={[
                      { value: 'code', label: t('brandsModels.brandCode') },
                      { value: 'name', label: t('brandsModels.brandName') },
                      { value: 'is_active', label: t('users.status') },
                    ]}
                    value={sorting[0]?.id ?? null}
                    onChange={(val) => {
                      if (val) setSorting([{ id: val as string, desc: sorting[0]?.desc ?? false }]);
                      else setSorting([]);
                      setPageIndex(0);
                    }}
                    placeholder={t('common.sortBy')}
                    size="sm"
                    showChevron
                    clearable
                    searchable={false}
                  />
                  {sorting.length > 0 && (
                    <Select
                      options={[
                        { value: 'asc', label: t('common.ascending') },
                        { value: 'desc', label: t('common.descending') },
                      ]}
                      value={sorting[0]?.desc ? 'desc' : 'asc'}
                      onChange={(val) => {
                        setSorting([{ id: sorting[0].id, desc: (val as string) === 'desc' }]);
                        setPageIndex(0);
                      }}
                      size="sm"
                      showChevron
                      searchable={false}
                    />
                  )}
                </div>
              </PopOver>
            </div>
          </div>
        </div>

        {isError && (
          <div className="px-6">
            <div className="border border-line bg-surface p-6 rounded-lg text-center">
              <div className="text-danger mb-4">{error instanceof Error ? error.message : t('common.error')}</div>
            </div>
          </div>
        )}

        {/* Desktop: DataTable */}
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
            className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
            noResults={
              <div className="p-8 text-center text-subtle">
                {t('brandsModels.noBrands')}
              </div>
            }
          />
        )}

        {/* Mobile: Card list */}
        {!isError && (
          <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
            <div className="flex-1 overflow-auto better-scroll pb-8">
              {brands.length === 0 ? (
                <div className="p-8 text-center text-subtle">
                  {t('brandsModels.noBrands')}
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-line">
                  {brands.map((brand) => (
                    <div key={brand.id} className="flex items-center gap-3 px-1 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{brand.code}</div>
                        <div className="text-sm text-subtle truncate">{brand.name}</div>
                      </div>
                      <div className="shrink-0">
                        <Badge size="sm" color={brand.is_active ? 'success' : 'danger'}>
                          {brand.is_active ? t('brandsModels.active') : t('brandsModels.inactive')}
                        </Badge>
                      </div>
                      <BrandRowActions
                        brand={brand}
                        onEdit={setEditBrand}
                        onToggle={handleToggle}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(totalCount / pageSize)}
              onPageChange={(p) => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          </div>
        )}
      </div>

      <CreateBrandModal open={createOpen} onClose={() => setCreateOpen(false)} holdingId={holdingId} />
      <EditBrandModal brand={editBrand} open={!!editBrand} onClose={() => setEditBrand(null)} />
    </>
  );
}
