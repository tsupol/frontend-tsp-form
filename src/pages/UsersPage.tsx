import { useState, useCallback, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { DataTable, DataTableColumnHeader, Skeleton, Button, Pagination, Input, Select, PopOver, MenuItem, MenuSeparator, Badge, createSelectColumn } from 'tsp-form';
import { type ColumnDef, type RowSelectionState } from '@tanstack/react-table';
import { Plus, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, KeyRound, Trash2, Ban, UserX } from 'lucide-react';
import { apiClient } from '../lib/api';

interface VUser {
  id: number;
  username: string;
  role_code: string;
  role_scope: string;
  holding_id: number | null;
  holding_code: string | null;
  holding_name: string | null;
  company_id: number | null;
  company_code: string | null;
  company_name: string | null;
  branch_id: number | null;
  branch_code: string | null;
  branch_name: string | null;
  is_active: boolean;
  must_change_password: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10' },
  { value: '25', label: '25' },
  { value: '50', label: '50' },
];

// Row actions menu
function RowActions({ user }: { user: VUser }) {
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
          onClick={(e: MouseEvent) => { e.stopPropagation(); setOpen(!open); }}
        >
          <MoreHorizontal size={16} className="opacity-50" />
        </button>
      }
    >
      <div className="py-1 min-w-[160px]">
        <MenuItem
          icon={<Pencil size={14} />}
          label={t('common.edit')}
          onClick={() => setOpen(false)}
        />
        <MenuItem
          icon={<KeyRound size={14} />}
          label={t('users.resetPassword')}
          onClick={() => setOpen(false)}
        />
        <MenuSeparator />
        <MenuItem
          icon={user.is_active ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
          label={user.is_active ? t('users.deactivate') : t('users.activate')}
          onClick={() => setOpen(false)}
        />
        <MenuItem
          icon={<Trash2 size={14} />}
          label={t('common.delete')}
          onClick={() => setOpen(false)}
          danger
        />
      </div>
    </PopOver>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const buildEndpoint = useCallback(() => {
    const params: string[] = [];
    if (search.trim()) {
      params.push(`username=ilike.*${encodeURIComponent(search.trim())}*`);
    }
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    return `/v_users${qs}`;
  }, [search]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['users', page, pageSize, search],
    queryFn: () => apiClient.getPaginated<VUser>(buildEndpoint(), { page, pageSize }),
    placeholderData: keepPreviousData,
  });

  const users = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);
  const selectedCount = Object.keys(rowSelection).length;

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
    setRowSelection({});
  };

  const handlePageSizeChange = (value: string | string[] | null) => {
    if (value && typeof value === 'string') {
      setPageSize(Number(value));
      setPage(1);
      setRowSelection({});
    }
  };

  const columns: ColumnDef<VUser, any>[] = [
    createSelectColumn<VUser>(),
    {
      accessorKey: 'username',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.username')} />,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.getValue('username')}</div>
          <div className="text-xs opacity-50 capitalize">{row.original.role_code}</div>
        </div>
      ),
    },
    {
      accessorKey: 'role_scope',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.scope')} />,
      cell: ({ row }) => (
        <Badge size="sm" className="capitalize">
          {row.getValue('role_scope')}
        </Badge>
      ),
    },
    {
      accessorKey: 'company_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.company')} />,
      cell: ({ row }) => {
        const company = row.getValue('company_name') as string | null;
        const branch = row.original.branch_name;
        if (!company) return <span className="opacity-30">—</span>;
        return (
          <div>
            <div>{company}</div>
            {branch && <div className="text-xs opacity-50">{branch}</div>}
          </div>
        );
      },
    },
    {
      accessorKey: 'is_active',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.status')} />,
      cell: ({ row }) => {
        const active = row.getValue('is_active') as boolean;
        return (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${active ? 'text-success' : 'text-danger'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-success' : 'bg-danger'}`} />
            {active ? t('users.active') : t('users.inactive')}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => <RowActions user={row.original} />,
      enableSorting: false,
    },
  ];

  return (
    <div className="page-content flex flex-col h-full" style={{ maxWidth: '64rem' }}>
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-bg px-6 pt-6 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">{t('users.title')}</h1>
          <Button color="primary" size="sm" onClick={() => {}}>
            <Plus size={16} />
            {t('common.create')}
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Input
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            size="sm"
            style={{ maxWidth: '16rem' }}
          />
          {selectedCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-control-label">
                {t('users.selectedCount', { count: selectedCount })}
              </span>
              <Button variant="outline" size="sm" onClick={() => {}}>
                <Ban size={14} />
                {t('users.deactivate')}
              </Button>
              <Button variant="outline" size="sm" color="danger" onClick={() => {}}>
                <UserX size={14} />
                {t('common.delete')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRowSelection({})}>
                {t('users.clearSelection')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 pb-6">
        {isLoading && (
          <div className="border border-line bg-surface rounded-lg divide-y divide-line">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <Skeleton variant="text" width="30%" height={16} />
                <Skeleton variant="text" width="20%" height={16} />
              </div>
            ))}
          </div>
        )}

        {isError && !isLoading && (
          <div className="border border-line bg-surface p-6 rounded-lg text-center">
            <div className="text-danger mb-4">{error instanceof Error ? error.message : t('common.error')}</div>
          </div>
        )}

        {!isLoading && !isError && (
          <>
            <DataTable
              data={users}
              columns={columns}
              enableSorting
              enableRowSelection
              rowSelection={rowSelection}
              onRowSelectionChange={setRowSelection}
              className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}
              noResults={
                <div className="p-8 text-center text-control-label">
                  {t('users.empty')}
                </div>
              }
            />
            <div className="flex items-center justify-between pt-4">
              <div className="text-xs text-control-label">
                {totalCount > 0
                  ? t('users.rowInfo', {
                      from: (page - 1) * pageSize + 1,
                      to: Math.min(page * pageSize, totalCount),
                      total: totalCount,
                    })
                  : null}
              </div>
              <div className="flex items-center gap-2 text-xs text-control-label">
                <span>{t('users.rowsPerPage')}</span>
                <Select
                  options={PAGE_SIZE_OPTIONS}
                  value={String(pageSize)}
                  onChange={handlePageSizeChange}
                  size="xs"
                  searchable={false}
                  showChevron
                />
              </div>
              {totalPages > 1 && (
                <Pagination
                  currentPage={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  size="sm"
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
