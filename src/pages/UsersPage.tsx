import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { DataTable, DataTableColumnHeader, Skeleton, Button, Pagination, Input } from 'tsp-form';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
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

const PAGE_SIZE = 15;

export function UsersPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  // Build PostgREST query string with filters
  const buildEndpoint = () => {
    const params: string[] = [];
    if (search.trim()) {
      params.push(`username=ilike.*${encodeURIComponent(search.trim())}*`);
    }
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    return `/v_users${qs}`;
  };

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['users', page, search],
    queryFn: () => apiClient.getPaginated<VUser>(buildEndpoint(), { page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const users = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1); // reset to first page on filter change
  };

  const columns: ColumnDef<VUser, any>[] = [
    {
      accessorKey: 'username',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.username')} />,
      cell: ({ row }) => <span className="font-medium">{row.getValue('username')}</span>,
    },
    {
      accessorKey: 'role_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.role')} />,
      cell: ({ row }) => <span className="capitalize">{row.getValue('role_code')}</span>,
    },
    {
      accessorKey: 'role_scope',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.scope')} />,
      cell: ({ row }) => <span className="capitalize">{row.getValue('role_scope')}</span>,
    },
    {
      accessorKey: 'company_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.company')} />,
      cell: ({ row }) => row.getValue('company_name') || '—',
    },
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.branch')} />,
      cell: ({ row }) => row.getValue('branch_name') || '—',
    },
    {
      accessorKey: 'is_active',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.status')} />,
      cell: ({ row }) => {
        const active = row.getValue('is_active') as boolean;
        return (
          <span className={`inline-flex items-center gap-1.5 ${active ? 'text-success' : 'text-danger'}`}>
            <span className={`w-2 h-2 rounded-full ${active ? 'bg-success' : 'bg-danger'}`} />
            {active ? t('users.active') : t('users.inactive')}
          </span>
        );
      },
    },
  ];

  return (
    <div className="page-content flex flex-col h-full" style={{ maxWidth: '64rem' }}>
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-bg px-6 pt-6 pb-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">{t('users.title')}</h1>
          <Button color="primary" size="sm" onClick={() => {}}>
            <Plus size={16} />
            {t('common.create')}
          </Button>
        </div>
        <Input
          placeholder={t('common.search')}
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          size="sm"
          style={{ maxWidth: '16rem' }}
        />
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
              className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}
              noResults={
                <div className="p-8 text-center text-control-label">
                  {t('users.empty')}
                </div>
              }
            />
            {totalPages > 1 && (
              <div className="flex justify-center pt-4">
                <Pagination
                  currentPage={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
