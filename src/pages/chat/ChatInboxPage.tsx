import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader,
  Badge, Input, Switch,
  type ColumnDef, type RowExpansionState, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Image as ImageIcon } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { formatSmart } from '../../lib/format';
import type { ChatInboxRow } from './chatTypes';

export function ChatInboxPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => { setPageIndex(0); }, [search, unreadOnly]);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value), 300);
  };

  const queryUrl = useMemo(() => {
    const params: string[] = ['order=last_message_at.desc.nullslast'];
    if (unreadOnly) params.push('unread_count=gt.0');
    if (search.trim()) {
      const q = encodeURIComponent(search.trim());
      // Match customer name OR contract code
      params.push(`or=(customer_name.ilike.*${q}*,contract_code.ilike.*${q}*)`);
    }
    return `/v_branch_chat_list?${params.join('&')}`;
  }, [search, unreadOnly]);

  const { data, isFetching } = useQuery({
    queryKey: ['chat-inbox', search, unreadOnly, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<ChatInboxRow>(
      queryUrl,
      { page: pageIndex + 1, pageSize },
    ),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  const openThread = (row: ChatInboxRow) => navigate(`/admin/chat/${row.contract_id}`);

  const renderPreview = (row: ChatInboxRow) => {
    if (row.last_message_type === 'IMAGE') {
      return (
        <span className="inline-flex items-center gap-1 text-subtle">
          <ImageIcon size={12} /> {t('chat.imageMessage')}
        </span>
      );
    }
    return <span className="truncate">{row.last_message_text ?? ''}</span>;
  };

  const columns: ColumnDef<ChatInboxRow>[] = useMemo(() => [
    {
      accessorKey: 'customer_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('chat.customer')} />,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{row.original.customer_name ?? '—'}</div>
          <div className="text-xs text-subtle truncate">{row.original.contract_code_display}</div>
        </div>
      ),
      className: 'w-[28%] min-w-48',
    },
    {
      accessorKey: 'last_message_text',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('chat.title')} />,
      cell: ({ row }) => (
        <div className="text-sm text-subtle truncate min-w-0">
          {renderPreview(row.original)}
        </div>
      ),
    },
    {
      accessorKey: 'last_message_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title="" />,
      cell: ({ row }) => (
        <div className="flex flex-col items-end gap-1 text-xs text-subtle">
          <span className="tabular-nums">{formatSmart(row.original.last_message_at, i18n.language)}</span>
          {row.original.unread_count > 0 && (
            <Badge size="sm" color="primary">{row.original.unread_count}</Badge>
          )}
        </div>
      ),
      className: 'w-32',
    },
  ], [t, i18n.language]);

  const handleRowExpansion = (
    updater: RowExpansionState | ((prev: RowExpansionState) => RowExpansionState),
  ) => {
    const next = typeof updater === 'function' ? updater({}) : updater;
    const clickedId = Object.keys(next).find(k => next[k]);
    if (clickedId) {
      const row = rows[Number(clickedId)];
      if (row) openThread(row);
    }
  };

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
        <div className="mobile-header-title">{t('chat.title')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('chat.title')}</h1>
        </div>

        <div className="flex items-center gap-3 pb-4 flex-none">
          <div className="flex-1 min-w-0 max-w-[20rem]">
            <Input
              size="sm"
              className="w-full"
              placeholder={t('chat.searchPlaceholder')}
              value={searchInput}
              onChange={e => handleSearch(e.target.value)}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm shrink-0 cursor-pointer">
            <Switch size="sm" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />
            <span>{t('chat.unreadOnly')}</span>
          </label>
        </div>

        <DataTable<ChatInboxRow>
          data={rows}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          expandOnRowClick
          getRowCanExpand={() => true}
          renderExpandedRow={() => null}
          rowExpansion={{}}
          onRowExpansionChange={handleRowExpansion}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[15, 25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
          tableClassName="[&_tbody_tr]:cursor-pointer"
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={<div className="p-8 text-center text-subtle">{t('chat.empty')}</div>}
        />

        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-subtle">{t('chat.empty')}</div>
            ) : (
              <div className="flex flex-col divide-y divide-line border-b border-line">
                {rows.map(row => (
                  <button
                    key={row.contract_id}
                    type="button"
                    className="px-1 py-3 text-left cursor-pointer active:bg-surface-hover bg-transparent border-none w-full"
                    onClick={() => openThread(row)}
                  >
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="text-sm font-medium truncate min-w-0">{row.customer_name ?? '—'}</div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[11px] text-subtle tabular-nums">
                          {formatSmart(row.last_message_at, i18n.language)}
                        </span>
                        {row.unread_count > 0 && (
                          <Badge size="sm" color="primary">{row.unread_count}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-subtle truncate">{row.contract_code_display}</div>
                    <div className="text-sm text-subtle truncate mt-0.5">
                      {renderPreview(row)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {totalCount > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(totalCount / pageSize)}
              onPageChange={p => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[15, 25, 50]}
              onPageSizeChange={ps => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
      </div>
    </>
  );
}
