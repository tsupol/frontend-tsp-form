import { useState, useEffect, useRef, useCallback, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, Button, Input, Select, PopOver, MenuItem,
  MenuSeparator, Badge, Modal, Switch, useSnackbarContext, FormErrorMessage,
  type ColumnDef,
} from 'tsp-form';
import {
  Plus, MoreHorizontal, Pencil, Send, Eye, XCircle, CheckCircle, Trash2,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface DraftPreview {
  draft_id: number;
  holding_id: number;
  company_id: number | null;
  family_id: number;
  family_code: string;
  family_name: string;
  category_code: string;
  category_name: string;
  brand_code: string;
  brand_name: string;
  requested_model_name: string | null;
  generated_model_code: string | null;
  generated_model_name: string | null;
  is_contractable: boolean;
  is_sellable: boolean;
  is_giftable: boolean;
  status: 'DRAFT' | 'READY' | 'PUBLISHED' | 'ARCHIVED';
  published_model_id: number | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  variants: DraftVariant[];
}

interface DraftVariant {
  draft_variant_id: number;
  sort_order: number;
  note: string | null;
  option_set: Record<string, unknown>;
  generated_variant_name: string | null;
  generated_sku_code: string | null;
  color_group: string;
  attributes: Record<string, unknown> | null;
}

interface CatalogEntry {
  model_id: number;
  model_code: string;
  model_name: string;
  model_is_active: boolean;
  category_code: string;
  category_name: string;
  brand_code: string;
  brand_name: string;
  family_code: string;
  family_name: string;
  variant_id: number | null;
  sku_code: string | null;
  item_name: string | null;
  color_group: string | null;
  variant_is_active: boolean | null;
}

interface ModelFamily {
  id: number;
  holding_id: number;
  brand_id: number;
  brand_code: string;
  brand_name: string;
  category_id: number;
  family_code: string;
  display_name: string;
  is_active: boolean;
}

interface ListResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

interface AttributeOption {
  option_id: number;
  option_code: string;
  option_label: string;
  is_default: boolean;
}

interface AttributeAxis {
  attribute_id: number;
  attribute_code: string;
  attribute_name: string;
  data_type: string;
  unit: string | null;
  required: boolean;
  allow_custom: boolean;
  use_in_sku_name: boolean;
  use_in_sku_code: boolean;
  name_order: number;
  sku_order: number;
  options: AttributeOption[];
}

interface FamilyAttributeConfig {
  family_id: number;
  axes: AttributeAxis[];
}

interface VariantRow {
  key: string;
  optionSet: Record<string, string>;
  sortOrder: number;
  note: string;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

function useDraftList(holdingId: number | null, search: string, page: number, pageSize: number) {
  return useQuery({
    queryKey: ['product-drafts', holdingId, search, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams();
      if (holdingId) params.set('holding_id', `eq.${holdingId}`);
      params.set('status', 'in.(DRAFT,READY)');
      if (search) params.set('or', `(generated_model_code.ilike.*${search}*,generated_model_name.ilike.*${search}*,family_name.ilike.*${search}*)`);
      params.set('order', 'updated_at.desc');
      const qs = params.toString();
      return apiClient.getPaginated<DraftPreview>(`/v_product_draft_preview${qs ? `?${qs}` : ''}`, {
        page: page + 1,
        pageSize,
      });
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useCatalogList(holdingId: number | null, search: string, page: number, pageSize: number) {
  return useQuery({
    queryKey: ['product-catalog', holdingId, search, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams();
      if (holdingId) params.set('holding_id', `eq.${holdingId}`);
      if (search) params.set('or', `(model_code.ilike.*${search}*,model_name.ilike.*${search}*,brand_name.ilike.*${search}*)`);
      params.set('order', 'model_code');
      const qs = params.toString();
      return apiClient.getPaginated<CatalogEntry>(`/v_seed_product_catalog${qs ? `?${qs}` : ''}`, {
        page: page + 1,
        pageSize,
      });
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useAllFamilies(holdingId: number | null) {
  return useQuery({
    queryKey: ['families', 'all', holdingId],
    queryFn: () => apiClient.rpc<ListResult<ModelFamily>>('ref_family_list', {
      p_holding_id: holdingId,
      p_brand_id: null,
      p_q: null,
      p_is_active: true,
      p_limit: 500,
      p_offset: 0,
    }),
    staleTime: 5 * 60 * 1000,
  });
}

function useFamilyAttributeConfig(familyId: number | null) {
  return useQuery({
    queryKey: ['family-attribute-config', familyId],
    queryFn: () => apiClient.get<FamilyAttributeConfig[]>(
      `/v_family_attribute_config?family_id=eq.${familyId}`
    ),
    enabled: !!familyId,
    staleTime: 5 * 60 * 1000,
  });
}

// ── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const colorMap: Record<string, 'warning' | 'info' | 'success' | 'danger'> = {
    DRAFT: 'warning',
    READY: 'info',
    PUBLISHED: 'success',
    ARCHIVED: 'danger',
  };
  const labelMap: Record<string, string> = {
    DRAFT: t('models.statusDraft'),
    READY: t('models.statusReady'),
    PUBLISHED: t('models.statusPublished'),
    ARCHIVED: t('models.statusArchived'),
  };
  return (
    <Badge size="sm" color={colorMap[status] ?? 'warning'}>
      {labelMap[status] ?? status}
    </Badge>
  );
}

// ── Draft Row Actions ────────────────────────────────────────────────────────

function DraftRowActions({ draft, onEdit, onPreview, onPublish }: {
  draft: DraftPreview;
  onEdit: (d: DraftPreview) => void;
  onPreview: (d: DraftPreview) => void;
  onPublish: (d: DraftPreview) => void;
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
          icon={<Eye size={14} />}
          label={t('models.variants')}
          onClick={() => { setOpen(false); onPreview(draft); }}
        />
        {draft.status !== 'PUBLISHED' && draft.status !== 'ARCHIVED' && (
          <MenuItem
            icon={<Pencil size={14} />}
            label={t('common.edit')}
            onClick={() => { setOpen(false); onEdit(draft); }}
          />
        )}
        {(draft.status === 'READY' || draft.status === 'DRAFT') && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={<Send size={14} />}
              label={t('models.publishDraft')}
              onClick={() => { setOpen(false); onPublish(draft); }}
            />
          </>
        )}
      </div>
    </PopOver>
  );
}

// ── Create/Edit Draft Modal ──────────────────────────────────────────────────

interface DraftFormData {
  family_id: string;
  requested_model_name: string;
  is_contractable: boolean;
  is_sellable: boolean;
  is_giftable: boolean;
}

let variantCounter = 0;
function nextVariantKey() { return `v_${++variantCounter}`; }

function DraftFormModal({ draft, open, onClose, holdingId, families }: {
  draft: DraftPreview | null;
  open: boolean;
  onClose: () => void;
  holdingId: number | null;
  families: ModelFamily[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [variantError, setVariantError] = useState('');

  const isEdit = !!draft;
  const familyOptions = families.map(f => ({ value: String(f.id), label: `${f.display_name} (${f.family_code})` }));

  const { register, handleSubmit, control, setValue, watch, reset, formState: { errors } } = useForm<DraftFormData>({
    defaultValues: { family_id: '', requested_model_name: '', is_contractable: false, is_sellable: true, is_giftable: false },
  });

  const familyId = watch('family_id');
  const numericFamilyId = familyId ? Number(familyId) : null;

  // Fetch attribute config for selected family
  const { data: configData, isFetching: configFetching } = useFamilyAttributeConfig(numericFamilyId);
  const axes: AttributeAxis[] = configData?.[0]?.axes ?? [];

  // Reset variants when family changes (create mode only)
  const prevFamilyRef = useRef(familyId);
  useEffect(() => {
    if (!isEdit && prevFamilyRef.current !== familyId) {
      setVariants([]);
      setVariantError('');
    }
    prevFamilyRef.current = familyId;
  }, [familyId, isEdit]);

  // Populate form when opening
  useEffect(() => {
    if (draft && open) {
      reset({
        family_id: String(draft.family_id),
        requested_model_name: draft.requested_model_name ?? '',
        is_contractable: draft.is_contractable,
        is_sellable: draft.is_sellable,
        is_giftable: draft.is_giftable,
      });
      setVariants(draft.variants.map(v => ({
        key: String(v.draft_variant_id),
        optionSet: Object.fromEntries(
          Object.entries(v.option_set).map(([k, val]) => [k, String(val)])
        ),
        sortOrder: v.sort_order,
        note: v.note ?? '',
      })));
      setErrorMessage('');
      setVariantError('');
    } else if (!draft && open) {
      reset({ family_id: '', requested_model_name: '', is_contractable: false, is_sellable: true, is_giftable: false });
      setVariants([]);
      setErrorMessage('');
      setVariantError('');
    }
  }, [draft, open, reset]);

  // ── Variant management ──

  const addVariant = useCallback(() => {
    // Pre-fill with default options from each axis
    const defaults: Record<string, string> = {};
    for (const axis of axes) {
      const defaultOpt = axis.options.find(o => o.is_default);
      if (defaultOpt) defaults[axis.attribute_code] = defaultOpt.option_code;
    }
    setVariants(prev => [...prev, {
      key: nextVariantKey(),
      optionSet: defaults,
      sortOrder: prev.length + 1,
      note: '',
    }]);
    setVariantError('');
  }, [axes]);

  const removeVariant = useCallback((key: string) => {
    setVariants(prev => prev.filter(v => v.key !== key).map((v, i) => ({ ...v, sortOrder: i + 1 })));
  }, []);

  const updateVariantOption = useCallback((key: string, attrCode: string, value: string) => {
    setVariants(prev => prev.map(v =>
      v.key === key ? { ...v, optionSet: { ...v.optionSet, [attrCode]: value } } : v
    ));
    setVariantError('');
  }, []);

  const updateVariantNote = useCallback((key: string, note: string) => {
    setVariants(prev => prev.map(v =>
      v.key === key ? { ...v, note } : v
    ));
  }, []);

  // ── Duplicate check ──

  const isDuplicateVariant = useCallback((checkKey: string, optionSet: Record<string, string>) => {
    const sig = JSON.stringify(Object.entries(optionSet).sort());
    return variants.some(v => v.key !== checkKey && JSON.stringify(Object.entries(v.optionSet).sort()) === sig);
  }, [variants]);

  // ── Validation ──

  const validateVariants = (): boolean => {
    if (variants.length === 0) {
      setVariantError(t('models.variantsRequired'));
      return false;
    }
    // Check required axes are filled
    const requiredAxes = axes.filter(a => a.required);
    for (const v of variants) {
      for (const axis of requiredAxes) {
        if (!v.optionSet[axis.attribute_code]) {
          setVariantError(`${axis.attribute_name}: ${t('models.requiredField')}`);
          return false;
        }
      }
      if (isDuplicateVariant(v.key, v.optionSet)) {
        setVariantError(t('models.duplicateVariant'));
        return false;
      }
    }
    setVariantError('');
    return true;
  };

  const onSubmit = async (data: DraftFormData) => {
    if (!validateVariants()) return;

    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('product_draft_save', {
        p_draft_id: draft?.draft_id ?? null,
        p_holding_id: holdingId,
        p_company_id: null,
        p_family_id: Number(data.family_id),
        p_requested_model_name: data.requested_model_name || null,
        p_is_contractable: data.is_contractable,
        p_is_sellable: data.is_sellable,
        p_is_giftable: data.is_giftable,
        p_variants: variants.map(v => ({
          option_set: v.optionSet,
          sort_order: v.sortOrder,
          note: v.note || null,
        })),
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('models.draftSaveSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['product-drafts'] });
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
    setVariants([]);
    setErrorMessage('');
    setVariantError('');
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth="56rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? t('models.editDraft') : t('models.createDraft')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          {errorMessage && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={18} />
              <div><div className="alert-description">{errorMessage}</div></div>
            </div>
          )}

          {/* Header fields */}
          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('models.family')}</label>
              <Select
                options={familyOptions}
                value={familyId || null}
                onChange={(val) => setValue('family_id', (val as string) ?? '', { shouldValidate: true })}
                placeholder={t('models.selectFamily')}
                showChevron
                searchable
                error={!!errors.family_id}
                disabled={isEdit}
              />
              <input type="hidden" {...register('family_id', { required: t('models.selectFamily') })} />
              <FormErrorMessage error={errors.family_id} />
            </div>
            <div className="flex flex-col">
              <label className="form-label" htmlFor="dm-name">{t('models.modelName')}</label>
              <Input id="dm-name" {...register('requested_model_name')} />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">{t('models.isSellable')}</label>
              <Controller
                name="is_sellable"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">{t('models.isContractable')}</label>
              <Controller
                name="is_contractable"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">{t('models.isGiftable')}</label>
              <Controller
                name="is_giftable"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
                )}
              />
            </div>
          </div>

          {/* Variant Builder */}
          {numericFamilyId && (
            <div className="mt-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">{t('models.variantBuilder')}</h3>
                <Button type="button" size="sm" color="primary" variant="ghost" onClick={addVariant} disabled={configFetching}>
                  <Plus size={14} />
                  {t('models.addVariant')}
                </Button>
              </div>

              {variantError && (
                <div className="alert alert-danger mb-3 animate-pop-in">
                  <XCircle size={16} />
                  <div><div className="alert-description text-xs">{variantError}</div></div>
                </div>
              )}

              {configFetching ? (
                <div className="p-4 text-center text-control-label text-sm">{t('common.loading')}</div>
              ) : axes.length === 0 ? (
                <div className="p-4 text-center text-control-label text-sm">{t('models.noAxes')}</div>
              ) : variants.length === 0 ? (
                <div className="p-6 text-center text-control-label text-sm border border-dashed border-line rounded-lg">
                  {t('models.noVariants')}
                </div>
              ) : (
                <div className="border border-line rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-line bg-surface-hover/50">
                        <th className="px-2 py-2 text-left font-medium text-control-label w-10">#</th>
                        {axes.map(axis => (
                          <th key={axis.attribute_code} className="px-2 py-2 text-left font-medium text-control-label">
                            {axis.attribute_name}
                            {axis.required && <span className="text-danger ml-0.5">*</span>}
                          </th>
                        ))}
                        <th className="px-2 py-2 text-left font-medium text-control-label">{t('models.note')}</th>
                        <th className="px-2 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {variants.map((variant, idx) => (
                        <tr key={variant.key} className="border-b border-line last:border-b-0">
                          <td className="px-2 py-1.5 text-control-label">{idx + 1}</td>
                          {axes.map(axis => {
                            const options = axis.options.map(o => ({
                              value: o.option_code,
                              label: o.option_label,
                            }));
                            const currentVal = variant.optionSet[axis.attribute_code] ?? '';
                            const isCustom = axis.allow_custom && currentVal && !axis.options.some(o => o.option_code === currentVal);

                            return (
                              <td key={axis.attribute_code} className="px-2 py-1.5">
                                {axis.allow_custom && isCustom ? (
                                  <Input
                                    size="sm"
                                    value={currentVal}
                                    onChange={(e) => updateVariantOption(variant.key, axis.attribute_code, e.target.value)}
                                    placeholder={t('models.customValue')}
                                    style={{ minWidth: '7rem' }}
                                  />
                                ) : (
                                  <div style={{ width: '10rem' }}>
                                    <Select
                                      options={axis.allow_custom
                                        ? [...options, { value: '__custom__', label: `✎ ${t('models.customValue')}` }]
                                        : options
                                      }
                                      value={currentVal || null}
                                      onChange={(val) => {
                                        if (val === '__custom__') {
                                          updateVariantOption(variant.key, axis.attribute_code, '');
                                        } else {
                                          updateVariantOption(variant.key, axis.attribute_code, (val as string) ?? '');
                                        }
                                      }}
                                      placeholder={t('models.selectOption')}
                                      size="sm"
                                      searchable
                                      clearable
                                      error={axis.required && !currentVal}
                                    />
                                  </div>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5">
                            <Input
                              size="sm"
                              value={variant.note}
                              onChange={(e) => updateVariantNote(variant.key, e.target.value)}
                              placeholder="—"
                              style={{ minWidth: '6rem' }}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <button
                              type="button"
                              className="p-1 rounded hover:bg-danger/10 text-control-label hover:text-danger transition-colors cursor-pointer"
                              onClick={() => removeVariant(variant.key)}
                              title={t('models.removeVariant')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
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

// ── Publish Confirm Modal ────────────────────────────────────────────────────

function PublishModal({ draft, open, onClose }: {
  draft: DraftPreview | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const handlePublish = async () => {
    if (!draft) return;
    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('product_draft_publish', {
        p_draft_id: draft.draft_id,
        p_activate_model: true,
        p_activate_variants: true,
        p_replace_existing: false,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('models.draftPublishSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['product-drafts'] });
      queryClient.invalidateQueries({ queryKey: ['product-catalog'] });
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
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('models.publishDraft')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          {errorMessage && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={18} />
              <div><div className="alert-description">{errorMessage}</div></div>
            </div>
          )}
          <p className="text-sm mb-3">
            {t('models.confirmPublish')}
          </p>
          {draft && (
            <div className="text-sm text-control-label space-y-1">
              <div><strong>{t('models.modelCode')}:</strong> {draft.generated_model_code ?? '—'}</div>
              <div><strong>{t('models.modelName')}:</strong> {draft.generated_model_name ?? draft.requested_model_name ?? '—'}</div>
              <div><strong>{t('models.variants')}:</strong> {draft.variants.length}</div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
          <Button type="button" color="primary" disabled={isPending} onClick={handlePublish}>
            {isPending ? t('common.loading') : t('models.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Preview Variants Modal ───────────────────────────────────────────────────

function PreviewVariantsModal({ draft, open, onClose }: {
  draft: DraftPreview | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const columns: ColumnDef<DraftVariant>[] = [
    {
      accessorKey: 'generated_sku_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.skuCode')} />,
      cell: ({ row }) => <span className="text-xs font-medium">{row.getValue('generated_sku_code') ?? '—'}</span>,
    },
    {
      accessorKey: 'generated_variant_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.variantName')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('generated_variant_name') ?? '—'}</span>,
    },
    {
      accessorKey: 'color_group',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.colorGroup')} />,
      cell: ({ row }) => {
        const cg = row.getValue('color_group') as string;
        return cg ? <Badge size="sm" color={cg === 'SPC' ? 'warning' : undefined}>{cg}</Badge> : null;
      },
    },
    {
      id: 'options',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Options" />,
      cell: ({ row }) => {
        const os = row.original.option_set;
        return (
          <div className="flex gap-1 flex-wrap">
            {Object.entries(os).map(([key, val]) => (
              <Badge key={key} size="sm">{key}: {String(val)}</Badge>
            ))}
          </div>
        );
      },
    },
  ];

  return (
    <Modal open={open} onClose={onClose} maxWidth="52rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">
            {t('models.variants')}
            {draft && (
              <span className="text-sm font-normal text-control-label ml-2">
                — {draft.generated_model_name ?? draft.requested_model_name ?? draft.family_name}
              </span>
            )}
          </h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          {draft && draft.variants.length > 0 ? (
            <DataTable
              data={draft.variants}
              columns={columns}
              noResults={<div className="p-4 text-center text-control-label">No variants</div>}
            />
          ) : (
            <div className="p-8 text-center text-control-label">No variants in this draft</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function ModelsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const holdingId = user?.holding_id ?? null;

  const [tab, setTab] = useState<'drafts' | 'published'>('drafts');

  // Draft state
  const [draftSearch, setDraftSearch] = useState('');
  const [draftSearchInput, setDraftSearchInput] = useState('');
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [draftPage, setDraftPage] = useState(0);
  const [draftPageSize, setDraftPageSize] = useState(10);
  const [createDraftOpen, setCreateDraftOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<DraftPreview | null>(null);
  const [publishDraft, setPublishDraft] = useState<DraftPreview | null>(null);
  const [previewDraft, setPreviewDraft] = useState<DraftPreview | null>(null);

  // Published state
  const [pubSearch, setPubSearch] = useState('');
  const [pubSearchInput, setPubSearchInput] = useState('');
  const pubTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pubPage, setPubPage] = useState(0);
  const [pubPageSize, setPubPageSize] = useState(10);

  const { data: familyData } = useAllFamilies(holdingId);
  const allFamilies = familyData?.items ?? [];

  const { data: draftData, isFetching: draftFetching } = useDraftList(holdingId, draftSearch, draftPage, draftPageSize);
  const drafts = draftData?.data ?? [];
  const draftTotal = draftData?.totalCount ?? 0;

  const { data: catalogData, isFetching: catalogFetching } = useCatalogList(holdingId, pubSearch, pubPage, pubPageSize);
  const catalogEntries = catalogData?.data ?? [];
  const catalogTotal = catalogData?.totalCount ?? 0;

  const handleDraftSearch = (value: string) => {
    setDraftSearchInput(value);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => { setDraftSearch(value); setDraftPage(0); }, 300);
  };

  const handlePubSearch = (value: string) => {
    setPubSearchInput(value);
    clearTimeout(pubTimer.current);
    pubTimer.current = setTimeout(() => { setPubSearch(value); setPubPage(0); }, 300);
  };

  // ── Draft columns ──

  const draftColumns: ColumnDef<DraftPreview>[] = [
    {
      accessorKey: 'generated_model_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.modelCode')} />,
      cell: ({ row }) => <span className="text-xs font-medium">{row.getValue('generated_model_code') ?? '—'}</span>,
    },
    {
      accessorKey: 'generated_model_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.modelName')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('generated_model_name') ?? row.original.requested_model_name ?? '—'}</span>,
    },
    {
      accessorKey: 'brand_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.brand')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('brand_name')}</span>,
    },
    {
      accessorKey: 'family_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.family')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('family_name')}</span>,
    },
    {
      id: 'variant_count',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.variants')} />,
      cell: ({ row }) => <Badge size="sm">{row.original.variants.length}</Badge>,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.status')} />,
      cell: ({ row }) => <StatusBadge status={row.getValue('status') as string} t={t} />,
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <DraftRowActions
          draft={row.original}
          onEdit={setEditDraft}
          onPreview={setPreviewDraft}
          onPublish={setPublishDraft}
        />
      ),
      enableSorting: false,
    },
  ];

  // ── Catalog columns ──

  const catalogColumns: ColumnDef<CatalogEntry>[] = [
    {
      accessorKey: 'model_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.modelCode')} />,
      cell: ({ row }) => <span className="text-xs font-medium">{row.getValue('model_code')}</span>,
    },
    {
      accessorKey: 'model_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.modelName')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('model_name')}</span>,
    },
    {
      accessorKey: 'brand_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.brand')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('brand_name')}</span>,
    },
    {
      accessorKey: 'sku_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.skuCode')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('sku_code') ?? '—'}</span>,
    },
    {
      accessorKey: 'item_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.variantName')} />,
      cell: ({ row }) => <span className="text-xs">{row.getValue('item_name') ?? '—'}</span>,
    },
    {
      accessorKey: 'color_group',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('models.colorGroup')} />,
      cell: ({ row }) => {
        const cg = row.getValue('color_group') as string | null;
        return cg ? <Badge size="sm" color={cg === 'SPC' ? 'warning' : undefined}>{cg}</Badge> : null;
      },
    },
  ];

  return (
    <div className="page-content max-w-[64rem] flex flex-col gap-6 pb-8">
      <h1 className="heading-2">{t('models.title')}</h1>

      {/* Tab buttons */}
      <div className="flex gap-1 border-b border-line">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
            tab === 'drafts' ? 'border-primary text-primary' : 'border-transparent text-control-label hover:text-fg'
          }`}
          onClick={() => setTab('drafts')}
        >
          {t('models.drafts')}
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
            tab === 'published' ? 'border-primary text-primary' : 'border-transparent text-control-label hover:text-fg'
          }`}
          onClick={() => setTab('published')}
        >
          {t('models.published')}
        </button>
      </div>

      {/* Drafts Tab */}
      {tab === 'drafts' && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <Input
              placeholder={t('common.search')}
              value={draftSearchInput}
              onChange={(e) => handleDraftSearch(e.target.value)}
              size="sm"
              style={{ width: '14rem' }}
            />
            <Button color="primary" size="sm" onClick={() => setCreateDraftOpen(true)}>
              <Plus />
              {t('models.createDraft')}
            </Button>
          </div>
          <DataTable
            data={drafts}
            columns={draftColumns}
            enablePagination
            pageIndex={draftPage}
            pageSize={draftPageSize}
            pageSizeOptions={[10, 25, 50]}
            rowCount={draftTotal}
            onPageChange={({ pageIndex: pi, pageSize: ps }) => {
              setDraftPage(pi);
              setDraftPageSize(ps);
            }}
            className={draftFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}
            noResults={
              <div className="p-8 text-center text-control-label">
                {t('models.noDrafts')}
              </div>
            }
          />
        </section>
      )}

      {/* Published Tab */}
      {tab === 'published' && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <Input
              placeholder={t('common.search')}
              value={pubSearchInput}
              onChange={(e) => handlePubSearch(e.target.value)}
              size="sm"
              style={{ width: '14rem' }}
            />
          </div>
          <DataTable
            data={catalogEntries}
            columns={catalogColumns}
            enablePagination
            pageIndex={pubPage}
            pageSize={pubPageSize}
            pageSizeOptions={[10, 25, 50]}
            rowCount={catalogTotal}
            onPageChange={({ pageIndex: pi, pageSize: ps }) => {
              setPubPage(pi);
              setPubPageSize(ps);
            }}
            className={catalogFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}
            noResults={
              <div className="p-8 text-center text-control-label">
                {t('models.noModels')}
              </div>
            }
          />
        </section>
      )}

      {/* Modals */}
      <DraftFormModal
        draft={createDraftOpen ? null : editDraft}
        open={createDraftOpen || !!editDraft}
        onClose={() => { setCreateDraftOpen(false); setEditDraft(null); }}
        holdingId={holdingId}
        families={allFamilies}
      />
      <PublishModal draft={publishDraft} open={!!publishDraft} onClose={() => setPublishDraft(null)} />
      <PreviewVariantsModal draft={previewDraft} open={!!previewDraft} onClose={() => setPreviewDraft(null)} />
    </div>
  );
}
