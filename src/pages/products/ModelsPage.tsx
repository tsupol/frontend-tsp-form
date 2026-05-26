import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, DataTable, Badge, Input, Select, Button, Modal, Switch, MobileHeader, PopOver, MenuItem, useSnackbarContext, FormErrorMessage } from 'tsp-form';
import { Plus, XCircle, CheckCircle, Info, SlidersHorizontal, ArrowRightFromLine, ArrowLeft, MoreHorizontal, Pencil, Power } from 'lucide-react';
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
  brand_name: string;
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
  brand_id: string;
  family_id: string;
  model_name: string;
  [key: `axis_${string}`]: string;
  is_contractable: boolean;
  is_sellable: boolean;
  is_giftable: boolean;
}

// ── CreateModelModal ─────────────────────────────────────────────────────────

function CreateModelModal({ open, onClose, holdingId, families, brands }: {
  open: boolean;
  onClose: () => void;
  holdingId: number | null;
  families: FamilyLookup[];
  brands: BrandLookup[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const { register, handleSubmit, reset, watch, setValue, control, formState: { errors, isDirty } } = useForm<CreateModelForm>({
    defaultValues: { brand_id: '', family_id: '', model_name: '', is_contractable: false, is_sellable: true, is_giftable: false },
  });

  const selectedBrandId = watch('brand_id');
  const selectedFamilyId = watch('family_id');

  // Family search is purely client-side — the families prop already holds the
  // full active list. Track the typed text so token-AND matching ("iph 11" →
  // "iPhone 11") works against display_name + brand_name.
  const [familyQuery, setFamilyQuery] = useState('');

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

  // Set defaults when config loads
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
  }, [familyConfig, setValue]);

  const axes = familyConfig?.axes ?? [];

  const brandOptions = brands.map(b => ({ value: String(b.id), label: b.name }));

  // Token-AND match over display_name + brand_name, so "iph 11" finds
  // "iPhone 11" and "apple iph" still narrows by brand.
  const filteredFamilies = useMemo(() => {
    const brandScoped = selectedBrandId
      ? families.filter(f => String(f.brand_id) === selectedBrandId)
      : families;
    const tokens = familyQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return brandScoped;
    return brandScoped.filter(f => {
      const hay = `${f.display_name} ${f.brand_name}`.toLowerCase();
      return tokens.every(tok => hay.includes(tok));
    });
  }, [families, selectedBrandId, familyQuery]);

  const familyOptions = filteredFamilies.map(f => ({
    value: String(f.id),
    label: selectedBrandId ? f.display_name : `${f.display_name} — ${f.brand_name}`,
  }));

  // When the user changes brand, clear family if it no longer matches. Skip
  // when brand-changes are triggered by the family-pick auto-fill (which
  // always sets brand to match, so there's nothing to clear).
  const lastBrandRef = useRef<string>('');
  useEffect(() => {
    if (selectedBrandId === lastBrandRef.current) return;
    lastBrandRef.current = selectedBrandId;
    if (!selectedBrandId || !selectedFamilyId) return;
    const fam = families.find(f => String(f.id) === selectedFamilyId);
    if (fam && String(fam.brand_id) !== selectedBrandId) {
      setValue('family_id', '', { shouldValidate: true });
      lastConfigRef.current = null;
    }
    // families intentionally omitted — only react to brand id changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBrandId, selectedFamilyId]);

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

  const onCreate = async (data: CreateModelForm) => {
    setIsCreating(true);
    setErrorMessage('');
    const start = Date.now();
    try {
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
    if (isDirty) {
      setConfirmCloseOpen(true);
      return;
    }
    forceClose();
  };

  const forceClose = () => {
    reset();
    setErrorMessage('');
    lastConfigRef.current = null;
    setConfirmCloseOpen(false);
    onClose();
  };

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onCreate)}>
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

          <div className="form-grid">
            {/* Brand — clearable; if cleared, family stays selected unless brand mismatch. */}
            <div className="flex flex-col">
              <label className="form-label">{t('models.brand')}</label>
              <div>
                <Select
                  options={brandOptions}
                  value={selectedBrandId || null}
                  onChange={(val) => {
                    setValue('brand_id', (val as string) ?? '', { shouldValidate: true });
                  }}
                  placeholder={t('models.selectBrandOptional')}
                  showChevron
                  clearable
                />
              </div>
            </div>

            {/* Family — client-side token-AND search over all active families;
                picking a family auto-fills brand. */}
            <div className="flex flex-col">
              <label className="form-label">{t('models.family')}</label>
              <div>
                <Select
                  options={familyOptions}
                  value={selectedFamilyId || null}
                  onChange={(val) => {
                    const newId = (val as string) ?? '';
                    lastConfigRef.current = null;
                    // Set brand first so the brand-mismatch effect never sees a
                    // transient state where the new family doesn't match the
                    // (still-old) brand.
                    if (newId) {
                      const fam = families.find(f => String(f.id) === newId);
                      if (fam) {
                        const brandStr = String(fam.brand_id);
                        lastBrandRef.current = brandStr;
                        setValue('brand_id', brandStr, { shouldValidate: true });
                      }
                    }
                    setValue('family_id', newId, { shouldValidate: true });
                  }}
                  onSearchChange={setFamilyQuery}
                  filterOptions={false}
                  placeholder={t('models.familyPlaceholder')}
                  showChevron
                  clearable
                  error={!!errors.family_id}
                />
              </div>
              <input type="hidden" {...register('family_id', { required: t('models.selectFamily') })} />
              <FormErrorMessage error={errors.family_id} />
            </div>

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
          <Button type="submit" color="primary" disabled={isCreating || !selectedFamilyId}>
            {isCreating ? t('models.creating') : t('common.create')}
          </Button>
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

// ── Model variants section (list + add/edit/toggle) ──────────────────────────

function ModelVariantsSection({ modelId, variants }: { modelId: number; variants: ModelVariant[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [addOpen, setAddOpen] = useState(false);
  const [editVariant, setEditVariant] = useState<ModelVariant | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['models-search'] });
    queryClient.invalidateQueries({ queryKey: ['model-detail-fallback', modelId] });
  };

  const showErr = (err: unknown) => {
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
      type: 'error', duration: 5000,
    });
  };

  const handleToggleActive = async (v: ModelVariant) => {
    try {
      await apiClient.rpc('variant_update', {
        p_variant_id: v.variant_id,
        p_is_active: !v.is_active,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">
              {v.is_active ? t('models.variantDisabled') : t('models.variantEnabled')}
            </div></div>
          </div>
        ),
        type: 'success', duration: 3000,
      });
      refresh();
    } catch (err) { showErr(err); }
  };

  return (
    <>
      <div className="px-4 py-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
          {t('models.variants')} ({variants.length})
        </h3>
        <Button
          size="sm"
          variant="outline"
          startIcon={<Plus size={14} />}
          onClick={() => setAddOpen(true)}
        >
          {t('models.addVariant')}
        </Button>
      </div>

      {variants.length === 0 ? (
        <div className="px-4 pb-6 text-center text-subtle text-xs">
          {t('models.noVariantsFound')}
        </div>
      ) : (
        <div className="px-4 pb-4 flex flex-col gap-2">
          {variants.map((v) => (
            <VariantRow
              key={v.variant_id}
              variant={v}
              onEdit={() => setEditVariant(v)}
              onToggleActive={() => handleToggleActive(v)}
            />
          ))}
        </div>
      )}

      <AddVariantModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        modelId={modelId}
        onSuccess={refresh}
      />
      <EditVariantModal
        open={!!editVariant}
        variant={editVariant}
        onClose={() => setEditVariant(null)}
        onSuccess={refresh}
      />
    </>
  );
}

function VariantRow({ variant, onEdit, onToggleActive }: {
  variant: ModelVariant;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  const attrEntries: [string, string][] = [];
  if (variant.attributes) {
    for (const [key, val] of Object.entries(variant.attributes)) {
      if (val === null || val === '' || val === undefined) continue;
      if (key === 'option_set' && typeof val === 'object' && !Array.isArray(val)) {
        for (const [axisCode, axisVal] of Object.entries(val as Record<string, unknown>)) {
          if (axisVal === null || axisVal === '' || axisVal === undefined) continue;
          if (typeof axisVal === 'object') continue;
          attrEntries.push([axisCode, String(axisVal)]);
        }
        continue;
      }
      if (typeof val === 'object') continue;
      attrEntries.push([key, String(val)]);
    }
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-3 transition-colors ${
        variant.is_active ? 'border-line bg-surface' : 'border-line bg-surface opacity-60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{variant.name}</div>
          <div className="text-[11px] font-mono text-subtle truncate mt-0.5">{variant.sku_code}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge size="sm" color={variant.is_active ? 'success' : 'danger'}>
            {variant.is_active ? t('brandsModels.active') : t('brandsModels.inactive')}
          </Badge>
          <PopOver
            isOpen={menuOpen}
            onClose={() => setMenuOpen(false)}
            placement="bottom"
            align="end"
            offset={4}
            openDelay={0}
            trigger={
              <button
                className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer bg-transparent border-0"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              >
                <MoreHorizontal size={16} className="opacity-50" />
              </button>
            }
          >
            <div className="py-1 min-w-[160px]">
              <MenuItem
                icon={<Pencil size={14} />}
                label={t('common.edit')}
                onClick={() => { setMenuOpen(false); onEdit(); }}
              />
              <MenuItem
                icon={<Power size={14} />}
                label={variant.is_active ? t('brandsModels.disable') : t('brandsModels.enable')}
                onClick={() => { setMenuOpen(false); onToggleActive(); }}
              />
            </div>
          </PopOver>
        </div>
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
}

// ── Color autocomplete ──────────────────────────────────────────────────────

/** Distinct manufacturer_color values across the holding, frequency-ranked.
 *  Used as suggestions in the variant add/edit form so colour names stay
 *  consistent ("Jet Black", not "jet-black" / "JetBlack"). */
function useManufacturerColorSuggestions() {
  return useQuery({
    queryKey: ['manufacturer-color-distinct'],
    queryFn: async () => {
      // PostgREST has no DISTINCT operator; pull a generous slice and dedupe
      // client-side. ~8k variants today → at most a few KB after dedupe.
      const rows = await apiClient.get<{ manufacturer_color: string | null }[]>(
        '/v_product_variant_list?select=manufacturer_color&manufacturer_color=not.is.null&limit=10000',
      );
      const counts = new Map<string, number>();
      for (const r of rows) {
        const c = r.manufacturer_color?.trim();
        if (!c) continue;
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([color]) => color);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Match a typed color against the known list — used by parent modals to
 *  render an "existing / new" badge on the label row. */
function useColorMatch(value: string) {
  const { data: allColors = [] } = useManufacturerColorSuggestions();
  const trimmed = value.trim();
  const isKnown = !!trimmed && allColors.some(c => c.toLowerCase() === trimmed.toLowerCase());
  return { allColors, trimmed, isKnown, isNew: !!trimmed && !isKnown };
}

function ColorMatchBadge({ value }: { value: string }) {
  const { t } = useTranslation();
  const { trimmed, isKnown } = useColorMatch(value);
  if (!trimmed) return null;
  return (
    <Badge size="xs" color={isKnown ? 'default' : 'info'}>
      {isKnown ? t('models.existingColor') : t('models.newColor')}
    </Badge>
  );
}

function ColorAutocomplete({ id, value, onChange, placeholder, autoFocus }: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { allColors, trimmed, isKnown } = useColorMatch(value);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = trimmed.toLowerCase();
    if (q.length === 0) return [];
    const tokens = q.split(/\s+/).filter(Boolean);

    // Score: 0 exact, 1 starts-with, 2 whole-word, 3 contains. Frequency
    // (= position in allColors) is the tiebreak, so a typed "Black" prefers
    // "Black" over "Jet Black" while still surfacing the latter.
    const scored: { color: string; score: number; index: number }[] = [];
    allColors.forEach((color, index) => {
      const hay = color.toLowerCase();
      if (!tokens.every(tok => hay.includes(tok))) return;
      let score = 3;
      if (hay === q) score = 0;
      else if (hay.startsWith(q)) score = 1;
      else if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay)) score = 2;
      scored.push({ color, score, index });
    });

    scored.sort((a, b) => a.score - b.score || a.index - b.index);
    const matches = scored.map(s => s.color);

    if (isKnown && matches.length === 1) return [];
    return matches.slice(0, 8);
  }, [allColors, trimmed, isKnown]);

  const triggerWidth = wrapperRef.current?.offsetWidth;
  const showPopover = open && suggestions.length > 0;

  const commit = (val: string) => {
    onChange(val);
    setOpen(false);
    setHighlighted(-1);
  };

  return (
    <div ref={wrapperRef}>
      <PopOver
        isOpen={showPopover}
        onClose={() => setOpen(false)}
        triggerRef={wrapperRef}
        placement="bottom"
        align="start"
        width={triggerWidth ? `${triggerWidth}px` : undefined}
        offset={4}
        // Modal stack uses 1000+; pinning above keeps the dropdown visible
        // across modal close/reopen cycles where PopOver's auto-detection
        // misfires (tsp-form 0.7.21).
        zIndex={2000}
        trigger={
          <Input
            id={id}
            className="w-full"
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            autoFocus={autoFocus}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
              setHighlighted(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (suggestions.length === 0) return;
                setOpen(true);
                setHighlighted((i) => (i < suggestions.length - 1 ? i + 1 : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (suggestions.length === 0) return;
                setHighlighted((i) => (i > 0 ? i - 1 : suggestions.length - 1));
              } else if (e.key === 'Enter') {
                if (highlighted >= 0 && highlighted < suggestions.length) {
                  e.preventDefault();
                  commit(suggestions[highlighted]);
                } else {
                  setOpen(false);
                }
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
        }
      >
        <div onMouseDown={(e) => e.preventDefault()} className="py-1">
          {suggestions.map((s, i) => (
            <div
              key={s}
              className={`select-popover-item ${i === highlighted ? 'highlighted' : ''}`}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => commit(s)}
            >
              {s}
            </div>
          ))}
        </div>
      </PopOver>
    </div>
  );
}

// ── Add / Edit Variant modals ───────────────────────────────────────────────

function AddVariantModal({ open, onClose, modelId, onSuccess }: {
  open: boolean;
  onClose: () => void;
  modelId: number;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [color, setColor] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open) {
      setColor('');
      setIsActive(true);
      setErrorMessage('');
    }
  }, [open]);

  const onSubmit = async () => {
    if (!color.trim()) {
      setErrorMessage(t('models.colorRequired'));
      return;
    }
    setIsPending(true);
    setErrorMessage('');
    try {
      await apiClient.rpc('variant_create', {
        p_model_id: modelId,
        p_manufacturer_color: color.trim(),
        p_is_active: isActive,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('models.variantCreated')}</div></div>
          </div>
        ),
        type: 'success', duration: 3000,
      });
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('models.addVariant')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="modal-content">
        {errorMessage && (
          <div className="alert alert-danger mb-4 animate-pop-in">
            <XCircle size={18} />
            <div><div className="alert-description">{errorMessage}</div></div>
          </div>
        )}
        <div className="form-grid">
          <div className="flex flex-col">
            <div className="flex items-center justify-between gap-2">
              <label className="form-label" htmlFor="av-color">{t('models.manufacturerColor')}</label>
              <ColorMatchBadge value={color} />
            </div>
            <ColorAutocomplete
              id="av-color"
              value={color}
              onChange={setColor}
              placeholder={t('models.manufacturerColorPlaceholder')}
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="form-label mb-0" htmlFor="av-active">{t('brandsModels.active')}</label>
            <Switch id="av-active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="button" color="primary" disabled={isPending || !color.trim()} onClick={onSubmit}>
          {isPending ? t('common.loading') : t('common.create')}
        </Button>
      </div>
    </Modal>
  );
}

function EditVariantModal({ open, onClose, variant, onSuccess }: {
  open: boolean;
  onClose: () => void;
  variant: ModelVariant | null;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  // Variant doesn't carry manufacturer_color in the list view; let admin type
  // a new colour name and submit. To "keep as is", they leave it blank.
  const [color, setColor] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open && variant) {
      setColor('');
      setIsActive(variant.is_active);
      setErrorMessage('');
    }
  }, [open, variant]);

  if (!variant) return null;

  const onSubmit = async () => {
    setIsPending(true);
    setErrorMessage('');
    try {
      const params: Record<string, unknown> = {
        p_variant_id: variant.variant_id,
        p_is_active: isActive,
      };
      if (color.trim()) params.p_manufacturer_color = color.trim();
      await apiClient.rpc('variant_update', params);
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('models.variantUpdated')}</div></div>
          </div>
        ),
        type: 'success', duration: 3000,
      });
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('models.editVariant')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="modal-content">
        {errorMessage && (
          <div className="alert alert-danger mb-4 animate-pop-in">
            <XCircle size={18} />
            <div><div className="alert-description">{errorMessage}</div></div>
          </div>
        )}
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('models.currentVariant')}</label>
            <div className="text-sm">{variant.name}</div>
            <div className="text-[11px] font-mono text-subtle truncate mt-0.5">{variant.sku_code}</div>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center justify-between gap-2">
              <label className="form-label" htmlFor="ev-color">{t('models.renameColor')}</label>
              <ColorMatchBadge value={color} />
            </div>
            <ColorAutocomplete
              id="ev-color"
              value={color}
              onChange={setColor}
              placeholder={t('models.renameColorPlaceholder')}
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="form-label mb-0" htmlFor="ev-active">{t('brandsModels.active')}</label>
            <Switch id="ev-active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="button" color="primary" disabled={isPending} onClick={onSubmit}>
          {isPending ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </Modal>
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

  // Selected model for detail panel — URL is canonical: /admin/products/models/:modelId
  const navigate = useNavigate();
  const { modelId: modelIdParam } = useParams<{ modelId?: string }>();
  const selectedModelId: number | null = modelIdParam ? Number(modelIdParam) : null;
  const setSelectedModelId = (id: number | null) => {
    navigate(id != null ? `/admin/products/models/${id}` : '/admin/products/models');
  };

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
      `/v_ref_product_family_list?holding_id=eq.${holdingId}&is_active=is.true&order=display_name&select=id,brand_id,brand_name,display_name`
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

  // Fallback fetch — when the route id points to a model that isn't in the
  // current search page, load it directly so deep links resolve.
  const inResults = !!selectedModelId && models.some(m => m.model_id === selectedModelId);
  const { data: fallbackModel } = useQuery({
    queryKey: ['model-detail-fallback', selectedModelId],
    queryFn: async () => {
      const rows = await apiClient.get<Model[]>(
        `/v_product_model_list?model_id=eq.${selectedModelId}&limit=1`,
      );
      return Array.isArray(rows) ? rows[0] ?? null : null;
    },
    enabled: !!selectedModelId && !inResults,
  });

  const selectedModel = selectedModelId
    ? (models.find(m => m.model_id === selectedModelId) ?? fallbackModel ?? null)
    : null;
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
                            isSelected ? 'bg-primary-soft' : ''
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
                        <ModelVariantsSection
                          modelId={selectedModel.model_id}
                          variants={selectedModel.variants}
                        />
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
              brands={brands}
            />
          </>
        );
      }}
    </PageNav>
  );
}
