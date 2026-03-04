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

interface ModelLookup {
  id: number;
  code: string;
  name: string;
  family_id: number;
}

interface FamilyLookup {
  id: number;
  display_name: string;
}

// Workbench-derived FIN2 row
interface WorkbenchFin2Row {
  model_id: number;
  model_code: string;
  model_name: string;
  term_months: number | null;
  fin2_profit_amount: number | null;
  fin2_max_discount_percent: number | null;
  missing_fin2_profit_rate: boolean;
}

// ── Create/Edit Modal ────────────────────────────────────────────────────────

interface Fin2FormData {
  model_id: string;
  term_months: string;
  max_discount_percent: string;
}

function Fin2Modal({ open, onClose, models, families, onSuccess }: {
  open: boolean;
  onClose: () => void;
  models: ModelLookup[];
  families: FamilyLookup[];
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const familyMap = new Map(families.map(f => [f.id, f.display_name]));

  const { register, handleSubmit, control, formState: { errors }, reset } = useForm<Fin2FormData>({
    defaultValues: {
      model_id: '',
      term_months: '12',
      max_discount_percent: '5',
    },
  });

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open) {
      reset({ model_id: '', term_months: '12', max_discount_percent: '5' });
      setErrorMessage('');
    }
  }, [open, reset]);

  const modelOptions = models.map(m => ({
    value: String(m.id),
    label: `${familyMap.get(m.family_id) ?? ''} ${m.name}`.trim(),
  }));

  // Add a "Default (all models)" option
  const allModelOptions = [
    { value: '0', label: t('fin2.defaultAllModels') },
    ...modelOptions,
  ];

  const onSubmit = async (data: Fin2FormData) => {
    setIsSaving(true);
    setErrorMessage('');
    try {
      const modelId = parseInt(data.model_id);
      await apiClient.rpc('fin2_term_upsert', {
        p_model_id: modelId === 0 ? null : modelId,
        p_term_months: parseInt(data.term_months),
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
          <h2 className="modal-title">{t('fin2.addTerm')}</h2>
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
              <label className="form-label">{t('fin2.model')}</label>
              <Controller
                name="model_id"
                control={control}
                rules={{ required: t('fin2.modelRequired') }}
                render={({ field }) => (
                  <div>
                    <Select
                      options={allModelOptions}
                      value={field.value || null}
                      onChange={(val) => field.onChange((val as string) ?? '')}
                      placeholder={t('fin2.selectModel')}
                      size="sm"
                      showChevron
                      searchable
                    />
                  </div>
                )}
              />
              <FormErrorMessage error={errors.model_id} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="form-label">{t('fin2.termMonths')}</label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  size="sm"
                  {...register('term_months', { required: t('fin2.termRequired') })}
                />
                <FormErrorMessage error={errors.term_months} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('fin2.maxDiscount')}</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  size="sm"
                  {...register('max_discount_percent', { required: t('fin2.maxDiscountRequired') })}
                />
                <FormErrorMessage error={errors.max_discount_percent} />
              </div>
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

export function Fin2RatesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const holdingId = user?.holding_id ?? null;

  const [sorting, setSorting] = useState<SortingState>([]);
  const [modalOpen, setModalOpen] = useState(false);

  // Model lookup
  const { data: models = [] } = useQuery({
    queryKey: ['model-lookup', holdingId],
    queryFn: () => apiClient.get<ModelLookup[]>(
      `/v_ref_product_models?holding_id=eq.${holdingId}&is_active=is.true&order=code&select=id,code,name,family_id`
    ),
    staleTime: 5 * 60 * 1000,
  });

  // Family lookup
  const { data: families = [] } = useQuery({
    queryKey: ['family-lookup', holdingId],
    queryFn: () => apiClient.get<FamilyLookup[]>(
      `/v_ref_product_family_list?holding_id=eq.${holdingId}&is_active=is.true&order=display_name&select=id,display_name`
    ),
    staleTime: 5 * 60 * 1000,
  });

  const familyMap = new Map(families.map(f => [f.id, f.display_name]));

  // FIN2 data from workbench
  const { data: fin2Rows = [], isFetching } = useQuery({
    queryKey: ['fin2-workbench', holdingId],
    queryFn: async () => {
      const rows = await apiClient.get<WorkbenchFin2Row[]>(
        `/v_pricing_user_workbench_branch?finance_model=eq.FIN2&select=model_id,model_code,model_name,term_months,fin2_profit_amount,fin2_max_discount_percent,missing_fin2_profit_rate&order=model_code,term_months`
      );
      // Deduplicate by model_id + term_months
      const seen = new Set<string>();
      return rows.filter(r => {
        if (r.term_months === null) return false;
        const key = `${r.model_id}-${r.term_months}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    staleTime: 30 * 1000,
  });

  type Fin2Row = typeof fin2Rows[number];

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
    showSuccess('fin2.saveSuccess');
    queryClient.invalidateQueries({ queryKey: ['fin2-workbench'] });
    queryClient.invalidateQueries({ queryKey: ['pricebook-prices'] });
  };

  const formatTHB = (value: number | null): string => {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
  };

  const columns: ColumnDef<Fin2Row>[] = [
    {
      accessorKey: 'model_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin2.model')} />,
      cell: ({ row }) => {
        const model = models.find(m => m.id === row.original.model_id);
        const familyName = model ? familyMap.get(model.family_id) ?? '' : '';
        return (
          <div>
            <div className="text-sm font-medium">{familyName} {row.original.model_name}</div>
            <div className="text-[11px] text-control-label">{row.original.model_code}</div>
          </div>
        );
      },
    },
    {
      accessorKey: 'term_months',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin2.termMonths')} />,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{t('pricing.termMonths', { months: row.original.term_months })}</span>
      ),
    },
    {
      accessorKey: 'fin2_profit_amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin2.profitAmount')} />,
      cell: ({ row }) => (
        <span className={`text-sm tabular-nums ${row.original.fin2_profit_amount === null ? 'text-control-label' : ''}`}>
          {formatTHB(row.original.fin2_profit_amount)}
        </span>
      ),
    },
    {
      accessorKey: 'fin2_max_discount_percent',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin2.maxDiscount')} />,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.fin2_max_discount_percent !== null ? `${row.original.fin2_max_discount_percent}%` : '—'}
        </span>
      ),
    },
    {
      id: 'status',
      header: () => null,
      cell: ({ row }) => (
        row.original.missing_fin2_profit_rate ? (
          <span className="text-xs text-warning">{t('fin2.missingProfit')}</span>
        ) : null
      ),
    },
  ];

  return (
    <div className="page-content">
      <div className="flex items-center justify-between pb-4">
        <h1 className="heading-2">{t('fin2.title')}</h1>
        <Button color="primary" size="sm" startIcon={<Plus size={14} />} onClick={handleCreate}>
          {t('fin2.addTerm')}
        </Button>
      </div>

      <DataTable<Fin2Row>
        data={fin2Rows}
        columns={columns}
        sorting={sorting}
        onSortingChange={setSorting}
        className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}
        noResults={
          <div className="p-8 text-center text-control-label">
            {t('fin2.empty')}
          </div>
        }
      />

      <Fin2Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        models={models}
        families={families}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
