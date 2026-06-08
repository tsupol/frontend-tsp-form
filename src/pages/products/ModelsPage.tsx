import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, DataTable, Badge, Input, Select, Button, Modal, Switch, MobileHeader, PopOver, MenuItem, useSnackbarContext, FormErrorMessage } from 'tsp-form';
import { Plus, X, XCircle, CheckCircle, SlidersHorizontal, ArrowRightFromLine, ArrowLeft, MoreHorizontal, Pencil, Power, Trash2, AlertCircle, Star, ShieldOff, ShieldCheck, Barcode as BarcodeIcon, ScanBarcode } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { useForm, Controller } from 'react-hook-form';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { useAuth } from '../../contexts/AuthContext';
import { ColorAutocomplete, ColorMatchBadge } from '../../components/ColorAutocomplete';
import { useBarcodeScanner } from '../../components/BarcodeScanner';

// ── Types ────────────────────────────────────────────────────────────────────

interface ModelVariant {
  variant_id: number;
  sku_code: string;
  name: string;
  attributes: Record<string, unknown> | null;
  is_active: boolean;
  barcodes?: string[];
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

function CreateModelModal({ open, onClose, holdingId, companyId, families, brands }: {
  open: boolean;
  onClose: () => void;
  holdingId: number | null;
  companyId: number | null;
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
      p_company_id: companyId,
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
      setErrorMessage(translateApiError(err, t));
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
  const [manageVariant, setManageVariant] = useState<ModelVariant | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['models-search'] });
    queryClient.invalidateQueries({ queryKey: ['model-detail-fallback', modelId] });
  };

  const showErr = (err: unknown) => {
    const msg = translateApiError(err, t);
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
              onManageBarcodes={() => setManageVariant(v)}
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
      <ManageBarcodesModal
        open={!!manageVariant}
        onClose={() => setManageVariant(null)}
        variant={manageVariant}
        onChanged={() => {
          if (!manageVariant) return;
          queryClient.invalidateQueries({ queryKey: ['variant-barcodes', manageVariant.variant_id] });
          queryClient.invalidateQueries({ queryKey: ['barcodes-list'] });
        }}
      />
    </>
  );
}

function VariantRow({ variant, onEdit, onManageBarcodes, onToggleActive }: {
  variant: ModelVariant;
  onEdit: () => void;
  onManageBarcodes: () => void;
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
                icon={<BarcodeIcon size={14} />}
                label={t('barcodes.manage', { defaultValue: 'Manage barcodes' })}
                onClick={() => { setMenuOpen(false); onManageBarcodes(); }}
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

      {(attrEntries.length > 0 || (variant.barcodes && variant.barcodes.length > 0)) && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {attrEntries.map(([key, val]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-fg/5 text-subtle"
            >
              <span className="opacity-70">{key}:</span>
              <span className="font-medium text-fg">{String(val)}</span>
            </span>
          ))}
          {variant.barcodes && variant.barcodes.length > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-fg/5 text-subtle"
              title={variant.barcodes.join('\n')}
            >
              <BarcodeIcon size={11} className="opacity-70" />
              <span className="font-mono font-medium text-success">{variant.barcodes.length}</span>
            </span>
          )}
        </div>
      )}
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
  const [barcodes, setBarcodes] = useState<string[]>(['']);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [barcodeWarnings, setBarcodeWarnings] = useState<string[]>([]);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setColor('');
      setIsActive(true);
      setBarcodes(['']);
      setErrorMessage('');
      setBarcodeWarnings([]);
      setConfirmCloseOpen(false);
    }
  }, [open]);

  const filledBarcodes = barcodes.map(b => b.trim()).filter(Boolean);
  const allBarcodesValid = filledBarcodes.every(b => detectBarcodeType(b) !== null && isValidGs1Checksum(b));

  // Dirty = any field diverges from initial blank state. Color empty + active=true
  // + only one empty barcode row = pristine.
  const isDirty =
    color.trim() !== '' ||
    !isActive ||
    barcodes.length > 1 ||
    barcodes.some(b => b.trim() !== '');

  const handleClose = () => {
    if (isPending) return;
    if (isDirty) { setConfirmCloseOpen(true); return; }
    onClose();
  };

  const forceClose = () => {
    setConfirmCloseOpen(false);
    onClose();
  };

  const onSubmit = async () => {
    if (!color.trim()) {
      setErrorMessage(t('models.colorRequired'));
      return;
    }
    if (filledBarcodes.length > 0 && !allBarcodesValid) {
      setErrorMessage(t('barcodes.invalidLengthError', { defaultValue: 'Each barcode must be 8, 12, or 13 digits.' }));
      return;
    }
    setIsPending(true);
    setErrorMessage('');
    setBarcodeWarnings([]);
    try {
      const res = await apiClient.rpc<{ id: number }>('variant_create', {
        p_model_id: modelId,
        p_manufacturer_color: color.trim(),
        p_is_active: isActive,
      });
      const newVariantId = res?.id;

      // Chain barcode_create calls. First filled barcode = primary. Collect
      // per-barcode failures so the user can see which ones got dropped
      // without rolling back the freshly-created variant.
      const warnings: string[] = [];
      if (newVariantId && filledBarcodes.length > 0) {
        for (let i = 0; i < filledBarcodes.length; i++) {
          const b = filledBarcodes[i];
          try {
            await apiClient.rpc('barcode_create', {
              p_variant_id: newVariantId,
              p_barcode: b,
              p_source: 'MANUAL_SCAN',
              p_branch_id: null,
              p_pin: null,
            });
          } catch (err) {
            warnings.push(`${b} — ${translateApiError(err, t)}`);
          }
        }
      }

      if (warnings.length > 0) {
        setBarcodeWarnings(warnings);
        addSnackbar({
          message: (
            <div className="alert alert-warning">
              <AlertCircle size={18} />
              <div><div className="alert-title">{t('models.variantCreatedBarcodeWarn', { defaultValue: 'Variant created, some barcodes failed' })}</div></div>
            </div>
          ),
          type: 'warning', duration: 4000,
        });
        onSuccess(); // refresh list so user sees the new variant
        return; // keep modal open so they can read the warning
      }

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
      setErrorMessage(translateApiError(err, t));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('models.addVariant')}</h2>
        <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
      </div>
      <div className="modal-content">
        {errorMessage && (
          <div className="alert alert-danger mb-4 animate-pop-in">
            <XCircle size={18} />
            <div><div className="alert-description">{errorMessage}</div></div>
          </div>
        )}
        {barcodeWarnings.length > 0 && (
          <div className="alert alert-warning mb-4">
            <AlertCircle size={18} />
            <div>
              <div className="alert-title">{t('models.variantCreatedBarcodeWarn', { defaultValue: 'Variant created, some barcodes failed' })}</div>
              <div className="alert-description">
                <ul className="list-disc pl-5 mt-1 text-xs">
                  {barcodeWarnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
                <div className="mt-1 text-xs">{t('models.addBarcodesLater', { defaultValue: 'You can add them later from the Barcodes page.' })}</div>
              </div>
            </div>
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

          <BarcodeRowsEditor barcodes={barcodes} onChange={setBarcodes} />
        </div>
      </div>
      <div className="modal-footer">
        <Button type="button" variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
        <Button
          type="button"
          color="primary"
          disabled={isPending || !color.trim() || (filledBarcodes.length > 0 && !allBarcodesValid)}
          onClick={onSubmit}
        >
          {isPending ? t('common.loading') : t('common.create')}
        </Button>
      </div>
    </Modal>

    <Modal open={confirmCloseOpen} onClose={() => setConfirmCloseOpen(false)} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('common.unsavedChanges')}</h2>
      </div>
      <div className="modal-content">
        <p>{t('common.unsavedChangesMessage')}</p>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => setConfirmCloseOpen(false)}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
      </div>
    </Modal>
    </>
  );
}

// ── Barcode helpers (mirror BarcodesPage) ────────────────────────────────────

function detectBarcodeType(raw: string): 'EAN8' | 'UPCA' | 'EAN13' | null {
  const d = raw.replace(/\D/g, '');
  if (d.length !== raw.length) return null;
  if (d.length === 8) return 'EAN8';
  if (d.length === 12) return 'UPCA';
  if (d.length === 13) return 'EAN13';
  return null;
}

// GS1 mod-10 check. Walking from the right: index 0 = check digit (×1),
// index 1 = ×3, index 2 = ×1, ... The full weighted sum is divisible by 10
// when the check digit is correct. Same algorithm for EAN-8 / UPC-A / EAN-13.
function isValidGs1Checksum(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = digits.charCodeAt(digits.length - 1 - i) - 48;
    sum += i % 2 === 1 ? d * 3 : d;
  }
  return sum % 10 === 0;
}

function jsbarcodeFormat(type: 'EAN8' | 'UPCA' | 'EAN13'): string {
  if (type === 'UPCA') return 'UPC';
  if (type === 'EAN8') return 'EAN8';
  return 'EAN13';
}

function BarcodePreviewSvg({ value, type }: { value: string; type: 'EAN8' | 'UPCA' | 'EAN13' }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: jsbarcodeFormat(type),
        width: 1.6,
        height: 40,
        displayValue: true,
        fontSize: 11,
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000',
      });
      // Width-based scaling stretches EAN8 vertically (fewer bars same width).
      // Lock the rendered height; let width auto-scale by aspect ratio.
      ref.current.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      ref.current.style.height = '56px';
      ref.current.style.width = 'auto';
    } catch {
      if (ref.current) ref.current.innerHTML = '';
    }
  }, [value, type]);
  return <svg ref={ref} />;
}

// Shared barcode input: text input + type chip / checksum warn / preview SVG.
// Used by BarcodeRowsEditor (Create Variant, looped) and ManageBarcodesModal's
// add row (single). Validation rules and preview shape must match.
function BarcodeInput({ value, onChange, badge, trailing, onEnter }: {
  value: string;
  onChange: (next: string) => void;
  badge?: React.ReactNode;
  trailing?: React.ReactNode;
  onEnter?: () => void;
}) {
  const { t } = useTranslation();
  const trimmed = value.trim();
  const type = trimmed ? detectBarcodeType(trimmed) : null;
  const digitsOnly = trimmed.replace(/\D/g, '');
  const showLengthWarn = trimmed.length > 0 && type === null;
  const checksumOk = type !== null && isValidGs1Checksum(trimmed);
  const { open: openScanner, scannerEl } = useBarcodeScanner({ onScan: onChange });

  return (
    <div className="flex flex-col gap-1.5 p-2 border border-line rounded-md">
      {scannerEl}
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('barcodes.barcodePlaceholder')}
          size="sm"
          className="w-full font-mono"
          inputMode="numeric"
          startIcon={<ScanBarcode size={16} />}
          onStartIconClick={openScanner}
          onKeyDown={onEnter ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } } : undefined}
        />
        {badge}
        {trailing}
      </div>
      {trimmed && (
        <div className="flex items-center gap-2 min-h-[1.25rem]">
          {type && checksumOk ? (
            <Badge size="xs" color="success">{type}</Badge>
          ) : type && !checksumOk ? (
            <span className="text-[11px] text-warning">{t('barcodes.checksumInvalid')}</span>
          ) : showLengthWarn ? (
            <span className="text-[11px] text-warning">
              {t('barcodes.lengthHint', { count: digitsOnly.length })}
            </span>
          ) : null}
        </div>
      )}
      {type && checksumOk && (
        <div className="flex justify-center items-center bg-white rounded border border-line h-16">
          <BarcodePreviewSvg value={trimmed} type={type} />
        </div>
      )}
    </div>
  );
}

function BarcodeRowsEditor({ barcodes, onChange }: {
  barcodes: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();

  const update = (i: number, v: string) => {
    const next = barcodes.slice();
    next[i] = v;
    onChange(next);
  };
  const addRow = () => onChange([...barcodes, '']);
  const removeRow = (i: number) => {
    if (barcodes.length === 1) {
      onChange(['']);
    } else {
      onChange(barcodes.filter((_, idx) => idx !== i));
    }
  };

  return (
    <div className="flex flex-col">
      <label className="form-label">
        {t('barcodes.title', { defaultValue: 'Barcodes' })}
        <span className="text-subtler font-normal ml-1">({t('common.optional', { defaultValue: 'optional' })})</span>
      </label>
      <div className="flex flex-col gap-2">
        {barcodes.map((raw, i) => (
          <BarcodeInput
            key={i}
            value={raw}
            onChange={(v) => update(i, v)}
            badge={i === 0 && raw.trim() ? <Badge size="xs" color="primary">{t('barcodes.primary')}</Badge> : null}
            trailing={
              <Button
                size="sm"
                variant="ghost"
                className="btn-icon-sm"
                startIcon={<Trash2 size={14} />}
                onClick={() => removeRow(i)}
                aria-label={t('common.remove', { defaultValue: 'Remove' })}
                disabled={barcodes.length === 1 && !raw}
              />
            }
          />
        ))}
      </div>
      <Button
        size="sm"
        variant="outline"
        startIcon={<Plus size={14} />}
        onClick={addRow}
        className="self-start mt-2"
      >
        {t('barcodes.addBarcode')}
      </Button>
    </div>
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
  const queryClient = useQueryClient();
  const [color, setColor] = useState('');
  const [editingColor, setEditingColor] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [manageBarcodesOpen, setManageBarcodesOpen] = useState(false);

  // Fetch the current manufacturer_color so we can show it (and pre-fill the
  // editor). It isn't on the search RPC response.
  const { data: detail } = useQuery({
    queryKey: ['variant-detail', variant?.variant_id],
    queryFn: async () => {
      const rows = await apiClient.get<{ manufacturer_color: string | null }[]>(
        `/v_product_variant_list?variant_id=eq.${variant!.variant_id}&select=manufacturer_color&limit=1`,
      );
      return Array.isArray(rows) ? rows[0] ?? null : null;
    },
    enabled: open && !!variant?.variant_id,
    staleTime: 30 * 1000,
  });

  const { data: barcodeRows = [] } = useQuery({
    queryKey: ['variant-barcodes', variant?.variant_id],
    queryFn: () => apiClient.get<VariantBarcodeRow[]>(
      `/v_barcode_list?variant_id=eq.${variant!.variant_id}&select=barcode_id,barcode,barcode_type,is_primary,is_active&order=is_primary.desc,barcode_id.asc`,
    ),
    enabled: open && !!variant?.variant_id,
    staleTime: 10 * 1000,
  });

  const currentColor = detail?.manufacturer_color?.trim() ?? '';

  useEffect(() => {
    if (open && variant) {
      setColor('');
      setEditingColor(false);
      setIsActive(variant.is_active);
      setErrorMessage('');
    }
  }, [open, variant]);

  const startEditingColor = () => {
    setColor(currentColor);
    setEditingColor(true);
  };

  const cancelEditingColor = () => {
    setColor('');
    setEditingColor(false);
  };

  const colorChanged = editingColor && color.trim() && color.trim() !== currentColor;

  const onSubmit = async () => {
    if (!variant) return;
    setIsPending(true);
    setErrorMessage('');
    try {
      const params: Record<string, unknown> = {
        p_variant_id: variant.variant_id,
        p_is_active: isActive,
      };
      if (colorChanged) params.p_manufacturer_color = color.trim();
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
      setErrorMessage(translateApiError(err, t));
    } finally {
      setIsPending(false);
    }
  };

  const activeBarcodes = barcodeRows.filter(b => b.is_active);

  return (
    <>
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
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
            <div className="card py-2">
              <div className="text-sm">{variant?.name ?? ''}</div>
              <div className="text-[11px] font-mono text-subtle truncate mt-0.5">{variant?.sku_code ?? ''}</div>
            </div>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="form-label mb-0" htmlFor="ev-color">{t('models.manufacturerColor')}</label>
              {editingColor && <ColorMatchBadge value={color} />}
            </div>
            {editingColor ? (
              <ColorAutocomplete
                id="ev-color"
                value={color}
                onChange={setColor}
                placeholder={t('models.manufacturerColorPlaceholder')}
                autoFocus
                endIcon={<X size={14} />}
                onEndIconClick={cancelEditingColor}
              />
            ) : (
              <div className="card flex items-center justify-between gap-2 py-2">
                <span className="text-sm">{currentColor || <span className="text-subtler">—</span>}</span>
                <Button
                  type="button"
                  size="sm"
                  startIcon={<Pencil size={12} />}
                  onClick={startEditingColor}
                >
                  {t('models.changeColor')}
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <label className="form-label mb-0" htmlFor="ev-active">{t('brandsModels.active')}</label>
            <Switch id="ev-active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          </div>

          <div className="flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="form-label mb-0">{t('barcodes.title')}</label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                startIcon={<Pencil size={12} />}
                onClick={() => setManageBarcodesOpen(true)}
              >
                {t('barcodes.manage', { defaultValue: 'Manage' })}
              </Button>
            </div>
            <div className="card py-2">
              {activeBarcodes.length === 0 ? (
                <span className="text-xs text-subtler">{t('barcodes.noneForVariant', { defaultValue: 'No barcodes bound to this variant yet.' })}</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {activeBarcodes.map(b => (
                    <span
                      key={b.barcode_id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-line text-[11px] font-mono"
                    >
                      {b.is_primary && <Badge size="xs" color="primary">{t('barcodes.primary')}</Badge>}
                      <span>{b.barcode}</span>
                      {b.barcode_type && <span className="text-subtler">· {b.barcode_type}</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
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

    <ManageBarcodesModal
      open={manageBarcodesOpen}
      onClose={() => setManageBarcodesOpen(false)}
      variant={variant}
      onChanged={() => {
        if (!variant) return;
        queryClient.invalidateQueries({ queryKey: ['variant-barcodes', variant.variant_id] });
        queryClient.invalidateQueries({ queryKey: ['barcodes-list'] });
      }}
    />
    </>
  );
}

// ── Manage Barcodes modal (per-variant) ──────────────────────────────────────

interface VariantBarcodeRow {
  barcode_id: number;
  barcode: string;
  barcode_type: string | null;
  is_primary: boolean;
  is_active: boolean;
}

function BarcodeRowActions({ row, busy, onSetPrimary, onToggleActive }: {
  row: VariantBarcodeRow;
  busy: boolean;
  onSetPrimary: () => void;
  onToggleActive: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const canSetPrimary = row.is_active && !row.is_primary;
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
          type="button"
          className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer bg-transparent border-0 disabled:opacity-50"
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          disabled={busy}
          aria-label={t('common.actions', { defaultValue: 'Actions' })}
        >
          <MoreHorizontal size={16} className="opacity-50" />
        </button>
      }
    >
      <div className="py-1 min-w-[160px]">
        {canSetPrimary && (
          <MenuItem
            icon={<Star size={14} />}
            label={t('barcodes.setPrimary')}
            onClick={() => { setOpen(false); onSetPrimary(); }}
          />
        )}
        <MenuItem
          icon={row.is_active ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
          label={row.is_active ? t('barcodes.disable') : t('barcodes.enable')}
          onClick={() => { setOpen(false); onToggleActive(); }}
        />
      </div>
    </PopOver>
  );
}

function ManageBarcodesModal({ open, onClose, variant, onChanged }: {
  open: boolean;
  onClose: () => void;
  variant: ModelVariant | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const queryClient = useQueryClient();
  const [newBarcode, setNewBarcode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (open) {
      setNewBarcode('');
      setErrorMessage('');
      setBusyId(null);
      setAdding(false);
    }
  }, [open]);

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['variant-barcodes', variant?.variant_id],
    queryFn: () => apiClient.get<VariantBarcodeRow[]>(
      `/v_barcode_list?variant_id=eq.${variant!.variant_id}&select=barcode_id,barcode,barcode_type,is_primary,is_active&order=is_active.desc,is_primary.desc,barcode_id.asc`,
    ),
    enabled: open && !!variant?.variant_id,
    staleTime: 5 * 1000,
  });

  const invalidate = () => {
    if (variant) queryClient.invalidateQueries({ queryKey: ['variant-barcodes', variant.variant_id] });
    onChanged();
  };

  const showErr = (err: unknown) => {
    setErrorMessage(translateApiError(err, t));
  };

  const handleAdd = async () => {
    if (!variant) return;
    const b = newBarcode.trim();
    setErrorMessage('');
    const type = detectBarcodeType(b);
    if (!type) {
      setErrorMessage(t('barcodes.digitsOnly'));
      return;
    }
    if (!isValidGs1Checksum(b)) {
      setErrorMessage(t('barcodes.checksumInvalid'));
      return;
    }
    setAdding(true);
    try {
      await apiClient.rpc('barcode_create', {
        p_variant_id: variant.variant_id,
        p_barcode: b,
        p_source: 'MANUAL_SCAN',
        p_branch_id: null,
        p_pin: null,
      });
      setNewBarcode('');
      invalidate();
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('barcodes.createSuccess')}</div></div>
          </div>
        ),
        type: 'success', duration: 2500,
      });
    } catch (err) { showErr(err); }
    finally { setAdding(false); }
  };

  const handleSetPrimary = async (row: VariantBarcodeRow) => {
    setBusyId(row.barcode_id);
    setErrorMessage('');
    try {
      await apiClient.rpc('barcode_update', {
        p_barcode_id: row.barcode_id,
        p_is_primary: true,
      });
      invalidate();
    } catch (err) { showErr(err); }
    finally { setBusyId(null); }
  };

  const handleToggleActive = async (row: VariantBarcodeRow) => {
    setBusyId(row.barcode_id);
    setErrorMessage('');
    try {
      await apiClient.rpc(row.is_active ? 'barcode_disable' : 'barcode_enable', {
        p_barcode_id: row.barcode_id,
      });
      invalidate();
    } catch (err) { showErr(err); }
    finally { setBusyId(null); }
  };

  const newType = newBarcode.trim() ? detectBarcodeType(newBarcode.trim()) : null;
  const newChecksumOk = newType !== null && isValidGs1Checksum(newBarcode.trim());

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('barcodes.manageTitle', { defaultValue: 'Manage barcodes' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="modal-content">
        <div className="flex flex-col mb-4">
          <label className="form-label">{t('models.currentVariant')}</label>
          <div className="card py-2">
            <div className="text-sm">{variant?.name ?? ''}</div>
            <div className="text-[11px] font-mono text-subtle truncate mt-0.5">{variant?.sku_code ?? ''}</div>
          </div>
        </div>

        {errorMessage && (
          <div className="alert alert-danger mb-3 animate-pop-in">
            <XCircle size={18} />
            <div><div className="alert-description">{errorMessage}</div></div>
          </div>
        )}

        <div className="flex flex-col gap-2 mb-4">
          {isFetching && rows.length === 0 ? (
            <div className="p-4 text-center text-subtler text-xs">{t('common.loading')}</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-center text-subtler text-xs">{t('barcodes.noneForVariant', { defaultValue: 'No barcodes bound to this variant yet.' })}</div>
          ) : (
            rows.map(row => (
              <div
                key={row.barcode_id}
                className={`flex items-center gap-2 px-3 py-2 border border-line rounded-md ${row.is_active ? '' : 'opacity-50'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-sm truncate">{row.barcode}</span>
                    {row.barcode_type && <Badge size="xs" color="default">{row.barcode_type}</Badge>}
                    {row.is_primary && <Badge size="xs" color="primary">{t('barcodes.primary')}</Badge>}
                    {!row.is_active && <Badge size="xs" color="default">{t('barcodes.inactive')}</Badge>}
                  </div>
                </div>
                <BarcodeRowActions
                  row={row}
                  busy={busyId === row.barcode_id}
                  onSetPrimary={() => handleSetPrimary(row)}
                  onToggleActive={() => handleToggleActive(row)}
                />
              </div>
            ))
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="form-label">{t('barcodes.addBarcode')}</label>
          <BarcodeInput
            value={newBarcode}
            onChange={setNewBarcode}
            onEnter={handleAdd}
            trailing={
              <Button
                size="sm"
                color="primary"
                disabled={adding || !newType || !newChecksumOk}
                onClick={handleAdd}
              >
                {adding ? t('common.loading') : t('common.add', { defaultValue: 'Add' })}
              </Button>
            }
          />
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>{t('common.close')}</Button>
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
              companyId={user?.company_id ?? null}
              families={families}
              brands={brands}
            />
          </>
        );
      }}
    </PageNav>
  );
}
