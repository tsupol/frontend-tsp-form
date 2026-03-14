import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, DataTable, Badge, Input, Select, Button, Tooltip, useSnackbarContext } from 'tsp-form';
import {
  ArrowRightFromLine,
  XCircle,
  SlidersHorizontal,
  CheckCircle,
  PhoneOff,
  PhoneCall,
  Phone,
  Undo2,
  MessageSquarePlus,
  UserPlus,
  StickyNote,
  Zap,
  Clock,
  CirclePlus,
  GitBranchPlus,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';

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

interface TicketDetail {
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
  assigned_to_user_id: number | null;
  assigned_at: string | null;
  next_attempt_after: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface TicketEvent {
  id: number;
  ticket_id: number;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  old_stage: string | null;
  new_stage: string | null;
  actor_user_id: number | null;
  note: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

interface TicketGetResponse {
  ticket: TicketDetail;
  events: TicketEvent[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function severityColor(severity: number): 'danger' | 'warning' | 'info' | undefined {
  if (severity >= 7) return 'danger';
  if (severity >= 4) return 'warning';
  if (severity >= 2) return 'info';
  return undefined;
}

const QUEUE_FLAG_KEYS: Record<string, string> = {
  NEW: 'callCenter.filterNew',
  IN_PROCESS: 'callCenter.filterInProcess',
  WAIT_FOR_REOPEN: 'callCenter.filterWaiting',
  BACKING_OFF: 'callCenter.filterBackingOff',
  CLOSED: 'callCenter.filterClosed',
};

const STAGE_KEYS: Record<string, string> = {
  NONE: 'callCenter.stageNone',
  CALL_DUE_IN_3: 'callCenter.stageDueIn3',
  CALL_OVERDUE_1: 'callCenter.stageOverdue1',
  CALL_OVERDUE_8: 'callCenter.stageOverdue8',
  CALL_OVERDUE_16: 'callCenter.stageOverdue16',
  CALL_OVERDUE_31: 'callCenter.stageOverdue31',
};

const STATUS_LABELS: Record<string, string> = {
  QUEUED: 'Queued',
  IN_PROGRESS: 'In Progress',
  CALL_NO_ANSWER: 'No Answer',
  CALL_UNREACHABLE: 'Unreachable',
  CLOSED_CALL_SUCCESS: 'Call Success',
  CLOSED_RESOLVED_BY_PAYMENT: 'Resolved by Payment',
  CLOSED_SUPERSEDED: 'Superseded',
  CLOSED_CANCELED_OR_CLOSED: 'Canceled / Closed',
};

const OPEN_STATUSES = ['QUEUED', 'IN_PROGRESS', 'CALL_NO_ANSWER', 'CALL_UNREACHABLE'];

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function statusColor(status: string): 'info' | 'warning' | 'success' | 'danger' | undefined {
  if (status === 'QUEUED') return 'info';
  if (status === 'IN_PROGRESS') return 'warning';
  if (status === 'CLOSED_CALL_SUCCESS') return 'success';
  if (status.startsWith('CLOSED_')) return undefined;
  if (status === 'CALL_NO_ANSWER' || status === 'CALL_UNREACHABLE') return 'danger';
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

function eventIcon(eventType: string) {
  switch (eventType) {
    case 'CREATED': return <CirclePlus size={16} className="text-subtle" />;
    case 'TAKEN': return <UserPlus size={16} className="text-info" />;
    case 'TAKEN_OVER': return <UserPlus size={16} className="text-warning" />;
    case 'RESULT_SET': return <PhoneCall size={16} className="text-success" />;
    case 'NOTE_ADDED': return <StickyNote size={16} className="text-subtle" />;
    case 'REVERTED': return <Undo2 size={16} className="text-warning" />;
    case 'AUTO_CLOSED': return <Zap size={16} className="text-subtle" />;
    case 'STAGE_CHANGED': return <GitBranchPlus size={16} className="text-info" />;
    default: return <Clock size={16} className="text-subtle" />;
  }
}

// ── Detail Content ───────────────────────────────────────────────────────────

function TicketDetailContent({
  ticketId,
  isMobile,
}: {
  ticketId: number;
  isMobile: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();

  const [actionPending, setActionPending] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [noteText, setNoteText] = useState('');
  const [revertNote, setRevertNote] = useState('');

  // Reset state when ticket changes
  useEffect(() => {
    setActionPending(null);
    setErrorMessage('');
    setNoteText('');
    setRevertNote('');
  }, [ticketId]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => apiClient.rpc<TicketGetResponse>('ops_call_ticket_get', { p_ticket_id: ticketId }),
  });

  const ticket = data?.ticket;
  const events = data?.events ?? [];

  // ── Action helpers ─────────────────────────────────────────────────────────

  const runAction = async (action: string, fn: () => Promise<unknown>) => {
    setActionPending(action);
    setErrorMessage('');
    const start = Date.now();
    try {
      await fn();
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['ticket-queue'] });
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setActionPending(null);
    }
  };

  const handleTake = () => runAction('take', async () => {
    await apiClient.rpc('ops_call_ticket_take', { p_ticket_id: ticketId });
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <div><div className="alert-title">{t('callCenter.takeSuccess')}</div></div>
        </div>
      ),
      type: 'success',
      duration: 3000,
    });
  });

  const handleSetResult = (result: string) => runAction('result', async () => {
    await apiClient.rpc('ops_call_ticket_set_result', { p_ticket_id: ticketId, p_result: result, p_note: null });
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <div><div className="alert-title">{t('callCenter.resultSuccess')}</div></div>
        </div>
      ),
      type: 'success',
      duration: 3000,
    });
  });

  const handleRevert = () => runAction('revert', async () => {
    await apiClient.rpc('ops_call_ticket_revert_result', { p_ticket_id: ticketId, p_note: revertNote || null });
    setRevertNote('');
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <div><div className="alert-title">{t('callCenter.revertSuccess')}</div></div>
        </div>
      ),
      type: 'success',
      duration: 3000,
    });
  });

  const handleAddNote = () => runAction('note', async () => {
    await apiClient.rpc('ops_call_ticket_add_note', { p_ticket_id: ticketId, p_note: noteText.trim() });
    setNoteText('');
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <div><div className="alert-title">{t('callCenter.noteSuccess')}</div></div>
        </div>
      ),
      type: 'success',
      duration: 3000,
    });
  });

  // ── Computed state ─────────────────────────────────────────────────────────

  const isAssignedToMe = ticket?.assigned_to_user_id === user?.user_id;
  const canTake = ticket && (
    ticket.status === 'QUEUED' ||
    (
      (ticket.status === 'CALL_NO_ANSWER' || ticket.status === 'CALL_UNREACHABLE') &&
      (!ticket.next_attempt_after || new Date(ticket.next_attempt_after) <= new Date())
    )
  );
  const canSetResult = ticket?.status === 'IN_PROGRESS' && isAssignedToMe;
  const canRevert = ticket && ['CALL_NO_ANSWER', 'CALL_UNREACHABLE', 'CLOSED_CALL_SUCCESS'].includes(ticket.status);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return <div className="p-4 text-subtle">{t('common.loading')}</div>;
  }

  if (isError || !ticket) {
    return (
      <div className="p-4">
        <div className="alert alert-danger">
          <XCircle size={18} />
          <div><div className="alert-description">{error instanceof Error ? error.message : t('common.error')}</div></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Desktop detail header */}
      {!isMobile && (
        <div className="flex-none flex items-center gap-2 h-panel-header-h px-4 border-b border-line">
          <span className="font-semibold truncate">{ticket.ticket_code}</span>
          <Badge size="sm" color={statusColor(ticket.status)}>{statusLabel(ticket.status)}</Badge>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto better-scroll">
        {/* Error alert */}
        {errorMessage && (
          <div key={errorKey} className="px-4 py-3 border-b border-line">
            <div className="alert alert-danger animate-pop-in">
              <XCircle size={18} />
              <div><div className="alert-description">{errorMessage}</div></div>
            </div>
          </div>
        )}

        {/* Info section */}
        <div className="bg-surface border-b border-line px-4 py-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.ticketCode')}</div>
              <div className="font-medium">{ticket.ticket_code}</div>
            </div>
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.contractCode')}</div>
              <div className="font-medium">{ticket.ref_contract_code ?? '—'}</div>
            </div>
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.contractSource')}</div>
              <div>{ticket.ref_contract_source ?? '—'}</div>
            </div>
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.status')}</div>
              <Badge size="sm" color={statusColor(ticket.status)}>{statusLabel(ticket.status)}</Badge>
            </div>
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.stage')}</div>
              <div className="flex items-center gap-1.5">
                <Badge size="sm">{STAGE_KEYS[ticket.stage] ? t(STAGE_KEYS[ticket.stage]) : ticket.stage}</Badge>
                <Tooltip content={t('callCenter.severity')}>
                  <Badge size="sm" color={severityColor(ticket.severity)}>
                    {ticket.severity}
                  </Badge>
                </Tooltip>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.assignedTo')}</div>
              <div>{ticket.assigned_to_user_id ? `#${ticket.assigned_to_user_id}` : '—'}</div>
            </div>
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.assignedAt')}</div>
              <DateTime value={ticket.assigned_at} />
            </div>
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.createdAt')}</div>
              <DateTime value={ticket.created_at} />
            </div>
            {ticket.closed_at && (
              <div>
                <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.closedAt')}</div>
                <DateTime value={ticket.closed_at} />
              </div>
            )}
            {ticket.closed_reason && (
              <div className="col-span-2">
                <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.closedReason')}</div>
                <div>{ticket.closed_reason}</div>
              </div>
            )}
            {ticket.next_attempt_after && OPEN_STATUSES.includes(ticket.status) && (
              <div>
                <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.nextAttempt')}</div>
                <DateTime value={ticket.next_attempt_after} />
              </div>
            )}
          </div>
        </div>

        {/* Take / Set Result / Revert */}
        {OPEN_STATUSES.includes(ticket.status) && (
          <>
            {/* Take */}
            {canTake && (
              <div className="px-4 py-4 border-b border-line">
                <Button
                  color="primary"
                  disabled={!!actionPending}
                  onClick={handleTake}
                  startIcon={<Phone size={16} />}
                >
                  {actionPending === 'take' ? t('callCenter.taking') : t('callCenter.take')}
                </Button>
              </div>
            )}

            {/* Set Result */}
            {canSetResult && (
              <div className="px-4 py-4 border-b border-line space-y-2">
                <div className="text-sm font-medium">{t('callCenter.setResult')}</div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    color="success"
                    disabled={!!actionPending}
                    onClick={() => handleSetResult('CALL_SUCCESS')}
                    startIcon={<PhoneCall size={16} />}
                  >
                    {t('callCenter.callSuccess')}
                  </Button>
                  <Button
                    color="warning"
                    disabled={!!actionPending}
                    onClick={() => handleSetResult('CALL_NO_ANSWER')}
                    startIcon={<PhoneOff size={16} />}
                  >
                    {t('callCenter.callNoAnswer')}
                  </Button>
                  <Button
                    color="danger"
                    disabled={!!actionPending}
                    onClick={() => handleSetResult('CALL_UNREACHABLE')}
                    startIcon={<PhoneOff size={16} />}
                  >
                    {t('callCenter.callUnreachable')}
                  </Button>
                </div>
              </div>
            )}

            {/* Revert */}
            {canRevert && (
              <div className="px-4 py-4 border-b border-line space-y-2">
                <div className="text-sm font-medium">{t('callCenter.revert')}</div>
                <div className="input-group">
                  <Input
                    placeholder={t('callCenter.revertNote')}
                    value={revertNote}
                    onChange={(e) => setRevertNote(e.target.value)}
                  />
                  <Button
                    color="warning"
                    disabled={!!actionPending}
                    onClick={handleRevert}
                    startIcon={<Undo2 size={16} />}
                  >
                    {actionPending === 'revert' ? t('callCenter.reverting') : t('callCenter.revert')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Add Note */}
        <div className="px-4 py-4 border-b border-line">
          <div className="input-group">
            <Input
              className="flex-1"
              placeholder={t('callCenter.notePlaceholder')}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <Button
              color="primary"
              disabled={!!actionPending || !noteText.trim()}
              onClick={handleAddNote}
              startIcon={<MessageSquarePlus size={16} />}
            >
              {t('callCenter.addNote')}
            </Button>
          </div>
        </div>

        {/* Timeline */}
        <div className="px-4 py-4">
          <h2 className="text-sm font-semibold pb-3">{t('callCenter.timeline')}</h2>
          {events.length === 0 ? (
            <div className="text-sm text-subtler">{t('common.noData')}</div>
          ) : (
            <div className="divide-y divide-line">
              {events.map((evt) => (
                <div key={evt.id} className="flex gap-3 py-3">
                  <div className="shrink-0 pt-0.5">{eventIcon(evt.event_type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{evt.event_type}</span>
                      {evt.new_status && (
                        <Badge size="sm" color={statusColor(evt.new_status)}>
                          {evt.new_status}
                        </Badge>
                      )}
                      {evt.actor_user_id && (
                        <span className="text-xs text-subtle">#{evt.actor_user_id}</span>
                      )}
                    </div>
                    {evt.note && (
                      <div className="text-sm text-subtle mt-1">{evt.note}</div>
                    )}
                    <div className="text-xs text-subtle mt-1">
                      <DateTime value={evt.created_at} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function TicketQueuePage() {
  const { t } = useTranslation();

  // Table state
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Filters & sort
  const [filterQueueFlag, setFilterQueueFlag] = useState<string>('READY_TO_CALL');
  const [sortBy, setSortBy] = useState<string>('severity.desc');
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Selection
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);

  const queueFlagOptions = [
    { value: 'READY_TO_CALL', label: t('callCenter.filterReadyToCall') },
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
    { value: 'updated_at.desc', label: t('callCenter.recentlyUpdated') },
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
    if (filterQueueFlag === 'READY_TO_CALL') {
      params.push('is_takeable=is.true');
    } else if (filterQueueFlag) {
      params.push(`queue_flag=eq.${filterQueueFlag}`);
    }
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

  // Find selected ticket code for mobile header
  const selectedTicket = selectedTicketId ? tickets.find(t => t.id === selectedTicketId) : null;

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, Header }) => (
        <>
          {isMobile && (
            <Header
              title={isRoot ? t('callCenter.ticketQueue') : (selectedTicket?.ticket_code ?? t('callCenter.ticketDetail'))}
              startContent={
                isRoot ? (
                  <button
                    className="flex items-center justify-center w-12 h-12 cursor-pointer hover:bg-surface-hover transition-colors"
                    onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                  >
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : undefined
              }
            />
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('callCenter.ticketQueue')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* ── Left Panel: Ticket Queue ── */}
            <PageNavPanel id="list" className="w-1/2 xl:w-5/12 border-r border-line flex flex-col" mobileClassName="flex flex-col overflow-hidden">
              <div className="flex-none flex flex-col gap-2 px-4 py-2 border-b border-line">
                {/* Row 1: Search + Status + Expand */}
                <div className="flex gap-2 w-full">
                  <div className="flex-[2] min-w-0">
                    <Input
                      className="w-full"
                      placeholder={t('common.search')}
                      value={searchInput}
                      onChange={(e) => handleSearch(e.target.value)}
                      size="sm"
                    />
                  </div>
                  <div className="flex-[2] min-w-0">
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`btn-icon-sm shrink-0 ${filtersExpanded ? 'text-primary' : ''}`}
                    startIcon={<SlidersHorizontal size={14} />}
                    onClick={() => setFiltersExpanded(!filtersExpanded)}
                  />
                </div>
                {/* Row 2: Sort (expanded) */}
                {filtersExpanded && (
                  <div className="flex gap-2 w-full">
                    <div className="min-w-0" style={{ width: '14rem' }}>
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
                )}
              </div>

              {isError && (
                <div className="flex-none p-4">
                  <div className="alert alert-danger">
                    <XCircle size={18} />
                    <div><div className="alert-description">{error instanceof Error ? error.message : t('common.error')}</div></div>
                  </div>
                </div>
              )}

              {!isError && (
                <DataTable<Ticket>
                  data={tickets}
                  renderRow={(row) => {
                    const ticket = row.original;
                    const isSelected = selectedTicketId === ticket.id;
                    return (
                      <div
                        className={`flex items-center gap-3 px-3 py-2 border-b border-line transition-colors cursor-pointer ${
                          isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                        }`}
                        onClick={() => {
                          setSelectedTicketId(ticket.id);
                          if (isMobile) goTo('detail');
                        }}
                      >
                        {/* Ticket code + contract */}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{ticket.ticket_code}</div>
                          <div className="text-xs text-subtle truncate">
                            {ticket.ref_contract_code ?? '—'}
                            {ticket.ref_contract_source ? ` · ${ticket.ref_contract_source}` : ''}
                          </div>
                        </div>

                        {/* Stage + severity */}
                        <div className="shrink-0 hidden sm:flex items-center gap-1.5">
                          <Badge size="sm">{STAGE_KEYS[ticket.stage] ? t(STAGE_KEYS[ticket.stage]) : ticket.stage}</Badge>
                          <Tooltip content={t('callCenter.severity')}>
                            <Badge size="sm" color={severityColor(ticket.severity)}>
                              {ticket.severity}
                            </Badge>
                          </Tooltip>
                        </div>

                        {/* Queue flag */}
                        <div className="shrink-0">
                          <Badge size="sm" color={queueFlagColor(ticket.queue_flag)}>
                            {QUEUE_FLAG_KEYS[ticket.queue_flag] ? t(QUEUE_FLAG_KEYS[ticket.queue_flag]) : ticket.queue_flag}
                          </Badge>
                        </div>

                        {/* Next attempt */}
                        {ticket.next_attempt_after && ticket.queue_flag === 'BACKING_OFF' && (
                          <div className="shrink-0 text-xs text-subtle hidden md:block">
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
                  className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                  noResults={
                    <div className="p-8 text-center text-subtler">
                      {t('callCenter.noTickets')}
                    </div>
                  }
                />
              )}
            </PageNavPanel>

            {/* ── Right Panel: Ticket Detail ── */}
            <PageNavPanel id="detail" className="flex-1 overflow-y-auto better-scroll">
              {selectedTicketId ? (
                <TicketDetailContent ticketId={selectedTicketId} isMobile={isMobile} />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  {t('callCenter.noSelection')}
                </div>
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}
