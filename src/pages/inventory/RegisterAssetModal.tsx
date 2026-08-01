import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query';
import { Modal, Button, Input, Select, MaskedInput, LabeledCheckbox, InputDatePicker } from 'tsp-form';
import { XCircle, CheckCircle, Search, Package, Keyboard, ExternalLink, RotateCcw } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { makeDatePickerFormat, toLocalDateStr, fmtCurrency } from '../../lib/format';
import { ImeiInput } from '../../components/ImeiInput';
import { getConditionLabel, getBucketLabel, CONDITION_VALUES } from './inventoryUtils';

// Direct device intake — fn_inv_asset_register. For our own shops (INTERNAL) and
// company-owned consignment branches (EXTERNAL): the device lands straight in
// ON_HAND_AVAILABLE, no PO / receipt / approval. DEAL_PARTNER is intentionally
// excluded here — those branches own their own devices, so letting them self-
// register would let them push stock in unchecked (their intake goes through the
// approval path, not this screen). Not the PO/buyback intake path.

interface BranchRow { id: number; name: string; branch_type: string; is_active: boolean }

interface ProductSearchVariant { variant_id: number; sku_code: string; name: string; is_active: boolean }
interface ProductSearchModel {
  model_id: number;
  model_name: string;
  brand_name: string | null;
  family_name: string | null;
  variants: ProductSearchVariant[];
}
interface ProductSearchResponse { rows: ProductSearchModel[] }

interface RegisterResult {
  asset_id: number;
  asset_code: string;
  code_display?: string | null;
  // Set true when the scanned device was OWNERSHIP_TRANSFERRED and the register
  // RPC pulled the existing row back into stock instead of creating a new one
  // (mig 890). from_branch_id = the branch that once released it; final_cost =
  // the cost the staff entered. The user pressed "register a new device" but the
  // system re-registered an existing one, so the done view says so explicitly.
  re_registered?: boolean;
  from_branch_id?: number | null;
  final_cost?: number | null;
}

export function RegisterAssetModal({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  onRegistered: () => void;
}) {
  const { t, i18n } = useTranslation();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<RegisterResult | null>(null);

  const [branchId, setBranchId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  const [modelId, setModelId] = useState<number | null>(null);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [condition, setCondition] = useState<string>('NEW');
  const [hasBox, setHasBox] = useState(true);
  const [battery, setBattery] = useState('');
  const [warranty, setWarranty] = useState('');
  const [typingWarranty, setTypingWarranty] = useState(false);
  const [imei, setImei] = useState('');
  const [serial, setSerial] = useState('');
  const [costOverride, setCostOverride] = useState('');
  const [retailOverride, setRetailOverride] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [error, setError] = useState('');
  // When the register RPC rejects with INV.CONFLICT.IDENTIFIER_CONFLICT, the BE
  // sends the existing asset's id/code so we can link straight to it.
  const [conflictAssetId, setConflictAssetId] = useState<number | null>(null);

  // INTERNAL (own shops) + EXTERNAL (company-owned consignment) may register here.
  // DEAL_PARTNER is excluded — they own their devices; self-register would let them
  // push stock in without approval.
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-register'],
    queryFn: () => apiClient.get<BranchRow[]>('/v_branches?is_active=is.true&order=name'),
    enabled: open,
  });
  const eligibleBranches = useMemo(
    () => branches.filter(b => b.branch_type === 'INTERNAL' || b.branch_type === 'EXTERNAL'),
    [branches],
  );
  const branchOptions = useMemo(
    () => eligibleBranches.map(b => ({ value: String(b.id), label: b.name })),
    [eligibleBranches],
  );

  // Preselect when there's exactly one eligible branch (shop staff see only theirs).
  useEffect(() => {
    if (open && !branchId && eligibleBranches.length === 1) {
      setBranchId(String(eligibleBranches[0].id));
    }
  }, [open, branchId, eligibleBranches]);

  useEffect(() => {
    if (open) {
      setView('form'); setResult(null);
      setBranchId(null); setKeyword(''); setDebounced('');
      setModelId(null); setVariantId(null);
      setCondition('NEW'); setHasBox(true);
      setBattery(''); setWarranty(''); setTypingWarranty(false);
      setImei(''); setSerial('');
      setCostOverride(''); setRetailOverride('');
      setExternalRef('');
      setError(''); setConflictAssetId(null);
    }
  }, [open]);

  useEffect(() => {
    const tm = setTimeout(() => setDebounced(keyword.trim()), 300);
    return () => clearTimeout(tm);
  }, [keyword]);

  const { data: searchData, isFetching } = useQuery({
    queryKey: ['register-product-search', debounced],
    queryFn: () => apiClient.rpc<ProductSearchResponse>('fn_product_search', {
      p_q: debounced,
      p_is_contractable: true,
      p_is_active: true,
      p_limit: 20,
    }),
    enabled: open && view === 'form',
    placeholderData: keepPreviousData,
  });
  const models = searchData?.rows ?? [];
  const selectedModel = useMemo(() => models.find(m => m.model_id === modelId) ?? null, [models, modelId]);
  const activeVariants = useMemo(() => selectedModel?.variants.filter(v => v.is_active) ?? [], [selectedModel]);

  useEffect(() => {
    if (activeVariants.length === 0) { setVariantId(null); return; }
    if (!activeVariants.some(v => v.variant_id === variantId)) setVariantId(activeVariants[0].variant_id);
  }, [activeVariants, variantId]);

  // Real grades only — 'USED' in CONDITION_VALUES is a filter meta-value, not a
  // registrable grade.
  const conditionOptions = useMemo(
    () => CONDITION_VALUES.filter(v => v !== 'USED').map(v => ({ value: v, label: getConditionLabel(v, t) })),
    [t],
  );

  const buildIdentifiers = () => {
    const ids: { type: string; value: string }[] = [];
    if (imei.trim()) ids.push({ type: 'IMEI', value: imei.trim() });
    if (serial.trim()) ids.push({ type: 'SERIAL_NO', value: serial.trim() });
    return ids;
  };

  const canSubmit = !!branchId && !!modelId && !!variantId
    && (imei.trim() !== '' || serial.trim() !== '');

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<RegisterResult>('fn_inv_asset_register', {
      p_branch_id: Number(branchId),
      p_model_id: modelId,
      p_variant_id: variantId,
      p_condition_grade: condition,
      p_identifiers: buildIdentifiers(),
      p_physical_color: null,
      p_cost_override: costOverride.trim() ? Number(costOverride) : null,
      p_retail_override: retailOverride.trim() ? Number(retailOverride) : null,
      p_dedupe_key: null,
      p_external_ref: externalRef.trim() || null,
      p_has_box: hasBox,
      p_legacy_code: null,
      // Battery health rides in the condition snapshot (key UPPERCASE, 0–100).
      p_condition_snapshot: battery.trim() ? { BATTERY_HEALTH: Number(battery) } : null,
      p_warranty_expired_date: warranty || null,
    }),
    onSuccess: (data) => {
      setResult(data);
      setView('done');
      onRegistered();
    },
    onError: (err) => {
      setConflictAssetId(null);
      if (err instanceof ApiError) {
        // Identifier conflict: the BE ships the existing asset's id/code/branch/
        // bucket as params. Resolve the bucket to its label so the message reads
        // like the stock screens, and stash the id so we can link to it.
        const p = err.messageParams;
        if (p && (err.code === 'INV.CONFLICT.IDENTIFIER_CONFLICT' || err.messageKey === 'inv.conflict.identifier_conflict')) {
          const bucket = p.existing_bucket as string | undefined;
          if (bucket) err.messageParams = { ...p, existing_bucket_label: getBucketLabel(bucket, t) };
          const id = Number(p.existing_asset_id);
          if (Number.isFinite(id) && id > 0) setConflictAssetId(id);
        }
        setError(translateApiError(err, t));
      } else {
        setError(String(err));
      }
    },
  });

  const noEligible = eligibleBranches.length === 0;

  // Name of the branch that once released a re-registered device. Falls back to
  // its id if the branch isn't in the active list (e.g. deactivated since).
  const fromBranchName = useMemo(() => {
    if (!result?.from_branch_id) return null;
    const b = branches.find(x => x.id === result.from_branch_id);
    return b?.name ?? `#${result.from_branch_id}`;
  }, [result?.from_branch_id, branches]);

  return (
    <Modal open={open} onClose={onClose} maxWidth="34rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('asset.registerTitle', { defaultValue: 'Register asset' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>

      {view === 'done' && result ? (
        <>
          <div className="modal-content">
            <div className="flex flex-col items-center gap-2 py-6">
              {result.re_registered ? (
                <RotateCcw size={40} className="text-success" />
              ) : (
                <CheckCircle size={40} className="text-success" />
              )}
              <p className="text-sm text-subtle text-center">
                {result.re_registered
                  ? t('asset.reRegisterDone', { defaultValue: 'Device returned to stock' })
                  : t('asset.registerDone', { defaultValue: 'Asset registered' })}
              </p>
              <Link
                to={`/admin/inventory/assets/${result.asset_id}`}
                className="text-lg font-semibold font-mono text-primary-fg hover:underline"
                onClick={onClose}
              >
                {result.code_display ?? result.asset_code}
              </Link>
              {result.re_registered && (
                <p className="text-xs text-subtle text-center max-w-xs">
                  {fromBranchName
                    ? t('asset.reRegisterFromBranch', {
                        branch: fromBranchName,
                        defaultValue: 'This device was previously transferred out of {{branch}}. It is now in this branch’s stock.',
                      })
                    : t('asset.reRegisterGeneric', {
                        defaultValue: 'This device had been transferred out. It is now back in this branch’s stock.',
                      })}
                  {result.final_cost != null && (
                    <> {' · '}{t('asset.reRegisterCost', { cost: fmtCurrency(result.final_cost), defaultValue: 'Cost {{cost}}' })}</>
                  )}
                </p>
              )}
              <Link
                to={`/admin/inventory/assets/${result.asset_id}`}
                className="inline-flex items-center gap-1 text-sm text-primary-fg hover:underline"
                onClick={onClose}
              >
                <ExternalLink size={14} />
                {t('asset.registerViewAsset', { defaultValue: 'Open asset' })}
              </Link>
            </div>
          </div>
          <div className="modal-footer">
            <Button color="primary" onClick={onClose}>{t('common.done', { defaultValue: 'Done' })}</Button>
          </div>
        </>
      ) : (
        <>
          <div className="modal-content">
            {noEligible ? (
              <div className="alert alert-warning">
                <XCircle size={18} />
                <span>{t('asset.registerNoBranch', {
                  defaultValue: 'You have no branch that can register devices into stock.',
                })}</span>
              </div>
            ) : (
              <>
                {error && (
                  <div className="alert alert-danger mb-4 animate-pop-in">
                    <XCircle size={16} />
                    <div className="flex flex-col gap-1 min-w-0">
                      <span>{error}</span>
                      {conflictAssetId != null && (
                        <Link
                          to={`/admin/inventory/assets/${conflictAssetId}`}
                          className="inline-flex items-center gap-1 text-primary-fg hover:underline font-medium"
                          onClick={onClose}
                        >
                          <ExternalLink size={13} />
                          {t('asset.registerViewExisting', { defaultValue: 'View existing asset' })}
                        </Link>
                      )}
                    </div>
                  </div>
                )}

                <div className="form-grid">
                  {/* Branch */}
                  <div className="flex flex-col">
                    <label className="form-label">{t('asset.registerBranch', { defaultValue: 'Branch' })} *</label>
                    <Select
                      options={branchOptions}
                      value={branchId}
                      onChange={(v) => setBranchId((v as string) || null)}
                      placeholder={t('asset.registerBranchPlaceholder', { defaultValue: 'Select branch' })}
                      size="sm"
                      searchable
                      showChevron
                    />
                  </div>

                  {/* Product search */}
                  <div className="flex flex-col">
                    <label className="form-label">{t('asset.registerProduct', { defaultValue: 'Product' })} *</label>
                    <Input
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder={t('asset.registerProductSearch', { defaultValue: 'Search model or brand...' })}
                      size="sm"
                      className="w-full"
                      startIcon={<Search size={14} />}
                    />
                    <div className="mt-2 max-h-44 overflow-auto better-scroll rounded-md border border-line divide-y divide-line">
                      {isFetching && models.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-subtler">{t('common.loading')}</div>
                      ) : models.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-subtler">{t('common.noData')}</div>
                      ) : models.map(m => (
                        <button
                          key={m.model_id}
                          type="button"
                          onClick={() => setModelId(m.model_id)}
                          className={`w-full text-left px-3 py-2 text-sm cursor-pointer transition-colors ${
                            m.model_id === modelId ? 'bg-primary-soft' : 'hover:bg-surface-hover bg-transparent'
                          }`}
                        >
                          <div className="font-medium truncate">{[m.brand_name, m.family_name, m.model_name].filter(Boolean).join(' ')}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Variant */}
                  {selectedModel && (
                    <div className="flex flex-col">
                      <label className="form-label">{t('asset.registerVariant', { defaultValue: 'Variant' })} *</label>
                      <Select
                        options={activeVariants.map(v => ({ value: String(v.variant_id), label: v.name }))}
                        value={variantId != null ? String(variantId) : null}
                        onChange={(v) => setVariantId(v ? Number(v) : null)}
                        size="sm"
                        showChevron
                      />
                    </div>
                  )}

                  {/* Condition + has_box */}
                  <div className="flex items-end gap-3">
                    <div className="flex flex-col flex-1 min-w-0">
                      <label className="form-label">{t('asset.registerCondition', { defaultValue: 'Condition' })} *</label>
                      <Select
                        options={conditionOptions}
                        value={condition}
                        onChange={(v) => setCondition(v as string)}
                        size="sm"
                        showChevron
                      />
                    </div>
                    <div className="pb-1">
                      <LabeledCheckbox
                        label={t('asset.hasBox', { defaultValue: 'Has box' })}
                        checked={hasBox}
                        onChange={(e) => setHasBox(e.target.checked)}
                      />
                    </div>
                  </div>

                  {/* Battery health + warranty expiry */}
                  <div className="flex gap-3">
                    <div className="flex flex-col flex-1 min-w-0">
                      <label className="form-label">{t('asset.registerBattery', { defaultValue: 'Battery health (%)' })}</label>
                      <MaskedInput
                        mask="number"
                        decimalScale={0}
                        value={battery}
                        onChange={(raw) => {
                          // Clamp to 0–100. Empty stays empty.
                          if (raw === '') { setBattery(''); return; }
                          const n = parseInt(raw, 10);
                          if (isNaN(n)) return;
                          setBattery(String(Math.max(0, Math.min(100, n))));
                        }}
                        placeholder="1-100"
                        className="w-full"
                        suffix="%"
                      />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <label className="form-label">{t('asset.registerWarranty', { defaultValue: 'Warranty expiry date' })}</label>
                      <InputDatePicker
                        value={warranty ? new Date(warranty + 'T00:00:00') : null}
                        onChange={(v) => setWarranty(toLocalDateStr(v))}
                        dateFormat={makeDatePickerFormat(i18n.language)}
                        locale={i18n.language}
                        calendar="gregorian"
                        size="sm"
                        endIcon={<Keyboard size={16} />}
                        onEndIconClick={() => setTypingWarranty(w => !w)}
                        typingMode={typingWarranty}
                        onTypingModeChange={setTypingWarranty}
                        typingMask="##/##/####"
                        typingPlaceholder="DD/MM/YYYY"
                        parseTypedDate={(raw) => {
                          if (raw.length !== 8) return null;
                          const day = parseInt(raw.slice(0, 2), 10);
                          const month = parseInt(raw.slice(2, 4), 10);
                          let year = parseInt(raw.slice(4, 8), 10);
                          if (year > 2400) year -= 543;
                          if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                          const d = new Date(year, month - 1, day);
                          if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                          return d;
                        }}
                      />
                    </div>
                  </div>

                  {/* Identifiers — at least one required; backend enforces IMEI for iPhone models */}
                  <div className="flex flex-col">
                    <label className="form-label">{t('asset.registerImei', { defaultValue: 'IMEI' })}</label>
                    <ImeiInput value={imei} onChange={setImei} size="sm" className="w-full" placeholder="15 digits" />
                  </div>
                  <div className="flex flex-col">
                    <label className="form-label">{t('asset.registerSerial', { defaultValue: 'Serial number' })}</label>
                    <Input value={serial} onChange={(e) => setSerial(e.target.value)} size="sm" className="w-full" />
                    <div className="text-xs text-subtle mt-1">{t('asset.registerIdHint', { defaultValue: 'Enter at least one identifier (IMEI or serial).' })}</div>
                  </div>

                  {/* Optional price overrides */}
                  <div className="flex gap-3">
                    <div className="flex flex-col flex-1 min-w-0">
                      <label className="form-label">{t('asset.registerCostOverride', { defaultValue: 'Cost (override)' })}</label>
                      <MaskedInput mask="number" decimalScale={2} value={costOverride} onChange={(raw) => setCostOverride(raw)} className="w-full" />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <label className="form-label">{t('asset.registerRetailOverride', { defaultValue: 'Retail (override)' })}</label>
                      <MaskedInput mask="number" decimalScale={2} value={retailOverride} onChange={(raw) => setRetailOverride(raw)} className="w-full" />
                    </div>
                  </div>

                  {/* Optional external reference — free text tying this asset to an
                      outside document (supplier invoice, partner ref). Not validated. */}
                  <div className="flex flex-col">
                    <label className="form-label">{t('asset.registerExternalRef', { defaultValue: 'External ref' })}</label>
                    <Input
                      value={externalRef}
                      onChange={(e) => setExternalRef(e.target.value)}
                      size="sm"
                      className="w-full"
                      placeholder={t('asset.registerExternalRefPlaceholder', { defaultValue: 'e.g. supplier invoice no.' })}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {!noEligible && (
            <div className="modal-footer">
              <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                startIcon={<Package size={16} />}
                onClick={() => mutation.mutate()}
                disabled={!canSubmit || mutation.isPending}
              >
                {mutation.isPending ? t('common.saving') : t('asset.registerSubmit', { defaultValue: 'Register' })}
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
