import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, Button, Input, Select,
  PopOver, MenuItem, Modal, MobileHeader,
  useSnackbarContext, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import {
  Plus, MoreHorizontal, Trash2,
  XCircle, CheckCircle, ArrowRightFromLine,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

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
  holiday_date: string;
  description: string;
}

// ── Row Actions ──────────────────────────────────────────────────────────────

function RowActions({ holiday, onRemove }: {
  holiday: Holiday;
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
        <MenuItem icon={<Trash2 size={14} />} label={t('settings.holidays.remove')} onClick={() => { setOpen(false); onRemove(holiday); }} />
      </div>
    </PopOver>
  );
}

// ── Add Holiday Modal ────────────────────────────────────────────────────────

function AddHolidayModal({ open, onClose, companies }: {
  open: boolean;
  onClose: () => void;
  companies: Company[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [isPending, setIsPending] = useState(false);

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<HolidayForm>({
    defaultValues: {
      company_id: '',
      holiday_date: '',
      description: '',
    },
  });

  const prevOpen = useRef(open);
  if (open && !prevOpen.current) {
    reset({ company_id: '', holiday_date: '', description: '' });
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
        p_holiday_date: data.holiday_date,
        p_description: data.description,
        p_managed_by: user.user_id,
      });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.holidays.added')}</span></div>,
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['company-holidays'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
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
          <h2 className="modal-title">{t('settings.holidays.addHoliday')}</h2>
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
                  />
                )}
              />
              <FormErrorMessage error={errors.company_id} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.holidays.holidayDate')}</label>
              <Input type="date" {...register('holiday_date', { required: t('common.required') })} className="w-full" />
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
            {isPending ? t('common.saving') : t('common.create')}
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
        ? (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '') || err.message
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
          <div className="mt-2 text-sm text-fg/60">
            <div>{holiday.company_name} — {formatDate(holiday.holiday_date)}</div>
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function HolidaysPage() {
  const { t } = useTranslation();
  const { addSnackbar: _ } = useSnackbarContext();
  void _;

  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [createOpen, setCreateOpen] = useState(false);
  const [removeHoliday, setRemoveHoliday] = useState<Holiday | null>(null);

  const { data: holidays = [], isFetching, isLoading } = useQuery({
    queryKey: ['company-holidays'],
    queryFn: () => apiClient.get<Holiday[]>('/v_company_holidays?order=holiday_date.desc,company_name'),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['companies-for-holidays'],
    queryFn: () => apiClient.get<Company[]>('/v_company_config?select=company_id,company_name&order=company_name'),
  });

  const filtered = search.trim()
    ? holidays.filter(h => {
        const term = search.trim().toLowerCase();
        return h.company_name.toLowerCase().includes(term)
          || h.description.toLowerCase().includes(term);
      })
    : holidays;

  const totalCount = filtered.length;
  const paginated = filtered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPageIndex(0);
    }, 300);
  };

  const columns: ColumnDef<Holiday>[] = [
    {
      accessorKey: 'company_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.holidays.colCompany')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.company_name}</span>,
    },
    {
      accessorKey: 'holiday_date',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.holidays.colDate')} />,
      cell: ({ row }) => <span className="font-medium tabular-nums">{formatDate(row.original.holiday_date)}</span>,
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
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-primary"
            onClick={() => setCreateOpen(true)}
            aria-label={t('settings.holidays.addHoliday')}
          >
            <Plus size={20} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('settings.holidays.title')}</h1>
            <p className="text-sm text-fg/60 mt-1">{t('settings.holidays.description')}</p>
          </div>
          <Button color="primary" startIcon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
            {t('settings.holidays.addHoliday')}
          </Button>
        </div>

        {/* Filter bar */}
        <div className="flex-none pb-4">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 md:max-w-56">
              <Input
                placeholder={t('common.search')}
                value={searchInput}
                onChange={(e) => handleSearch(e.target.value)}
                size="sm"
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Desktop: DataTable */}
        <DataTable<Holiday>
          data={paginated}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setPageIndex(pi);
            setPageSize(ps);
          }}
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-control-label">
              {isLoading ? t('common.loading') : t('settings.holidays.empty')}
            </div>
          }
        />

        {/* Mobile: Card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-control-label">
                {isLoading ? t('common.loading') : t('settings.holidays.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {paginated.map((holiday) => (
                  <div
                    key={holiday.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{formatDate(holiday.holiday_date)}</div>
                      <div className="text-xs text-fg/60 mt-0.5">{holiday.description}</div>
                      <div className="text-xs text-fg/40 mt-0.5">{holiday.company_name}</div>
                    </div>
                    <RowActions
                      holiday={holiday}
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
              pageSizeOptions={[25, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      <AddHolidayModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        companies={companies}
      />
      <ConfirmRemoveModal
        open={!!removeHoliday}
        onClose={() => setRemoveHoliday(null)}
        holiday={removeHoliday}
      />
    </>
  );
}
