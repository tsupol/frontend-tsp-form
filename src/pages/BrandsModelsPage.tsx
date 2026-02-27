import { useState, useEffect, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, Button, Input, Select, PopOver, MenuItem,
  MenuSeparator, Badge, Modal, Switch, useSnackbarContext, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import {
  Plus, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, XCircle, CheckCircle, RefreshCw,
} from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

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

function useBrandList(holdingId: number | null, search: string) {
  return useQuery({
    queryKey: ['brands', holdingId, search],
    queryFn: () => apiClient.rpc<ListResult<Brand>>('ref_brand_list', {
      p_holding_id: holdingId,
      p_q: search || null,
      p_is_active: null,
      p_limit: 200,
      p_offset: 0,
    }),
    staleTime: 5 * 60 * 1000,
  });
}

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

function useProductCategories() {
  return useQuery({
    queryKey: ['product-categories'],
    queryFn: () => apiClient.get<ProductCategory[]>('/product_categories?is_active=is.true&order=sort_order'),
    staleTime: 30 * 60 * 1000,
  });
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

export function BrandsModelsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const holdingId = user?.holding_id ?? null;

  // Brand state
  const [brandSearchInput, setBrandSearchInput] = useState('');
  const [brandSearch, setBrandSearch] = useState('');
  const brandSearchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [createBrandOpen, setCreateBrandOpen] = useState(false);
  const [editBrand, setEditBrand] = useState<Brand | null>(null);

  // Family state
  const [familySearchInput, setFamilySearchInput] = useState('');
  const [familySearch, setFamilySearch] = useState('');
  const familySearchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [familyPage, setFamilyPage] = useState(0);
  const [familyPageSize, setFamilyPageSize] = useState(10);
  const [familyBrandFilter, setFamilyBrandFilter] = useState<number | null>(null);
  const [createFamilyOpen, setCreateFamilyOpen] = useState(false);
  const [editFamily, setEditFamily] = useState<ModelFamily | null>(null);

  // Data
  const { data: brandData, isFetching: brandsFetching } = useBrandList(holdingId, brandSearch);
  const brands = brandData?.items ?? [];

  const { data: familyData, isFetching: familiesFetching } = useFamilyList(holdingId, familyBrandFilter, familySearch, familyPage, familyPageSize);
  const families = familyData?.items ?? [];
  const familyTotal = familyData?.total ?? 0;

  const brandFilterOptions = brands.map(b => ({ value: String(b.id), label: b.name }));

  // Brand search debounce
  const handleBrandSearch = (value: string) => {
    setBrandSearchInput(value);
    clearTimeout(brandSearchTimer.current);
    brandSearchTimer.current = setTimeout(() => setBrandSearch(value), 300);
  };

  // Family search debounce
  const handleFamilySearch = (value: string) => {
    setFamilySearchInput(value);
    clearTimeout(familySearchTimer.current);
    familySearchTimer.current = setTimeout(() => {
      setFamilySearch(value);
      setFamilyPage(0);
    }, 300);
  };

  // Toggle brand active
  const handleToggleBrand = async (brand: Brand) => {
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

  // Toggle family active
  const handleToggleFamily = async (family: ModelFamily) => {
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

  // Brand columns
  const brandColumns: ColumnDef<Brand>[] = [
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
          onToggle={handleToggleBrand}
        />
      ),
      enableSorting: false,
    },
  ];

  // Family columns
  const familyColumns: ColumnDef<ModelFamily>[] = [
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
          onToggle={handleToggleFamily}
        />
      ),
      enableSorting: false,
    },
  ];

  return (
    <div className="page-content max-w-[64rem] flex flex-col gap-8 pb-8">
      {/* Page title */}
      <h1 className="heading-2">{t('brandsModels.title')}</h1>

      {/* ── Brands Section ──────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="heading-3">{t('brandsModels.brands')}</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="btn-icon-sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['brands'] })}
            >
              <RefreshCw size={16} />
            </Button>
            <Button color="primary" size="sm" onClick={() => setCreateBrandOpen(true)}>
              <Plus />
              {t('brandsModels.addBrand')}
            </Button>
          </div>
        </div>

        <div className="mb-3">
          <Input
            placeholder={t('common.search')}
            value={brandSearchInput}
            onChange={(e) => handleBrandSearch(e.target.value)}
            size="sm"
            style={{ width: '14rem' }}
          />
        </div>

        <DataTable
          data={brands}
          columns={brandColumns}
          enablePagination={false}
          className={brandsFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}
          noResults={
            <div className="p-8 text-center text-control-label">
              {t('brandsModels.noBrands')}
            </div>
          }
        />
      </section>

      {/* ── Model Families Section ──────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="heading-3">{t('brandsModels.models')}</h2>
          <Button color="primary" size="sm" onClick={() => setCreateFamilyOpen(true)}>
            <Plus />
            {t('brandsModels.addFamily')}
          </Button>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <Input
            placeholder={t('common.search')}
            value={familySearchInput}
            onChange={(e) => handleFamilySearch(e.target.value)}
            size="sm"
            style={{ width: '14rem' }}
          />
          <Select
            options={brandFilterOptions}
            value={familyBrandFilter ? String(familyBrandFilter) : null}
            onChange={(val) => {
              setFamilyBrandFilter(val ? Number(val) : null);
              setFamilyPage(0);
            }}
            placeholder={t('brandsModels.selectBrand')}
            size="sm"
            showChevron
            clearable
            className="flex-1 min-w-0"
            style={{ maxWidth: '14rem' }}
          />
        </div>

        <DataTable
          data={families}
          columns={familyColumns}
          enablePagination
          pageIndex={familyPage}
          pageSize={familyPageSize}
          pageSizeOptions={[10, 25, 50]}
          rowCount={familyTotal}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setFamilyPage(pi);
            setFamilyPageSize(ps);
          }}
          className={familiesFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}
          noResults={
            <div className="p-8 text-center text-control-label">
              {t('brandsModels.noFamilies')}
            </div>
          }
        />
      </section>

      {/* Modals */}
      <CreateBrandModal open={createBrandOpen} onClose={() => setCreateBrandOpen(false)} holdingId={holdingId} />
      <EditBrandModal brand={editBrand} open={!!editBrand} onClose={() => setEditBrand(null)} />
      <CreateFamilyModal open={createFamilyOpen} onClose={() => setCreateFamilyOpen(false)} holdingId={holdingId} brands={brands} />
      <EditFamilyModal family={editFamily} open={!!editFamily} onClose={() => setEditFamily(null)} brands={brands} />
    </div>
  );
}
