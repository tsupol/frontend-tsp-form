import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, Button, Input, Select,
  PopOver, MenuItem, Modal, MobileHeader, InputDatePicker,
  useSnackbarContext, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import {
  Plus, MoreHorizontal, Trash2, Pencil, Keyboard,
  XCircle, CheckCircle, ArrowRightFromLine, SlidersHorizontal,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { translateApiError } from '../../lib/apiErrors';
import { toLocalDateStr, parseLocalDate, makeDatePickerFormat } from '../../lib/format';
import { DateTime } from '../../components/DateTime';

// ── Types ────────────────────────────────────────────────────────────────────

interface Holiday {
  id: number;
  company_id: number;
  company_name: string;
  holiday_date: string;
  description: string;
  created_by: number;
  created_at: string;
  holding_id: number;
}

interface Company {
  company_id: number;
  company_name: string;
}

interface HolidayForm {
  company_id: string;
  holiday_date: Date | null;
  description: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** DD/MM/YYYY typed input → Date. Accepts Buddhist Era years. */
function parseTypedDate(raw: string): Date | null {
  if (raw.length !== 8) return null;
  const day = parseInt(raw.slice(0, 2), 10);
  const month = parseInt(raw.slice(2, 4), 10);
  let year = parseInt(raw.slice(4, 8), 10);
  if (year > 2400) year -= 543;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

// ── Row Actions ──────────────────────────────────────────────────────────────

function RowActions({ holiday, onEdit, onRemove }: {
  holiday: Holiday;
  onEdit: (h: Holiday) => void;
  onRemove: (h: Holiday) => void;
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
          className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); setOpen(!open); }}
          aria-label="Actions"
        >
          <MoreHorizontal size={16} className="opacity-50" />
        </button>
      }
    >
      <div className="py-1 min-w-[160px]">
        <MenuItem icon={<Pencil size={14} />} label={t('common.edit')} onClick={() => { setOpen(false); onEdit(holiday); }} />
        <MenuItem icon={<Trash2 size={14} />} label={t('settings.holidays.remove')} onClick={() => { setOpen(false); onRemove(holiday); }} />
      </div>
    </PopOver>
  );
}

// ── Holiday Form Modal (add + edit) ──────────────────────────────────────────

function HolidayFormModal({ open, onClose, companies, holiday }: {
  open: boolean;
  onClose: () => void;
  companies: Company[];
  holiday?: Holiday | null;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [isPending, setIsPending] = useState(false);
  const [dateTyping, setDateTyping] = useState(false);
  const isEdit = !!holiday;

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<HolidayForm>({
    defaultValues: {
      company_id: '',
      holiday_date: null,
      description: '',
    },
  });

  const prevOpen = useRef(open);
  if (open && !prevOpen.current) {
    if (holiday) {
      reset({
        company_id: String(holiday.company_id),
        holiday_date: parseLocalDate(holiday.holiday_date),
        description: holiday.description,
      });
    } else {
      reset({ company_id: '', holiday_date: null, description: '' });
    }
    setErrorMessage('');
  }
  prevOpen.current = open;

  const onSubmit = async (data: HolidayForm) => {
    if (!user) return;
    setIsPending(true);
    setErrorMessage('');

    const start = Date.now();
    try {
      await apiClient.rpc('fn_holiday_manage', {
        p_company_id: Number(data.company_id),
        p_action: 'ADD',
        p_holiday_date: toLocalDateStr(data.holiday_date),
        p_description: data.description,
        p_managed_by: user.user_id,
      });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{isEdit ? t('settings.holidays.updated') : t('settings.holidays.added')}</span></div>,
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['company-holidays'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? t('settings.holidays.editHoliday') : t('settings.holidays.addHoliday')}</h2>
        </div>
        <div className="modal-content">
          {errorMessage && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={18} />
              <div><div className="alert-description">{errorMessage}</div></div>
            </div>
          )}
          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('settings.holidays.company')}</label>
              <Controller
                name="company_id"
                control={control}
                rules={{ required: t('common.required') }}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onChange={(val) => field.onChange(val as string)}
                    placeholder={t('settings.holidays.company')}
                    options={companies.map(c => ({ label: c.company_name, value: String(c.company_id) }))}
                    disabled={isEdit}
                  />
                )}
              />
              <FormErrorMessage error={errors.company_id} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.holidays.holidayDate')}</label>
              <Controller
                name="holiday_date"
                control={control}
                rules={{ required: t('common.required') }}
                render={({ field }) => (
                  <InputDatePicker
                    value={field.value}
                    onChange={(date) => field.onChange(date)}
                    placeholder={t('settings.holidays.holidayDate')}
                    dateFormat={makeDatePickerFormat(i18n.language)}
                    locale={i18n.language}
                    calendar="gregorian"
                    endIcon={<Keyboard size={16} />}
                    onEndIconClick={() => setDateTyping(v => !v)}
                    typingMode={dateTyping}
                    onTypingModeChange={setDateTyping}
                    typingMask="##/##/####"
                    typingPlaceholder="DD/MM/YYYY"
                    parseTypedDate={parseTypedDate}
                    disabled={isEdit}
                  />
                )}
              />
              <FormErrorMessage error={errors.holiday_date} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.holidays.descriptionField')}</label>
              <Input {...register('description', { required: t('common.required') })} className="w-full" />
              <FormErrorMessage error={errors.description} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" color="primary" disabled={isPending}>
            {isPending ? t('common.saving') : isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Confirm Remove Modal ─────────────────────────────────────────────────────

function ConfirmRemoveModal({ open, onClose, holiday }: {
  open: boolean;
  onClose: () => void;
  holiday: Holiday | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);

  const handleRemove = async () => {
    if (!user || !holiday) return;
    setIsPending(true);

    const start = Date.now();
    try {
      await apiClient.rpc('fn_holiday_manage', {
        p_company_id: holiday.company_id,
        p_action: 'REMOVE',
        p_holiday_date: holiday.holiday_date,
        p_description: holiday.description,
        p_managed_by: user.user_id,
      });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.holidays.removed')}</span></div>,
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['company-holidays'] });
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError
        ? translateApiError(err, t) || err.message
        : t('common.error');
      addSnackbar({
        message: <div className="alert alert-danger"><XCircle size={16} /><span className="alert-description">{msg}</span></div>,
        type: 'error',
        duration: 5000,
      });
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('settings.holidays.confirmRemove')}</h2>
      </div>
      <div className="modal-content">
        <p className="text-sm">{t('settings.holidays.confirmRemoveMessage')}</p>
        {holiday && (
          <div className="mt-2 text-sm text-subtle">
            <div>{holiday.company_name} — <DateTime value={holiday.holiday_date} showTime={false} /></div>
            <div>{holiday.description}</div>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button type="button" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="button" color="danger" disabled={isPending} onClick={handleRemove}>
          {isPending ? t('common.saving') : t('settings.holidays.remove')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Sort helpers ─────────────────────────────────────────────────────────────

const sortColumnMap: Record<string, string> = {
  holiday_date: 'holiday_date',
  company_name: 'company_name',
  description: 'description',
};

// ── Main Page (continued) ───────────────────────────────────────────────────

export function HolidaysPage() {
  const { t } = useTranslation();

  const [sorting, setSorting] = useState<SortingState>([{ id: 'holiday_date', desc: false }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [companyFilter, setCompanyFilter] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editHoliday, setEditHoliday] = useState<Holiday | null>(null);
  const [removeHoliday, setRemoveHoliday] = useState<Holiday | null>(null);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies-for-holidays'],
    queryFn: () => apiClient.get<Company[]>('/v_company_config?select=company_id,company_name&order=company_name'),
  });

  const companyOptions = companies.map(c => ({ value: String(c.company_id), label: c.company_name }));

  const buildEndpoint = () => {
    const params: string[] = [];
    if (search.trim()) {
      params.push(`description=ilike.*${encodeURIComponent(search.trim())}*`);
    }
    if (companyFilter) params.push(`company_id=eq.${companyFilter}`);
    const sort = sorting[0];
    const col = sort ? sortColumnMap[sort.id] : null;
    params.push(col ? `order=${col}.${sort.desc ? 'desc' : 'asc'}` : 'order=holiday_date.asc');
    return `/v_company_holidays?${params.join('&')}`;
  };

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ['company-holidays', pageIndex, pageSize, search, companyFilter, sorting],
    queryFn: () => apiClient.getPaginated<Holiday>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const holidays = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  useEffect(() => { setPageIndex(0); }, [search, companyFilter, sorting]);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
    }, 300);
  };

  const sortOptions = [
    { value: 'holiday_date', label: t('settings.holidays.colDate') },
    { value: 'company_name', label: t('settings.holidays.colCompany') },
  ];

  const columns: ColumnDef<Holiday>[] = [
    {
      accessorKey: 'company_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.holidays.colCompany')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.company_name}</span>,
    },
    {
      accessorKey: 'holiday_date',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.holidays.colDate')} />,
      cell: ({ row }) => <DateTime value={row.original.holiday_date} showTime={false} className="font-medium tabular-nums" />,
    },
    {
      accessorKey: 'description',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.holidays.colDescription')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.description}</span>,
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <RowActions
          holiday={row.original}
          onEdit={setEditHoliday}
          onRemove={setRemoveHoliday}
        />
      ),
      enableSorting: false,
      className: 'w-10',
    },
  ];

  return (
    <>
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
          {t('settings.holidays.title')}
        </div>
        <div className="mobile-header-end">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-primary-fg"
            onClick={() => setCreateOpen(true)}
            aria-label={t('settings.holidays.addHoliday')}
          >
            <Plus size={20} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-start justify-between gap-4 mb-4 flex-none max-md:hidden">
          <div className="min-w-0">
            <h1 className="heading-2">{t('settings.holidays.title')}</h1>
            <p className="text-sm text-subtle mt-1">{t('settings.holidays.description')}</p>
          </div>
          <Button color="primary" className="shrink-0 whitespace-nowrap" startIcon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
            {t('settings.holidays.addHoliday')}
          </Button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 pb-4 flex-none">
          {/* Search — always visible */}
          <div className="flex-1 min-w-0 md:max-w-56">
            <Input
              placeholder={t('settings.holidays.searchPlaceholder')}
              value={searchInput}
              onChange={(e) => handleSearch(e.target.value)}
              size="sm"
              className="w-full"
            />
          </div>
          {/* Company — visible ≥sm */}
          <div className="hidden sm:block flex-1 min-w-0 md:max-w-56">
            <Select
              options={companyOptions}
              value={companyFilter !== null ? String(companyFilter) : null}
              onChange={(val) => setCompanyFilter(val ? Number(val) : null)}
              placeholder={t('settings.holidays.filterAllCompanies')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          {/* PopOver — visible <sm */}
          <div className="sm:hidden shrink-0">
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
                    size="sm"
                    startIcon={<SlidersHorizontal size={16} />}
                    onClick={() => setFilterOpen(!filterOpen)}
                  />
                  {companyFilter && (
                    <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none pointer-events-none">1</span>
                  )}
                </div>
              }
            >
              <div className="flex flex-col gap-3 p-3">
                <div className="text-xs font-medium text-subtle uppercase tracking-wide">{t('common.filters')}</div>
                <Select
                  options={companyOptions}
                  value={companyFilter !== null ? String(companyFilter) : null}
                  onChange={(val) => setCompanyFilter(val ? Number(val) : null)}
                  placeholder={t('settings.holidays.filterAllCompanies')}
                  size="sm"
                  showChevron
                  clearable
                />
                <div className="text-xs font-medium text-subtle uppercase tracking-wide mt-1">{t('common.sortBy')}</div>
                <Select
                  options={sortOptions}
                  value={sorting[0]?.id ?? null}
                  onChange={(val) => {
                    if (val) setSorting([{ id: val as string, desc: sorting[0]?.desc ?? false }]);
                    else setSorting([]);
                  }}
                  size="sm"
                  showChevron
                />
              </div>
            </PopOver>
          </div>
        </div>

        {/* Desktop: DataTable */}
        <DataTable<Holiday>
          data={holidays}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[15, 25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setPageIndex(pi);
            setPageSize(ps);
          }}
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-subtle">
              {isLoading ? t('common.loading') : t('settings.holidays.empty')}
            </div>
          }
        />

        {/* Mobile: Card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {holidays.length === 0 ? (
              <div className="p-8 text-center text-subtle">
                {isLoading ? t('common.loading') : t('settings.holidays.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {holidays.map((holiday) => (
                  <div
                    key={holiday.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <DateTime value={holiday.holiday_date} showTime={false} className="font-medium text-sm truncate block" />
                      <div className="text-xs text-subtle mt-0.5">{holiday.description}</div>
                      <div className="text-xs text-subtler mt-0.5">{holiday.company_name}</div>
                    </div>
                    <RowActions
                      holiday={holiday}
                      onEdit={setEditHoliday}
                      onRemove={setRemoveHoliday}
                    />
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
              pageSizeOptions={[15, 25, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      <HolidayFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        companies={companies}
      />
      <HolidayFormModal
        open={!!editHoliday}
        onClose={() => setEditHoliday(null)}
        companies={companies}
        holiday={editHoliday}
      />
      <ConfirmRemoveModal
        open={!!removeHoliday}
        onClose={() => setRemoveHoliday(null)}
        holiday={removeHoliday}
      />
    </>
  );
}
