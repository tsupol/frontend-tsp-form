import { useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader,
  Input,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Pencil } from 'lucide-react';
import { apiClient } from '../../lib/api';
import type { CompanyConfig } from './companyConfigTypes';

// ── Main Page ────────────────────────────────────────────────────────────────

export function CompanyConfigPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { data: configs = [], isFetching, isLoading } = useQuery({
    queryKey: ['company-config-list'],
    queryFn: () => apiClient.get<CompanyConfig[]>('/v_company_config?order=company_name'),
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return configs;
    const term = search.trim().toLowerCase();
    return configs.filter(c => c.company_name.toLowerCase().includes(term));
  }, [configs, search]);

  const totalCount = filtered.length;
  const paginatedConfigs = filtered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPageIndex(0);
    }, 300);
  };

  const handleRowClick = (config: CompanyConfig) => {
    navigate(`/admin/company/config/${config.company_id}`);
  };

  const columns: ColumnDef<CompanyConfig>[] = [
    {
      accessorKey: 'company_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.config.companyName')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.company_name}</span>,
      className: 'w-[35%] min-w-40',
    },
    {
      id: 'expiry',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.config.colExpiry')} />,
      cell: ({ row }) => (
        <span className="tabular-nums text-sm">
          {t('settings.config.grace')} {row.original.grace_period_days}d · {t('settings.config.draft')} {row.original.draft_expiry_days}d
        </span>
      ),
      className: 'w-[25%] min-w-44',
    },
    {
      id: 'late_fee',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.config.colLateFee')} />,
      cell: ({ row }) => (
        <span className="tabular-nums text-sm">
          ฿{(row.original.late_fee_per_day ?? 0).toLocaleString()} ({row.original.late_fee_split_holding ?? 0}/{row.original.late_fee_split_company ?? 0})
        </span>
      ),
      className: 'w-[22%] min-w-36',
    },
    {
      id: 'pause',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.config.colPause')} />,
      cell: ({ row }) => row.original.pause_enabled
        ? <span className="tabular-nums text-sm">{t('settings.config.maxDeferred')} {row.original.pause_max_deferred}</span>
        : <span className="text-sm text-fg/40">{t('common.disabled')}</span>,
      className: 'w-[15%] min-w-28',
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <button
          className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); navigate(`/admin/company/config/${row.original.company_id}`); }}
          aria-label={t('common.edit')}
        >
          <Pencil size={14} className="opacity-50" />
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
          {t('settings.config.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('settings.config.title')}</h1>
            <p className="text-sm text-fg/60 mt-1">{t('settings.config.description')}</p>
          </div>
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
        <DataTable<CompanyConfig>
          data={paginatedConfigs}
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
              {isLoading ? t('common.loading') : t('settings.config.empty')}
            </div>
          }
        />

        {/* Mobile: Card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-control-label">
                {isLoading ? t('common.loading') : t('settings.config.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {paginatedConfigs.map((config) => (
                  <div
                    key={config.company_id}
                    className="px-4 py-3 cursor-pointer active:bg-surface-hover"
                    onClick={() => handleRowClick(config)}
                  >
                    <div className="font-medium text-sm">{config.company_name}</div>
                    <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
                      <div>
                        <div className="text-[10px] text-control-label">{t('settings.config.gracePeriodDays')}</div>
                        <div className="tabular-nums font-medium">{config.grace_period_days}d</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-control-label">{t('settings.config.lateFeePerDay')}</div>
                        <div className="tabular-nums font-medium">฿{config.late_fee_per_day}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-control-label">{t('settings.config.lateFeeSplit')}</div>
                        <div className="tabular-nums font-medium">{config.late_fee_split_holding}/{config.late_fee_split_company}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-1 text-sm">
                      <div>
                        <div className="text-[10px] text-control-label">{t('settings.config.draftExpiryDays')}</div>
                        <div className="tabular-nums font-medium">{config.draft_expiry_days}d</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-control-label">{t('settings.config.colPause')}</div>
                        <div className="tabular-nums font-medium">{config.pause_enabled ? config.pause_max_deferred : <span className="text-fg/40">{t('common.disabled')}</span>}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-control-label">{t('settings.config.commMinActiveDays')}</div>
                        <div className="tabular-nums font-medium">{config.comm_min_active_days}d</div>
                      </div>
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
              pageSizeOptions={[25, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
      </div>
    </>
  );
}
