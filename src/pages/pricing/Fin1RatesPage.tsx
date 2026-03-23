import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader,
  Button, Input, Select, Modal, Badge,
  useSnackbarContext, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Plus, XCircle, CheckCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface CategoryLookup {
  id: number;
  code: string;
  name: string;
}

// Workbench row (used to extract unique FIN1 rate card info)
interface WorkbenchFin1Row {
  category_id: number;
  category_code: string;
  category_name: string;
  term_months: number | null;
  down_percent: number | null;
  interest_percent_total: number | null;
  rounding_unit: number | null;
  max_discount_percent: number | null;
  missing_fin1_rate_card: boolean;
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

  const { register, handleSubmit, control, formState: { errors, isDirty }, reset } = useForm<Fin1FormData>({
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
                          <div className="text-[11px] text-control-label">{categoryCodes.get(opt.value)}</div>
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
                <Input
                  type="number"
                  min={1}
                  step={1}
                  size="sm"
                  {...register('term_months', { required: t('fin1.termRequired') })}
                />
                <FormErrorMessage error={errors.term_months} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('fin1.downPercent')}</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  size="sm"
                  {...register('down_percent', { required: t('fin1.downPercentRequired') })}
                />
                <FormErrorMessage error={errors.down_percent} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="form-label">{t('fin1.interestPercent')}</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  size="sm"
                  {...register('interest_percent_total', { required: t('fin1.interestRequired') })}
                />
                <FormErrorMessage error={errors.interest_percent_total} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('fin1.roundingUnit')}</label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  size="sm"
                  {...register('rounding_unit', { required: t('fin1.roundingRequired') })}
                />
                <FormErrorMessage error={errors.rounding_unit} />
              </div>
            </div>

            <div className="flex flex-col">
              <label className="form-label">{t('fin1.maxDiscount')}</label>
              <Input
                type="number"
                min={0}
                max={100}
                step="0.1"
                size="sm"
                {...register('max_discount_percent', { required: t('fin1.maxDiscountRequired') })}
              />
              <FormErrorMessage error={errors.max_discount_percent} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="outline" size="sm" onClick={handleClose} type="button">
            {t('common.cancel')}
          </Button>
          <Button color="primary" size="sm" type="submit" disabled={isSaving}>
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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const holdingId = user?.holding_id ?? null;

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

  // FIN1 rate cards from workbench (deduplicated)
  const { data: rateCards = [], isFetching } = useQuery({
    queryKey: ['fin1-rate-cards', holdingId],
    queryFn: async () => {
      const rows = await apiClient.get<WorkbenchFin1Row[]>(
        `/v_pricing_user_workbench?finance_model=eq.FIN1&select=category_id,category_code,category_name,term_months,down_percent,interest_percent_total,rounding_unit,max_discount_percent,missing_fin1_rate_card&order=category_code,term_months,down_percent`
      );
      const seen = new Set<string>();
      const cards: Array<{
        category_id: number;
        category_code: string;
        category_name: string;
        term_months: number;
        down_percent: number;
        interest_percent_total: number;
        rounding_unit: number;
        max_discount_percent: number;
      }> = [];
      for (const r of rows) {
        if (r.term_months === null || r.down_percent === null) continue;
        const key = `${r.category_id}-${r.term_months}-${r.down_percent}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cards.push({
          category_id: r.category_id,
          category_code: r.category_code,
          category_name: r.category_name,
          term_months: r.term_months,
          down_percent: r.down_percent,
          interest_percent_total: r.interest_percent_total ?? 0,
          rounding_unit: r.rounding_unit ?? 10,
          max_discount_percent: r.max_discount_percent ?? 5,
        });
      }
      return cards;
    },
    staleTime: 30 * 1000,
  });

  type RateCardRow = typeof rateCards[number];

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
          <div className="text-[11px] text-control-label">{row.original.category_code}</div>
        </div>
      ),
    },
    {
      accessorKey: 'term_months',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin1.termMonths')} />,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{t('pricing.termMonths', { months: row.original.term_months })}</span>
      ),
    },
    {
      accessorKey: 'down_percent',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin1.downPercent')} />,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.down_percent}%</span>
      ),
    },
    {
      accessorKey: 'interest_percent_total',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin1.interestPercent')} />,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.interest_percent_total}%</span>
      ),
    },
    {
      accessorKey: 'rounding_unit',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin1.roundingUnit')} />,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.rounding_unit}</span>
      ),
    },
    {
      accessorKey: 'max_discount_percent',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin1.maxDiscount')} />,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.max_discount_percent}%</span>
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

      <div className="page-content responsive-dvh-mobile-header max-w-[64rem]">
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
            <div className="p-8 text-center text-control-label">
              {t('fin1.empty')}
            </div>
          }
        />

        {/* Mobile: Card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {rateCards.length === 0 ? (
              <div className="p-8 text-center text-control-label">
                {t('fin1.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {paginatedCards.map((card) => (
                  <div key={`${card.category_id}-${card.term_months}-${card.down_percent}`} className="px-1 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{card.category_name}</div>
                        <div className="text-xs text-control-label">{card.category_code}</div>
                      </div>
                      <Badge size="sm" color="info">
                        {t('pricing.termMonths', { months: card.term_months })}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-control-label">{t('fin1.downPercent')}</span>
                        <span className="tabular-nums">{card.down_percent}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-control-label">{t('fin1.interestPercent')}</span>
                        <span className="tabular-nums">{card.interest_percent_total}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-control-label">{t('fin1.roundingUnit')}</span>
                        <span className="tabular-nums">{card.rounding_unit}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-control-label">{t('fin1.maxDiscount')}</span>
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
