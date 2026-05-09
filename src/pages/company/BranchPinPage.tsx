import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, Button, Input, Select,
  PopOver, Badge, Modal, MobileHeader,
  useSnackbarContext, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { KeyRound, ArrowRightFromLine, XCircle, CheckCircle, SlidersHorizontal, Eye, EyeOff } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface PinUsageLog {
  id: number;
  holding_id: number;
  branch_id: number;
  branch_name: string;
  used_by: number;
  used_by_name: string;
  permission_code: string;
  context: Record<string, unknown> | null;
  success: boolean;
  used_at: string;
}

interface PinChangeLog {
  id: number;
  holding_id: number;
  branch_id: number;
  branch_name: string;
  action: 'PIN_SET' | 'PIN_CHANGE' | string;
  set_by: number;
  set_by_name: string;
  set_at: string;
}

interface Branch {
  id: number;
  name: string;
  company_id: number;
}

interface ElevatablePermission {
  permission_code: string;
  description: string;
}

interface PinForm {
  branch_id: string;
  pin: string;
}

type Tab = 'change' | 'usage';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBangkokTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Set PIN Modal ────────────────────────────────────────────────────────────

function SetPinModal({ open, onClose, branches, defaultBranchId }: {
  open: boolean;
  onClose: () => void;
  branches: Branch[];
  defaultBranchId?: number | null;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [isPending, setIsPending] = useState(false);
  const [showPin, setShowPin] = useState(false);

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<PinForm>({
    defaultValues: { branch_id: '', pin: '' },
  });

  useEffect(() => {
    if (open) {
      reset({ branch_id: defaultBranchId ? String(defaultBranchId) : '', pin: '' });
      setErrorMessage('');
      setShowPin(false);
    }
  }, [open, defaultBranchId, reset]);

  const onSubmit = async (data: PinForm) => {
    if (!user) return;
    setIsPending(true);
    setErrorMessage('');

    const start = Date.now();
    try {
      await apiClient.rpc('fn_pin_set', {
        p_branch_id: Number(data.branch_id),
        p_pin: data.pin,
        p_set_by: user.user_id,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span className="alert-description">{t('settings.pin.pinSet')}</span>
          </div>
        ),
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['pin-change-log'] });
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

  const isLocked = !!defaultBranchId;

  return (
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{t('settings.pin.setPin')}</h2>
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
              <label className="form-label">{t('settings.pin.branch')}</label>
              <Controller
                name="branch_id"
                control={control}
                rules={{ required: t('common.required') }}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onChange={(val) => field.onChange(val as string)}
                    placeholder={t('settings.pin.branch')}
                    options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
                    disabled={isLocked}
                  />
                )}
              />
              <FormErrorMessage error={errors.branch_id} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.pin.pin')}</label>
              <Input
                type={showPin ? 'text' : 'password'}
                {...register('pin', { required: t('common.required'), pattern: { value: /^\d{6}$/, message: t('settings.pin.pinMustBe6Digits') } })}
                maxLength={6}
                inputMode="numeric"
                className="w-full"
                endIcon={showPin ? <EyeOff size={18} /> : <Eye size={18} />}
                onEndIconClick={() => setShowPin(!showPin)}
              />
              <FormErrorMessage error={errors.pin} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" color="primary" disabled={isPending}>
            {isPending ? t('common.saving') : t('settings.pin.setPin')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Change log tab ───────────────────────────────────────────────────────────

const changeSortColumnMap: Record<string, string> = {
  branch_name: 'branch_name',
  set_by_name: 'set_by_name',
  set_at: 'set_at',
  action: 'action',
};

function ChangeLogTab({ branches, onSetPin }: { branches: Branch[]; onSetPin: (branchId: number) => void }) {
  const { t } = useTranslation();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'set_at', desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [branchFilter, setBranchFilter] = useState<number | null>(null);

  const branchOptions = branches.map(b => ({ value: String(b.id), label: b.name }));

  const buildEndpoint = () => {
    const params: string[] = [];
    if (branchFilter) params.push(`branch_id=eq.${branchFilter}`);
    const sort = sorting[0];
    const col = sort ? changeSortColumnMap[sort.id] : null;
    params.push(col ? `order=${col}.${sort.desc ? 'desc' : 'asc'}` : 'order=set_at.desc');
    return `/v_pin_change_log?${params.join('&')}`;
  };

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ['pin-change-log', pageIndex, pageSize, branchFilter, sorting],
    queryFn: () => apiClient.getPaginated<PinChangeLog>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  useEffect(() => { setPageIndex(0); }, [branchFilter, sorting]);

  const columns: ColumnDef<PinChangeLog>[] = [
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.pin.branch')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.branch_name}</span>,
    },
    {
      accessorKey: 'action',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.pin.action')} />,
      cell: ({ row }) => {
        const a = row.original.action;
        const label = a === 'PIN_SET' ? t('settings.pin.actionSet')
          : a === 'PIN_CHANGE' ? t('settings.pin.actionChange')
          : a;
        return <Badge color={a === 'PIN_SET' ? 'info' : 'default'} size="sm">{label}</Badge>;
      },
    },
    {
      accessorKey: 'set_by_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.pin.changedBy')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.set_by_name}</span>,
    },
    {
      accessorKey: 'set_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.pin.setAt')} />,
      cell: ({ row }) => (
        <span className="text-xs tabular-nums text-subtle">{formatBangkokTime(row.original.set_at)}</span>
      ),
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          startIcon={<KeyRound size={14} />}
          onClick={() => onSetPin(row.original.branch_id)}
        >
          {t('settings.pin.changePin')}
        </Button>
      ),
      enableSorting: false,
    },
  ];

  return (
    <>
      {/* Filter bar */}
      <div className="flex items-center gap-2 pb-4 flex-none">
        <div className="hidden sm:block flex-1 min-w-0 md:max-w-72">
          <Select
            options={branchOptions}
            value={branchFilter !== null ? String(branchFilter) : null}
            onChange={(val) => setBranchFilter(val ? Number(val) : null)}
            placeholder={t('settings.pin.filterAllBranches')}
            size="sm"
            showChevron
            clearable
          />
        </div>
      </div>

      {/* Desktop */}
      <DataTable<PinChangeLog>
        data={rows}
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
            {isLoading ? t('common.loading') : t('settings.pin.noChangeLogs')}
          </div>
        }
      />

      {/* Mobile */}
      <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        <div className="flex-1 overflow-auto better-scroll pb-8">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-subtle">
              {isLoading ? t('common.loading') : t('settings.pin.noChangeLogs')}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {rows.map((row) => (
                <div key={row.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{row.branch_name}</span>
                      <Badge color={row.action === 'PIN_SET' ? 'info' : 'default'} size="sm">
                        {row.action === 'PIN_SET' ? t('settings.pin.actionSet')
                          : row.action === 'PIN_CHANGE' ? t('settings.pin.actionChange')
                          : row.action}
                      </Badge>
                    </div>
                    <div className="text-xs text-subtle mt-0.5">{row.set_by_name}</div>
                    <div className="text-xs text-fg/40 mt-0.5 tabular-nums">{formatBangkokTime(row.set_at)}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    startIcon={<KeyRound size={14} />}
                    onClick={() => onSetPin(row.branch_id)}
                  >
                    {t('settings.pin.changePin')}
                  </Button>
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
    </>
  );
}

// ── Usage log tab ────────────────────────────────────────────────────────────

const usageSortColumnMap: Record<string, string> = {
  branch_name: 'branch_name',
  used_by_name: 'used_by_name',
  permission_code: 'permission_code',
  used_at: 'used_at',
};

function UsageLogTab({ branches, permissionOptions }: { branches: Branch[]; permissionOptions: { value: string; label: string }[] }) {
  const { t } = useTranslation();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'used_at', desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [permissionFilter, setPermissionFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const branchOptions = branches.map(b => ({ value: String(b.id), label: b.name }));

  const buildEndpoint = () => {
    const params: string[] = [];
    if (search.trim()) {
      params.push(`or=(branch_name.ilike.*${encodeURIComponent(search.trim())}*,used_by_name.ilike.*${encodeURIComponent(search.trim())}*)`);
    }
    if (branchFilter) params.push(`branch_id=eq.${branchFilter}`);
    if (permissionFilter) params.push(`permission_code=eq.${permissionFilter}`);
    const sort = sorting[0];
    const col = sort ? usageSortColumnMap[sort.id] : null;
    params.push(col ? `order=${col}.${sort.desc ? 'desc' : 'asc'}` : 'order=used_at.desc');
    return `/v_pin_usage_log?${params.join('&')}`;
  };

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ['pin-usage-log', pageIndex, pageSize, search, branchFilter, permissionFilter, sorting],
    queryFn: () => apiClient.getPaginated<PinUsageLog>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const logs = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  useEffect(() => { setPageIndex(0); }, [search, branchFilter, permissionFilter, sorting]);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
    }, 300);
  };

  const sortOptions = [
    { value: 'used_at', label: t('settings.pin.usedAt') },
    { value: 'branch_name', label: t('settings.pin.branch') },
    { value: 'used_by_name', label: t('settings.pin.usedBy') },
  ];

  const columns: ColumnDef<PinUsageLog>[] = [
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.pin.branch')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.branch_name}</span>,
    },
    {
      accessorKey: 'used_by_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.pin.usedBy')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.used_by_name}</span>,
    },
    {
      accessorKey: 'permission_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.pin.permissionCode')} />,
      cell: ({ row }) => <Badge size="sm">{row.original.permission_code}</Badge>,
    },
    {
      id: 'success',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.pin.result')} />,
      cell: ({ row }) => (
        <Badge color={row.original.success ? 'success' : 'danger'} size="sm">
          {row.original.success ? t('settings.pin.success') : t('settings.pin.failed')}
        </Badge>
      ),
    },
    {
      accessorKey: 'used_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.pin.usedAt')} />,
      cell: ({ row }) => (
        <span className="text-xs tabular-nums text-subtle">{formatBangkokTime(row.original.used_at)}</span>
      ),
    },
  ];

  return (
    <>
      {/* Filter bar */}
      <div className="flex items-center gap-2 pb-4 flex-none">
        <div className="flex-1 min-w-0">
          <Input
            placeholder={t('settings.pin.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            size="sm"
            className="w-full"
          />
        </div>
        <div className="hidden sm:block flex-1 min-w-0">
          <Select
            options={permissionOptions}
            value={permissionFilter}
            onChange={(val) => setPermissionFilter((val as string) || null)}
            placeholder={t('settings.pin.allPermissions')}
            size="sm"
            showChevron
            clearable
          />
        </div>
        <div className="hidden md:block flex-1 min-w-0">
          <Select
            options={branchOptions}
            value={branchFilter !== null ? String(branchFilter) : null}
            onChange={(val) => setBranchFilter(val ? Number(val) : null)}
            placeholder={t('settings.pin.filterAllBranches')}
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
              <Button size="sm" className="relative btn-icon-sm" onClick={() => setFilterOpen(!filterOpen)}>
                <SlidersHorizontal size={16} />
                {(branchFilter || permissionFilter) && (
                  <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                    {(branchFilter ? 1 : 0) + (permissionFilter ? 1 : 0)}
                  </span>
                )}
              </Button>
            }
          >
            <div className="flex flex-col gap-3 p-3">
              <div className="text-xs font-medium text-muted uppercase tracking-wide">{t('common.filters')}</div>
              <Select
                options={permissionOptions}
                value={permissionFilter}
                onChange={(val) => setPermissionFilter((val as string) || null)}
                placeholder={t('settings.pin.allPermissions')}
                size="sm"
                showChevron
                clearable
              />
              <Select
                options={branchOptions}
                value={branchFilter !== null ? String(branchFilter) : null}
                onChange={(val) => setBranchFilter(val ? Number(val) : null)}
                placeholder={t('settings.pin.filterAllBranches')}
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

      {/* Desktop */}
      <DataTable<PinUsageLog>
        data={logs}
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
            {isLoading ? t('common.loading') : t('settings.pin.noLogs')}
          </div>
        }
      />

      {/* Mobile */}
      <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        <div className="flex-1 overflow-auto better-scroll pb-8">
          {logs.length === 0 ? (
            <div className="p-8 text-center text-subtle">
              {isLoading ? t('common.loading') : t('settings.pin.noLogs')}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{log.used_by_name}</span>
                      <Badge color={log.success ? 'success' : 'danger'} size="sm">
                        {log.success ? t('settings.pin.success') : t('settings.pin.failed')}
                      </Badge>
                    </div>
                    <div className="text-xs text-subtle mt-0.5">{log.branch_name} · {log.permission_code}</div>
                    <div className="text-xs text-fg/40 mt-0.5 tabular-nums">{formatBangkokTime(log.used_at)}</div>
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
            pageSizeOptions={[15, 25, 50]}
            onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
            totalRows={totalCount}
          />
        )}
      </div>
    </>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function BranchPinPage() {
  const { t } = useTranslation();

  const initialTab: Tab = (() => {
    const url = new URL(window.location.href);
    const t = url.searchParams.get('tab');
    return t === 'usage' ? 'usage' : 'change';
  })();
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') !== tab) {
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url.toString());
    }
  }, [tab]);

  const [setPinOpen, setSetPinOpen] = useState(false);
  const [setPinDefaultBranch, setSetPinDefaultBranch] = useState<number | null>(null);

  const openSetPin = (branchId?: number) => {
    setSetPinDefaultBranch(branchId ?? null);
    setSetPinOpen(true);
  };

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const { data: elevatablePermissions = [] } = useQuery({
    queryKey: ['pin-elevatable-permissions'],
    queryFn: () => apiClient.get<ElevatablePermission[]>('/v_pin_elevatable_permissions?order=permission_code'),
    staleTime: 5 * 60 * 1000,
  });

  const permissionOptions = elevatablePermissions.map(p => ({
    value: p.permission_code,
    label: p.description?.trim() ? `${p.description} (${p.permission_code})` : p.permission_code,
  }));

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
          {t('settings.pin.title')}
        </div>
        <div className="mobile-header-end">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-primary"
            onClick={() => openSetPin()}
            aria-label={t('settings.pin.setPin')}
          >
            <KeyRound size={18} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('settings.pin.title')}</h1>
            <p className="text-sm text-subtle mt-1">{t('settings.pin.description')}</p>
          </div>
          <Button color="primary" startIcon={<KeyRound size={16} />} onClick={() => openSetPin()}>
            {t('settings.pin.setPin')}
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-line mb-4 flex-none">
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px cursor-pointer ${tab === 'change' ? 'border-primary text-primary' : 'border-transparent text-subtle hover:text-fg'}`}
            onClick={() => setTab('change')}
          >
            {t('settings.pin.tabChange')}
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px cursor-pointer ${tab === 'usage' ? 'border-primary text-primary' : 'border-transparent text-subtle hover:text-fg'}`}
            onClick={() => setTab('usage')}
          >
            {t('settings.pin.tabUsage')}
          </button>
        </div>

        {tab === 'change' ? (
          <ChangeLogTab branches={branches} onSetPin={openSetPin} />
        ) : (
          <UsageLogTab branches={branches} permissionOptions={permissionOptions} />
        )}
      </div>

      {/* Set PIN Modal */}
      <SetPinModal
        open={setPinOpen}
        onClose={() => setSetPinOpen(false)}
        branches={branches}
        defaultBranchId={setPinDefaultBranch}
      />
    </>
  );
}
