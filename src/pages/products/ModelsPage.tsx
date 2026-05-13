import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, DataTable, Badge, Input, Select, Button, Modal, Switch, MobileHeader, PopOver, useSnackbarContext, FormErrorMessage } from 'tsp-form';
import { Plus, XCircle, CheckCircle, Info, SlidersHorizontal, ArrowRightFromLine, ArrowLeft } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface ModelVariant {
  variant_id: number;
  sku_code: string;
  name: string;
  attributes: Record<string, unknown> | null;
  is_active: boolean;
}

interface Model {
  model_id: number;
  holding_id: number;
  company_id: number | null;
  model_code: string;
  base_model_name: string;
  model_name_suffix: string;
  model_name: string;
  model_attributes: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  family_id: number;
  family_code: string;
  family_name: string;
  brand_id: number;
  brand_code: string;
  brand_name: string;
  category_id: number;
  category_code: string;
  category_name: string;
  variant_count: number;
  variants: ModelVariant[];
}

/** Row shape returned by fn_product_search RPC. */
interface ProductSearchRow {
  model_id: number;
  model_code: string;
  model_name: string;
  base_model_name: string;
  model_name_suffix?: string;
  model_attributes?: Record<string, unknown> | null;
  brand_code: string;
  brand_name: string;
  family_code: string;
  family_name: string;
  category_name?: string;
  is_active: boolean;
  is_contractable?: boolean;
  is_sellable?: boolean;
  is_giftable?: boolean;
  variants?: ModelVariant[];
}

interface ProductSearchResponse {
  total: number;
  rows: ProductSearchRow[];
  has_more?: boolean;
}

interface BrandLookup {
  id: number;
  name: string;
}

interface FamilyLookup {
  id: number;
  brand_id: number;
  display_name: string;
}

interface AxisOption {
  option_id: number;
  option_code: string;
  option_label: string;
  option_value: string;
  sort_order: number;
  is_default: boolean;
}

interface Axis {
  attribute_id: number;
  attribute_code: string;
  attribute_name: string;
  data_type: string;
  unit: string | null;
  required: boolean;
  allow_custom: boolean;
  use_in_model_name: boolean;
  use_in_model_code: boolean;
  name_order: number;
  code_order: number;
  options: AxisOption[];
}

interface FamilyAttributeConfig {
  family_id: number;
  holding_id: number;
  company_id: number | null;
  brand_code: string;
  brand_name: string;
  family_code: string;
  family_name: string;
  default_model_name: string | null;
  axes: Axis[];
}

/** Variant config shape mirrors model config but axes use use_in_sku_* fields. */
interface VariantAxis extends Omit<Axis, 'use_in_model_name' | 'use_in_model_code'> {
  use_in_sku_name: boolean;
  use_in_sku_code: boolean;
}

interface FamilyVariantConfig {
  family_id: number;
  holding_id: number;
  company_id: number | null;
  brand_code: string;
  brand_name: string;
  family_code: string;
  family_name: string;
  axes: VariantAxis[];
}

interface VariantInput {
  /** Stable client-side id for React keys + remove. */
  client_id: string;
  option_set: Record<string, string>;
  manufacturer_color?: string;
  master_color_code?: string;
  color_group?: 'STD' | 'SPC';
}

interface PreviewVariant {
  sort_order: number;
  option_set: Record<string, string>;
  generated_variant_name: string;
  generated_sku_code: string;
  color_group?: string;
  manufacturer_color?: string;
  master_color_code?: string;
  attributes?: Record<string, unknown>;
}

interface PreviewData {
  generated_model_code: string;
  generated_model_name: string;
  generated_item_base_name?: string;
  variants?: PreviewVariant[];
  warnings?: string[];
}

interface CreateModelForm {
  family_id: string;
  model_name: string;
  [key: `axis_${string}`]: string;
  is_contractable: boolean;
  is_sellable: boolean;
  is_giftable: boolean;
}

// ── CreateModelModal ─────────────────────────────────────────────────────────

function CreateModelModal({ open, onClose, holdingId, families }: {
  open: boolean;
  onClose: () => void;
  holdingId: number | null;
  families: FamilyLookup[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [preview, setPreview] = useState<PreviewData | null>(null);

  // Variants — managed outside react-hook-form (list state is simpler as plain useState)
  const [variants, setVariants] = useState<VariantInput[]>([]);

  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const { register, handleSubmit, reset, watch, setValue, control, formState: { errors, isDirty } } = useForm<CreateModelForm>({
    defaultValues: { family_id: '', model_name: '', is_contractable: false, is_sellable: true, is_giftable: false },
  });

  const selectedFamilyId = watch('family_id');

  // Fetch model attribute config when family is selected
  const { data: familyConfig, isFetching: configLoading } = useQuery({
    queryKey: ['family-attr-config', selectedFamilyId],
    queryFn: () => apiClient.get<FamilyAttributeConfig[]>(
      `/v_family_model_attribute_config?family_id=eq.${selectedFamilyId}&holding_id=eq.${holdingId}`
    ),
    enabled: !!selectedFamilyId && !!holdingId,
    staleTime: 5 * 60 * 1000,
    select: (data) => data[0] ?? null,
  });

  // Fetch variant attribute config (separate view, may have axes like COLOR)
  const { data: variantConfig } = useQuery({
    queryKey: ['family-variant-attr-config', selectedFamilyId],
    queryFn: () => apiClient.get<FamilyVariantConfig[]>(
      `/v_family_variant_attribute_config?family_id=eq.${selectedFamilyId}&holding_id=eq.${holdingId}`
    ),
    enabled: !!selectedFamilyId && !!holdingId,
    staleTime: 5 * 60 * 1000,
    select: (data) => data[0] ?? null,
  });

  const variantAxes = variantConfig?.axes ?? [];

  // Set defaults when config loads (and reset variants on family change)
  const lastConfigRef = useRef<number | null>(null);
  useEffect(() => {
    if (!familyConfig) return;
    if (familyConfig.family_id === lastConfigRef.current) return;
    lastConfigRef.current = familyConfig.family_id;
    if (familyConfig.default_model_name) {
      setValue('model_name', familyConfig.default_model_name);
    }
    for (const axis of familyConfig.axes) {
      const defaultOpt = axis.options.find(o => o.is_default);
      if (defaultOpt) {
        setValue(`axis_${axis.attribute_code}` as keyof CreateModelForm, defaultOpt.option_code);
      }
    }
    setVariants([]);
  }, [familyConfig, setValue]);

  const axes = familyConfig?.axes ?? [];
  const familyOptions = families.map(f => ({ value: String(f.id), label: f.display_name }));

  // ── Variant helpers ────────────────────────────────────────────────────────

  /** Stable key for a variant's option set, used for dedup. */
  const optionSetKey = (os: Record<string, string>) =>
    Object.keys(os).sort().map(k => `${k}=${os[k]}`).join('|');

  /** Toggle a single option for a single axis — adds or removes the matching variant row. */
  const toggleVariantOption = (axisCode: string, optionCode: string) => {
    setPreview(null);
    setVariants(prev => {
      // For single-axis families (the common case), each toggled option = one variant row.
      // For multi-axis families, the user needs to add a row first then refine — see below.
      if (variantAxes.length === 1) {
        const exists = prev.find(v => v.option_set[axisCode] === optionCode);
        if (exists) {
          return prev.filter(v => v !== exists);
        }
        return [
          ...prev,
          {
            client_id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            option_set: { [axisCode]: optionCode },
          },
        ];
      }
      return prev;
    });
  };

  /** True when this option is currently part of any variant row's option_set. */
  const isOptionSelected = (axisCode: string, optionCode: string) =>
    variants.some(v => v.option_set[axisCode] === optionCode);

  /** Add a blank row for multi-axis families — user fills in each axis manually. */
  const addBlankVariant = () => {
    setPreview(null);
    setVariants(prev => [
      ...prev,
      {
        client_id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        option_set: {},
      },
    ]);
  };

  const removeVariant = (clientId: string) => {
    setPreview(null);
    setVariants(prev => prev.filter(v => v.client_id !== clientId));
  };

  const updateVariantAxis = (clientId: string, axisCode: string, optionCode: string) => {
    setPreview(null);
    setVariants(prev => prev.map(v =>
      v.client_id === clientId
        ? { ...v, option_set: { ...v.option_set, [axisCode]: optionCode } }
        : v
    ));
  };

  /** Detect duplicates by option_set hash — shown as a warning, not a hard block. */
  const duplicateClientIds = (() => {
    const seen = new Map<string, string>();
    const dups = new Set<string>();
    for (const v of variants) {
      const key = optionSetKey(v.option_set);
      if (!key) continue;
      const existing = seen.get(key);
      if (existing) {
        dups.add(existing);
        dups.add(v.client_id);
      } else {
        seen.set(key, v.client_id);
      }
    }
    return dups;
  })();

  const buildPayload = (data: CreateModelForm) => {
    const optionSet: Record<string, string> = {};
    for (const axis of axes) {
      const val = data[`axis_${axis.attribute_code}` as keyof CreateModelForm] as string;
      if (val) optionSet[axis.attribute_code] = val;
    }
    const variantPayload = variants.map((v, idx) => ({
      option_set: v.option_set,
      sort_order: (idx + 1) * 10,
      ...(v.color_group ? { color_group: v.color_group } : {}),
      ...(v.manufacturer_color ? { manufacturer_color: v.manufacturer_color } : {}),
      ...(v.master_color_code ? { master_color_code: v.master_color_code } : {}),
      attributes: {},
    }));
    return {
      p_holding_id: holdingId,
      p_company_id: null,
      p_family_id: Number(data.family_id),
      p_requested_model_name: data.model_name,
      p_model_option_set: optionSet,
      p_is_contractable: data.is_contractable,
      p_is_sellable: data.is_sellable,
      p_is_giftable: data.is_giftable,
      p_variants: variantPayload,
    };
  };

  const onPreview = async (data: CreateModelForm) => {
    setIsPending(true);
    setErrorMessage('');
    setPreview(null);
    const start = Date.now();
    try {
      const result = await apiClient.rpc<PreviewData>('product_create_validate', buildPayload(data));
      setPreview(result);
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

  const onConfirmCreate = async () => {
    setIsCreating(true);
    setErrorMessage('');
    const start = Date.now();
    try {
      const data = watch();
      await apiClient.rpc('product_create', buildPayload(data));
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('models.createSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['models'] });
      forceClose();
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
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (isDirty || variants.length > 0) {
      setConfirmCloseOpen(true);
      return;
    }
    forceClose();
  };

  const forceClose = () => {
    reset();
    setErrorMessage('');
    setPreview(null);
    setVariants([]);
    lastConfigRef.current = null;
    setConfirmCloseOpen(false);
    onClose();
  };

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onPreview)}>
        <div className="modal-header">
          <h2 className="modal-title">{t('models.addModel')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {errorMessage && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={18} />
              <div><div className="alert-description">{errorMessage}</div></div>
            </div>
          )}

          {preview && (
            <div className="alert alert-info mb-4">
              <Info size={18} />
              <div className="min-w-0 flex-1">
                <div className="alert-title">{t('models.previewCode')}: <span className="font-mono">{preview.generated_model_code}</span></div>
                <div className="alert-description">{t('models.previewName')}: {preview.generated_model_name}</div>
                {preview.variants && preview.variants.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-info/20">
                    <div className="text-xs font-semibold uppercase tracking-wider mb-1.5 opacity-80">
                      {t('models.variants')} ({preview.variants.length})
                    </div>
                    <div className="flex flex-col gap-1">
                      {preview.variants.map((v) => (
                        <div key={v.generated_sku_code} className="text-xs flex items-baseline gap-2">
                          <span className="font-mono shrink-0">{v.generated_sku_code}</span>
                          <span className="text-subtle truncate">{v.generated_variant_name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {preview.warnings && preview.warnings.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-info/20 flex flex-col gap-1">
                    {preview.warnings.map((w, i) => (
                      <div key={i} className="text-xs text-warning-fg">⚠ {w}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="form-grid">
            {/* Family select */}
            <div className="flex flex-col">
              <label className="form-label">{t('models.family')}</label>
              <div>
                <Select
                  options={familyOptions}
                  value={selectedFamilyId || null}
                  onChange={(val) => {
                    setValue('family_id', (val as string) ?? '', { shouldValidate: true });
                    setPreview(null);
                    // Reset axis values when family changes
                    lastConfigRef.current = null;
                  }}
                  placeholder={t('models.selectFamily')}
                  showChevron
                  error={!!errors.family_id}
                />
              </div>
              <input type="hidden" {...register('family_id', { required: t('models.selectFamily') })} />
              <FormErrorMessage error={errors.family_id} />
            </div>

            {/* Hint when no family selected */}
            {!selectedFamilyId && (
              <div className="text-xs text-subtle">{t('models.selectFamilyFirst')}</div>
            )}

            {/* Loading config */}
            {selectedFamilyId && configLoading && (
              <div className="text-xs text-subtle">{t('common.loading')}</div>
            )}

            {/* Model name */}
            {selectedFamilyId && familyConfig && (
              <>
                <div className="flex flex-col">
                  <label className="form-label" htmlFor="cm-name">{t('models.modelName')}</label>
                  <Input
                    id="cm-name"
                    error={!!errors.model_name}
                    {...register('model_name', { required: t('models.modelName') + ' is required' })}
                    onChange={(e) => {
                      register('model_name').onChange(e);
                      setPreview(null);
                    }}
                  />
                  <FormErrorMessage error={errors.model_name} />
                </div>

                {/* Axes hint or selects */}
                {axes.length === 0 && (
                  <div className="text-xs text-subtle">{t('models.noAxesHint')}</div>
                )}

                {axes.map((axis) => {
                  const fieldName = `axis_${axis.attribute_code}` as keyof CreateModelForm;
                  const axisOptions = axis.options
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map(o => ({ value: o.option_code, label: o.option_label }));
                  return (
                    <div key={axis.attribute_id} className="flex flex-col">
                      <label className="form-label">
                        {axis.attribute_name}
                        {axis.unit ? ` (${axis.unit})` : ''}
                      </label>
                      <div>
                        <Select
                          options={axisOptions}
                          value={watch(fieldName) as string || null}
                          onChange={(val) => {
                            setValue(fieldName, (val as string) ?? '', { shouldValidate: true });
                            setPreview(null);
                          }}
                          placeholder={t('models.selectOption')}
                          showChevron
                          error={!!errors[fieldName]}
                        />
                      </div>
                      <input type="hidden" {...register(fieldName, { required: axis.required ? t('models.requiredField') : false })} />
                      <FormErrorMessage error={errors[fieldName]} />
                    </div>
                  );
                })}

                {/* Variant axes — render as regular labeled fields, in line with model axes */}
                {variantAxes.length === 1 && variantAxes[0] && (() => {
                  const axis = variantAxes[0];
                  const sortedOptions = [...axis.options].sort((a, b) => a.sort_order - b.sort_order);
                  return (
                    <div className="flex flex-col">
                      <label className="form-label">
                        {axis.attribute_name}
                        {axis.unit ? ` (${axis.unit})` : ''}
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {sortedOptions.map(opt => {
                          const selected = isOptionSelected(axis.attribute_code, opt.option_code);
                          return (
                            <button
                              key={opt.option_id}
                              type="button"
                              onClick={() => toggleVariantOption(axis.attribute_code, opt.option_code)}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                                selected
                                  ? 'bg-primary text-primary-contrast border-primary'
                                  : 'border-line text-fg hover:bg-surface-hover'
                              }`}
                            >
                              {opt.option_label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {variantAxes.length > 1 && (
                  <div className="flex flex-col">
                    <label className="form-label">{t('models.variants')}</label>
                    <div className="flex flex-col gap-2">
                      {variants.map((v) => {
                        const isDup = duplicateClientIds.has(v.client_id);
                        return (
                          <div
                            key={v.client_id}
                            className={`border rounded-md p-2 flex flex-col gap-2 ${
                              isDup ? 'border-warning bg-warning/5' : 'border-line'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[11px] text-subtle">
                                {isDup ? t('models.duplicateVariant') : ''}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="btn-icon-sm text-subtle hover:text-danger"
                                onClick={() => removeVariant(v.client_id)}
                                startIcon={<XCircle size={14} />}
                              />
                            </div>
                            {variantAxes.map(axis => {
                              const sortedOptions = [...axis.options].sort((a, b) => a.sort_order - b.sort_order);
                              return (
                                <div key={axis.attribute_id} className="flex flex-col">
                                  <label className="form-label text-xs">{axis.attribute_name}</label>
                                  <Select
                                    options={sortedOptions.map(o => ({ value: o.option_code, label: o.option_label }))}
                                    value={v.option_set[axis.attribute_code] || null}
                                    onChange={(val) => updateVariantAxis(v.client_id, axis.attribute_code, (val as string) ?? '')}
                                    placeholder={t('models.selectOption')}
                                    showChevron
                                    size="sm"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        startIcon={<Plus size={14} />}
                        onClick={addBlankVariant}
                      >
                        {t('models.addVariant')}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Flags — one row */}
                <div className="flex items-center gap-4 flex-wrap">
                  <Controller name="is_sellable" control={control} render={({ field: { onChange, value, ref } }) => (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} size="sm" />
                      <span className="text-sm">{t('models.isSellable')}</span>
                    </label>
                  )} />
                  <Controller name="is_contractable" control={control} render={({ field: { onChange, value, ref } }) => (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} size="sm" />
                      <span className="text-sm">{t('models.isContractable')}</span>
                    </label>
                  )} />
                  <Controller name="is_giftable" control={control} render={({ field: { onChange, value, ref } }) => (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} size="sm" />
                      <span className="text-sm">{t('models.isGiftable')}</span>
                    </label>
                  )} />
                </div>
              </>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
          {preview ? (
            <Button type="button" color="primary" disabled={isCreating} onClick={onConfirmCreate}>
              {isCreating ? t('models.creating') : t('models.confirmCreate')}
            </Button>
          ) : (
            <Button type="submit" color="primary" disabled={isPending || !selectedFamilyId}>
              {isPending ? t('models.previewing') : t('models.preview')}
            </Button>
          )}
        </div>
      </form>
    </Modal>

    {/* Unsaved changes confirm */}
    <Modal open={confirmCloseOpen} onClose={() => setConfirmCloseOpen(false)} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('common.unsavedChanges')}</h2>
      </div>
      <div className="modal-content">
        <p>{t('common.unsavedChangesMessage')}</p>
      </div>
      <div className="modal-footer">
        <Button type="button" variant="ghost" onClick={() => setConfirmCloseOpen(false)}>{t('common.cancel')}</Button>
        <Button type="button" color="danger" onClick={forceClose}>{t('common.discard')}</Button>
      </div>
    </Modal>
    </>
  );
}

// ── VariantSubRow ────────────────────────────────────────────────────────────

function VariantSubRow({ variants }: { variants: ModelVariant[] }) {
  const { t } = useTranslation();

  if (variants.length === 0) {
    return (
      <div className="px-4 pb-6 text-center text-subtle text-xs">
        {t('models.noVariantsFound')}
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 flex flex-col gap-2">
      {variants.map((v) => {
        const attrEntries: [string, string][] = [];
        if (v.attributes) {
          for (const [key, val] of Object.entries(v.attributes)) {
            if (val === null || val === '' || val === undefined) continue;
            // option_set is a nested object of axis_code → option_value — flatten its entries
            if (key === 'option_set' && typeof val === 'object' && !Array.isArray(val)) {
              for (const [axisCode, axisVal] of Object.entries(val as Record<string, unknown>)) {
                if (axisVal === null || axisVal === '' || axisVal === undefined) continue;
                if (typeof axisVal === 'object') continue;
                attrEntries.push([axisCode, String(axisVal)]);
              }
              continue;
            }
            // Skip any other nested object/array values — would render as "[object Object]"
            if (typeof val === 'object') continue;
            attrEntries.push([key, String(val)]);
          }
        }
        return (
          <div
            key={v.variant_id}
            className={`flex flex-col gap-2 rounded-lg border p-3 transition-colors ${
              v.is_active ? 'border-line bg-surface' : 'border-line bg-surface opacity-60'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{v.name}</div>
                <div className="text-[11px] font-mono text-subtle truncate mt-0.5">{v.sku_code}</div>
              </div>
              <Badge size="sm" color={v.is_active ? 'success' : 'danger'}>
                {v.is_active ? t('brandsModels.active') : t('brandsModels.inactive')}
              </Badge>
            </div>

            {attrEntries.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-line/60">
                {attrEntries.map(([key, val]) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-fg/5 text-subtle"
                  >
                    <span className="opacity-70">{key}:</span>
                    <span className="font-medium text-fg">{String(val)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function ModelsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const holdingId = user?.holding_id ?? null;

  // Table state
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Filters & sort
  const [filterBrand, setFilterBrand] = useState<string>('');
  const [filterFamily, setFilterFamily] = useState<string>('');
  const [filterBaseModel, setFilterBaseModel] = useState<string>('');

  // Filter popover (small screens)
  const [filterOpen, setFilterOpen] = useState(false);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);

  // Selected model for detail panel
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  // Search debounce
  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPageIndex(0);
    }, 300);
  };

  // Brand lookup (still needed for filter dropdown — all brands, not just current page)
  const { data: brands = [] } = useQuery({
    queryKey: ['brand-lookup', holdingId],
    queryFn: () => apiClient.get<BrandLookup[]>(
      `/v_ref_brand_list?holding_id=eq.${holdingId}&is_active=is.true&order=name`
    ),
    staleTime: 5 * 60 * 1000,
  });

  // Family lookup (still needed for filter dropdown + create modal)
  const { data: families = [] } = useQuery({
    queryKey: ['family-lookup', holdingId],
    queryFn: () => apiClient.get<FamilyLookup[]>(
      `/v_ref_product_family_list?holding_id=eq.${holdingId}&is_active=is.true&order=display_name`
    ),
    staleTime: 5 * 60 * 1000,
  });

  // Base model lookup (depends on selected family)
  const { data: baseModels = [] } = useQuery({
    queryKey: ['base-model-lookup', holdingId, filterFamily],
    queryFn: async () => {
      const rows = await apiClient.get<{ base_model_name: string }[]>(
        `/v_product_model_list?holding_id=eq.${holdingId}&family_id=eq.${filterFamily}&select=base_model_name&order=base_model_name`
      );
      const unique = [...new Set(rows.map(r => r.base_model_name))];
      return unique;
    },
    enabled: !!filterFamily && !!holdingId,
    staleTime: 5 * 60 * 1000,
  });

  // Clear family when brand changes and selected family doesn't belong to new brand
  useEffect(() => {
    if (!filterBrand) return;
    if (!filterFamily) return;
    const family = families.find(f => String(f.id) === filterFamily);
    if (family && String(family.brand_id) !== filterBrand) {
      setFilterFamily('');
    }
  }, [filterBrand, filterFamily, families]);

  // Clear base model filter when family changes and it's no longer valid
  useEffect(() => {
    if (!filterFamily) {
      setFilterBaseModel('');
    } else if (filterBaseModel && baseModels.length > 0 && !baseModels.includes(filterBaseModel)) {
      setFilterBaseModel('');
    }
  }, [filterFamily, baseModels, filterBaseModel]);

  // Filter options
  const brandOptions = brands.map((b) => ({ value: String(b.id), label: b.name }));
  const filteredFamilies = filterBrand ? families.filter(f => String(f.brand_id) === filterBrand) : families;
  const familyOptions = filteredFamilies.map((f) => ({ value: String(f.id), label: f.display_name }));
  const baseModelOptions = baseModels.map((name) => ({ value: name, label: name }));
  const activeFilterCount = [filterBrand, filterFamily, filterBaseModel].filter(Boolean).length;

  // Fetch models via fuzzy-search RPC (handles both empty and non-empty queries via fast path)
  const { data: searchData, isError, error, isFetching } = useQuery({
    queryKey: ['models-search', pageIndex, pageSize, holdingId, search, filterBrand, filterFamily, filterBaseModel],
    queryFn: () => apiClient.rpc<ProductSearchResponse>('fn_product_search', {
      p_q: search.trim() || null,
      p_brand_id: filterBrand ? Number(filterBrand) : null,
      p_family_id: filterFamily ? Number(filterFamily) : null,
      p_base_model_name: filterBaseModel || null,
      p_is_active: null, // show both active and inactive in admin view
      p_limit: pageSize,
      p_offset: pageIndex * pageSize,
    }),
    placeholderData: keepPreviousData,
  });

  // Map RPC response to existing Model shape (variant_count derived from variants.length)
  const models = useMemo<Model[]>(() => {
    const rows = searchData?.rows ?? [];
    return rows.map(r => ({
      model_id: r.model_id,
      holding_id: holdingId ?? 0,
      company_id: null,
      model_code: r.model_code,
      base_model_name: r.base_model_name,
      model_name_suffix: r.model_name_suffix ?? '',
      model_name: r.model_name,
      model_attributes: r.model_attributes ?? null,
      is_active: r.is_active,
      created_at: '',
      updated_at: '',
      family_id: 0,
      family_code: r.family_code,
      family_name: r.family_name,
      brand_id: 0,
      brand_code: r.brand_code,
      brand_name: r.brand_name,
      category_id: 0,
      category_code: '',
      category_name: r.category_name ?? '',
      variant_count: r.variants?.length ?? 0,
      variants: r.variants ?? [],
    }));
  }, [searchData, holdingId]);
  const totalCount = searchData?.total ?? 0;

  const selectedModel = selectedModelId ? models.find(m => m.model_id === selectedModelId) ?? null : null;
  const detailTitle = selectedModel
    ? (selectedModel.model_name_suffix
        ? `${selectedModel.base_model_name} ${selectedModel.model_name_suffix}`
        : selectedModel.base_model_name)
    : t('models.title');

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => {
        const handleRowSelect = (modelId: number) => {
          setSelectedModelId(modelId);
          if (isMobile) goTo('detail');
        };

        return (
          <>
            {/* ── Mobile Header ── */}
            {isMobile && (
              <MobileHeader className="mobile-header-bordered">
                <div className="mobile-header-start">
                  {isRoot ? (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      aria-label="Open menu"
                      onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                    >
                      <ArrowRightFromLine size={18} />
                    </button>
                  ) : (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      onClick={goBack}
                    >
                      <ArrowLeft size={20} />
                    </button>
                  )}
                </div>
                <div className="mobile-header-title mobile-header-title-truncate">
                  {isRoot ? t('models.title') : detailTitle}
                </div>
                <div className="mobile-header-end px-2">
                  {isRoot ? (
                    <button
                      className="flex items-center justify-center w-8 h-8 rounded hover:bg-surface-hover cursor-pointer text-current"
                      aria-label={t('models.addModel')}
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus size={18} />
                    </button>
                  ) : (
                    <div className="w-8" />
                  )}
                </div>
              </MobileHeader>
            )}

            {/* ── Desktop Header ── */}
            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center justify-between gap-4">
                <h1 className="heading-2">{t('models.title')}</h1>
                <Button color="primary" size="sm" startIcon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
                  {t('models.addModel')}
                </Button>
              </div>
            )}

            {/* ── Filter bar — above panels, list view only on mobile ── */}
            {(isRoot || !isMobile) && (
              <div className="flex-none p-2 border-b border-line">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Input
                      placeholder={t('common.search')}
                      value={searchInput}
                      onChange={(e) => handleSearch(e.target.value)}
                      size="sm"
                      className="w-full"
                    />
                  </div>
                  <div className="flex-1 min-w-0 hidden sm:block">
                    <Select
                      options={brandOptions}
                      value={filterBrand || null}
                      onChange={(val) => { setFilterBrand((val as string) ?? ''); setPageIndex(0); }}
                      placeholder={t('brandsModels.selectBrand')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                  <div className="flex-1 min-w-0 hidden md:block">
                    <Select
                      options={familyOptions}
                      value={filterFamily || null}
                      onChange={(val) => { setFilterFamily((val as string) ?? ''); setPageIndex(0); }}
                      placeholder={t('models.selectFamily')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                  <div className="flex-1 min-w-0 hidden lg:block">
                    <Select
                      options={baseModelOptions}
                      value={filterBaseModel || null}
                      onChange={(val) => { setFilterBaseModel((val as string) ?? ''); setPageIndex(0); }}
                      placeholder={t('models.selectBaseModel')}
                      size="sm"
                      showChevron
                      clearable
                      disabled={!filterFamily}
                    />
                  </div>
                  <div className="xl:hidden shrink-0">
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
                        <div className="text-xs font-medium text-subtle uppercase tracking-wide">{t('common.filters')}</div>
                        <Select
                          options={brandOptions}
                          value={filterBrand || null}
                          onChange={(val) => { setFilterBrand((val as string) ?? ''); setPageIndex(0); }}
                          placeholder={t('brandsModels.selectBrand')}
                          size="sm"
                          showChevron
                          clearable
                        />
                        <Select
                          options={familyOptions}
                          value={filterFamily || null}
                          onChange={(val) => { setFilterFamily((val as string) ?? ''); setPageIndex(0); }}
                          placeholder={t('models.selectFamily')}
                          size="sm"
                          showChevron
                          clearable
                        />
                        <Select
                          options={baseModelOptions}
                          value={filterBaseModel || null}
                          onChange={(val) => { setFilterBaseModel((val as string) ?? ''); setPageIndex(0); }}
                          placeholder={t('models.selectBaseModel')}
                          size="sm"
                          showChevron
                          clearable
                          disabled={!filterFamily}
                        />
                      </div>
                    </PopOver>
                  </div>
                </div>
              </div>
            )}

            {/* ── Error display ── */}
            {isError && (
              <div className="px-6 py-4">
                <div className="border border-line bg-surface p-6 rounded-lg text-center">
                  <div className="text-danger">{error instanceof Error ? error.message : t('common.error')}</div>
                </div>
              </div>
            )}

            {/* ── Panels ── */}
            {!isError && (
              <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
                {/* Left panel: Model list */}
                <PageNavPanel id="list" className="w-1/2 xl:w-5/12 border-r border-line flex flex-col" mobileClassName="flex flex-col overflow-hidden">
                  <DataTable<Model>
                    data={models}
                    renderRow={(row) => {
                      const model = row.original;
                      const isSelected = model.model_id === selectedModelId;
                      return (
                        <div
                          className={`flex items-center gap-3 px-3 py-2 border-b border-line hover:bg-surface-hover transition-colors cursor-pointer ${
                            isSelected ? 'bg-primary/10' : ''
                          }`}
                          onClick={() => handleRowSelect(model.model_id)}
                        >
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="text-xs sm:text-sm truncate">
                              <span>{model.family_name}</span>
                              {' '}
                              <span className="font-medium text-info">{model.base_model_name}</span>
                              {model.model_name_suffix && (
                                <> <span className="font-semibold">{model.model_name_suffix}</span></>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-subtle">
                              <span className="truncate">{model.brand_name}</span>
                              <span className="flex-1" />
                              {model.variant_count > 0 && (
                                <span className="shrink-0">{model.variant_count} {t('models.variants').toLowerCase()}</span>
                              )}
                              <Badge size="sm" color={model.is_active ? 'success' : 'danger'}>
                                {model.is_active ? t('brandsModels.active') : t('brandsModels.inactive')}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                    enablePagination
                    pageIndex={pageIndex}
                    pageSize={pageSize}
                    pageSizeOptions={[10, 25, 50]}
                    siblingCount={2}
                    rowCount={totalCount}
                    onPageChange={({ pageIndex: pi, pageSize: ps }) => {
                      setPageIndex(pi);
                      setPageSize(ps);
                    }}
                    className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                    noResults={
                      <div className="p-8 text-center text-subtle">
                        {t('models.noModels')}
                      </div>
                    }
                  />
                </PageNavPanel>

                {/* Right panel: Model detail (variants) */}
                <PageNavPanel id="detail" className="flex-1 min-w-0 overflow-y-auto better-scroll" mobileClassName="flex flex-col overflow-hidden">
                  {selectedModel ? (
                    <div className="flex flex-col">
                      {/* Detail header */}
                      <div className="flex-none px-4 py-3 border-b border-line">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="text-xs text-subtle truncate">{selectedModel.family_name}</span>
                          <span className="text-sm font-medium text-info truncate">{selectedModel.base_model_name}</span>
                          {selectedModel.model_name_suffix && (
                            <span className="text-sm font-semibold truncate">{selectedModel.model_name_suffix}</span>
                          )}
                          <Badge size="sm" color={selectedModel.is_active ? 'success' : 'danger'}>
                            {selectedModel.is_active ? t('brandsModels.active') : t('brandsModels.inactive')}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-subtle mt-0.5 truncate">
                          {selectedModel.brand_name} · {selectedModel.model_code}
                        </div>
                      </div>

                      {/* Variants section */}
                      <div className="flex-1 min-h-0">
                        <div className="px-4 py-3">
                          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
                            {t('models.variants')} ({selectedModel.variant_count})
                          </h3>
                        </div>
                        <VariantSubRow variants={selectedModel.variants} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 h-full flex items-center justify-center text-subtle p-8 text-center">
                      <div>{t('models.selectToView', { defaultValue: 'Select a model to view details' })}</div>
                    </div>
                  )}
                </PageNavPanel>
              </div>
            )}

            <CreateModelModal
              open={createOpen}
              onClose={() => setCreateOpen(false)}
              holdingId={holdingId}
              families={families}
            />
          </>
        );
      }}
    </PageNav>
  );
}
