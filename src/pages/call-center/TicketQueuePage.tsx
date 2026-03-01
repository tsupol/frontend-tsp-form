import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { DataTable, Badge, Input, Select } from 'tsp-form';
import { ChevronsUpDown } from 'lucide-react';
import { apiClient } from '../../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface Ticket {
  id: number;
  ticket_code: string;
  intent_type: string;
  ref_contract_id: number;
  ref_contract_code: string | null;
  ref_contract_source: string | null;
  holding_id: number | null;
  company_id: number | null;
  branch_id: number | null;
  stage: string;
  severity: number;
  status: string;
  status_label: string;
  assigned_to_user_id: number | null;
  assigned_at: string | null;
  next_attempt_after: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  created_at: string;
  updated_at: string;
  queue_flag: string;
  is_takeable: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function severityColor(severity: number): 'danger' | 'warning' | 'info' | undefined {
  if (severity >= 7) return 'danger';
  if (severity >= 4) return 'warning';
  if (severity >= 2) return 'info';
  return undefined;
}

function queueFlagColor(flag: string): 'info' | 'warning' | 'success' | undefined {
  switch (flag) {
    case 'NEW': return 'info';
    case 'IN_PROCESS': return 'warning';
    case 'WAIT_FOR_REOPEN': return 'success';
    default: return undefined;
  }
}

function relativeTime(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return '—';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function TicketQueuePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Table state
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Filters & sort
  const [filterQueueFlag, setFilterQueueFlag] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('severity.desc');

  const queueFlagOptions = [
    { value: 'NEW', label: t('callCenter.filterNew') },
    { value: 'IN_PROCESS', label: t('callCenter.filterInProcess') },
    { value: 'WAIT_FOR_REOPEN', label: t('callCenter.filterWaiting') },
    { value: 'BACKING_OFF', label: t('callCenter.filterBackingOff') },
    { value: 'CLOSED', label: t('callCenter.filterClosed') },
  ];

  const sortOptions = [
    { value: 'severity.desc', label: t('callCenter.highestSeverity') },
    { value: 'created_at.desc', label: t('callCenter.newestFirst') },
    { value: 'created_at.asc', label: t('callCenter.oldestFirst') },
  ];

  // Search debounce
  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPageIndex(0);
    }, 300);
  };

  // Build endpoint
  const buildEndpoint = useCallback(() => {
    const params: string[] = [];
    if (search.trim()) {
      params.push(`or=(ticket_code.ilike.*${encodeURIComponent(search.trim())}*,ref_contract_code.ilike.*${encodeURIComponent(search.trim())}*)`);
    }
    if (filterQueueFlag) params.push(`queue_flag=eq.${filterQueueFlag}`);
    params.push(`order=${sortBy}`);
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    return `/v_ops_call_ticket_list${qs}`;
  }, [search, filterQueueFlag, sortBy]);

  // Fetch tickets
  const { data, isError, error, isFetching } = useQuery({
    queryKey: ['ticket-queue', pageIndex, pageSize, search, filterQueueFlag, sortBy],
    queryFn: () => apiClient.getPaginated<Ticket>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const tickets = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  return (
    <div className="page-content h-dvh max-h-dvh max-w-[64rem] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-none pb-4 space-y-3">
        <h1 className="heading-2">{t('callCenter.ticketQueue')}</h1>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input
            placeholder={t('common.search')}
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            size="sm"
          />
          <div>
            <Select
              options={queueFlagOptions}
              value={filterQueueFlag || null}
              onChange={(val) => {
                setFilterQueueFlag((val as string) ?? '');
                setPageIndex(0);
              }}
              placeholder={t('callCenter.allStatuses')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          <div className="flex items-center gap-1.5 text-control-label">
            <ChevronsUpDown size={14} className="shrink-0" />
            <div className="flex-1">
              <Select
                options={sortOptions}
                value={sortBy}
                onChange={(val) => {
                  setSortBy((val as string) ?? 'severity.desc');
                  setPageIndex(0);
                }}
                size="sm"
                showChevron
              />
            </div>
          </div>
        </div>
      </div>

      {isError && (
        <div className="px-6">
          <div className="border border-line bg-surface p-6 rounded-lg text-center">
            <div className="text-danger mb-4">{error instanceof Error ? error.message : t('common.error')}</div>
          </div>
        </div>
      )}

      {!isError && (
        <DataTable<Ticket>
          data={tickets}
          renderRow={(row) => {
            const ticket = row.original;
            return (
              <div
                className="flex items-center gap-3 px-3 py-2 border-b border-line hover:bg-surface-hover transition-colors cursor-pointer"
                onClick={() => navigate(`/admin/call-center/ticket/${ticket.id}`)}
              >
                {/* Ticket code + contract */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{ticket.ticket_code}</div>
                  <div className="text-xs text-control-label truncate">
                    {ticket.ref_contract_code ?? '—'}
                    {ticket.ref_contract_source ? ` · ${ticket.ref_contract_source}` : ''}
                  </div>
                </div>

                {/* Stage + severity */}
                <div className="shrink-0 hidden sm:block">
                  <Badge size="sm" color={severityColor(ticket.severity)}>
                    {ticket.stage} ({ticket.severity})
                  </Badge>
                </div>

                {/* Queue flag */}
                <div className="shrink-0">
                  <Badge size="sm" color={queueFlagColor(ticket.queue_flag)}>
                    {ticket.queue_flag}
                  </Badge>
                </div>

                {/* Next attempt */}
                {ticket.next_attempt_after && ticket.queue_flag === 'BACKING_OFF' && (
                  <div className="shrink-0 text-xs text-control-label hidden md:block">
                    {relativeTime(ticket.next_attempt_after)}
                  </div>
                )}
              </div>
            );
          }}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[10, 25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setPageIndex(pi);
            setPageSize(ps);
          }}
          className={`flex-1 min-h-0 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-control-label">
              {t('callCenter.noTickets')}
            </div>
          }
        />
      )}
    </div>
  );
}
