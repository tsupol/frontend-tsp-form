import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { DataTable, Badge, Input, Select, Button, Modal, Switch, Drawer, useSnackbarContext, FormErrorMessage } from 'tsp-form';
import { ChevronRight, ChevronDown, ChevronsUpDown, Plus, XCircle, CheckCircle, Info, Search, SlidersHorizontal } from 'lucide-react';
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

interface PreviewData {
  generated_model_code: string;
  generated_model_name: string;
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

  const { register, handleSubmit, reset, watch, setValue, control, formState: { errors } } = useForm<CreateModelForm>({
    defaultValues: { family_id: '', model_name: '', is_contractable: false, is_sellable: true, is_giftable: false },
  });

  const selectedFamilyId = watch('family_id');

  // Fetch attribute config when family is selected
  const { data: familyConfig, isFetching: configLoading } = useQuery({
    queryKey: ['family-attr-config', selectedFamilyId],
    queryFn: () => apiClient.get<FamilyAttributeConfig[]>(
      `/v_family_model_attribute_config?family_id=eq.${selectedFamilyId}&holding_id=eq.${holdingId}`
    ),
    enabled: !!selectedFamilyId && !!holdingId,
    staleTime: 5 * 60 * 1000,
    select: (data) => data[0] ?? null,
  });

  // Set defaults when config loads
  const lastConfigRef = useRef<number | null>(null);
  if (familyConfig && familyConfig.family_id !== lastConfigRef.current) {
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
  }

  const axes = familyConfig?.axes ?? [];
  const familyOptions = families.map(f => ({ value: String(f.id), label: f.display_name }));

  const buildPayload = (data: CreateModelForm) => {
    const optionSet: Record<string, string> = {};
    for (const axis of axes) {
      const val = data[`axis_${axis.attribute_code}` as keyof CreateModelForm] as string;
      if (val) optionSet[axis.attribute_code] = val;
    }
    return {
      p_holding_id: holdingId,
      p_company_id: null,
      p_family_id: Number(data.family_id),
      p_requested_model_name: data.model_name,
      p_model_option_set: optionSet,
      p_is_contractable: data.is_contractable,
      p_is_sellable: data.is_sellable,
      p_is_giftable: data.is_giftable,
      p_variants: [],
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
      handleClose();
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
    reset();
    setErrorMessage('');
    setPreview(null);
    lastConfigRef.current = null;
    onClose();
  };

  return (
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
              <div>
                <div className="alert-title">{t('models.previewCode')}: {preview.generated_model_code}</div>
                <div className="alert-description">{t('models.previewName')}: {preview.generated_model_name}</div>
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
              <div className="text-xs text-control-label">{t('models.selectFamilyFirst')}</div>
            )}

            {/* Loading config */}
            {selectedFamilyId && configLoading && (
              <div className="text-xs text-control-label">{t('common.loading')}</div>
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
                  <div className="text-xs text-control-label">{t('models.noAxesHint')}</div>
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

                {/* Flags */}
                <div className="flex items-center justify-between">
                  <label className="form-label mb-0">{t('models.isSellable')}</label>
                  <Controller name="is_sellable" control={control} render={({ field: { onChange, value, ref } }) => (
                    <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
                  )} />
                </div>
                <div className="flex items-center justify-between">
                  <label className="form-label mb-0">{t('models.isContractable')}</label>
                  <Controller name="is_contractable" control={control} render={({ field: { onChange, value, ref } }) => (
                    <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
                  )} />
                </div>
                <div className="flex items-center justify-between">
                  <label className="form-label mb-0">{t('models.isGiftable')}</label>
                  <Controller name="is_giftable" control={control} render={({ field: { onChange, value, ref } }) => (
                    <Switch ref={ref} checked={value} onChange={(e) => onChange(e.target.checked)} />
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
  );
}

// ── VariantSubRow ────────────────────────────────────────────────────────────

function VariantSubRow({ variants }: { variants: ModelVariant[] }) {
  const { t } = useTranslation();

  if (variants.length === 0) {
    return (
      <div className="px-6 py-4 text-center text-control-label text-xs">
        {t('models.noVariantsFound')}
      </div>
    );
  }

  return (
    <div className="px-6 py-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line">
            <th className="px-2 py-1.5 text-left font-medium text-control-label">{t('models.skuCode')}</th>
            <th className="px-2 py-1.5 text-left font-medium text-control-label">{t('models.variantName')}</th>
            <th className="px-2 py-1.5 text-left font-medium text-control-label">{t('users.status')}</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.variant_id} className="border-b border-line last:border-b-0">
              <td className="px-2 py-1.5 font-medium">{v.sku_code}</td>
              <td className="px-2 py-1.5">{v.name}</td>
              <td className="px-2 py-1.5">
                <Badge size="sm" color={v.is_active ? 'success' : 'danger'}>
                  {v.is_active ? t('brandsModels.active') : t('brandsModels.inactive')}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const [sortBy, setSortBy] = useState<string>('model_code.asc');

  // Filter drawer (small screens)
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);

  // Expand state
  const [expandedModels, setExpandedModels] = useState<Set<number>>(new Set());

  const toggleExpand = useCallback((modelId: number) => {
    setExpandedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }, []);

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

  // Filter & sort options
  const brandOptions = brands.map((b) => ({ value: String(b.id), label: b.name }));
  const filteredFamilies = filterBrand ? families.filter(f => String(f.brand_id) === filterBrand) : families;
  const familyOptions = filteredFamilies.map((f) => ({ value: String(f.id), label: f.display_name }));
  const baseModelOptions = baseModels.map((name) => ({ value: name, label: name }));
  const activeFilterCount = [filterBrand, filterFamily, filterBaseModel].filter(Boolean).length;
  const sortOptions = [
    { value: 'model_code.asc', label: `${t('models.modelCode')} A→Z` },
    { value: 'model_code.desc', label: `${t('models.modelCode')} Z→A` },
    { value: 'model_name.asc', label: `${t('models.modelName')} A→Z` },
    { value: 'model_name.desc', label: `${t('models.modelName')} Z→A` },
    { value: 'model_id.desc', label: t('models.newestFirst') },
    { value: 'model_id.asc', label: t('models.oldestFirst') },
    { value: 'updated_at.desc', label: t('models.recentlyUpdated') },
  ];

  // Build endpoint
  const buildEndpoint = useCallback(() => {
    const params: string[] = [];
    if (holdingId) params.push(`holding_id=eq.${holdingId}`);
    if (search.trim()) {
      params.push(`or=(model_code.ilike.*${encodeURIComponent(search.trim())}*,model_name.ilike.*${encodeURIComponent(search.trim())}*,family_name.ilike.*${encodeURIComponent(search.trim())}*,brand_name.ilike.*${encodeURIComponent(search.trim())}*)`);
    }
    if (filterBrand) params.push(`brand_id=eq.${filterBrand}`);
    if (filterFamily) params.push(`family_id=eq.${filterFamily}`);
    if (filterBaseModel) params.push(`base_model_name=eq.${encodeURIComponent(filterBaseModel)}`);
    params.push(`order=${sortBy}`);
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    return `/v_product_model_list${qs}`;
  }, [holdingId, search, filterBrand, filterFamily, filterBaseModel, sortBy]);

  // Fetch models
  const { data, isError, error, isFetching } = useQuery({
    queryKey: ['models', pageIndex, pageSize, holdingId, search, filterBrand, filterFamily, filterBaseModel, sortBy],
    queryFn: () => apiClient.getPaginated<Model>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const models = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  return (
    <div className="page-content h-dvh max-h-dvh max-w-[64rem] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-none pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="heading-2">{t('models.title')}</h1>
          <Button color="primary" startIcon={<Plus />} onClick={() => setCreateOpen(true)}>
            {t('models.addModel')}
          </Button>
        </div>
        {/* Desktop: all controls in one row */}
        <div className="hidden lg:flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <Input
              placeholder={t('common.search')}
              value={searchInput}
              onChange={(e) => handleSearch(e.target.value)}
              size="sm"
              startIcon={<Search size={14} />}
            />
          </div>
          <div className="flex-1 min-w-0" style={{ maxWidth: '10rem' }}>
            <Select
              options={brandOptions}
              value={filterBrand || null}
              onChange={(val) => {
                setFilterBrand((val as string) ?? '');
                setPageIndex(0);
              }}
              placeholder={t('brandsModels.selectBrand')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          <div className="flex-1 min-w-0" style={{ maxWidth: '10rem' }}>
            <Select
              options={familyOptions}
              value={filterFamily || null}
              onChange={(val) => {
                setFilterFamily((val as string) ?? '');
                setPageIndex(0);
              }}
              placeholder={t('models.selectFamily')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          <div className="flex-1 min-w-0" style={{ maxWidth: '10rem' }}>
            <Select
              options={baseModelOptions}
              value={filterBaseModel || null}
              onChange={(val) => {
                setFilterBaseModel((val as string) ?? '');
                setPageIndex(0);
              }}
              placeholder={t('models.selectBaseModel')}
              size="sm"
              showChevron
              clearable
              disabled={!filterFamily}
            />
          </div>
          <div className="flex items-center gap-1.5 text-control-label flex-1 min-w-0" style={{ maxWidth: '12rem' }}>
            <ChevronsUpDown size={14} className="shrink-0" />
            <div className="flex-1">
              <Select
                options={sortOptions}
                value={sortBy}
                onChange={(val) => {
                  setSortBy((val as string) ?? 'model_code.asc');
                  setPageIndex(0);
                }}
                size="sm"
                showChevron
              />
            </div>
          </div>
        </div>

        {/* Mobile/Tablet: search + filter button */}
        <div className="flex lg:hidden gap-2">
          <div className="flex-1">
            <Input
              placeholder={t('common.search')}
              value={searchInput}
              onChange={(e) => handleSearch(e.target.value)}
              size="sm"
              startIcon={<Search size={14} />}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilterDrawerOpen(true)}
            startIcon={<SlidersHorizontal size={14} />}
          >
            {t('common.filters')}
            {activeFilterCount > 0 && (
              <Badge size="sm" color="primary">{activeFilterCount}</Badge>
            )}
          </Button>
        </div>

        {/* Filter drawer for small screens */}
        <Drawer
          open={filterDrawerOpen}
          onClose={() => setFilterDrawerOpen(false)}
          side="right"
          ariaLabel={t('common.filters')}
        >
          <div className="drawer-header">
            <h2 className="drawer-title">{t('common.filters')}</h2>
            <button className="drawer-close-btn" onClick={() => setFilterDrawerOpen(false)}>&times;</button>
          </div>
          <div className="drawer-content">
            <div className="form-grid">
              <div className="flex flex-col">
                <label className="form-label">{t('brandsModels.selectBrand')}</label>
                <div>
                  <Select
                    options={brandOptions}
                    value={filterBrand || null}
                    onChange={(val) => {
                      setFilterBrand((val as string) ?? '');
                      setPageIndex(0);
                    }}
                    placeholder={t('brandsModels.selectBrand')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('models.selectFamily')}</label>
                <div>
                  <Select
                    options={familyOptions}
                    value={filterFamily || null}
                    onChange={(val) => {
                      setFilterFamily((val as string) ?? '');
                      setPageIndex(0);
                    }}
                    placeholder={t('models.selectFamily')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('models.selectBaseModel')}</label>
                <div>
                  <Select
                    options={baseModelOptions}
                    value={filterBaseModel || null}
                    onChange={(val) => {
                      setFilterBaseModel((val as string) ?? '');
                      setPageIndex(0);
                    }}
                    placeholder={t('models.selectBaseModel')}
                    size="sm"
                    showChevron
                    clearable
                    disabled={!filterFamily}
                  />
                </div>
              </div>
            </div>
            <hr className="border-line my-2" />
            <div className="form-grid">
              <div className="flex flex-col">
                <label className="form-label">{t('common.sortBy')}</label>
                <div>
                  <Select
                    options={sortOptions}
                    value={sortBy}
                    onChange={(val) => {
                      setSortBy((val as string) ?? 'model_code.asc');
                      setPageIndex(0);
                    }}
                    size="sm"
                    showChevron
                  />
                </div>
              </div>
            </div>
          </div>
        </Drawer>
      </div>

      {isError && (
        <div className="px-6">
          <div className="border border-line bg-surface p-6 rounded-lg text-center">
            <div className="text-danger mb-4">{error instanceof Error ? error.message : t('common.error')}</div>
          </div>
        </div>
      )}

      {!isError && (
        <DataTable<Model>
          data={models}
          renderRow={(row) => {
            const model = row.original;
            const isExpanded = expandedModels.has(model.model_id);
            return (
              <>
                <div
                  className="flex items-center gap-3 px-3 py-2 border-b border-line hover:bg-surface-hover transition-colors cursor-pointer"
                  onClick={() => toggleExpand(model.model_id)}
                >
                  <div className="shrink-0 w-5">
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span className="text-sm truncate">{model.family_name}</span>
                      <span className="text-sm font-medium text-info truncate">{model.base_model_name}</span>
                      {model.model_name_suffix && (
                        <span className="text-sm font-semibold truncate">{model.model_name_suffix}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-control-label truncate opacity-60">{model.brand_name}</div>
                  </div>
                  <div className="shrink-0 text-xs text-control-label">
                    {model.variant_count > 0 && `${model.variant_count} ${t('models.variants').toLowerCase()}`}
                  </div>
                  <div className="shrink-0">
                    <Badge size="sm" color={model.is_active ? 'success' : 'danger'}>
                      {model.is_active ? t('brandsModels.active') : t('brandsModels.inactive')}
                    </Badge>
                  </div>
                </div>
                {isExpanded && (
                  <div className="bg-surface border-b border-line">
                    <VariantSubRow variants={model.variants} />
                  </div>
                )}
              </>
            );
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
              {t('models.noModels')}
            </div>
          }
        />
      )}

      <CreateModelModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        holdingId={holdingId}
        families={families}
      />
    </div>
  );
}
