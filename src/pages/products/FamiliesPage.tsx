import { useState, useEffect, useRef, useCallback, useMemo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, Button, Input, Select, PopOver, MenuItem,
  MenuSeparator, Badge, Modal, Switch, NumberSpinner, RadioGroup, useSnackbarContext, FormErrorMessage,
  MobileHeader, DataTableFooter,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import {
  Plus, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, XCircle, CheckCircle, Layers,
  ArrowRightFromLine, SlidersHorizontal,
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

interface ModelFamily {
  id: number;
  holding_id: number;
  company_id: number | null;
  company_scope_id: number | null;
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

interface ProductAttribute {
  id: number;
  attribute_code: string;
  attribute_name: string;
}

interface FamilyModelAttribute {
  id: number;
  holding_id: number;
  family_id: number;
  attribute_id: number;
  is_required: boolean;
  allow_custom: boolean;
  use_in_model_name: boolean;
  use_in_model_code: boolean;
  name_order: number;
  code_order: number;
  is_active: boolean;
}

interface FamilyVariantAttribute {
  id: number;
  holding_id: number;
  family_id: number;
  attribute_id: number;
  is_required: boolean;
  allow_custom: boolean;
  use_in_sku_name: boolean;
  use_in_sku_code: boolean;
  name_order: number;
  code_order: number;
  is_active: boolean;
}

type AttrLevel = 'model' | 'variant';

interface UnifiedFamilyAttribute {
  id: number;
  level: AttrLevel;
  attribute_id: number;
  is_required: boolean;
  allow_custom: boolean;
  use_in_name: boolean;
  use_in_code: boolean;
  name_order: number;
  code_order: number;
  is_active: boolean;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

function useProductCategories() {
  return useQuery({
    queryKey: ['product-categories'],
    queryFn: () => apiClient.get<ProductCategory[]>('/v_product_categories?is_active=is.true&order=sort_order'),
    staleTime: 30 * 60 * 1000,
  });
}

function useAllBrands(holdingId: number | null) {
  const endpoint = holdingId
    ? `/v_ref_brand_list?holding_id=eq.${holdingId}&is_active=is.true&order=name`
    : '/v_ref_brand_list?is_active=is.true&order=name';
  return useQuery({
    queryKey: ['brands', 'all-active', holdingId],
    queryFn: () => apiClient.get<Brand[]>(endpoint),
    staleTime: 5 * 60 * 1000,
  });
}

function useAllAttributes(holdingId: number | null) {
  const endpoint = holdingId
    ? `/v_product_attribute_list?holding_id=eq.${holdingId}&is_active=is.true&order=attribute_name&select=id,attribute_code,attribute_name`
    : '/v_product_attribute_list?is_active=is.true&order=attribute_name&select=id,attribute_code,attribute_name';
  return useQuery({
    queryKey: ['product-attributes', 'all-active', holdingId],
    queryFn: () => apiClient.get<ProductAttribute[]>(endpoint),
    staleTime: 5 * 60 * 1000,
  });
}

function useFamilyModelAttributes(familyId: number | null) {
  return useQuery({
    queryKey: ['family-model-attributes', familyId],
    queryFn: () => apiClient.get<FamilyModelAttribute[]>(`/v_family_model_attributes?family_id=eq.${familyId}`),
    enabled: !!familyId,
    staleTime: 5 * 60 * 1000,
  });
}

function useFamilyVariantAttributes(familyId: number | null) {
  return useQuery({
    queryKey: ['family-variant-attributes', familyId],
    queryFn: () => apiClient.get<FamilyVariantAttribute[]>(`/v_family_variant_attributes?family_id=eq.${familyId}`),
    enabled: !!familyId,
    staleTime: 5 * 60 * 1000,
  });
}

// ── Family Row Actions ───────────────────────────────────────────────────────

function FamilyRowActions({ family, onEdit, onToggle, onManageAttributes }: {
  family: ModelFamily;
  onEdit: (f: ModelFamily) => void;
  onToggle: (f: ModelFamily) => void;
  onManageAttributes: (f: ModelFamily) => void;
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
          icon={<Layers size={14} />}
          label={t('familyAttributes.manageAttributes')}
          onClick={() => { setOpen(false); onManageAttributes(family); }}
        />
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

  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const { register, handleSubmit, setValue, watch, reset, formState: { errors, isDirty } } = useForm<FamilyFormData>({
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

  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const { register, handleSubmit, control, setValue, watch, reset, formState: { errors, isDirty } } = useForm<EditFamilyFormData>({
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

// ── Family Attribute Row Actions ─────────────────────────────────────────────

function FamilyAttrRowActions({ isActive, onEdit, onToggle }: {
  isActive: boolean;
  onEdit: () => void;
  onToggle: () => void;
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
          onClick={() => { setOpen(false); onEdit(); }}
        />
        <MenuSeparator />
        <MenuItem
          icon={isActive ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
          label={isActive ? t('familyAttributes.inactive') : t('familyAttributes.active')}
          onClick={() => { setOpen(false); onToggle(); }}
        />
      </div>
    </PopOver>
  );
}

// ── Create Family Attribute Modal ─────────────────────────────────────────────

interface CreateAttrFormData {
  attribute_id: string;
  level: AttrLevel;
  is_required: boolean;
  allow_custom: boolean;
  use_in_name: boolean;
  use_in_code: boolean;
  name_order: number | '';
  code_order: number | '';
}

function CreateFamilyAttrModal({ open, onClose, holdingId, familyId, attributes }: {
  open: boolean;
  onClose: () => void;
  holdingId: number | null;
  familyId: number | null;
  attributes: ProductAttribute[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const attrOptions = attributes.map(a => ({ value: String(a.id), label: `${a.attribute_name} (${a.attribute_code})` }));
  const levelOptions = [
    { value: 'model', label: t('familyAttributes.levelModel') },
    { value: 'variant', label: t('familyAttributes.levelVariant') },
  ];

  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const { register, handleSubmit, control, setValue, watch, reset, formState: { errors, isDirty } } = useForm<CreateAttrFormData>({
    defaultValues: { attribute_id: '', level: 'model', is_required: false, allow_custom: false, use_in_name: false, use_in_code: false, name_order: 0, code_order: 0 },
  });

  const attributeId = watch('attribute_id');
  const level = watch('level');

  const onSubmit = async (data: CreateAttrFormData) => {
    if (!familyId) return;
    setIsPending(true);
    const start = Date.now();
    try {
      const nameOrd = data.name_order === '' ? undefined : Number(data.name_order);
      const codeOrd = data.code_order === '' ? undefined : Number(data.code_order);
      if (data.level === 'model') {
        await apiClient.rpc('family_model_attribute_create', {
          p_holding_id: holdingId,
          p_family_id: familyId,
          p_attribute_id: Number(data.attribute_id),
          p_is_required: data.is_required,
          p_allow_custom: data.allow_custom,
          p_use_in_model_name: data.use_in_name,
          p_use_in_model_code: data.use_in_code,
          ...(nameOrd !== undefined && { p_name_order: nameOrd }),
          ...(codeOrd !== undefined && { p_code_order: codeOrd }),
          p_is_active: true,
        });
      } else {
        await apiClient.rpc('family_variant_attribute_create', {
          p_holding_id: holdingId,
          p_family_id: familyId,
          p_attribute_id: Number(data.attribute_id),
          p_is_required: data.is_required,
          p_allow_custom: data.allow_custom,
          p_use_in_sku_name: data.use_in_name,
          p_use_in_sku_code: data.use_in_code,
          ...(nameOrd !== undefined && { p_name_order: nameOrd }),
          ...(codeOrd !== undefined && { p_code_order: codeOrd }),
          p_is_active: true,
        });
      }
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('familyAttributes.createSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['family-model-attributes'] });
      queryClient.invalidateQueries({ queryKey: ['family-variant-attributes'] });
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
    if (isDirty) { setConfirmCloseOpen(true); return; }
    forceClose();
  };

  const forceClose = () => {
    reset();
    setErrorMessage('');
    setConfirmCloseOpen(false);
    onClose();
  };

  const nameLabel = level === 'model' ? t('familyAttributes.useInModelName') : t('familyAttributes.useInSkuName');
  const codeLabel = level === 'model' ? t('familyAttributes.useInModelCode') : t('familyAttributes.useInSkuCode');

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{t('familyAttributes.addAttribute')}</h2>
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
              <label className="form-label">{t('familyAttributes.attribute')}</label>
              <Select
                options={attrOptions}
                value={attributeId || null}
                onChange={(val) => setValue('attribute_id', (val as string) ?? '', { shouldValidate: true })}
                placeholder={t('familyAttributes.selectAttribute')}
                showChevron
                searchable
                error={!!errors.attribute_id}
              />
              <input type="hidden" {...register('attribute_id', { required: t('familyAttributes.selectAttribute') })} />
              <FormErrorMessage error={errors.attribute_id} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('familyAttributes.level')}</label>
              <Controller
                name="level"
                control={control}
                render={({ field: { onChange, value } }) => (
                  <RadioGroup
                    name="cfa-level"
                    value={value}
                    onChange={onChange}
                    options={levelOptions}
                    className="flex gap-4"
                  />
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">{t('familyAttributes.isRequired')}</label>
              <Controller
                name="is_required"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">{t('familyAttributes.allowCustom')}</label>
              <Controller
                name="allow_custom"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">{nameLabel}</label>
              <Controller
                name="use_in_name"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">{codeLabel}</label>
              <Controller
                name="use_in_code"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
                )}
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('familyAttributes.nameOrder')}</label>
              <Controller
                name="name_order"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <NumberSpinner ref={ref} value={value} onChange={onChange} min={0} scale="sm" />
                )}
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('familyAttributes.codeOrder')}</label>
              <Controller
                name="code_order"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <NumberSpinner ref={ref} value={value} onChange={onChange} min={0} scale="sm" />
                )}
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

// ── Edit Family Attribute Modal ──────────────────────────────────────────────

interface EditAttrFormData {
  is_required: boolean;
  allow_custom: boolean;
  use_in_name: boolean;
  use_in_code: boolean;
  name_order: number | '';
  code_order: number | '';
  is_active: boolean;
}

function EditFamilyAttrModal({ rule, attrName, open, onClose }: {
  rule: UnifiedFamilyAttribute | null;
  attrName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const { handleSubmit, control, reset, formState: { isDirty } } = useForm<EditAttrFormData>({
    defaultValues: { is_required: false, allow_custom: false, use_in_name: false, use_in_code: false, name_order: 0, code_order: 0, is_active: true },
  });

  useEffect(() => {
    if (rule && open) {
      reset({
        is_required: rule.is_required,
        allow_custom: rule.allow_custom,
        use_in_name: rule.use_in_name,
        use_in_code: rule.use_in_code,
        name_order: rule.name_order,
        code_order: rule.code_order,
        is_active: rule.is_active,
      });
      setErrorMessage('');
    }
  }, [rule, open, reset]);

  const onSubmit = async (data: EditAttrFormData) => {
    if (!rule) return;
    setIsPending(true);
    const start = Date.now();
    try {
      const nameOrd = data.name_order === '' ? undefined : Number(data.name_order);
      const codeOrd = data.code_order === '' ? undefined : Number(data.code_order);
      if (rule.level === 'model') {
        await apiClient.rpc('family_model_attribute_update', {
          p_rule_id: rule.id,
          p_is_required: data.is_required,
          p_allow_custom: data.allow_custom,
          p_use_in_model_name: data.use_in_name,
          p_use_in_model_code: data.use_in_code,
          ...(nameOrd !== undefined && { p_name_order: nameOrd }),
          ...(codeOrd !== undefined && { p_code_order: codeOrd }),
          p_is_active: data.is_active,
        });
      } else {
        await apiClient.rpc('family_variant_attribute_update', {
          p_rule_id: rule.id,
          p_is_required: data.is_required,
          p_allow_custom: data.allow_custom,
          p_use_in_sku_name: data.use_in_name,
          p_use_in_sku_code: data.use_in_code,
          ...(nameOrd !== undefined && { p_name_order: nameOrd }),
          ...(codeOrd !== undefined && { p_code_order: codeOrd }),
          p_is_active: data.is_active,
        });
      }
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('familyAttributes.updateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['family-model-attributes'] });
      queryClient.invalidateQueries({ queryKey: ['family-variant-attributes'] });
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
    if (isDirty) { setConfirmCloseOpen(true); return; }
    forceClose();
  };

  const forceClose = () => {
    setErrorMessage('');
    setConfirmCloseOpen(false);
    onClose();
  };

  const nameLabel = rule?.level === 'model' ? t('familyAttributes.useInModelName') : t('familyAttributes.useInSkuName');
  const codeLabel = rule?.level === 'model' ? t('familyAttributes.useInModelCode') : t('familyAttributes.useInSkuCode');

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">
            {t('familyAttributes.editAttribute')}
            {attrName && (
              <span className="text-sm font-normal text-control-label ml-2">
                — {attrName}
              </span>
            )}
          </h2>
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
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">{t('familyAttributes.level')}</label>
              <Badge size="sm" color={rule?.level === 'model' ? 'info' : 'secondary'}>
                {rule?.level === 'model' ? t('familyAttributes.levelModel') : t('familyAttributes.levelVariant')}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">{t('familyAttributes.isRequired')}</label>
              <Controller
                name="is_required"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">{t('familyAttributes.allowCustom')}</label>
              <Controller
                name="allow_custom"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">{nameLabel}</label>
              <Controller
                name="use_in_name"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">{codeLabel}</label>
              <Controller
                name="use_in_code"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
                )}
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('familyAttributes.nameOrder')}</label>
              <Controller
                name="name_order"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <NumberSpinner ref={ref} value={value} onChange={onChange} min={0} scale="sm" />
                )}
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('familyAttributes.codeOrder')}</label>
              <Controller
                name="code_order"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <NumberSpinner ref={ref} value={value} onChange={onChange} min={0} scale="sm" />
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">{t('familyAttributes.active')}</label>
              <Controller
                name="is_active"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
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

// ── Manage Family Attributes Modal (Unified) ─────────────────────────────────

function ManageFamilyAttributesModal({ family, open, onClose, holdingId }: {
  family: ModelFamily | null;
  open: boolean;
  onClose: () => void;
  holdingId: number | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [createOpen, setCreateOpen] = useState(false);
  const [editRule, setEditRule] = useState<UnifiedFamilyAttribute | null>(null);

  // Attribute lookup
  const { data: allAttributes = [] } = useAllAttributes(holdingId);
  const attrMap = useMemo(() => {
    const map = new Map<number, ProductAttribute>();
    for (const a of allAttributes) map.set(a.id, a);
    return map;
  }, [allAttributes]);

  // Model attributes data
  const { data: modelAttrs = [], isFetching: modelFetching } = useFamilyModelAttributes(family?.id ?? null);

  // Variant attributes data
  const { data: variantAttrs = [], isFetching: variantFetching } = useFamilyVariantAttributes(family?.id ?? null);

  // Merge into unified list
  const unifiedAttrs: UnifiedFamilyAttribute[] = useMemo(() => {
    const modelItems: UnifiedFamilyAttribute[] = modelAttrs.map(r => ({
      id: r.id,
      level: 'model' as const,
      attribute_id: r.attribute_id,
      is_required: r.is_required,
      allow_custom: r.allow_custom,
      use_in_name: r.use_in_model_name,
      use_in_code: r.use_in_model_code,
      name_order: r.name_order,
      code_order: r.code_order,
      is_active: r.is_active,
    }));
    const variantItems: UnifiedFamilyAttribute[] = variantAttrs.map(r => ({
      id: r.id,
      level: 'variant' as const,
      attribute_id: r.attribute_id,
      is_required: r.is_required,
      allow_custom: r.allow_custom,
      use_in_name: r.use_in_sku_name,
      use_in_code: r.use_in_sku_code,
      name_order: r.name_order,
      code_order: r.code_order,
      is_active: r.is_active,
    }));
    return [...modelItems, ...variantItems];
  }, [modelAttrs, variantAttrs]);

  const isFetching = modelFetching || variantFetching;

  // Toggle handler
  const handleToggle = async (rule: UnifiedFamilyAttribute) => {
    const start = Date.now();
    try {
      const rpcName = rule.level === 'model' ? 'family_model_attribute_set_active' : 'family_variant_attribute_set_active';
      await apiClient.rpc(rpcName, {
        p_rule_id: rule.id,
        p_is_active: !rule.is_active,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('familyAttributes.updateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['family-model-attributes'] });
      queryClient.invalidateQueries({ queryKey: ['family-variant-attributes'] });
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

  const handleClose = () => {
    setCreateOpen(false);
    setEditRule(null);
    onClose();
  };

  const columns: ColumnDef<UnifiedFamilyAttribute>[] = [
    {
      accessorKey: 'attribute_id',
      id: 'attribute_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('attributes.attributeName')} />,
      cell: ({ row }) => {
        const attr = attrMap.get(row.original.attribute_id);
        return (
          <div>
            <span className="text-xs font-medium">{attr?.attribute_name ?? '—'}</span>
            <span className="text-xs text-control-label ml-1.5">({attr?.attribute_code ?? '—'})</span>
          </div>
        );
      },
    },
    {
      id: 'level',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('familyAttributes.level')} />,
      cell: ({ row }) => (
        <Badge size="sm" color={row.original.level === 'model' ? 'info' : 'warning'}>
          {row.original.level === 'model' ? t('familyAttributes.levelModel') : t('familyAttributes.levelVariant')}
        </Badge>
      ),
    },
    {
      id: 'flags',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Flags" />,
      cell: ({ row }) => {
        const r = row.original;
        const nameLabel = r.level === 'model' ? t('familyAttributes.useInModelName') : t('familyAttributes.useInSkuName');
        const codeLabel = r.level === 'model' ? t('familyAttributes.useInModelCode') : t('familyAttributes.useInSkuCode');
        return (
          <div className="flex gap-1 flex-wrap">
            {r.is_required && <Badge size="sm" color="warning">{t('familyAttributes.isRequired')}</Badge>}
            {r.allow_custom && <Badge size="sm">{t('familyAttributes.allowCustom')}</Badge>}
            {r.use_in_name && <Badge size="sm" color="info">{nameLabel}</Badge>}
            {r.use_in_code && <Badge size="sm" color="info">{codeLabel}</Badge>}
          </div>
        );
      },
    },
    {
      accessorKey: 'name_order',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('familyAttributes.nameOrder')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('name_order')}</span>,
    },
    {
      accessorKey: 'code_order',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('familyAttributes.codeOrder')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('code_order')}</span>,
    },
    {
      accessorKey: 'is_active',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.status')} />,
      cell: ({ row }) => {
        const active = row.getValue('is_active') as boolean;
        return (
          <Badge size="sm" color={active ? 'success' : 'danger'}>
            {active ? t('familyAttributes.active') : t('familyAttributes.inactive')}
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <FamilyAttrRowActions
          isActive={row.original.is_active}
          onEdit={() => setEditRule(row.original)}
          onToggle={() => handleToggle(row.original)}
        />
      ),
      enableSorting: false,
      className: 'w-10',
    },
  ];

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="56rem" width="100%">
        <div className="flex flex-col overflow-hidden">
          <div className="modal-header">
            <h2 className="modal-title">
              {t('familyAttributes.title')}
              {family && (
                <span className="text-sm font-normal text-control-label ml-2">
                  — {family.display_name}
                </span>
              )}
            </h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>
          <div className="modal-content">
            <div className="flex items-center justify-end mb-3">
              <Button color="primary" size="sm" startIcon={<Plus />} onClick={() => setCreateOpen(true)}>
                {t('familyAttributes.addAttribute')}
              </Button>
            </div>
            <DataTable
              data={unifiedAttrs}
              columns={columns}
              className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}
              noResults={
                <div className="p-8 text-center text-control-label">
                  {t('familyAttributes.noAttributes')}
                </div>
              }
            />
          </div>
        </div>
      </Modal>

      <CreateFamilyAttrModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        holdingId={holdingId}
        familyId={family?.id ?? null}
        attributes={allAttributes}
      />
      <EditFamilyAttrModal
        rule={editRule}
        attrName={editRule ? (attrMap.get(editRule.attribute_id)?.attribute_name ?? '') : ''}
        open={!!editRule}
        onClose={() => setEditRule(null)}
      />
    </>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function FamiliesPage() {
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
  const [brandFilter, setBrandFilter] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editFamily, setEditFamily] = useState<ModelFamily | null>(null);
  const [manageAttrsFamily, setManageAttrsFamily] = useState<ModelFamily | null>(null);

  const { data: allBrands = [] } = useAllBrands(holdingId);
  const brandFilterOptions = allBrands.map(b => ({ value: String(b.id), label: b.name }));

  const buildEndpoint = useCallback(() => {
    const params: string[] = [];
    if (holdingId) params.push(`holding_id=eq.${holdingId}`);
    if (brandFilter) params.push(`brand_id=eq.${brandFilter}`);
    if (search.trim()) {
      const term = encodeURIComponent(search.trim());
      params.push(`or=(family_code.ilike.*${term}*,display_name.ilike.*${term}*,brand_name.ilike.*${term}*)`);
    }
    if (sorting.length > 0) {
      const order = sorting.map(s => `${s.id}.${s.desc ? 'desc' : 'asc'}`).join(',');
      params.push(`order=${order}`);
    }
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    return `/v_ref_product_family_list${qs}`;
  }, [holdingId, brandFilter, search, sorting]);

  const { data, isError, error, isFetching } = useQuery({
    queryKey: ['families', pageIndex, pageSize, search, holdingId, brandFilter, sorting],
    queryFn: () => apiClient.getPaginated<ModelFamily>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const families = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPageIndex(0);
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
          onManageAttributes={setManageAttrsFamily}
        />
      ),
      enableSorting: false,
      className: 'w-10',
    },
  ];

  const [filterOpen, setFilterOpen] = useState(false);
  const activeFilterCount = (brandFilter ? 1 : 0) + (sorting.length > 0 ? 1 : 0);

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
          {t('brandsModels.models')}
        </div>
        <div className="mobile-header-end px-2">
          <button
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-surface-hover cursor-pointer text-current"
            aria-label={t('brandsModels.addFamily')}
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={18} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('brandsModels.models')}</h1>
          <Button color="primary" startIcon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
            {t('brandsModels.addFamily')}
          </Button>
        </div>

        {/* Filters bar */}
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
            {/* Brand filter — visible ≥sm */}
            <div className="hidden sm:block flex-1 min-w-0 md:max-w-56">
              <Select
                options={brandFilterOptions}
                value={brandFilter ? String(brandFilter) : null}
                onChange={(val) => {
                  setBrandFilter(val ? Number(val) : null);
                  setPageIndex(0);
                }}
                placeholder={t('brandsModels.selectBrand')}
                size="sm"
                showChevron
                clearable
              />
            </div>
            {/* Popover — visible <sm always, sm–md for sort only */}
            <div className="md:hidden shrink-0">
              <PopOver
                isOpen={filterOpen}
                onClose={() => setFilterOpen(false)}
                placement="bottom"
                align="end"
                maxWidth="300px"
                trigger={
                  <Button variant="outline" size="sm" className="relative btn-icon-sm" onClick={() => setFilterOpen(!filterOpen)}>
                    <SlidersHorizontal size={16} />
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>
                }
              >
                <div className="flex flex-col gap-3 p-3">
                  <div className="text-xs font-medium text-muted uppercase tracking-wide">{t('common.filters')}</div>
                  <Select
                    options={brandFilterOptions}
                    value={brandFilter ? String(brandFilter) : null}
                    onChange={(val) => {
                      setBrandFilter(val ? Number(val) : null);
                      setPageIndex(0);
                    }}
                    placeholder={t('brandsModels.selectBrand')}
                    size="sm"
                    showChevron
                    clearable
                  />
                  <div className="text-xs font-medium text-muted uppercase tracking-wide mt-1">{t('common.sortBy')}</div>
                  <Select
                    options={[
                      { value: 'family_code', label: t('brandsModels.familyCode') },
                      { value: 'display_name', label: t('brandsModels.displayName') },
                      { value: 'brand_name', label: t('brandsModels.brand') },
                      { value: 'category_name', label: t('brandsModels.category') },
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
            data={families}
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
              <div className="p-8 text-center text-control-label">
                {t('brandsModels.noFamilies')}
              </div>
            }
          />
        )}

        {/* Mobile: Card list */}
        {!isError && (
          <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
            <div className="flex-1 overflow-auto better-scroll pb-8">
              {families.length === 0 ? (
                <div className="p-8 text-center text-control-label">
                  {t('brandsModels.noFamilies')}
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-line">
                  {families.map((family) => (
                    <div key={family.id} className="flex items-center gap-3 px-1 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{family.family_code}</div>
                        <div className="text-sm text-control-label truncate">{family.display_name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge size="sm" className="capitalize">{family.brand_name}</Badge>
                          <span className="text-xs text-control-label truncate">{family.category_name}</span>
                        </div>
                      </div>
                      <div className="shrink-0">
                        <Badge size="sm" color={family.is_active ? 'success' : 'danger'}>
                          {family.is_active ? t('brandsModels.active') : t('brandsModels.inactive')}
                        </Badge>
                      </div>
                      <FamilyRowActions
                        family={family}
                        onEdit={setEditFamily}
                        onToggle={handleToggle}
                        onManageAttributes={setManageAttrsFamily}
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

      <CreateFamilyModal open={createOpen} onClose={() => setCreateOpen(false)} holdingId={holdingId} brands={allBrands} />
      <EditFamilyModal family={editFamily} open={!!editFamily} onClose={() => setEditFamily(null)} brands={allBrands} />
      <ManageFamilyAttributesModal family={manageAttrsFamily} open={!!manageAttrsFamily} onClose={() => setManageAttrsFamily(null)} holdingId={holdingId} />
    </>
  );
}
