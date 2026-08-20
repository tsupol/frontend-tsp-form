import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter,
  PopOver, MenuItem, Badge, Select, MobileHeader,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { MoreHorizontal, ShieldOff, ArrowRightFromLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { SearchInput } from '../../components/SearchInput';
import { DateTime } from '../../components/DateTime';
import { LiftBlacklistModal } from '../customers/BlacklistModals';

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
  reason_code: string | null;
  lift_reason_code: string | null;
}

// ── Row Actions ──────────────────────────────────────────────────────────────

function RowActions({ entry, onLift }: {
  entry: BlacklistEntry;
  onLift: (e: BlacklistEntry) => void;
}) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);

  // Lift is COMPANY_ADMIN-only; a lifted row has nothing to act on. Either way
  // there is no menu worth opening.
  if (!can('BLACKLIST.LIFT') || !entry.is_active) return null;

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
        />
      </div>
    </PopOver>
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

  // v_blacklist now returns lifted history too, so the list needs its own
  // status filter — default to the active rows, which is what the old
  // active-only view used to return.
  const [status, setStatus] = useState<'active' | 'lifted' | ''>('active');
  const [liftEntry, setLiftEntry] = useState<BlacklistEntry | null>(null);

  const buildEndpoint = () => {
    const params: string[] = ['order=created_at.desc'];
    if (status === 'active') params.push('is_active=is.true');
    if (status === 'lifted') params.push('is_active=is.false');
    if (search.trim()) {
      params.push(`or=(customer_name.ilike.*${encodeURIComponent(search.trim())}*,national_id.ilike.*${encodeURIComponent(search.trim())}*,reason.ilike.*${encodeURIComponent(search.trim())}*)`);
    }
    return `/v_blacklist?${params.join('&')}`;
  };

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ['blacklist', pageIndex, pageSize, search, status],
    queryFn: () => apiClient.getPaginated<BlacklistEntry>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const entries = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  const statusOptions = [
    { value: 'active', label: t('settings.blacklist.statusActive') },
    { value: 'lifted', label: t('settings.blacklist.statusLifted') },
  ];

  const handleSearch = (value: string) => {
    setSearch(value);
    setPageIndex(0);
  };

  const columns: ColumnDef<BlacklistEntry>[] = [
    {
      id: 'customer',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.blacklist.customerName')} />,
      cell: ({ row }) => (
        <Link
          to={`/admin/customers/${row.original.customer_id}`}
          className="block text-primary-fg hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-sm font-medium text-primary-fg">{row.original.customer_name}</div>
          <div className="text-xs text-primary-fg tabular-nums">{row.original.national_id}</div>
        </Link>
      ),
    },
    {
      id: 'reason',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.blacklist.reason')} />,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="text-xs font-medium truncate">
            {row.original.reason_code
              ? t(`blacklist.reason.${row.original.reason_code}`, { defaultValue: row.original.reason_code })
              : row.original.reason}
          </div>
          {row.original.reason_code && row.original.reason && (
            <div className="text-[11px] text-subtle truncate">{row.original.reason}</div>
          )}
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
          {!row.original.is_active && row.original.lifted_at && (
            <div className="text-[11px] text-subtler mt-0.5">
              <DateTime value={row.original.lifted_at} showTime={false} />
            </div>
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
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('settings.blacklist.title')}</h1>
            <p className="text-sm text-subtle mt-1">{t('settings.blacklist.description')}</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex-none pb-4">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 md:max-w-56">
              <SearchInput
                value={searchInput}
                onChange={setSearchInput}
                onDebouncedChange={handleSearch}
                size="sm"
                className="w-full"
              />
            </div>
            <div className="w-36 shrink-0">
              <Select
                options={statusOptions}
                value={status || null}
                onChange={(v) => { setStatus((v as 'active' | 'lifted') ?? ''); setPageIndex(0); }}
                placeholder={t('settings.blacklist.statusAll')}
                size="sm"
                searchable={false}
                showChevron
                clearable
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
                        <Link
                          to={`/admin/customers/${entry.customer_id}`}
                          className="font-medium text-sm truncate text-primary-fg hover:underline"
                        >
                          {entry.customer_name}
                        </Link>
                        <Badge color={entry.is_active ? 'danger' : 'default'} size="sm">
                          {entry.is_active ? t('settings.blacklist.statusActive') : t('settings.blacklist.statusLifted')}
                        </Badge>
                      </div>
                      <Link
                        to={`/admin/customers/${entry.customer_id}`}
                        className="text-xs text-primary-fg hover:underline tabular-nums mt-0.5 block"
                      >
                        {entry.national_id}
                      </Link>
                      <div className="text-xs text-subtle mt-0.5">{entry.reason}</div>
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

      <LiftBlacklistModal
        open={!!liftEntry}
        onClose={() => setLiftEntry(null)}
        entry={liftEntry ? { blacklistId: liftEntry.id, customerName: liftEntry.customer_name } : null}
      />
    </>
  );
}
