import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader,
  Button, Select, Modal, Badge, MaskedInput,
  useSnackbarContext, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Plus, XCircle, CheckCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface CategoryLookup {
  id: number;
  code: string;
  name: string;
}

interface Fin1RateCard {
  id: number;
  holding_id: number;
  category_id: number;
  category_code: string;
  category_name: string;
  model_id: number | null;
  model_code: string | null;
  model_name: string | null;
  model_scope_id: number | null;
  term_months: number;
  down_percent: number;
  interest_percent_total: number;
  rounding_unit: number;
  max_discount_percent: number;
  is_active: boolean;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

// ── Create/Edit Modal ────────────────────────────────────────────────────────

interface Fin1FormData {
  category_id: string;
  down_percent: string;
  term_months: string;
  interest_percent_total: string;
  rounding_unit: string;
  max_discount_percent: string;
}

function Fin1Modal({ open, onClose, categories, onSuccess }: {
  open: boolean;
  onClose: () => void;
  categories: CategoryLookup[];
  onSuccess: () => void;
}) {
  const { t } = useTranslation();

  const defaults: Fin1FormData = {
    category_id: '',
    down_percent: '0',
    term_months: '12',
    interest_percent_total: '',
    rounding_unit: '10',
    max_discount_percent: '5',
  };

  const { handleSubmit, control, formState: { errors, isDirty }, reset } = useForm<Fin1FormData>({
    defaultValues: defaults,
  });

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  useEffect(() => {
    if (open) {
      reset(defaults);
      setErrorMessage('');
    }
  }, [open, reset]);

  const categoryOptions = categories.map(c => ({ value: String(c.id), label: c.name }));
  const categoryCodes = new Map(categories.map(c => [String(c.id), c.code]));

  const onSubmit = async (data: Fin1FormData) => {
    setIsSaving(true);
    setErrorMessage('');
    try {
      await apiClient.rpc('fin1_rate_card_upsert', {
        p_category_id: parseInt(data.category_id),
        p_down_percent: parseFloat(data.down_percent),
        p_term_months: parseInt(data.term_months),
        p_interest_percent_total: parseFloat(data.interest_percent_total),
        p_rounding_unit: parseInt(data.rounding_unit),
        p_max_discount_percent: parseFloat(data.max_discount_percent),
      });
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (isDirty) { setConfirmCloseOpen(true); return; }
    forceClose();
  };

  const forceClose = () => {
    reset(defaults);
    setErrorMessage('');
    setConfirmCloseOpen(false);
    onClose();
  };

  return (
    <>
    <Modal
      open={open}
      onClose={handleClose}
      maxWidth="24rem"
      width="100%"
    >
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{t('fin1.addRateCard')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          <div className="form-grid">
            {errorMessage && (
              <div className="alert alert-danger">
                <XCircle size={16} />
                <div><div className="alert-description text-xs">{errorMessage}</div></div>
              </div>
            )}

            <div className="flex flex-col">
              <label className="form-label">{t('fin1.category')}</label>
              <Controller
                name="category_id"
                control={control}
                rules={{ required: t('fin1.categoryRequired') }}
                render={({ field }) => (
                  <div>
                    <Select
                      options={categoryOptions}
                      value={field.value || null}
                      onChange={(val) => field.onChange((val as string) ?? '')}
                      placeholder={t('fin1.selectCategory')}
                      size="sm"
                      showChevron
                      renderOption={(opt) => (
                        <div>
                          <div className="text-sm">{opt.label}</div>
                          <div className="text-[11px] text-subtle">{categoryCodes.get(opt.value)}</div>
                        </div>
                      )}
                    />
                  </div>
                )}
              />
              <FormErrorMessage error={errors.category_id} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="form-label">{t('fin1.termMonths')}</label>
                <Controller
                  name="term_months"
                  control={control}
                  rules={{ required: t('fin1.termRequired') }}
                  render={({ field }) => (
                    <MaskedInput
                      mask="number"
                      decimalScale={0}
                      value={field.value}
                      onChange={(raw) => field.onChange(raw)}
                      size="sm"
                      placeholder="12"
                    />
                  )}
                />
                <FormErrorMessage error={errors.term_months} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('fin1.downPercent')}</label>
                <Controller
                  name="down_percent"
                  control={control}
                  rules={{ required: t('fin1.downPercentRequired') }}
                  render={({ field }) => (
                    <MaskedInput
                      mask="number"
                      decimalScale={1}
                      value={field.value}
                      onChange={(raw) => field.onChange(raw)}
                      size="sm"
                      suffix="%"
                    />
                  )}
                />
                <FormErrorMessage error={errors.down_percent} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="form-label">{t('fin1.interestPercent')}</label>
                <Controller
                  name="interest_percent_total"
                  control={control}
                  rules={{ required: t('fin1.interestRequired') }}
                  render={({ field }) => (
                    <MaskedInput
                      mask="number"
                      decimalScale={2}
                      value={field.value}
                      onChange={(raw) => field.onChange(raw)}
                      size="sm"
                      suffix="%"
                    />
                  )}
                />
                <FormErrorMessage error={errors.interest_percent_total} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('fin1.roundingUnit')}</label>
                <Controller
                  name="rounding_unit"
                  control={control}
                  rules={{ required: t('fin1.roundingRequired') }}
                  render={({ field }) => (
                    <MaskedInput
                      mask="number"
                      decimalScale={0}
                      value={field.value}
                      onChange={(raw) => field.onChange(raw)}
                      size="sm"
                      placeholder="10"
                    />
                  )}
                />
                <FormErrorMessage error={errors.rounding_unit} />
              </div>
            </div>

            <div className="flex flex-col">
              <label className="form-label">{t('fin1.maxDiscount')}</label>
              <Controller
                name="max_discount_percent"
                control={control}
                rules={{ required: t('fin1.maxDiscountRequired') }}
                render={({ field }) => (
                  <MaskedInput
                    mask="number"
                    decimalScale={1}
                    value={field.value}
                    onChange={(raw) => field.onChange(raw)}
                    size="sm"
                    suffix="%"
                    placeholder="5"
                  />
                )}
              />
              <FormErrorMessage error={errors.max_discount_percent} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="outline" onClick={handleClose} type="button">
            {t('common.cancel')}
          </Button>
          <Button color="primary" type="submit" disabled={isSaving}>
            {isSaving ? t('pricing.saving') : t('common.save')}
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

// ── Main Page ────────────────────────────────────────────────────────────────

export function Fin1RatesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [sorting, setSorting] = useState<SortingState>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Category lookup
  const { data: categories = [] } = useQuery({
    queryKey: ['category-lookup'],
    queryFn: () => apiClient.get<CategoryLookup[]>('/v_product_categories?is_active=is.true&order=sort_order'),
    staleTime: 5 * 60 * 1000,
  });

  // FIN1 rate cards from dedicated view
  const { data: rateCards = [], isFetching } = useQuery({
    queryKey: ['fin1-rate-cards'],
    queryFn: () => apiClient.get<Fin1RateCard[]>(
      '/v_fin1_rate_cards?order=category_code,term_months,down_percent'
    ),
    staleTime: 30 * 1000,
  });

  type RateCardRow = Fin1RateCard;

  // Client-side pagination
  const totalCount = rateCards.length;
  const paginatedCards = rateCards.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const showSuccess = (msgKey: string) => {
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <div><div className="alert-title">{t(msgKey)}</div></div>
        </div>
      ),
      type: 'success',
      duration: 3000,
    });
  };

  const handleCreate = () => {
    setModalOpen(true);
  };

  const handleSuccess = () => {
    showSuccess('fin1.saveSuccess');
    queryClient.invalidateQueries({ queryKey: ['fin1-rate-cards'] });
    queryClient.invalidateQueries({ queryKey: ['pricebook-prices'] });
  };

  const columns: ColumnDef<RateCardRow>[] = [
    {
      accessorKey: 'category_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin1.category')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-sm font-medium">{row.original.category_name}</div>
          <div className="text-[11px] text-subtle">{row.original.category_code}</div>
        </div>
      ),
    },
    {
      accessorKey: 'model_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin1.model')} />,
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.model_name ?? <span className="text-subtle">{t('fin1.categoryDefault')}</span>}
        </span>
      ),
    },
    {
      accessorKey: 'term_months',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin1.termMonths')} />,
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <Badge size="xs" color={row.original.is_active ? 'success' : 'default'}>
            {row.original.is_active ? t('fin1.statusActive') : t('fin1.statusInactive')}
          </Badge>
          <span className="text-sm tabular-nums">{t('pricing.termMonths', { months: row.original.term_months })}</span>
        </div>
      ),
    },
    {
      id: 'rate_details',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin1.rateDetails')} />,
      cell: ({ row }) => (
        <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          <span className="text-[11px] text-subtle">{t('fin1.down')}</span>
          <span className="tabular-nums">{row.original.down_percent}%</span>
          <span className="text-[11px] text-subtle">{t('fin1.interest')}</span>
          <span className="tabular-nums">{row.original.interest_percent_total}%</span>
          <span className="text-[11px] text-subtle">{t('fin1.rounding')}</span>
          <span className="tabular-nums">{row.original.rounding_unit}</span>
          <span className="text-[11px] text-subtle">{t('fin1.maxDisc')}</span>
          <span className="tabular-nums">{row.original.max_discount_percent}%</span>
        </div>
      ),
    },
  ];

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
          {t('fin1.title')}
        </div>
        <div className="mobile-header-end px-2">
          <button
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-surface-hover cursor-pointer text-current"
            aria-label={t('fin1.addRateCard')}
            onClick={handleCreate}
          >
            <Plus size={18} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('fin1.title')}</h1>
          <Button color="primary" startIcon={<Plus size={16} />} onClick={handleCreate}>
            {t('fin1.addRateCard')}
          </Button>
        </div>

        {/* Desktop: DataTable with columns */}
        <DataTable<RateCardRow>
          data={paginatedCards}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
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
            <div className="p-8 text-center text-subtle">
              {t('fin1.empty')}
            </div>
          }
        />

        {/* Mobile: Card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {rateCards.length === 0 ? (
              <div className="p-8 text-center text-subtle">
                {t('fin1.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {paginatedCards.map((card) => (
                  <div key={card.id} className="px-1 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{card.category_name}</div>
                        <div className="text-xs text-subtle">
                          {card.category_code}
                          {card.model_name && <span> &middot; {card.model_name}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge size="sm" color="info">
                          {t('pricing.termMonths', { months: card.term_months })}
                        </Badge>
                        <Badge size="sm" color={card.is_active ? 'success' : 'default'}>
                          {card.is_active ? t('fin1.statusActive') : t('fin1.statusInactive')}
                        </Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-subtle">{t('fin1.downPercent')}</span>
                        <span className="tabular-nums">{card.down_percent}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-subtle">{t('fin1.interestPercent')}</span>
                        <span className="tabular-nums">{card.interest_percent_total}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-subtle">{t('fin1.roundingUnit')}</span>
                        <span className="tabular-nums">{card.rounding_unit}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-subtle">{t('fin1.maxDiscount')}</span>
                        <span className="tabular-nums">{card.max_discount_percent}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {totalCount > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(totalCount / pageSize)}
              onPageChange={(p) => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
      </div>

      <Fin1Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        categories={categories}
        onSuccess={handleSuccess}
      />
    </>
  );
}
