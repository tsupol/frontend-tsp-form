import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader, Modal,
  Badge, Select, Button, Switch, PopOver, MaskedInput,
  InputDateRangePicker, useSnackbarContext,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Plus, Pencil, CheckCircle, XCircle, Keyboard, SlidersHorizontal } from 'lucide-react';
import { makeDateRangePickerFormat } from '../../lib/format';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { useAuth } from '../../contexts/AuthContext';
import { translateApiError } from '../../lib/apiErrors';

// ── Types ────────────────────────────────────────────────────────────────────

interface DiscountPolicy {
  id: number;
  holding_id: number;
  company_id: number | null;
  company_name: string | null;
  branch_id: number | null;
  branch_name: string | null;
  retail_max_discount_percent: number;
  fin1_max_discount_percent: number;
  fin2_max_discount_percent: number;
  effective_from: string | null;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface CompanyLookup {
  id: number;
  name: string;
}

interface BranchLookup {
  id: number;
  company_id: number;
  name: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const getScopeLabel = (p: DiscountPolicy): 'Holding' | 'Company' | 'Branch' => {
  if (p.branch_id) return 'Branch';
  if (p.company_id) return 'Company';
  return 'Holding';
};

const scopeBadgeColor = (scope: string): 'info' | 'warning' | 'success' => {
  switch (scope) {
    case 'Holding': return 'info';
    case 'Company': return 'warning';
    case 'Branch': return 'success';
    default: return 'info';
  }
};

// ── Policy Modal ─────────────────────────────────────────────────────────────

interface PolicyFormData {
  company_id: string;
  branch_id: string;
  retail_max_discount_percent: string;
  fin1_max_discount_percent: string;
  fin2_max_discount_percent: string;
  effective_from: Date | null;
  effective_to: Date | null;
  is_active: boolean;
}

function PolicyModal({ open, onClose, editPolicy, onSuccess }: {
  open: boolean;
  onClose: () => void;
  editPolicy: DiscountPolicy | null;
  onSuccess: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  const userCompanyId = user?.company_id ?? null;
  const userBranchId = user?.branch_id ?? null;
  const isHoldingLevel = !userCompanyId && !userBranchId;
  const isCompanyLevel = !!userCompanyId && !userBranchId;

  const { handleSubmit, control, watch, setValue, formState: { isDirty }, reset } = useForm<PolicyFormData>({
    defaultValues: {
      company_id: '',
      branch_id: '',
      retail_max_discount_percent: '0',
      fin1_max_discount_percent: '5',
      fin2_max_discount_percent: '5',
      effective_from: null,
      effective_to: null,
      is_active: true,
    },
  });

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [isTypingDateRange, setIsTypingDateRange] = useState(false);

  const selectedCompanyId = watch('company_id');

  // Lookups for ADD modal scope selectors
  const { data: companies = [] } = useQuery({
    queryKey: ['discount-companies'],
    queryFn: () => apiClient.get<CompanyLookup[]>('/v_companies?is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
    enabled: isHoldingLevel && !editPolicy,
  });

  const branchQueryCompanyId = isHoldingLevel ? selectedCompanyId : String(userCompanyId ?? '');
  const { data: branches = [] } = useQuery({
    queryKey: ['discount-branches', branchQueryCompanyId],
    queryFn: () => apiClient.get<BranchLookup[]>(
      `/v_branches?is_active=is.true&company_id=eq.${branchQueryCompanyId}&order=name`
    ),
    enabled: !!branchQueryCompanyId && !userBranchId && !editPolicy,
    staleTime: 5 * 60 * 1000,
  });

  const companyOptions = companies.map(c => ({ value: String(c.id), label: c.name }));
  const branchOptions = branches.map(b => ({ value: String(b.id), label: b.name }));

  // Clear branch when company changes in add mode
  useEffect(() => {
    if (!editPolicy && isHoldingLevel) {
      setValue('branch_id', '');
    }
  }, [selectedCompanyId, editPolicy, isHoldingLevel, setValue]);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      if (editPolicy) {
        reset({
          company_id: editPolicy.company_id ? String(editPolicy.company_id) : '',
          branch_id: editPolicy.branch_id ? String(editPolicy.branch_id) : '',
          retail_max_discount_percent: String(editPolicy.retail_max_discount_percent),
          fin1_max_discount_percent: String(editPolicy.fin1_max_discount_percent),
          fin2_max_discount_percent: String(editPolicy.fin2_max_discount_percent),
          effective_from: editPolicy.effective_from ? new Date(editPolicy.effective_from) : null,
          effective_to: editPolicy.effective_to ? new Date(editPolicy.effective_to) : null,
          is_active: editPolicy.is_active,
        });
      } else {
        reset({
          company_id: '',
          branch_id: '',
          retail_max_discount_percent: '0',
          fin1_max_discount_percent: '5',
          fin2_max_discount_percent: '5',
          effective_from: null,
          effective_to: null,
          is_active: true,
        });
      }
      setErrorMessage('');
    }
  }, [open, editPolicy, reset]);

  const onSubmit = async (data: PolicyFormData) => {
    setIsSaving(true);
    setErrorMessage('');
    const start = Date.now();
    try {
      const cid = data.company_id ? parseInt(data.company_id) : null;
      const bid = data.branch_id ? parseInt(data.branch_id) : null;

      await apiClient.rpc<DiscountPolicy>('discount_policy_upsert', {
        p_policy_id: editPolicy?.id || undefined,
        p_company_id: editPolicy ? undefined : cid,
        p_branch_id: editPolicy ? undefined : bid,
        p_retail_max_discount_percent: data.retail_max_discount_percent ? parseFloat(data.retail_max_discount_percent) : 0,
        p_fin1_max_discount_percent: data.fin1_max_discount_percent ? parseFloat(data.fin1_max_discount_percent) : 5,
        p_fin2_max_discount_percent: data.fin2_max_discount_percent ? parseFloat(data.fin2_max_discount_percent) : 5,
        p_effective_from: data.effective_from ? data.effective_from.toISOString() : undefined,
        p_effective_to: data.effective_to ? data.effective_to.toISOString() : undefined,
        p_is_active: data.is_active,
      });
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (isDirty) { setConfirmCloseOpen(true); return; }
    forceClose();
  };

  const forceClose = () => {
    reset();
    setErrorMessage('');
    setConfirmCloseOpen(false);
    onClose();
  };

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">
            {editPolicy ? t('discount.editPolicy') : t('discount.addPolicy')}
          </h2>
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

            {/* Scope selectors — only in add mode, only what user can choose */}
            {!editPolicy && (isHoldingLevel || isCompanyLevel) && (
              <>
                {isHoldingLevel && (
                  <div className="flex flex-col">
                    <label className="form-label">{t('discount.company')}</label>
                    <Controller
                      control={control}
                      name="company_id"
                      render={({ field }) => (
                        <div>
                          <Select
                            options={companyOptions}
                            value={field.value || null}
                            onChange={(val) => field.onChange((val as string) ?? '')}
                            placeholder={t('discount.allCompanies')}
                            showChevron
                            clearable
                          />
                        </div>
                      )}
                    />
                  </div>
                )}
                {(isHoldingLevel ? !!selectedCompanyId : true) && (
                  <div className="flex flex-col">
                    <label className="form-label">{t('discount.branch')}</label>
                    <Controller
                      control={control}
                      name="branch_id"
                      render={({ field }) => (
                        <div>
                          <Select
                            options={branchOptions}
                            value={field.value || null}
                            onChange={(val) => field.onChange((val as string) ?? '')}
                            placeholder={t('discount.allBranches')}
                            showChevron
                            clearable
                          />
                        </div>
                      )}
                    />
                  </div>
                )}
              </>
            )}

            {/* Scope indicator in edit mode */}
            {editPolicy && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-subtle">{t('discount.scope')}:</span>
                <Badge size="sm" color={scopeBadgeColor(getScopeLabel(editPolicy))}>
                  {t(`discount.scope${getScopeLabel(editPolicy)}`)}
                </Badge>
                {editPolicy.company_name && (
                  <span className="text-sm">{editPolicy.company_name}</span>
                )}
                {editPolicy.branch_name && (
                  <span className="text-sm text-subtle">/ {editPolicy.branch_name}</span>
                )}
              </div>
            )}

            <div className="flex flex-col">
              <label className="form-label">{t('discount.retailMaxDiscount')}</label>
              <Controller
                control={control}
                name="retail_max_discount_percent"
                render={({ field }) => (
                  <MaskedInput
                    mask="number"
                    decimalScale={1}
                    value={field.value}
                    onChange={(raw) => field.onChange(raw)}
                    suffix="%"
                  />
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="form-label">{t('discount.fin1MaxDiscount')}</label>
                <Controller
                  control={control}
                  name="fin1_max_discount_percent"
                  render={({ field }) => (
                    <MaskedInput
                      mask="number"
                      decimalScale={1}
                      value={field.value}
                      onChange={(raw) => field.onChange(raw)}
                      suffix="%"
                    />
                  )}
                />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('discount.fin2MaxDiscount')}</label>
                <Controller
                  control={control}
                  name="fin2_max_discount_percent"
                  render={({ field }) => (
                    <MaskedInput
                      mask="number"
                      decimalScale={1}
                      value={field.value}
                      onChange={(raw) => field.onChange(raw)}
                      suffix="%"
                    />
                  )}
                />
              </div>
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('discount.effectivePeriod')}</label>
              <Controller
                control={control}
                name="effective_from"
                render={({ field: { onChange: onFromChange, value: fromDate } }) => (
                  <Controller
                    control={control}
                    name="effective_to"
                    render={({ field: { onChange: onToChange, value: toDate } }) => (
                      <InputDateRangePicker
                        fromDate={fromDate}
                        toDate={toDate}
                        onFromDateChange={onFromChange}
                        onToDateChange={onToChange}
                        placeholder={t('discount.effectivePeriod')}
                        endIcon={<Keyboard size={16} />}
                        onEndIconClick={() => setIsTypingDateRange(v => !v)}
                        locale={i18n.language}
                        calendar="gregorian"
                        dateFormat={makeDateRangePickerFormat(i18n.language)}
                        typingMode={isTypingDateRange}
                        onTypingModeChange={setIsTypingDateRange}
                        typingMask="##/##/#### - ##/##/####"
                        typingPlaceholder="DD/MM/YYYY - DD/MM/YYYY"
                        parseTypedDates={(raw) => {
                          const parseDate = (digits: string) => {
                            if (digits.length !== 8) return null;
                            const day = parseInt(digits.slice(0, 2), 10);
                            const month = parseInt(digits.slice(2, 4), 10);
                            let year = parseInt(digits.slice(4, 8), 10);
                            if (year > 2400) year -= 543;
                            if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                            const d = new Date(year, month - 1, day);
                            if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                            return d;
                          };
                          return {
                            from: parseDate(raw.slice(0, 8)),
                            to: raw.length >= 16 ? parseDate(raw.slice(8, 16)) : null,
                          };
                        }}
                      />
                    )}
                  />
                )}
              />
            </div>
            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name="is_active"
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                  />
                )}
              />
              <label className="form-label mb-0">{t('discount.active')}</label>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="outline" onClick={handleClose} type="button">
            {t('common.cancel')}
          </Button>
          <Button color="primary" type="submit" disabled={isSaving}>
            {isSaving ? t('discount.saving') : t('discount.savePolicy')}
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

export function DiscountPoliciesPage() {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const queryClient = useQueryClient();

  const [sorting, setSorting] = useState<SortingState>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editPolicy, setEditPolicy] = useState<DiscountPolicy | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Filters
  const [filterScope, setFilterScope] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  const { data: filterCompanies = [] } = useQuery({
    queryKey: ['companies-lookup'],
    queryFn: () => apiClient.get<CompanyLookup[]>('/v_companies?select=id,name&is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
  });

  const companyFilterOptions = useMemo(
    () => filterCompanies.map(c => ({ value: String(c.id), label: c.name })),
    [filterCompanies],
  );

  const scopeOptions = [
    { value: 'Holding', label: t('discount.scopeHolding') },
    { value: 'Company', label: t('discount.scopeCompany') },
    { value: 'Branch', label: t('discount.scopeBranch') },
  ];

  const activeOptions = [
    { value: 'active', label: t('discount.activeOnly') },
    { value: 'inactive', label: t('discount.inactiveOnly') },
  ];

  // Fetch policies from the view
  const { data: policies = [], isFetching } = useQuery({
    queryKey: ['discount-policies'],
    queryFn: () => apiClient.get<DiscountPolicy[]>(
      '/v_discount_policies?order=company_id.nullsfirst,branch_id.nullsfirst'
    ),
    staleTime: 30 * 1000,
  });

  // Client-side filtering
  const filteredPolicies = useMemo(() => {
    let result = policies;
    if (filterScope) {
      result = result.filter(p => getScopeLabel(p) === filterScope);
    }
    if (filterCompany) {
      result = result.filter(p => p.company_id === Number(filterCompany));
    }
    if (filterActive === 'active') {
      result = result.filter(p => p.is_active);
    } else if (filterActive === 'inactive') {
      result = result.filter(p => !p.is_active);
    }
    return result;
  }, [policies, filterScope, filterCompany, filterActive]);

  // Reset page when filters change
  useEffect(() => {
    setPageIndex(0);
  }, [filterScope, filterCompany, filterActive]);

  const totalCount = filteredPolicies.length;
  const paginatedPolicies = filteredPolicies.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const handleCreate = () => {
    setEditPolicy(null);
    setModalOpen(true);
  };

  const handleEdit = (policy: DiscountPolicy) => {
    setEditPolicy(policy);
    setModalOpen(true);
  };

  const handleSuccess = () => {
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <div><div className="alert-title">{t('discount.policySaved')}</div></div>
        </div>
      ),
      type: 'success',
      duration: 3000,
    });
    queryClient.invalidateQueries({ queryKey: ['discount-policies'] });
  };

  const columns: ColumnDef<DiscountPolicy>[] = [
    {
      id: 'scope',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('discount.scope')} />,
      cell: ({ row }) => {
        const p = row.original;
        const scope = getScopeLabel(p);
        return (
          <div>
            <Badge size="sm" color={scopeBadgeColor(scope)}>{t(`discount.scope${scope}`)}</Badge>
            <div className="text-xs text-subtle mt-0.5 truncate">
              {p.branch_name ?? p.company_name ?? '—'}
            </div>
          </div>
        );
      },
    },
    {
      id: 'max_discount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('discount.maxDiscount')} />,
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="tabular-nums text-sm">
            <div><span className="text-[10px] text-subtle uppercase">Retail</span> {p.retail_max_discount_percent}%</div>
            <div><span className="text-[10px] text-subtle">FIN1</span> {p.fin1_max_discount_percent}% · <span className="text-[10px] text-subtle">FIN2</span> {p.fin2_max_discount_percent}%</div>
          </div>
        );
      },
    },
    {
      id: 'effective_period',
      accessorKey: 'effective_from',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('discount.effectivePeriod')} />,
      cell: ({ row }) => {
        const p = row.original;
        if (!p.effective_from && !p.effective_to) return <span className="text-sm text-subtle">—</span>;
        return (
          <div className="text-xs text-subtle">
            {p.effective_from && <DateTime value={p.effective_from} showTime={false} />}
            {p.effective_from && p.effective_to && <span> — </span>}
            {p.effective_to && <DateTime value={p.effective_to} showTime={false} />}
          </div>
        );
      },
      className: 'max-md:hidden',
    },
    {
      accessorKey: 'is_active',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('discount.active')} className="justify-center" />,
      cell: ({ row }) => (
        <div className="flex justify-center">
          {row.original.is_active
            ? <Badge size="sm" color="success" startIcon={<CheckCircle />} />
            : <Badge size="sm" color="default" startIcon={<XCircle />} />}
        </div>
      ),
      className: 'w-16',
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <button
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-surface-hover cursor-pointer text-subtle hover:text-fg"
          onClick={() => handleEdit(row.original)}
          aria-label={t('common.edit')}
        >
          <Pencil size={14} />
        </button>
      ),
      enableSorting: false,
      className: 'w-10',
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
          {t('discount.policies')}
        </div>
        <div className="mobile-header-end px-2">
          <button
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-surface-hover cursor-pointer text-current"
            aria-label={t('discount.addPolicy')}
            onClick={handleCreate}
          >
            <Plus size={18} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('discount.policies')}</h1>
          <Button color="primary" startIcon={<Plus size={16} />} onClick={handleCreate}>
            {t('discount.addPolicy')}
          </Button>
        </div>

        {/* Filters — scope always visible, active ≥sm, popover <sm */}
        <div className="flex items-center gap-2 pb-4 flex-none">
          <div className="flex-1 min-w-0">
            <Select
              options={scopeOptions}
              value={filterScope || null}
              onChange={(val) => setFilterScope((val as string) ?? '')}
              placeholder={t('discount.allScopes')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          <div className="hidden sm:block flex-1 min-w-0">
            <Select
              options={companyFilterOptions}
              value={filterCompany || null}
              onChange={(val) => setFilterCompany((val as string) ?? '')}
              placeholder={t('discount.allCompanies')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          <div className="hidden md:block flex-1 min-w-0">
            <Select
              options={activeOptions}
              value={filterActive || null}
              onChange={(val) => setFilterActive((val as string) ?? '')}
              placeholder={t('discount.allStatuses')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          <div className="md:hidden shrink-0">
            <PopOver
              isOpen={filterOpen}
              onClose={() => setFilterOpen(false)}
              placement="bottom"
              align="end"
              maxWidth="300px"
              maxHeight="400px"
              trigger={
                <div className="relative inline-flex">
                  <Button
                    variant="outline"
                    size="sm"
                    startIcon={<SlidersHorizontal size={16} />}
                    onClick={() => setFilterOpen(!filterOpen)}
                  />
                  {(filterCompany || filterActive) && (
                    <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none pointer-events-none">
                      {(filterCompany ? 1 : 0) + (filterActive ? 1 : 0)}
                    </span>
                  )}
                </div>
              }
            >
              <div className="flex flex-col gap-3 p-3">
                <div className="text-xs font-medium text-subtle uppercase tracking-wide">{t('common.filters')}</div>
                <Select
                  options={companyFilterOptions}
                  value={filterCompany}
                  onChange={(val) => setFilterCompany((val as string) ?? '')}
                  placeholder={t('discount.allCompanies')}
                  size="sm"
                  showChevron
                  clearable
                />
                <Select
                  options={activeOptions}
                  value={filterActive}
                  onChange={(val) => setFilterActive((val as string) ?? '')}
                  placeholder={t('discount.allStatuses')}
                  size="sm"
                  showChevron
                  clearable
                />
                <div className="text-xs font-medium text-subtle uppercase tracking-wide mt-1">{t('common.sortBy')}</div>
                <Select
                  options={[
                    { value: 'scope', label: t('discount.scope') },
                    { value: 'company_name', label: t('discount.company') },
                    { value: 'is_active', label: t('discount.active') },
                    { value: 'effective_period', label: t('discount.effectivePeriod') },
                  ]}
                  value={sorting[0]?.id ?? null}
                  onChange={(val) => {
                    if (val) setSorting([{ id: val as string, desc: sorting[0]?.desc ?? false }]);
                    else setSorting([]);
                  }}
                  placeholder={t('common.sortBy')}
                  size="sm"
                  showChevron
                  clearable
                  searchable={false}
                />
              </div>
            </PopOver>
          </div>
        </div>

        {/* Desktop: DataTable */}
        <DataTable<DiscountPolicy>
          data={paginatedPolicies}
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
              {t('discount.noPolicies')}
            </div>
          }
        />

        {/* Mobile: Card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {filteredPolicies.length === 0 ? (
              <div className="p-8 text-center text-subtle">
                {t('discount.noPolicies')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {paginatedPolicies.map((policy) => {
                  const scope = getScopeLabel(policy);
                  return (
                    <div
                      key={policy.id}
                      className="px-1 py-3 cursor-pointer active:bg-surface-hover"
                      onClick={() => handleEdit(policy)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 -ml-1">
                          <Badge size="sm" color={scopeBadgeColor(scope)}>
                            {t(`discount.scope${scope}`)}
                          </Badge>
                          {policy.company_name && (
                            <span className="text-sm font-medium truncate">{policy.company_name}</span>
                          )}
                        </div>
                        {policy.is_active
                          ? <Badge size="sm" color="success" startIcon={<CheckCircle />} />
                          : <Badge size="sm" color="default" startIcon={<XCircle />} />
                        }
                      </div>
                      {policy.branch_name && (
                        <div className="text-xs text-subtle mt-0.5 ml-1">{policy.branch_name}</div>
                      )}
                      <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
                        <div>
                          <div className="text-[10px] text-subtle">Retail</div>
                          <div className="tabular-nums font-medium">{policy.retail_max_discount_percent}%</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-subtle">FIN1</div>
                          <div className="tabular-nums font-medium">{policy.fin1_max_discount_percent}%</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-subtle">FIN2</div>
                          <div className="tabular-nums font-medium">{policy.fin2_max_discount_percent}%</div>
                        </div>
                      </div>
                      {(policy.effective_from || policy.effective_to) && (
                        <div className="text-[11px] text-subtle mt-1">
                          {policy.effective_from && <DateTime value={policy.effective_from} />}
                          {policy.effective_from && policy.effective_to && ' — '}
                          {policy.effective_to && <DateTime value={policy.effective_to} />}
                        </div>
                      )}
                    </div>
                  );
                })}
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

      <PolicyModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editPolicy={editPolicy}
        onSuccess={handleSuccess}
      />
    </>
  );
}
