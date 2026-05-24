import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, Button, Input, Select, Badge, Modal, MobileHeader,
  PopOver, MenuItem, MenuSeparator, useSnackbarContext,
} from 'tsp-form';
import {
  Barcode, Plus, Search, ArrowRightFromLine, ScanLine, CheckCircle, XCircle,
  MoreHorizontal, ShieldOff, ShieldCheck, AlertCircle, Wand2, X,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useMediaQuery } from '../../hooks/useMediaQuery';

// ── Types ────────────────────────────────────────────────────────────────────
// v_barcode_list columns (verified against the view DDL):
//   barcode_id, holding_id, barcode, barcode_type, is_primary, source, is_active,
//   variant_id, sku_code, variant_name, model_id, model_code, model_name,
//   family_id, family_code, family_name, brand_id, brand_code, brand_name,
//   created_at, updated_at.

interface BarcodeRow {
  barcode_id: number;
  barcode: string;
  barcode_type: string | null;
  is_primary: boolean;
  source: string | null;
  is_active: boolean;
  variant_id: number;
  sku_code: string | null;
  variant_name: string | null;
  model_id: number | null;
  model_name: string | null;
  family_name: string | null;
  brand_name: string | null;
}

interface BarcodeSearchResult {
  barcode_id: number;
  barcode: string;
  barcode_type: string | null;
  variant_id: number;
  sku_code: string | null;
  sku_name: string | null;
  model_id: number | null;
  model_name: string | null;
  family_name: string | null;
  brand_name: string | null;
}

interface ProductSearchRow {
  model_id: number;
  model_name: string;
  brand_name: string;
  family_name: string;
}

interface ProductSearchResponse {
  total: number;
  rows: ProductSearchRow[];
}

interface VariantRow {
  variant_id: number;
  sku_code: string;
  name: string;
  is_active: boolean;
}

interface ModelDetailRow {
  variants: VariantRow[];
}

// ── Source label ─────────────────────────────────────────────────────────────

function sourceLabel(t: ReturnType<typeof useTranslation>['t'], src: string | null) {
  switch (src) {
    case 'MANUAL_SCAN': return t('barcodes.sourceManual');
    case 'WEB_LOOKUP': return t('barcodes.sourceWeb');
    case 'IMPORT': return t('barcodes.sourceImport');
    default: return src ?? '—';
  }
}

// ── EAN-13 generator (store-internal, prefix 200) ────────────────────────────
// EAN-13 reserves "2"-prefixed codes for store-internal use. Build 12 digits
// then append the check digit (mod-10 with alternating ×3/×1 weighting).
function generateEan13(): string {
  // 200 + 9 random digits = 12; append checksum
  let body = '200';
  for (let i = 0; i < 9; i++) body += Math.floor(Math.random() * 10).toString();
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(body[i], 10);
    sum += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return body + check.toString();
}

function detectBarcodeType(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 12) return 'UPCA';
  if (d.length === 8) return 'EAN8';
  return 'EAN13';
}

// ── Main page ────────────────────────────────────────────────────────────────

export function BarcodesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const [scanInput, setScanInput] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const [scanResult, setScanResult] = useState<BarcodeSearchResult | null>(null);
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [scanError, setScanError] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const tm = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(tm);
  }, [search]);

  useEffect(() => { setPageIndex(0); }, [debouncedSearch]);

  // Fetch all barcodes
  const { data, isFetching } = useQuery({
    queryKey: ['barcodes-list', pageIndex, pageSize, debouncedSearch],
    queryFn: () => {
      const params: string[] = ['order=created_at.desc'];
      if (debouncedSearch) {
        const term = encodeURIComponent(debouncedSearch);
        params.push(
          `or=(barcode.ilike.*${term}*,sku_code.ilike.*${term}*,variant_name.ilike.*${term}*,model_name.ilike.*${term}*)`,
        );
      }
      return apiClient.getPaginated<BarcodeRow>(`/v_barcode_list?${params.join('&')}`, {
        page: pageIndex + 1,
        pageSize,
      });
    },
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  // ── Scan handler ───────────────────────────────────────────────────────────
  const handleScan = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    setScanError('');
    setScanResult(null);
    try {
      const res = await apiClient.rpc<BarcodeSearchResult>('barcode_search', { p_barcode: code });
      setScanResult(res);
      setScanInput('');
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'BARCODE.NOT_FOUND' || err.messageKey === 'barcode.not_found')) {
        setPendingBarcode(code);
        setRegisterOpen(true);
        setScanInput('');
      } else {
        const msg = err instanceof ApiError
          ? (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || err.message
          : t('barcodes.lookupError');
        setScanError(msg);
      }
    }
  }, [t]);

  const onScanKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleScan(scanInput);
    }
  };

  const onScanCleared = () => {
    setScanResult(null);
    setScanError('');
    setScanInput('');
    scanInputRef.current?.focus();
  };

  // ── Row actions ────────────────────────────────────────────────────────────
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

  const handleSetPrimary = async (row: BarcodeRow) => {
    try {
      await apiClient.rpc('barcode_update', {
        p_barcode_id: row.barcode_id,
        p_barcode: null,
        p_barcode_type: null,
        p_is_primary: true,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('barcodes.updateSuccess')}</div></div>
          </div>
        ),
        type: 'success', duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['barcodes-list'] });
    } catch (err) { showErr(err); }
  };

  const handleToggleActive = async (row: BarcodeRow) => {
    try {
      if (row.is_active) {
        await apiClient.rpc('barcode_disable', { p_barcode_id: row.barcode_id });
        addSnackbar({
          message: (
            <div className="alert alert-success">
              <CheckCircle size={18} />
              <div><div className="alert-title">{t('barcodes.disableSuccess')}</div></div>
            </div>
          ),
          type: 'success', duration: 3000,
        });
      } else {
        await apiClient.rpc('barcode_enable', { p_barcode_id: row.barcode_id });
        addSnackbar({
          message: (
            <div className="alert alert-success">
              <CheckCircle size={18} />
              <div><div className="alert-title">{t('barcodes.enableSuccess')}</div></div>
            </div>
          ),
          type: 'success', duration: 3000,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['barcodes-list'] });
    } catch (err) { showErr(err); }
  };

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
          {t('barcodes.title')}
        </div>
        <div className="mobile-header-end px-2">
          <button
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-surface-hover cursor-pointer text-current"
            aria-label={t('barcodes.addBarcode')}
            onClick={() => { setPendingBarcode(null); setRegisterOpen(true); }}
          >
            <Plus size={18} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2 flex items-center gap-2">
            <Barcode size={18} />
            {t('barcodes.title')}
          </h1>
          <Button
            color="primary"
            startIcon={<Plus size={16} />}
            onClick={() => { setPendingBarcode(null); setRegisterOpen(true); }}
          >
            {t('barcodes.addBarcode')}
          </Button>
        </div>

        {/* Scan + search bar */}
        <div className="flex-none pb-3 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-0 max-w-72">
            <div className="input-group">
              <Input
                ref={scanInputRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={onScanKey}
                placeholder={t('barcodes.scanPlaceholder')}
                size="sm"
                endIcon={scanInput ? <X size={14} /> : undefined}
                onEndIconClick={scanInput ? () => setScanInput('') : undefined}
                className="w-full"
                autoFocus={!isMobile}
              />
              <div className="input-group-divider" />
              <Button
                variant="outline"
                size="sm"
                className="px-3"
                startIcon={<ScanLine size={16} />}
                onClick={() => handleScan(scanInput)}
                disabled={!scanInput.trim()}
              >
                {t('barcodes.scan')}
              </Button>
            </div>
          </div>
          <div className="flex-1 min-w-0 max-w-64">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('barcodes.search')}
              size="sm"
              startIcon={<Search size={16} />}
              endIcon={search ? <X size={14} /> : undefined}
              onEndIconClick={search ? () => setSearch('') : undefined}
              className="w-full"
            />
          </div>
        </div>

        {/* Scan feedback (errors/results) */}
        <div className="flex-none">
          {scanError && (
            <div className="mt-2 alert alert-danger animate-pop-in">
              <XCircle size={18} />
              <div><div className="alert-description">{scanError}</div></div>
            </div>
          )}
          {scanResult && (
            <div className="mt-2 alert alert-success">
              <CheckCircle size={18} />
              <div className="flex-1 min-w-0">
                <div className="alert-title">{t('barcodes.found')}</div>
                <div className="alert-description">
                  <span className="font-mono">{scanResult.barcode}</span>
                  {scanResult.barcode_type ? ` (${scanResult.barcode_type})` : ''}
                  {' → '}
                  <span className="font-medium">{scanResult.sku_name ?? scanResult.model_name}</span>
                  {scanResult.brand_name ? <span className="text-subtle"> · {scanResult.brand_name}</span> : null}
                  {scanResult.sku_code ? <span className="text-subtle"> · {scanResult.sku_code}</span> : null}
                </div>
              </div>
              <button
                type="button"
                className="ml-2 text-xs underline text-subtle hover:text-fg cursor-pointer bg-transparent border-0"
                onClick={onScanCleared}
              >
                {t('common.close')}
              </button>
            </div>
          )}
        </div>

        <DataTable<BarcodeRow>
          data={rows}
          renderRow={(row) => {
            const r = row.original;
            return (
              <div
                key={r.barcode_id}
                className="w-full px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors hover:bg-surface-hover"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-sm font-medium truncate">{r.barcode}</span>
                    {r.barcode_type && (
                      <Badge size="xs" color="default">{r.barcode_type}</Badge>
                    )}
                    {r.is_primary && (
                      <Badge size="xs" color="primary">{t('barcodes.primary')}</Badge>
                    )}
                    {!r.is_active && (
                      <Badge size="xs" color="default">{t('barcodes.inactive')}</Badge>
                    )}
                  </div>
                  <div className="text-xs truncate mt-0.5">
                    <span className="text-subtle">
                      {[r.brand_name, r.family_name, r.model_name].filter(Boolean).join(' ')}
                    </span>
                    {r.variant_name && (
                      <>
                        {' '}
                        <span>{r.variant_name}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <div className="text-xs text-subtle">{sourceLabel(t, r.source)}</div>
                </div>
                <RowActions
                  row={r}
                  onSetPrimary={handleSetPrimary}
                  onToggleActive={handleToggleActive}
                />
              </div>
            );
          }}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[10, 20, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
          className={`flex-1 min-h-0 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={<div className="p-8 text-center text-subtler">{t('barcodes.noBarcodes')}</div>}
        />
      </div>

      <RegisterBarcodeModal
        open={registerOpen}
        onClose={() => { setRegisterOpen(false); setPendingBarcode(null); }}
        initialBarcode={pendingBarcode}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['barcodes-list'] });
        }}
      />
    </>
  );
}

// ── Row Actions ──────────────────────────────────────────────────────────────

function RowActions({ row, onSetPrimary, onToggleActive }: {
  row: BarcodeRow;
  onSetPrimary: (r: BarcodeRow) => void;
  onToggleActive: (r: BarcodeRow) => void;
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
          className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer bg-transparent border-0"
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        >
          <MoreHorizontal size={16} className="opacity-50" />
        </button>
      }
    >
      <div className="py-1 min-w-[160px]">
        {!row.is_primary && row.is_active && (
          <>
            <MenuItem
              label={t('barcodes.setPrimary')}
              onClick={() => { setOpen(false); onSetPrimary(row); }}
            />
            <MenuSeparator />
          </>
        )}
        <MenuItem
          icon={row.is_active ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
          label={row.is_active ? t('barcodes.disable') : t('barcodes.enable')}
          onClick={() => { setOpen(false); onToggleActive(row); }}
        />
      </div>
    </PopOver>
  );
}

// ── Register Barcode Modal ───────────────────────────────────────────────────

interface RegisterModalProps {
  open: boolean;
  onClose: () => void;
  initialBarcode: string | null;
  onSuccess: () => void;
}

function RegisterBarcodeModal({ open, onClose, initialBarcode, onSuccess }: RegisterModalProps) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [barcode, setBarcode] = useState(initialBarcode ?? '');
  const [barcodeType, setBarcodeType] = useState<string>('EAN13');
  const [isPrimary, setIsPrimary] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isPending, setIsPending] = useState(false);

  const [modelQuery, setModelQuery] = useState('');
  const [debouncedModelQuery, setDebouncedModelQuery] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string>('');
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setBarcode(initialBarcode ?? '');
      setBarcodeType(initialBarcode ? detectBarcodeType(initialBarcode) : 'EAN13');
      setIsPrimary(true);
      setErrorMessage('');
      setModelQuery('');
      setDebouncedModelQuery('');
      setSelectedModelId(null);
      setSelectedModelName('');
      setSelectedVariantId(null);
    }
  }, [open, initialBarcode]);

  useEffect(() => {
    const tm = setTimeout(() => setDebouncedModelQuery(modelQuery.trim()), 300);
    return () => clearTimeout(tm);
  }, [modelQuery]);

  const { data: modelSearch, isFetching: modelsFetching } = useQuery({
    queryKey: ['barcode-register-models', debouncedModelQuery],
    queryFn: () => apiClient.rpc<ProductSearchResponse>('fn_product_search', {
      p_q: debouncedModelQuery || null,
      p_brand_id: null,
      p_family_id: null,
      p_base_model_name: null,
      p_is_active: true,
      p_limit: 20,
      p_offset: 0,
    }),
    enabled: open && debouncedModelQuery.length > 0 && !selectedModelId,
  });

  const { data: modelDetail } = useQuery({
    queryKey: ['barcode-register-variants', selectedModelId],
    queryFn: async () => {
      const rows = await apiClient.get<ModelDetailRow[]>(
        `/v_ref_model_detail?model_id=eq.${selectedModelId}&limit=1`,
      );
      return Array.isArray(rows) ? rows[0] ?? { variants: [] } : { variants: [] };
    },
    enabled: !!selectedModelId,
  });

  const variants = modelDetail?.variants ?? [];

  useEffect(() => {
    if (variants.length === 1) setSelectedVariantId(variants[0].variant_id);
  }, [variants]);

  const handleGenerate = () => {
    const code = generateEan13();
    setBarcode(code);
    setBarcodeType('EAN13');
  };

  const onSubmit = async () => {
    setErrorMessage('');
    if (!barcode.trim()) {
      setErrorMessage(t('barcode.invalid', { ns: 'apiErrors', defaultValue: 'Invalid barcode' }));
      return;
    }
    if (!selectedVariantId) {
      setErrorMessage(t('barcode.variant_required', { ns: 'apiErrors', defaultValue: 'Variant is required' }));
      return;
    }

    setIsPending(true);
    try {
      await apiClient.rpc('barcode_create', {
        p_variant_id: selectedVariantId,
        p_barcode: barcode.trim(),
        p_barcode_type: barcodeType,
        p_is_primary: isPrimary,
        p_source: 'MANUAL_SCAN',
        p_branch_id: null,
        p_pin: null,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('barcodes.createSuccess')}</div></div>
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
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('barcodes.registerTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="modal-content">
        {initialBarcode && (
          <div className="alert alert-info mb-4">
            <AlertCircle size={18} />
            <div>
              <div className="alert-description">
                {t('barcodes.registerHint', { barcode: initialBarcode })}
              </div>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="alert alert-danger mb-4 animate-pop-in">
            <XCircle size={18} />
            <div><div className="alert-description">{errorMessage}</div></div>
          </div>
        )}

        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('barcodes.barcode')} *</label>
            <div className="flex items-center gap-2">
              <Input
                value={barcode}
                onChange={(e) => { setBarcode(e.target.value); setBarcodeType(detectBarcodeType(e.target.value)); }}
                placeholder="200xxxxxxxxxx"
                className="w-full font-mono"
                autoFocus
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                startIcon={<Wand2 size={14} />}
                onClick={handleGenerate}
              >
                {t('barcodes.generate')}
              </Button>
            </div>
          </div>

          <div className="flex flex-col">
            <label className="form-label">{t('barcodes.type')}</label>
            <div style={{ width: '14rem' }}>
              <Select
                options={[
                  { value: 'UPCA', label: 'UPC-A (12)' },
                  { value: 'EAN13', label: 'EAN-13 (13)' },
                  { value: 'EAN8', label: 'EAN-8 (8)' },
                ]}
                value={barcodeType}
                onChange={(v) => setBarcodeType(v as string)}
                searchable={false}
              />
            </div>
          </div>

          <div className="flex flex-col">
            <label className="form-label">{t('barcodes.pickModel')}</label>
            <Input
              value={selectedModelId ? selectedModelName : modelQuery}
              onChange={(e) => {
                setModelQuery(e.target.value);
                setSelectedModelId(null);
                setSelectedModelName('');
                setSelectedVariantId(null);
              }}
              placeholder={t('barcodes.search')}
              className="w-full"
              startIcon={<Search size={16} />}
            />
            {debouncedModelQuery && !selectedModelId && (
              <div className="mt-1 max-h-48 overflow-auto better-scroll border border-line rounded">
                {modelsFetching ? (
                  <div className="p-3 text-sm text-subtle">{t('common.loading')}</div>
                ) : (modelSearch?.rows ?? []).length === 0 ? (
                  <div className="p-3 text-sm text-subtle">{t('common.noData')}</div>
                ) : (
                  (modelSearch?.rows ?? []).map((m) => (
                    <button
                      type="button"
                      key={m.model_id}
                      className="w-full text-left px-3 py-2 hover:bg-surface-hover cursor-pointer bg-transparent border-0 border-b border-line"
                      onClick={() => {
                        setSelectedModelId(m.model_id);
                        setSelectedModelName(m.model_name);
                        setModelQuery('');
                      }}
                    >
                      <div className="text-sm font-medium">{m.model_name}</div>
                      <div className="text-xs text-subtle">
                        {[m.brand_name, m.family_name].filter(Boolean).join(' · ')}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {selectedModelId && variants.length > 0 && (
            <div className="flex flex-col">
              <label className="form-label">{t('barcodes.variant')} *</label>
              <Select
                options={variants.map(v => ({ value: String(v.variant_id), label: `${v.sku_code} — ${v.name}` }))}
                value={selectedVariantId !== null ? String(selectedVariantId) : null}
                onChange={(v) => setSelectedVariantId(v ? Number(v as string) : null)}
                placeholder={t('barcodes.variant')}
                searchable
                showChevron
              />
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
            />
            <span className="text-sm">{t('barcodes.primaryHint')}</span>
          </label>
        </div>
      </div>
      <div className="modal-footer">
        <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          type="button"
          color="primary"
          onClick={onSubmit}
          disabled={isPending || !barcode.trim() || !selectedVariantId}
        >
          {isPending ? t('common.loading') : t('barcodes.register')}
        </Button>
      </div>
    </Modal>
  );
}
