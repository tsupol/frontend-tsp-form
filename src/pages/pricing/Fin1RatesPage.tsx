import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, Button, Input, Select, Modal,
  useSnackbarContext, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { Plus, XCircle, CheckCircle } from 'lucide-react';
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

  const { register, handleSubmit, control, formState: { errors }, reset } = useForm<Fin1FormData>({
    defaultValues: defaults,
  });

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

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

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="24rem"
      width="100%"
    >
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{t('fin1.addRateCard')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
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
          <Button variant="outline" size="sm" onClick={onClose} type="button">
            {t('common.cancel')}
          </Button>
          <Button color="primary" size="sm" type="submit" disabled={isSaving}>
            {isSaving ? t('pricing.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
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
      // Fetch all active rate cards by creating a synthetic list from workbench
      // We need to map workbench data to rate-card-like rows
      const rows = await apiClient.get<WorkbenchFin1Row[]>(
        `/v_pricing_user_workbench_branch?finance_model=eq.FIN1&select=category_id,category_code,category_name,term_months,down_percent,interest_percent_total,rounding_unit,max_discount_percent,missing_fin1_rate_card&order=category_code,term_months,down_percent`
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
    <div className="page-content">
      <div className="flex items-center justify-between pb-4">
        <h1 className="heading-2">{t('fin1.title')}</h1>
        <Button color="primary" size="sm" startIcon={<Plus size={14} />} onClick={handleCreate}>
          {t('fin1.addRateCard')}
        </Button>
      </div>

      <DataTable<RateCardRow>
        data={rateCards}
        columns={columns}
        sorting={sorting}
        onSortingChange={setSorting}
        className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}
        noResults={
          <div className="p-8 text-center text-control-label">
            {t('fin1.empty')}
          </div>
        }
      />

      <Fin1Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        categories={categories}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
