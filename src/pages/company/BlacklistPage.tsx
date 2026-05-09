import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, Button, Input,
  PopOver, MenuItem, Badge, Modal, MobileHeader,
  useSnackbarContext, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import {
  Plus, MoreHorizontal, ShieldOff, XCircle, CheckCircle, ArrowRightFromLine,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface BlacklistEntry {
  id: number;
  customer_id: number;
  first_name: string;
  last_name: string;
  customer_name: string;
  customer_tel: string;
  national_id: string;
  blacklist_type: string;
  reason: string;
  ref_contract_id: number | null;
  contract_code: string | null;
  contract_code_display: string | null;
  is_active: boolean;
  expires_at: string | null;
  lifted_by: number | null;
  lifted_at: string | null;
  lift_reason: string | null;
  created_by: number;
  created_at: string;
  holding_id: number;
}

interface AddForm {
  customer_id: string;
  national_id: string;
  reason: string;
  ref_contract_id: string;
  expires_at: string;
}

interface LiftForm {
  lift_reason: string;
}

// ── Row Actions ──────────────────────────────────────────────────────────────

function RowActions({ entry, onLift }: {
  entry: BlacklistEntry;
  onLift: (e: BlacklistEntry) => void;
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
        <MenuItem
          icon={<ShieldOff size={14} />}
          label={t('settings.blacklist.liftFromBlacklist')}
          onClick={() => { setOpen(false); onLift(entry); }}
          disabled={!entry.is_active}
        />
      </div>
    </PopOver>
  );
}

// ── Add to Blacklist Modal ───────────────────────────────────────────────────

function AddBlacklistModal({ open, onClose }: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [isPending, setIsPending] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<AddForm>({
    defaultValues: {
      customer_id: '',
      national_id: '',
      reason: '',
      ref_contract_id: '',
      expires_at: '',
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        customer_id: '',
        national_id: '',
        reason: '',
        ref_contract_id: '',
        expires_at: '',
      });
      setErrorMessage('');
    }
  }, [open, reset]);

  const onSubmit = async (data: AddForm) => {
    if (!user) return;
    setIsPending(true);
    setErrorMessage('');

    const start = Date.now();
    try {
      await apiClient.rpc('fn_blacklist_add', {
        p_customer_id: Number(data.customer_id),
        p_reason: data.reason,
        p_national_id: data.national_id || null,
        p_ref_contract_id: data.ref_contract_id ? Number(data.ref_contract_id) : null,
        p_expires_at: data.expires_at || null,
        p_added_by: user.user_id,
      });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.blacklist.added')}</span></div>,
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['blacklist'] });
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
          <h2 className="modal-title">{t('settings.blacklist.addToBlacklist')}</h2>
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
              <label className="form-label">{t('settings.blacklist.customerId')}</label>
              <Input {...register('customer_id', { required: t('common.required') })} type="number" className="w-full" />
              <FormErrorMessage error={errors.customer_id} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.blacklist.nationalId')}</label>
              <Input {...register('national_id')} className="w-full" />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.blacklist.reason')}</label>
              <Input {...register('reason', { required: t('common.required') })} className="w-full" />
              <FormErrorMessage error={errors.reason} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.blacklist.refContract')}</label>
              <Input {...register('ref_contract_id')} type="number" className="w-full" />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.blacklist.expiresAt')}</label>
              <Input {...register('expires_at')} type="datetime-local" className="w-full" />
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

// ── Lift from Blacklist Modal ────────────────────────────────────────────────

function LiftBlacklistModal({ open, onClose, entry }: {
  open: boolean;
  onClose: () => void;
  entry: BlacklistEntry | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [isPending, setIsPending] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<LiftForm>({
    defaultValues: { lift_reason: '' },
  });

  useEffect(() => {
    if (open) {
      reset({ lift_reason: '' });
      setErrorMessage('');
    }
  }, [open, reset]);

  const onSubmit = async (data: LiftForm) => {
    if (!user || !entry) return;
    setIsPending(true);
    setErrorMessage('');

    const start = Date.now();
    try {
      await apiClient.rpc('fn_blacklist_lift', {
        p_blacklist_id: entry.id,
        p_lift_reason: data.lift_reason,
        p_lifted_by: user.user_id,
      });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.blacklist.lifted')}</span></div>,
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['blacklist'] });
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
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{t('settings.blacklist.liftFromBlacklist')}</h2>
        </div>
        <div className="modal-content">
          {errorMessage && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={18} />
              <div><div className="alert-description">{errorMessage}</div></div>
            </div>
          )}
          {entry && (
            <div className="text-sm text-subtle mb-4">
              {entry.customer_name} ({entry.national_id})
            </div>
          )}
          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('settings.blacklist.liftReason')}</label>
              <Input {...register('lift_reason', { required: t('common.required') })} className="w-full" />
              <FormErrorMessage error={errors.lift_reason} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" color="primary" disabled={isPending}>
            {isPending ? t('common.saving') : t('common.confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function BlacklistPage() {
  const { t } = useTranslation();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [createOpen, setCreateOpen] = useState(false);
  const [liftEntry, setLiftEntry] = useState<BlacklistEntry | null>(null);

  const buildEndpoint = () => {
    const params: string[] = ['order=created_at.desc'];
    if (search.trim()) {
      params.push(`or=(customer_name.ilike.*${encodeURIComponent(search.trim())}*,national_id.ilike.*${encodeURIComponent(search.trim())}*,reason.ilike.*${encodeURIComponent(search.trim())}*)`);
    }
    return `/v_blacklist?${params.join('&')}`;
  };

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ['blacklist', pageIndex, pageSize, search],
    queryFn: () => apiClient.getPaginated<BlacklistEntry>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const entries = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPageIndex(0);
    }, 300);
  };

  const formatExpiry = (expires_at: string | null) => {
    if (!expires_at) return null;
    return new Date(expires_at).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const columns: ColumnDef<BlacklistEntry>[] = [
    {
      id: 'customer',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.blacklist.customerName')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-xs font-medium">{row.original.customer_name}</div>
          <div className="text-[11px] text-subtle tabular-nums">{row.original.national_id}</div>
        </div>
      ),
    },
    {
      id: 'reason',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.blacklist.reason')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-xs font-medium">{row.original.reason}</div>
          {row.original.contract_code_display && (
            <div className="text-[11px] text-subtler">{row.original.contract_code_display}</div>
          )}
        </div>
      ),
    },
    {
      id: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.blacklist.colStatus')} />,
      cell: ({ row }) => (
        <div>
          <Badge color={row.original.is_active ? 'danger' : 'default'} size="sm">
            {row.original.is_active ? t('settings.blacklist.statusActive') : t('settings.blacklist.statusLifted')}
          </Badge>
          {row.original.expires_at && (
            <div className="text-[11px] text-subtler mt-0.5">{t('settings.blacklist.expiresAt')}: {formatExpiry(row.original.expires_at)}</div>
          )}
        </div>
      ),
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <RowActions
          entry={row.original}
          onLift={setLiftEntry}
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
          {t('settings.blacklist.title')}
        </div>
        <div className="mobile-header-end">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-primary"
            onClick={() => setCreateOpen(true)}
            aria-label={t('settings.blacklist.addToBlacklist')}
          >
            <Plus size={20} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('settings.blacklist.title')}</h1>
            <p className="text-sm text-subtle mt-1">{t('settings.blacklist.description')}</p>
          </div>
          <Button color="primary" startIcon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
            {t('settings.blacklist.addToBlacklist')}
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
        <DataTable<BlacklistEntry>
          data={entries}
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
            <div className="p-8 text-center text-subtle">
              {isLoading ? t('common.loading') : t('settings.blacklist.empty')}
            </div>
          }
        />

        {/* Mobile: Card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {entries.length === 0 ? (
              <div className="p-8 text-center text-subtle">
                {isLoading ? t('common.loading') : t('settings.blacklist.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{entry.customer_name}</span>
                        <Badge color={entry.is_active ? 'danger' : 'default'} size="sm">
                          {entry.is_active ? t('settings.blacklist.statusActive') : t('settings.blacklist.statusLifted')}
                        </Badge>
                      </div>
                      <div className="text-xs text-subtle tabular-nums mt-0.5">{entry.national_id}</div>
                      <div className="text-xs text-fg/40 mt-0.5">{entry.reason}</div>
                    </div>
                    <RowActions
                      entry={entry}
                      onLift={setLiftEntry}
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
      <AddBlacklistModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <LiftBlacklistModal
        open={!!liftEntry}
        onClose={() => setLiftEntry(null)}
        entry={liftEntry}
      />
    </>
  );
}
