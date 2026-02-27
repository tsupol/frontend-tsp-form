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
  Plus, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, XCircle, CheckCircle, RefreshCw, List,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface ProductAttribute {
  id: number;
  holding_id: number;
  attribute_code: string;
  attribute_name: string;
  data_type: string;
  unit: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface AttributeOption {
  id: number;
  holding_id: number;
  attribute_id: number;
  option_code: string;
  option_label: string;
  option_value: string | null;
  sort_order: number;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ListResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

const DATA_TYPE_OPTIONS = [
  { value: 'TEXT', label: 'Text' },
  { value: 'INTEGER', label: 'Integer' },
  { value: 'DECIMAL', label: 'Decimal' },
  { value: 'BOOLEAN', label: 'Boolean' },
];

// ── Hooks ────────────────────────────────────────────────────────────────────

function useAttributeList(holdingId: number | null, search: string, page: number, pageSize: number) {
  return useQuery({
    queryKey: ['product-attributes', holdingId, search, page, pageSize],
    queryFn: () => apiClient.rpc<ListResult<ProductAttribute>>('product_attribute_list', {
      p_holding_id: holdingId,
      p_q: search || null,
      p_is_active: null,
      p_limit: pageSize,
      p_offset: page * pageSize,
    }),
    staleTime: 5 * 60 * 1000,
  });
}

function useAttributeOptionList(holdingId: number | null, attributeId: number | null, search: string, page: number, pageSize: number) {
  return useQuery({
    queryKey: ['product-attribute-options', holdingId, attributeId, search, page, pageSize],
    queryFn: () => apiClient.rpc<ListResult<AttributeOption>>('product_attribute_option_list', {
      p_holding_id: holdingId,
      p_attribute_id: attributeId,
      p_q: search || null,
      p_is_active: null,
      p_limit: pageSize,
      p_offset: page * pageSize,
    }),
    enabled: !!attributeId,
    staleTime: 5 * 60 * 1000,
  });
}

// ── Attribute Row Actions ────────────────────────────────────────────────────

function AttributeRowActions({ attribute, onEdit, onToggle, onManageOptions }: {
  attribute: ProductAttribute;
  onEdit: (a: ProductAttribute) => void;
  onToggle: (a: ProductAttribute) => void;
  onManageOptions: (a: ProductAttribute) => void;
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
          icon={<List size={14} />}
          label={t('attributes.manageOptions')}
          onClick={() => { setOpen(false); onManageOptions(attribute); }}
        />
        <MenuItem
          icon={<Pencil size={14} />}
          label={t('common.edit')}
          onClick={() => { setOpen(false); onEdit(attribute); }}
        />
        <MenuSeparator />
        <MenuItem
          icon={attribute.is_active ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
          label={attribute.is_active ? t('attributes.inactive') : t('attributes.active')}
          onClick={() => { setOpen(false); onToggle(attribute); }}
        />
      </div>
    </PopOver>
  );
}

// ── Option Row Actions ───────────────────────────────────────────────────────

function OptionRowActions({ option, onEdit, onToggle }: {
  option: AttributeOption;
  onEdit: (o: AttributeOption) => void;
  onToggle: (o: AttributeOption) => void;
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
          onClick={() => { setOpen(false); onEdit(option); }}
        />
        <MenuSeparator />
        <MenuItem
          icon={option.is_active ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
          label={option.is_active ? t('attributes.inactive') : t('attributes.active')}
          onClick={() => { setOpen(false); onToggle(option); }}
        />
      </div>
    </PopOver>
  );
}

// ── Create Attribute Modal ───────────────────────────────────────────────────

interface AttributeFormData {
  attribute_code: string;
  attribute_name: string;
  data_type: string;
  unit: string;
  sort_order: string;
}

function CreateAttributeModal({ open, onClose, holdingId }: { open: boolean; onClose: () => void; holdingId: number | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<AttributeFormData>({
    defaultValues: { attribute_code: '', attribute_name: '', data_type: 'TEXT', unit: '', sort_order: '0' },
  });

  const dataType = watch('data_type');

  const onSubmit = async (data: AttributeFormData) => {
    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('product_attribute_create', {
        p_holding_id: holdingId,
        p_attribute_code: data.attribute_code,
        p_attribute_name: data.attribute_name,
        p_data_type: data.data_type,
        p_unit: data.unit || null,
        p_sort_order: Number(data.sort_order) || 0,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('attributes.attributeCreateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['product-attributes'] });
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
          <h2 className="modal-title">{t('attributes.addAttribute')}</h2>
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
              <label className="form-label" htmlFor="ca-code">{t('attributes.attributeCode')}</label>
              <Input
                id="ca-code"
                error={!!errors.attribute_code}
                {...register('attribute_code', { required: t('attributes.attributeCode') + ' is required' })}
              />
              <FormErrorMessage error={errors.attribute_code} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="ca-name">{t('attributes.attributeName')}</label>
              <Input
                id="ca-name"
                error={!!errors.attribute_name}
                {...register('attribute_name', { required: t('attributes.attributeName') + ' is required' })}
              />
              <FormErrorMessage error={errors.attribute_name} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('attributes.dataType')}</label>
              <Select
                options={DATA_TYPE_OPTIONS}
                value={dataType}
                onChange={(val) => setValue('data_type', (val as string) ?? 'TEXT')}
                showChevron
              />
              <input type="hidden" {...register('data_type')} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="ca-unit">{t('attributes.unit')}</label>
              <Input id="ca-unit" {...register('unit')} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="ca-sort">{t('attributes.sortOrder')}</label>
              <Input id="ca-sort" type="number" {...register('sort_order')} />
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

// ── Edit Attribute Modal ─────────────────────────────────────────────────────

interface EditAttributeFormData {
  attribute_code: string;
  attribute_name: string;
  data_type: string;
  unit: string;
  sort_order: string;
  is_active: boolean;
}

function EditAttributeModal({ attribute, open, onClose }: { attribute: ProductAttribute | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const { register, handleSubmit, control, setValue, watch, reset, formState: { errors } } = useForm<EditAttributeFormData>({
    defaultValues: { attribute_code: '', attribute_name: '', data_type: 'TEXT', unit: '', sort_order: '0', is_active: true },
  });

  const dataType = watch('data_type');

  useEffect(() => {
    if (attribute && open) {
      reset({
        attribute_code: attribute.attribute_code,
        attribute_name: attribute.attribute_name,
        data_type: attribute.data_type,
        unit: attribute.unit ?? '',
        sort_order: String(attribute.sort_order),
        is_active: attribute.is_active,
      });
      setErrorMessage('');
    }
  }, [attribute, open, reset]);

  const onSubmit = async (data: EditAttributeFormData) => {
    if (!attribute) return;
    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('product_attribute_update', {
        p_attribute_id: attribute.id,
        p_attribute_code: data.attribute_code,
        p_attribute_name: data.attribute_name,
        p_data_type: data.data_type,
        p_unit: data.unit || null,
        p_sort_order: Number(data.sort_order) || 0,
        p_is_active: data.is_active,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('attributes.attributeUpdateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['product-attributes'] });
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
          <h2 className="modal-title">{t('attributes.editAttribute')}</h2>
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
              <label className="form-label" htmlFor="ea-code">{t('attributes.attributeCode')}</label>
              <Input
                id="ea-code"
                error={!!errors.attribute_code}
                {...register('attribute_code', { required: t('attributes.attributeCode') + ' is required' })}
              />
              <FormErrorMessage error={errors.attribute_code} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="ea-name">{t('attributes.attributeName')}</label>
              <Input
                id="ea-name"
                error={!!errors.attribute_name}
                {...register('attribute_name', { required: t('attributes.attributeName') + ' is required' })}
              />
              <FormErrorMessage error={errors.attribute_name} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('attributes.dataType')}</label>
              <Select
                options={DATA_TYPE_OPTIONS}
                value={dataType}
                onChange={(val) => setValue('data_type', (val as string) ?? 'TEXT')}
                showChevron
              />
              <input type="hidden" {...register('data_type')} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="ea-unit">{t('attributes.unit')}</label>
              <Input id="ea-unit" {...register('unit')} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="ea-sort">{t('attributes.sortOrder')}</label>
              <Input id="ea-sort" type="number" {...register('sort_order')} />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0" htmlFor="ea-active">{t('attributes.active')}</label>
              <Controller
                name="is_active"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} id="ea-active" checked={value} onChange={(e) => onChange(e.target.checked)} />
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

// ── Create Option Modal ──────────────────────────────────────────────────────

interface OptionFormData {
  option_code: string;
  option_label: string;
  option_value: string;
  sort_order: string;
  is_default: boolean;
}

function CreateOptionModal({ open, onClose, holdingId, attributeId }: {
  open: boolean;
  onClose: () => void;
  holdingId: number | null;
  attributeId: number | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<OptionFormData>({
    defaultValues: { option_code: '', option_label: '', option_value: '', sort_order: '0', is_default: false },
  });

  const onSubmit = async (data: OptionFormData) => {
    if (!attributeId) return;
    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('product_attribute_option_create', {
        p_holding_id: holdingId,
        p_attribute_id: attributeId,
        p_option_code: data.option_code,
        p_option_label: data.option_label,
        p_option_value: data.option_value || null,
        p_sort_order: Number(data.sort_order) || 0,
        p_is_default: data.is_default,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('attributes.optionCreateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['product-attribute-options'] });
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
          <h2 className="modal-title">{t('attributes.addOption')}</h2>
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
              <label className="form-label" htmlFor="co-code">{t('attributes.optionCode')}</label>
              <Input
                id="co-code"
                error={!!errors.option_code}
                {...register('option_code', { required: t('attributes.optionCode') + ' is required' })}
              />
              <FormErrorMessage error={errors.option_code} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="co-label">{t('attributes.optionLabel')}</label>
              <Input
                id="co-label"
                error={!!errors.option_label}
                {...register('option_label', { required: t('attributes.optionLabel') + ' is required' })}
              />
              <FormErrorMessage error={errors.option_label} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="co-value">{t('attributes.optionValue')}</label>
              <Input id="co-value" {...register('option_value')} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="co-sort">{t('attributes.sortOrder')}</label>
              <Input id="co-sort" type="number" {...register('sort_order')} />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0" htmlFor="co-default">{t('attributes.isDefault')}</label>
              <Controller
                name="is_default"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} id="co-default" checked={value} onChange={(e) => onChange(e.target.checked)} />
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
  );
}

// ── Edit Option Modal ────────────────────────────────────────────────────────

interface EditOptionFormData {
  option_code: string;
  option_label: string;
  option_value: string;
  sort_order: string;
  is_default: boolean;
  is_active: boolean;
}

function EditOptionModal({ option, open, onClose }: { option: AttributeOption | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<EditOptionFormData>({
    defaultValues: { option_code: '', option_label: '', option_value: '', sort_order: '0', is_default: false, is_active: true },
  });

  useEffect(() => {
    if (option && open) {
      reset({
        option_code: option.option_code,
        option_label: option.option_label,
        option_value: option.option_value ?? '',
        sort_order: String(option.sort_order),
        is_default: option.is_default,
        is_active: option.is_active,
      });
      setErrorMessage('');
    }
  }, [option, open, reset]);

  const onSubmit = async (data: EditOptionFormData) => {
    if (!option) return;
    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('product_attribute_option_update', {
        p_option_id: option.id,
        p_option_code: data.option_code,
        p_option_label: data.option_label,
        p_option_value: data.option_value || null,
        p_sort_order: Number(data.sort_order) || 0,
        p_is_default: data.is_default,
        p_is_active: data.is_active,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('attributes.optionUpdateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['product-attribute-options'] });
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
          <h2 className="modal-title">{t('attributes.editOption')}</h2>
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
              <label className="form-label" htmlFor="eo-code">{t('attributes.optionCode')}</label>
              <Input
                id="eo-code"
                error={!!errors.option_code}
                {...register('option_code', { required: t('attributes.optionCode') + ' is required' })}
              />
              <FormErrorMessage error={errors.option_code} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="eo-label">{t('attributes.optionLabel')}</label>
              <Input
                id="eo-label"
                error={!!errors.option_label}
                {...register('option_label', { required: t('attributes.optionLabel') + ' is required' })}
              />
              <FormErrorMessage error={errors.option_label} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="eo-value">{t('attributes.optionValue')}</label>
              <Input id="eo-value" {...register('option_value')} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="eo-sort">{t('attributes.sortOrder')}</label>
              <Input id="eo-sort" type="number" {...register('sort_order')} />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0" htmlFor="eo-default">{t('attributes.isDefault')}</label>
              <Controller
                name="is_default"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} id="eo-default" checked={value} onChange={(e) => onChange(e.target.checked)} />
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0" htmlFor="eo-active">{t('attributes.active')}</label>
              <Controller
                name="is_active"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} id="eo-active" checked={value} onChange={(e) => onChange(e.target.checked)} />
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

// ── Manage Options Modal ─────────────────────────────────────────────────────

function ManageOptionsModal({ attribute, open, onClose, holdingId }: {
  attribute: ProductAttribute | null;
  open: boolean;
  onClose: () => void;
  holdingId: number | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [createOptOpen, setCreateOptOpen] = useState(false);
  const [editOpt, setEditOpt] = useState<AttributeOption | null>(null);

  const { data: optData, isFetching } = useAttributeOptionList(holdingId, attribute?.id ?? null, search, page, pageSize);
  const options = optData?.items ?? [];
  const total = optData?.total ?? 0;

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPage(0);
    }, 300);
  };

  const handleToggleOption = async (opt: AttributeOption) => {
    const start = Date.now();
    try {
      await apiClient.rpc('product_attribute_option_set_active', {
        p_option_id: opt.id,
        p_is_active: !opt.is_active,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('attributes.optionUpdateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['product-attribute-options'] });
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
    setSearchInput('');
    setSearch('');
    setPage(0);
    onClose();
  };

  const columns: ColumnDef<AttributeOption>[] = [
    {
      accessorKey: 'option_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('attributes.optionCode')} />,
      cell: ({ row }) => <span className="text-xs font-medium">{row.getValue('option_code')}</span>,
    },
    {
      accessorKey: 'option_label',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('attributes.optionLabel')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('option_label')}</span>,
    },
    {
      accessorKey: 'option_value',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('attributes.optionValue')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('option_value') ?? '—'}</span>,
    },
    {
      accessorKey: 'is_default',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('attributes.isDefault')} />,
      cell: ({ row }) => {
        const def = row.getValue('is_default') as boolean;
        return def ? <Badge size="sm" color="primary">Default</Badge> : null;
      },
    },
    {
      accessorKey: 'is_active',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.status')} />,
      cell: ({ row }) => {
        const active = row.getValue('is_active') as boolean;
        return (
          <Badge size="sm" color={active ? 'success' : 'danger'}>
            {active ? t('attributes.active') : t('attributes.inactive')}
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <OptionRowActions
          option={row.original}
          onEdit={setEditOpt}
          onToggle={handleToggleOption}
        />
      ),
      enableSorting: false,
    },
  ];

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="48rem" width="100%">
        <div className="flex flex-col overflow-hidden">
          <div className="modal-header">
            <h2 className="modal-title">
              {t('attributes.options')}
              {attribute && (
                <span className="text-sm font-normal text-control-label ml-2">
                  — {attribute.attribute_name}
                </span>
              )}
            </h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>
          <div className="modal-content">
            <div className="flex items-center justify-between mb-3">
              <Input
                placeholder={t('common.search')}
                value={searchInput}
                onChange={(e) => handleSearch(e.target.value)}
                size="sm"
                style={{ width: '14rem' }}
              />
              <Button color="primary" size="sm" onClick={() => setCreateOptOpen(true)}>
                <Plus />
                {t('attributes.addOption')}
              </Button>
            </div>
            <DataTable
              data={options}
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
                  {t('attributes.noOptions')}
                </div>
              }
            />
          </div>
        </div>
      </Modal>
      <CreateOptionModal open={createOptOpen} onClose={() => setCreateOptOpen(false)} holdingId={holdingId} attributeId={attribute?.id ?? null} />
      <EditOptionModal option={editOpt} open={!!editOpt} onClose={() => setEditOpt(null)} />
    </>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function AttributesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const holdingId = user?.holding_id ?? null;

  // Attribute state
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [createAttrOpen, setCreateAttrOpen] = useState(false);
  const [editAttr, setEditAttr] = useState<ProductAttribute | null>(null);
  const [manageOptionsAttr, setManageOptionsAttr] = useState<ProductAttribute | null>(null);

  // Data
  const { data: attrData, isFetching } = useAttributeList(holdingId, search, page, pageSize);
  const attributes = attrData?.items ?? [];
  const total = attrData?.total ?? 0;

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPage(0);
    }, 300);
  };

  const handleToggleAttribute = async (attr: ProductAttribute) => {
    const start = Date.now();
    try {
      await apiClient.rpc('product_attribute_set_active', {
        p_attribute_id: attr.id,
        p_is_active: !attr.is_active,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('attributes.attributeUpdateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['product-attributes'] });
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

  const columns: ColumnDef<ProductAttribute>[] = [
    {
      accessorKey: 'attribute_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('attributes.attributeCode')} />,
      cell: ({ row }) => <span className="text-xs font-medium">{row.getValue('attribute_code')}</span>,
    },
    {
      accessorKey: 'attribute_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('attributes.attributeName')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('attribute_name')}</span>,
    },
    {
      accessorKey: 'data_type',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('attributes.dataType')} />,
      cell: ({ row }) => <Badge size="sm">{row.getValue('data_type')}</Badge>,
    },
    {
      accessorKey: 'unit',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('attributes.unit')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('unit') ?? '—'}</span>,
    },
    {
      accessorKey: 'is_active',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.status')} />,
      cell: ({ row }) => {
        const active = row.getValue('is_active') as boolean;
        return (
          <Badge size="sm" color={active ? 'success' : 'danger'}>
            {active ? t('attributes.active') : t('attributes.inactive')}
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <AttributeRowActions
          attribute={row.original}
          onEdit={setEditAttr}
          onToggle={handleToggleAttribute}
          onManageOptions={setManageOptionsAttr}
        />
      ),
      enableSorting: false,
    },
  ];

  return (
    <div className="page-content max-w-[64rem] flex flex-col gap-6 pb-8">
      <h1 className="heading-2">{t('attributes.title')}</h1>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder={t('common.search')}
              value={searchInput}
              onChange={(e) => handleSearch(e.target.value)}
              size="sm"
              style={{ width: '14rem' }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="btn-icon-sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['product-attributes'] })}
            >
              <RefreshCw size={16} />
            </Button>
            <Button color="primary" size="sm" onClick={() => setCreateAttrOpen(true)}>
              <Plus />
              {t('attributes.addAttribute')}
            </Button>
          </div>
        </div>

        <DataTable
          data={attributes}
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
              {t('attributes.noAttributes')}
            </div>
          }
        />
      </section>

      {/* Modals */}
      <CreateAttributeModal open={createAttrOpen} onClose={() => setCreateAttrOpen(false)} holdingId={holdingId} />
      <EditAttributeModal attribute={editAttr} open={!!editAttr} onClose={() => setEditAttr(null)} />
      <ManageOptionsModal attribute={manageOptionsAttr} open={!!manageOptionsAttr} onClose={() => setManageOptionsAttr(null)} holdingId={holdingId} />
    </div>
  );
}
