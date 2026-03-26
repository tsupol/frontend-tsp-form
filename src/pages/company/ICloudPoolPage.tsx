import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, Button, Input, Select,
  PopOver, MenuItem, MenuSeparator, Badge, Modal, MobileHeader, TextArea,
  useSnackbarContext, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import {
  Plus, MoreHorizontal, Pencil, ShieldCheck, ShieldOff,
  XCircle, CheckCircle, ArrowRightFromLine, Eye, EyeOff, SlidersHorizontal,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface ICloudAccount {
  id: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  apple_id: string;
  registration_email: string | null;
  is_active: boolean;
  note: string | null;
  c_device_count: number;
  created_by: number;
  created_at: string;
  updated_at: string;
}

interface Branch {
  id: number;
  name: string;
  company_id: number;
}

interface CreateForm {
  branch_id: string;
  apple_id: string;
  password: string;
  registration_email: string;
  note: string;
}

interface EditForm {
  password: string;
  registration_email: string;
  note: string;
}

// ── Row Actions ──────────────────────────────────────────────────────────────

function RowActions({ account, onEdit, onToggle }: {
  account: ICloudAccount;
  onEdit: (a: ICloudAccount) => void;
  onToggle: (a: ICloudAccount) => void;
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
        <MenuItem icon={<Pencil size={14} />} label={t('common.edit')} onClick={() => { setOpen(false); onEdit(account); }} />
        <MenuSeparator />
        <MenuItem
          icon={account.is_active ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
          label={account.is_active ? t('settings.icloud.deactivate') : t('settings.icloud.activate')}
          onClick={() => { setOpen(false); onToggle(account); }}
        />
      </div>
    </PopOver>
  );
}

// ── Create Modal ─────────────────────────────────────────────────────────────

function CreateModal({ open, onClose, branches }: {
  open: boolean;
  onClose: () => void;
  branches: Branch[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<CreateForm>({
    defaultValues: { branch_id: '', apple_id: '', password: '', registration_email: '', note: '' },
  });

  useEffect(() => {
    if (open) {
      reset({ branch_id: '', apple_id: '', password: '', registration_email: '', note: '' });
      setErrorMessage('');
      setShowPassword(false);
    }
  }, [open, reset]);

  const onSubmit = async (data: CreateForm) => {
    if (!user) return;
    setIsPending(true);
    setErrorMessage('');

    const start = Date.now();
    try {
      await apiClient.rpc('fn_icloud_account_create', {
        p_company_id: user.company_id,
        p_branch_id: Number(data.branch_id),
        p_apple_id: data.apple_id,
        p_password: data.password,
        p_registration_email: data.registration_email || null,
        p_note: data.note || null,
        p_created_by: user.user_id,
      });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.icloud.created')}</span></div>,
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['icloud-accounts'] });
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
          <h2 className="modal-title">{t('settings.icloud.addAccount')}</h2>
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
              <label className="form-label">{t('settings.icloud.branch')}</label>
              <Controller
                name="branch_id"
                control={control}
                rules={{ required: t('common.required') }}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onChange={(val) => field.onChange(val as string)}
                    placeholder={t('settings.icloud.branch')}
                    options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
                  />
                )}
              />
              <FormErrorMessage error={errors.branch_id} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.icloud.appleId')}</label>
              <Input {...register('apple_id', { required: t('common.required') })} className="w-full" />
              <FormErrorMessage error={errors.apple_id} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.icloud.password')}</label>
              <Input
                type={showPassword ? 'text' : 'password'}
                {...register('password', { required: t('common.required'), minLength: { value: 8, message: t('settings.icloud.passwordMinLength') } })}
                className="w-full"
                endIcon={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                onEndIconClick={() => setShowPassword(!showPassword)}
              />
              <FormErrorMessage error={errors.password} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.icloud.registrationEmail')}</label>
              <Input {...register('registration_email', { pattern: { value: /^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: t('settings.icloud.invalidEmail') } })} className="w-full" />
              <FormErrorMessage error={errors.registration_email} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.icloud.note')}</label>
              <Input {...register('note')} className="w-full" />
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

// ── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ open, onClose, account }: {
  open: boolean;
  onClose: () => void;
  account: ICloudAccount | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<EditForm>({
    defaultValues: { password: '', registration_email: '', note: '' },
  });

  useEffect(() => {
    if (open && account) {
      reset({
        password: '',
        registration_email: account.registration_email ?? '',
        note: account.note ?? '',
      });
      setErrorMessage('');
      setShowPassword(false);
    }
  }, [open, account, reset]);

  const onSubmit = async (data: EditForm) => {
    if (!user || !account) return;
    setIsPending(true);
    setErrorMessage('');

    const start = Date.now();
    try {
      await apiClient.rpc('fn_icloud_account_update', {
        p_account_id: account.id,
        p_password: data.password || null,
        p_registration_email: data.registration_email || null,
        p_is_active: account.is_active,
        p_note: data.note || null,
        p_updated_by: user.user_id,
      });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.icloud.updated')}</span></div>,
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['icloud-accounts'] });
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
          <h2 className="modal-title">{t('settings.icloud.editAccount')}</h2>
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
              <label className="form-label">{t('settings.icloud.password')}</label>
              <Input
                type={showPassword ? 'text' : 'password'}
                {...register('password', { minLength: { value: 8, message: t('settings.icloud.passwordMinLength') } })}
                className="w-full"
                placeholder={t('settings.icloud.passwordPlaceholder')}
                endIcon={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                onEndIconClick={() => setShowPassword(!showPassword)}
              />
              <FormErrorMessage error={errors.password} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.icloud.registrationEmail')}</label>
              <Input {...register('registration_email', { pattern: { value: /^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: t('settings.icloud.invalidEmail') } })} className="w-full" />
              <FormErrorMessage error={errors.registration_email} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.icloud.note')}</label>
              <TextArea {...register('note')} className="w-full" rows={3} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" color="primary" disabled={isPending}>
            {isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Sort helpers ─────────────────────────────────────────────────────────────

const sortColumnMap: Record<string, string> = {
  branch_name: 'branch_name',
  apple_id: 'apple_id',
  registration_email: 'registration_email',
  updated_at: 'updated_at',
};

// ── Main Page ────────────────────────────────────────────────────────────────

export function ICloudPoolPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [sorting, setSorting] = useState<SortingState>([{ id: 'updated_at', desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<ICloudAccount | null>(null);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const branchOptions = branches.map(b => ({ value: String(b.id), label: b.name }));

  const buildEndpoint = () => {
    const params: string[] = [];
    if (search.trim()) {
      params.push(`or=(branch_name.ilike.*${encodeURIComponent(search.trim())}*,apple_id.ilike.*${encodeURIComponent(search.trim())}*,registration_email.ilike.*${encodeURIComponent(search.trim())}*)`);
    }
    if (branchFilter) params.push(`branch_id=eq.${branchFilter}`);
    const sort = sorting[0];
    const col = sort ? sortColumnMap[sort.id] : null;
    params.push(col ? `order=${col}.${sort.desc ? 'desc' : 'asc'}` : 'order=updated_at.desc');
    return `/v_icloud_accounts?${params.join('&')}`;
  };

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ['icloud-accounts', pageIndex, pageSize, search, branchFilter, sorting],
    queryFn: () => apiClient.getPaginated<ICloudAccount>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const accounts = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  useEffect(() => { setPageIndex(0); }, [search, branchFilter, sorting]);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
    }, 300);
  };

  const handleToggle = async (account: ICloudAccount) => {
    if (!user) return;
    try {
      await apiClient.rpc('fn_icloud_account_update', {
        p_account_id: account.id,
        p_password: null,
        p_registration_email: account.registration_email,
        p_is_active: !account.is_active,
        p_note: account.note,
        p_updated_by: user.user_id,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span className="alert-description">
              {account.is_active ? t('settings.icloud.deactivated') : t('settings.icloud.activated')}
            </span>
          </div>
        ),
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['icloud-accounts'] });
    } catch (err) {
      const msg = err instanceof ApiError
        ? (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '') || err.message
        : t('common.error');
      addSnackbar({
        message: <div className="alert alert-danger"><XCircle size={16} /><span className="alert-description">{msg}</span></div>,
        type: 'error',
        duration: 5000,
      });
    }
  };

  const columns: ColumnDef<ICloudAccount>[] = [
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.icloud.colBranch')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.branch_name}</span>,
    },
    {
      accessorKey: 'apple_id',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.icloud.colAppleId')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.apple_id}</span>,
    },
    {
      accessorKey: 'registration_email',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.icloud.colEmail')} />,
      cell: ({ row }) => row.original.registration_email
        ? <span>{row.original.registration_email}</span>
        : <span className="opacity-30">—</span>,
    },
    {
      id: 'devices',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.icloud.devices')} />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.c_device_count}</span>,
    },
    {
      id: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.icloud.colStatus')} />,
      cell: ({ row }) => (
        <Badge color={row.original.is_active ? 'success' : 'default'} size="sm">
          {row.original.is_active ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
    },
    {
      accessorKey: 'updated_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.icloud.colUpdatedAt')} />,
      cell: ({ row }) => (
        <span className="text-xs tabular-nums opacity-60">
          {new Date(row.original.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <RowActions
          account={row.original}
          onEdit={setEditAccount}
          onToggle={handleToggle}
        />
      ),
      enableSorting: false,
      className: 'w-10',
    },
  ];

  const sortOptions = [
    { value: 'updated_at', label: t('settings.icloud.colUpdatedAt') },
    { value: 'branch_name', label: t('settings.icloud.colBranch') },
    { value: 'apple_id', label: t('settings.icloud.colAppleId') },
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
          {t('settings.icloud.title')}
        </div>
        <div className="mobile-header-end">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-primary"
            onClick={() => setCreateOpen(true)}
            aria-label={t('settings.icloud.addAccount')}
          >
            <Plus size={20} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('settings.icloud.title')}</h1>
            <p className="text-sm text-fg/60 mt-1">{t('settings.icloud.description')}</p>
          </div>
          <Button color="primary" startIcon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
            {t('settings.icloud.addAccount')}
          </Button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 pb-4 flex-none">
          {/* Search — always visible */}
          <div className="flex-1 min-w-0 md:max-w-56">
            <Input
              placeholder={t('settings.icloud.searchPlaceholder')}
              value={searchInput}
              onChange={(e) => handleSearch(e.target.value)}
              size="sm"
              className="w-full"
            />
          </div>
          {/* Branch — visible ≥sm */}
          <div className="hidden sm:block flex-1 min-w-0 md:max-w-56">
            <Select
              options={branchOptions}
              value={branchFilter !== null ? String(branchFilter) : null}
              onChange={(val) => setBranchFilter(val ? Number(val) : null)}
              placeholder={t('settings.icloud.filterAllBranches')}
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
                <Button size="sm" className="relative btn-icon-sm" onClick={() => setFilterOpen(!filterOpen)}>
                  <SlidersHorizontal size={16} />
                  {branchFilter && (
                    <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">1</span>
                  )}
                </Button>
              }
            >
              <div className="flex flex-col gap-3 p-3">
                <div className="text-xs font-medium text-muted uppercase tracking-wide">{t('common.filters')}</div>
                <Select
                  options={branchOptions}
                  value={branchFilter !== null ? String(branchFilter) : null}
                  onChange={(val) => setBranchFilter(val ? Number(val) : null)}
                  placeholder={t('settings.icloud.filterAllBranches')}
                  size="sm"
                  showChevron
                  clearable
                />
                <div className="text-xs font-medium text-muted uppercase tracking-wide mt-1">{t('common.sortBy')}</div>
                <Select
                  options={sortOptions}
                  value={sorting[0]?.id ?? null}
                  onChange={(val) => {
                    if (val) setSorting([{ id: val as string, desc: sorting[0]?.desc ?? true }]);
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
        <DataTable<ICloudAccount>
          data={accounts}
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
              {isLoading ? t('common.loading') : t('settings.icloud.empty')}
            </div>
          }
        />

        {/* Mobile: Card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {accounts.length === 0 ? (
              <div className="p-8 text-center text-control-label">
                {isLoading ? t('common.loading') : t('settings.icloud.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{account.apple_id}</span>
                        {!account.is_active && <Badge color="default" size="sm">{t('common.inactive')}</Badge>}
                      </div>
                      <div className="text-xs text-fg/60 mt-0.5">{account.branch_name} · {account.c_device_count} {t('settings.icloud.devices').toLowerCase()}</div>
                    </div>
                    <RowActions
                      account={account}
                      onEdit={setEditAccount}
                      onToggle={handleToggle}
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
      <CreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        branches={branches}
      />
      <EditModal
        open={!!editAccount}
        onClose={() => setEditAccount(null)}
        account={editAccount}
      />
    </>
  );
}
