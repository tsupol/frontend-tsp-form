import { useState, useEffect, useMemo, useRef, useCallback, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, Button, Input, Badge, Modal, MobileHeader,
  PopOver, MenuItem, LabeledCheckbox, useSnackbarContext,
} from 'tsp-form';
import {
  Barcode, Plus, Search, ArrowRightFromLine, CheckCircle, XCircle,
  MoreHorizontal, ShieldOff, ShieldCheck, AlertCircle, Eye, ExternalLink, Printer, X,
} from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { apiClient, ApiError } from '../../lib/api';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { DateTime } from '../../components/DateTime';

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
  created_at: string | null;
  updated_at: string | null;
}

interface ProductSearchVariant {
  variant_id: number;
  sku_code: string;
  name: string;
  is_active: boolean;
}

interface ProductSearchRow {
  model_id: number;
  model_code: string;
  model_name: string;
  brand_name: string | null;
  family_name: string | null;
  is_active: boolean;
  variants: ProductSearchVariant[];
}

interface ProductSearchResponse {
  total: number;
  rows: ProductSearchRow[];
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

  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);
  const [viewRow, setViewRow] = useState<BarcodeRow | null>(null);
  const [printRow, setPrintRow] = useState<BarcodeRow | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);

  const handlePrint = useCallback((row: BarcodeRow) => {
    setPrintRow(row);
    // Two rAFs — React commits, browser paints, then we open the print dialog
    // with the sticker fully rendered. Same 76×26mm page as the asset sticker
    // so both labels share printer-side defaults.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const styleEl = document.createElement('style');
      styleEl.id = 'sticker-print-page';
      styleEl.textContent = '@media print { @page { size: 76mm 26mm; margin: 0; } }';
      document.head.appendChild(styleEl);
      try {
        window.print();
      } finally {
        styleEl.remove();
        setPrintRow(null);
      }
    }));
  }, []);

  const commitSearch = useCallback(() => {
    const next = searchInput.trim();
    setActiveSearch(next);
    setPageIndex(0);
  }, [searchInput]);

  const clearSearch = () => {
    setSearchInput('');
    setActiveSearch('');
    setPageIndex(0);
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitSearch();
    }
  };

  const { data, isFetching } = useQuery({
    queryKey: ['barcodes-list', pageIndex, pageSize, activeSearch],
    queryFn: () => {
      const params: string[] = ['order=created_at.desc'];
      if (activeSearch) {
        const term = encodeURIComponent(activeSearch);
        // family_name / brand_name carry the human label ("iPhone 11", "Apple")
        // — model_name is just the suffix ("Base 64GB"), so a search like
        // "iphone 11" must hit family_name to return anything useful.
        params.push(
          `or=(barcode.ilike.*${term}*,sku_code.ilike.*${term}*,variant_name.ilike.*${term}*,model_name.ilike.*${term}*,family_name.ilike.*${term}*,brand_name.ilike.*${term}*)`,
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

        {/* Search bar */}
        <div className="flex-none pb-3 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-0 max-w-md">
            <div className="input-group">
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder={t('barcodes.search')}
                size="sm"
                startIcon={<Search size={16} />}
                endIcon={searchInput ? <X size={14} /> : undefined}
                onEndIconClick={searchInput ? clearSearch : undefined}
                className="w-full"
                autoFocus={!isMobile}
              />
              <div className="input-group-divider" />
              <Button
                size="sm"
                className="px-3"
                onClick={commitSearch}
              >
                {t('common.search', { defaultValue: 'Search' })}
              </Button>
            </div>
          </div>
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
                    {r.source && (
                      <Badge size="xs" variant="outline" color="default">{sourceLabel(t, r.source)}</Badge>
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
                {r.model_id && (
                  <Link
                    to={`/admin/products/models/${r.model_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer text-current opacity-50 hover:opacity-100 shrink-0"
                    aria-label={t('barcodes.openModel', { defaultValue: 'Open model' })}
                  >
                    <ExternalLink size={16} />
                  </Link>
                )}
                <RowActions
                  row={r}
                  onView={setViewRow}
                  onPrint={handlePrint}
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
          noResults={
            activeSearch ? (
              <div className="p-8 text-center">
                <div className="text-subtler mb-3">
                  {t('barcodes.noMatch', { q: activeSearch, defaultValue: `No barcodes match "${activeSearch}"` })}
                </div>
                <Button
                  color="primary"
                  startIcon={<Plus size={16} />}
                  onClick={() => { setPendingBarcode(activeSearch); setRegisterOpen(true); }}
                >
                  {t('barcodes.registerThis', { defaultValue: 'Register this barcode' })}
                </Button>
              </div>
            ) : (
              <div className="p-8 text-center text-subtler">{t('barcodes.noBarcodes')}</div>
            )
          }
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

      <ViewBarcodeModal
        open={!!viewRow}
        row={viewRow}
        onClose={() => setViewRow(null)}
      />

      {/* Print sticker — portaled to body so no panel/modal ancestor pushes
          the sticker down the page during print. Hidden on screen via the
          .print-only-sticker rule in app.css. */}
      {printRow && createPortal(
        <div className="print-only-sticker" aria-hidden>
          <BarcodeSticker row={printRow} />
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Row Actions ──────────────────────────────────────────────────────────────

function RowActions({ row, onView, onPrint, onSetPrimary, onToggleActive }: {
  row: BarcodeRow;
  onView: (r: BarcodeRow) => void;
  onPrint: (r: BarcodeRow) => void;
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
        <MenuItem
          icon={<Eye size={14} />}
          label={t('barcodes.viewDetail', { defaultValue: 'View detail' })}
          onClick={() => { setOpen(false); onView(row); }}
        />
        <MenuItem
          icon={<Printer size={14} />}
          label={t('barcodes.printSticker', { defaultValue: 'Print sticker' })}
          onClick={() => { setOpen(false); onPrint(row); }}
        />
        {!row.is_primary && row.is_active && (
          <MenuItem
            label={t('barcodes.setPrimary')}
            onClick={() => { setOpen(false); onSetPrimary(row); }}
          />
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
      p_q: debouncedModelQuery,
      p_is_active: true,
      p_limit: 20,
    }),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const models = modelSearch?.rows ?? [];
  const selectedModel = useMemo(
    () => models.find(m => m.model_id === selectedModelId) ?? null,
    [models, selectedModelId],
  );
  const activeVariants = useMemo(
    () => selectedModel?.variants.filter(v => v.is_active) ?? [],
    [selectedModel],
  );

  useEffect(() => {
    if (activeVariants.length === 0) {
      setSelectedVariantId(null);
      return;
    }
    if (!activeVariants.some(v => v.variant_id === selectedVariantId)) {
      setSelectedVariantId(activeVariants[0].variant_id);
    }
  }, [activeVariants, selectedVariantId]);

  const selectedVariant = activeVariants.find(v => v.variant_id === selectedVariantId) ?? null;

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
    <Modal open={open} onClose={onClose} maxWidth="36rem" width="100%">
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
            <Input
              value={barcode}
              onChange={(e) => { setBarcode(e.target.value); setBarcodeType(detectBarcodeType(e.target.value)); }}
              placeholder={t('barcodes.barcodePlaceholder')}
              size="md"
              className="w-full font-mono"
              autoFocus
            />
          </div>

          <div className="flex flex-col">
            <label className="form-label">{t('barcodes.pickModel')} *</label>
            <Input
              value={modelQuery}
              onChange={(e) => setModelQuery(e.target.value)}
              placeholder={t('barcodes.search')}
              className="w-full"
              startIcon={<Search size={16} />}
            />
            <div className="mt-3 h-60 overflow-auto better-scroll border border-line rounded-md">
              {modelsFetching && models.length === 0 && (
                <div className="p-3 text-xs text-subtle text-center">{t('common.loading')}</div>
              )}
              {!modelsFetching && models.length === 0 && (
                <div className="p-3 text-xs text-subtler text-center">{t('common.noData')}</div>
              )}
              {models.map((model) => {
                const activeCount = model.variants.filter(v => v.is_active).length;
                if (activeCount === 0) return null;
                const isSelected = model.model_id === selectedModelId;
                return (
                  <div
                    key={model.model_id}
                    className={`border-b border-line last:border-b-0 ${isSelected ? 'bg-item-active-bg' : ''}`}
                  >
                    {isSelected ? (
                      <div className="px-3 py-2 flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate text-item-active-fg">
                            {[model.brand_name, model.family_name, model.model_name].filter(Boolean).join(' ')}
                          </div>
                          <div className="text-[11px] text-subtler font-mono truncate">{model.model_code}</div>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 p-1 rounded hover:bg-surface-hover cursor-pointer bg-transparent border-none text-current"
                          onClick={() => { setSelectedModelId(null); setSelectedVariantId(null); }}
                          aria-label={t('common.clear', { defaultValue: 'Clear' })}
                        >
                          <XCircle size={16} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-surface-hover cursor-pointer flex items-center gap-2 bg-transparent border-0"
                        onClick={() => setSelectedModelId(model.model_id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {[model.brand_name, model.family_name, model.model_name].filter(Boolean).join(' ')}
                          </div>
                          <div className="text-[11px] text-subtler font-mono truncate">{model.model_code}</div>
                        </div>
                        <span className="text-[11px] text-subtler shrink-0">
                          {activeCount} {t('barcodes.variantsCount', { defaultValue: 'variants' })}
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {selectedModel && (
              <div className="mt-3 pt-3 border-t border-line">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle mb-2">
                  {t('barcodes.pickVariant', { defaultValue: 'Select variant' })}
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeVariants.map((variant) => {
                    const isActive = variant.variant_id === selectedVariantId;
                    return (
                      <Button
                        key={variant.variant_id}
                        size="sm"
                        variant={isActive ? undefined : 'outline'}
                        color={isActive ? 'primary' : undefined}
                        onClick={() => setSelectedVariantId(variant.variant_id)}
                      >
                        {variant.name}
                      </Button>
                    );
                  })}
                </div>
                {selectedVariant && (
                  <div className="text-[11px] text-subtler font-mono mt-2 truncate">{selectedVariant.sku_code}</div>
                )}
              </div>
            )}
          </div>

          <LabeledCheckbox
            label={t('barcodes.primaryHint')}
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
          />
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

// ── View Barcode Modal ───────────────────────────────────────────────────────

function jsbarcodeFormat(barcodeType: string | null, raw: string): string {
  const t = (barcodeType ?? detectBarcodeType(raw)).toUpperCase();
  if (t === 'UPCA' || t === 'UPC-A' || t === 'UPC') return 'UPC';
  if (t === 'EAN8' || t === 'EAN-8') return 'EAN8';
  return 'EAN13';
}

function BarcodeSvg({ value, type }: { value: string; type: string | null }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: jsbarcodeFormat(type, value),
        width: 2,
        height: 80,
        displayValue: true,
        fontSize: 16,
        margin: 8,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch {
      // Invalid for selected format — show plain digits as fallback.
      if (ref.current) ref.current.innerHTML = '';
    }
  }, [value, type]);
  return <svg ref={ref} className="max-w-full" />;
}

// ── Print sticker (XP-420B 76×26mm — shared with asset sticker) ──────────────

function BarcodeSticker({ row }: { row: BarcodeRow }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, row.barcode, {
        format: jsbarcodeFormat(row.barcode_type, row.barcode),
        // Wider narrow-bar — see AssetSticker for the 203-DPI rationale.
        width: 2.2,
        height: 60,
        displayValue: true,
        fontSize: 11,
        textMargin: 1,
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000',
      });
      svgRef.current.setAttribute('shape-rendering', 'crispEdges');
      // Stretch X and Y independently — bar-width ratios stay correct.
      svgRef.current.setAttribute('preserveAspectRatio', 'none');
    } catch {
      if (svgRef.current) svgRef.current.innerHTML = '';
    }
  }, [row]);

  const headline = [row.brand_name, row.family_name].filter(Boolean).join(' ');

  return (
    <div className="barcode-sticker">
      <div className="barcode-sticker-left">
        {headline && <div className="barcode-sticker-title">{headline}</div>}
        {row.variant_name && (
          <div className="barcode-sticker-line barcode-sticker-line-sub">
            <span>{row.variant_name}</span>
          </div>
        )}
      </div>
      <svg ref={svgRef} className="barcode-sticker-barcode" />
    </div>
  );
}

function ViewBarcodeModal({ open, onClose, row }: {
  open: boolean;
  onClose: () => void;
  row: BarcodeRow | null;
}) {
  const { t } = useTranslation();

  // Fetch fresh row (timestamps / source flags) when opening.
  const { data: fresh } = useQuery({
    queryKey: ['barcode-detail', row?.barcode_id],
    queryFn: async () => {
      const rows = await apiClient.get<BarcodeRow[]>(
        `/v_barcode_list?barcode_id=eq.${row!.barcode_id}&limit=1`,
      );
      return Array.isArray(rows) ? rows[0] ?? null : null;
    },
    enabled: open && !!row?.barcode_id,
  });

  const r = fresh ?? row;

  return (
    <Modal open={open} onClose={onClose} maxWidth="30rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('barcodes.viewTitle', { defaultValue: 'Barcode detail' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="modal-content">
        {r && (
          <>
            <div className="flex justify-center p-4 bg-white rounded-md border border-line">
              <BarcodeSvg value={r.barcode} type={r.barcode_type} />
            </div>

            <div className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              <div className="text-subtle">{t('barcodes.type')}</div>
              <div className="flex items-center gap-2">
                {r.barcode_type && <Badge size="xs" color="default">{r.barcode_type}</Badge>}
                {r.is_primary && <Badge size="xs" color="primary">{t('barcodes.primary')}</Badge>}
                {!r.is_active && <Badge size="xs" color="default">{t('barcodes.inactive')}</Badge>}
              </div>

              <div className="text-subtle">{t('barcodes.variant')}</div>
              <div>
                <div className="font-medium">{r.variant_name ?? '—'}</div>
                {r.sku_code && <div className="text-xs text-subtler font-mono">{r.sku_code}</div>}
              </div>

              <div className="text-subtle">{t('barcodes.pickModel')}</div>
              <div>
                <div>{r.model_name ?? '—'}</div>
                <div className="text-xs text-subtle">
                  {[r.brand_name, r.family_name].filter(Boolean).join(' · ')}
                </div>
              </div>

              <div className="text-subtle">{t('barcodes.source', { defaultValue: 'Source' })}</div>
              <div>{sourceLabel(t, r.source)}</div>

              <div className="text-subtle">{t('common.createdAt', { defaultValue: 'Created' })}</div>
              <div><DateTime value={r.created_at} showTime /></div>
            </div>
          </>
        )}
      </div>
      <div className="modal-footer">
        <Button type="button" variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
