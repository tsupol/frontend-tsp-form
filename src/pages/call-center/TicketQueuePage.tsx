import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, DataTable, Badge, Input, Select, Button, TextArea, Tooltip, LabeledCheckbox, useSnackbarContext } from 'tsp-form';
import {
  ArrowLeft,
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
  User,
  Snowflake,
  CalendarClock,
  CalendarOff,
  AlertTriangle,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { wsClient } from '../../lib/api/ws';

// ── Types ────────────────────────────────────────────────────────────────────

type CallTicketStatus =
  | 'QUEUED'
  | 'IN_PROGRESS'
  | 'CALL_NO_ANSWER'
  | 'CALL_UNREACHABLE'
  | 'CALL_SUCCESS'
  | 'CLOSED_RESOLVED_BY_PAYMENT'
  | 'CLOSED_CALL_SUCCESS'
  | 'CLOSED_CANCELED_OR_CLOSED'
  | 'CLOSED_SUPERSEDED'
  | 'CLOSED_REPOSSESSION_SUCCESS';

interface Ticket {
  id: number;
  ticket_code: string | null;
  code_display: string | null;
  intent_type: 'OVERDUE_COLLECTION' | 'PAYMENT_REMINDER' | string;
  ref_contract_id: number;
  ref_contract_code: string;
  holding_id: number | null;
  company_id: number | null;
  branch_id: number | null;
  ref_branch_id: number | null;
  current_bucket_code: string | null;
  next_due_date: string | null;
  next_due_amount: number | null;
  next_due_outstanding: number | null;
  first_overdue_due_date: string | null;
  overdue_amount: number;
  overdue_installment_count: number;
  overdue_streak_count: number;
  overdue_streak_start_due_date: string | null;
  overdue_streak_latest_due_date: string | null;
  overdue_streak_amount: number;
  status: CallTicketStatus;
  assigned_to_user_id: number | null;
  is_mine: boolean;
  assigned_at: string | null;
  next_attempt_after: string | null;
  is_cooling_down: boolean;
  cooldown_remaining: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  created_at: string;
  updated_at: string;
  queue_flag: string;
  is_takeable: boolean;
  // mig 09 (2026-06-09):
  overdue_days: number;
  opened_overdue_days: number | null;
  next_appointment_at: string | null;
  has_active_appt: boolean;
  is_paused_by_appointment: boolean;
  appointment_note: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  urgency_sort: number;
}

interface TicketEvent {
  id: number;
  ticket_id: number;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  actor_user_id: number | null;
  note: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

interface TicketGetResponse {
  ticket: Ticket;
  events: TicketEvent[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_KEYS: Record<string, string> = {
  QUEUED: 'callCenter.statusQueued',
  IN_PROGRESS: 'callCenter.statusInProgress',
  CALL_NO_ANSWER: 'callCenter.statusNoAnswer',
  CALL_UNREACHABLE: 'callCenter.statusUnreachable',
  CALL_SUCCESS: 'callCenter.statusCallSuccess',
  CLOSED_CALL_SUCCESS: 'callCenter.statusCallSuccess',
  CLOSED_RESOLVED_BY_PAYMENT: 'callCenter.statusResolvedByPayment',
  CLOSED_SUPERSEDED: 'callCenter.statusSuperseded',
  CLOSED_CANCELED_OR_CLOSED: 'callCenter.statusCanceled',
};

const INTENT_KEYS: Record<string, string> = {
  OVERDUE_COLLECTION: 'callCenter.intentOverdue',
  PAYMENT_REMINDER: 'callCenter.intentReminder',
};

const EVENT_TYPE_KEYS: Record<string, string> = {
  CREATED: 'callCenter.eventCreated',
  TAKEN: 'callCenter.eventTaken',
  TAKEN_OVER: 'callCenter.eventTakenOver',
  RESULT_SET: 'callCenter.eventResultSet',
  NOTE_ADDED: 'callCenter.eventNoteAdded',
  REVERTED: 'callCenter.eventReverted',
  AUTO_CLOSED: 'callCenter.eventAutoClosed',
  APPOINTMENT_SET: 'callCenter.eventAppointmentSet',
  APPOINTMENT_CLEARED: 'callCenter.eventAppointmentCleared',
};

const CLOSED_REASON_KEYS: Record<string, string> = {
  CALL_SUCCESS: 'callCenter.statusCallSuccess',
  SUPERSEDED: 'callCenter.statusSuperseded',
  RESOLVED_BY_PAYMENT: 'callCenter.statusResolvedByPayment',
  CANCELED_OR_CLOSED: 'callCenter.statusCanceled',
};

const OPEN_STATUSES = ['QUEUED', 'IN_PROGRESS', 'CALL_NO_ANSWER', 'CALL_UNREACHABLE'];

function statusColor(status: string): 'info' | 'warning' | 'success' | 'danger' | undefined {
  if (status === 'QUEUED') return 'info';
  if (status === 'IN_PROGRESS') return 'warning';
  if (status === 'CLOSED_CALL_SUCCESS' || status === 'CALL_SUCCESS') return 'success';
  if (status.startsWith('CLOSED_')) return undefined;
  if (status === 'CALL_NO_ANSWER' || status === 'CALL_UNREACHABLE') return 'danger';
  return undefined;
}

function overdueColor(days: number): 'info' | 'warning' | 'danger' {
  if (days >= 30) return 'danger';
  if (days >= 7) return 'warning';
  return 'info';
}

function formatAmount(amount: number | null): string {
  if (amount == null) return '—';
  return amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatCooldown(raw: string | null): string {
  if (!raw) return '';
  const dayMatch = raw.match(/(\d+)\s*day/);
  const days = dayMatch ? parseInt(dayMatch[1], 10) : 0;
  const timeMatch = raw.match(/(\d+):(\d+):(\d+)/);
  const hours = timeMatch ? parseInt(timeMatch[1], 10) : 0;
  const minutes = timeMatch ? parseInt(timeMatch[2], 10) : 0;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const promise = new Date(iso).getTime();
  const now = Date.now();
  return Math.ceil((promise - now) / 86400000);
}

function eventIcon(eventType: string) {
  switch (eventType) {
    case 'CREATED': return <CirclePlus size={16} className="text-subtle" />;
    case 'TAKEN': return <UserPlus size={16} className="text-info" />;
    case 'TAKEN_OVER': return <UserPlus size={16} className="text-warning-fg" />;
    case 'RESULT_SET': return <PhoneCall size={16} className="text-success" />;
    case 'NOTE_ADDED': return <StickyNote size={16} className="text-subtle" />;
    case 'REVERTED': return <Undo2 size={16} className="text-warning-fg" />;
    case 'AUTO_CLOSED': return <Zap size={16} className="text-subtle" />;
    case 'APPOINTMENT_SET': return <CalendarClock size={16} className="text-info" />;
    case 'APPOINTMENT_CLEARED': return <CalendarOff size={16} className="text-subtle" />;
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
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();

  const [actionPending, setActionPending] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [noteText, setNoteText] = useState('');
  const [revertNote, setRevertNote] = useState('');
  const [resultNote, setResultNote] = useState('');

  // Reset state when ticket changes
  useEffect(() => {
    setActionPending(null);
    setErrorMessage('');
    setNoteText('');
    setRevertNote('');
    setResultNote('');
  }, [ticketId]);

  // Always refetch on mount and on demand — never serve from cache for take decisions.
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => apiClient.rpc<TicketGetResponse>('ops_call_ticket_get', { p_ticket_id: ticketId }),
    staleTime: 0,
    gcTime: 0,
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
        const translated =
          (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') ||
          (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setErrorMessage(translated || err.message);
        // Race lost vs appointment — refetch so banner appears.
        if (err.code === 'OPS.CONFLICT.TICKET_PAUSED_BY_APPOINTMENT' || err.code === 'OPS.CONFLICT.ALREADY_IN_PROGRESS') {
          refetch();
        }
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
    // Re-fetch live state right before take to catch any pause we missed.
    const fresh = await refetch();
    const liveTicket = fresh.data?.ticket;
    if (liveTicket && (liveTicket.has_active_appt || !liveTicket.is_takeable)) {
      throw new ApiError({
        code: 'OPS.CONFLICT.TICKET_PAUSED_BY_APPOINTMENT',
        messageKey: 'OPS.CONFLICT.TICKET_PAUSED_BY_APPOINTMENT',
        message: 'Ticket paused by appointment',
        isAuthError: false,
      });
    }
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
    await apiClient.rpc('ops_call_ticket_set_result', { p_ticket_id: ticketId, p_result: result, p_note: resultNote.trim() || null });
    setResultNote('');
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
  // Server-derived is_takeable already factors in appointment + cooldown.
  // Fall back to the legacy condition only if the view didn't return is_takeable.
  const canTake =
    !!ticket &&
    !ticket.has_active_appt &&
    (
      ticket.is_takeable ??
      (
        ticket.status === 'QUEUED' ||
        ((ticket.status === 'CALL_NO_ANSWER' || ticket.status === 'CALL_UNREACHABLE') &&
          (!ticket.next_attempt_after || new Date(ticket.next_attempt_after) <= new Date()))
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

  const apptCountdown = ticket.next_appointment_at ? daysUntil(ticket.next_appointment_at) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Desktop detail header */}
      {!isMobile && (
        <div className="flex-none flex items-center gap-2 h-panel-header-h px-4 border-b border-line">
          <span className="font-semibold truncate">{ticket.code_display ?? ticket.ticket_code ?? `#${ticket.id}`}</span>
          <Badge size="sm" color={statusColor(ticket.status)}>
            {STATUS_KEYS[ticket.status] ? t(STATUS_KEYS[ticket.status]) : ticket.status}
          </Badge>
          {ticket.is_paused_by_appointment && (
            <Badge size="sm" color="warning">
              <CalendarClock size={10} className="inline-block mr-0.5 -mt-0.5" />
              {t('callCenter.pausedBadge')}
            </Badge>
          )}
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

        {/* Appointment banner — sits above the info card when active */}
        {ticket.has_active_appt && ticket.next_appointment_at && (
          <div className="px-4 py-3 border-b border-line">
            <div className="alert alert-warning">
              <CalendarClock size={18} />
              <div className="flex-1 min-w-0">
                <div className="alert-title">{t('callCenter.appointmentBannerTitle')}</div>
                <div className="alert-description space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <DateTime value={ticket.next_appointment_at} showTime={false} className="font-medium" />
                    {apptCountdown != null && (
                      <Badge size="sm" color={apptCountdown < 0 ? 'danger' : apptCountdown === 0 ? 'warning' : 'info'}>
                        {apptCountdown < 0
                          ? t('callCenter.appointmentCountdownPassed')
                          : apptCountdown === 0
                            ? t('callCenter.appointmentCountdownToday')
                            : t('callCenter.appointmentCountdown', { days: apptCountdown })}
                      </Badge>
                    )}
                  </div>
                  {ticket.appointment_note && (
                    <div>
                      <span className="text-subtle">{t('callCenter.appointmentNoteLabel')}</span>{' '}
                      <span>{ticket.appointment_note}</span>
                    </div>
                  )}
                  <div className="text-xs text-subtle">{t('callCenter.appointmentBannerSubtitle')}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Info section */}
        <div className="bg-surface border-b border-line px-4 py-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.ticketCode')}</div>
              <div className="min-h-info-content-h flex items-center font-medium text-xs">{ticket.code_display ?? ticket.ticket_code ?? '—'}</div>
            </div>
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.contractCode')}</div>
              <div className="min-h-info-content-h flex items-center font-medium text-xs">{ticket.ref_contract_code ?? '—'}</div>
            </div>
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.intent')}</div>
              <div className="min-h-info-content-h flex items-center">
                <Badge size="sm" color={ticket.intent_type === 'OVERDUE_COLLECTION' ? 'danger' : 'info'}>
                  {INTENT_KEYS[ticket.intent_type] ? t(INTENT_KEYS[ticket.intent_type]) : ticket.intent_type}
                </Badge>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.lastResult')}</div>
              <div className="min-h-info-content-h flex items-center">
                <Badge size="sm" color={statusColor(ticket.status)}>
                  {STATUS_KEYS[ticket.status] ? t(STATUS_KEYS[ticket.status]) : ticket.status}
                </Badge>
              </div>
            </div>
            {ticket.overdue_days > 0 ? (
              <div>
                <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.overdue')}</div>
                <div className="min-h-info-content-h flex items-center gap-1.5">
                  <Badge size="sm" color={overdueColor(ticket.overdue_days)}>
                    {t('callCenter.overdueDays', { n: ticket.overdue_days })}
                  </Badge>
                  {ticket.overdue_amount > 0 && (
                    <span className="font-medium text-figure">฿{formatAmount(ticket.overdue_amount)}</span>
                  )}
                </div>
              </div>
            ) : ticket.next_due_date && (
              <div>
                <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.nextDue')}</div>
                <div className="min-h-info-content-h flex items-center gap-1.5">
                  <DateTime value={ticket.next_due_date} showTime={false} className="text-sm" />
                  {ticket.next_due_amount != null && (
                    <span className="text-subtle">฿{formatAmount(ticket.next_due_amount)}</span>
                  )}
                </div>
              </div>
            )}
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.lastCallAt')}</div>
              <div className="min-h-info-content-h flex items-center gap-1.5">
                <span className="text-sm">
                  {ticket.attempt_count > 0
                    ? t('callCenter.attemptCount', { n: ticket.attempt_count })
                    : t('callCenter.attemptCountZero')}
                </span>
                {ticket.last_attempt_at && <DateTime value={ticket.last_attempt_at} className="text-xs text-subtle" />}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.createdAt')}</div>
              <div className="min-h-info-content-h flex items-center gap-1.5">
                <DateTime value={ticket.created_at} className="text-sm" />
                {ticket.opened_overdue_days != null && (
                  <Tooltip content={t('callCenter.openedDaysAgo', { n: ticket.opened_overdue_days })}>
                    <Badge size="sm">{ticket.opened_overdue_days}d</Badge>
                  </Tooltip>
                )}
              </div>
            </div>
            {ticket.closed_at && (
              <div>
                <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.closedAt')}</div>
                <div className="min-h-info-content-h flex items-center">
                  <DateTime value={ticket.closed_at} className="text-sm" />
                </div>
              </div>
            )}
            {ticket.closed_reason && (
              <div className="col-span-2">
                <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.closedReason')}</div>
                <div className="min-h-info-content-h flex items-center">
                  {CLOSED_REASON_KEYS[ticket.closed_reason] ? t(CLOSED_REASON_KEYS[ticket.closed_reason]) : ticket.closed_reason}
                </div>
              </div>
            )}
            {ticket.next_attempt_after && OPEN_STATUSES.includes(ticket.status) && !ticket.has_active_appt && (
              <div>
                <div className="text-[10px] text-subtle uppercase tracking-wider">{t('callCenter.nextAttempt')}</div>
                <div className="min-h-info-content-h flex items-center gap-1.5">
                  <DateTime value={ticket.next_attempt_after} className="text-sm" />
                  {ticket.is_cooling_down && ticket.cooldown_remaining && (
                    <Badge size="sm" color="default">
                      <Snowflake size={10} className="inline-block mr-0.5 -mt-0.5" />
                      {formatCooldown(ticket.cooldown_remaining)}
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Take / Set Result / Revert */}
        {OPEN_STATUSES.includes(ticket.status) && (
          <>
            {/* Take */}
            {(canTake || ticket.has_active_appt) && !canSetResult && (
              <div className="px-4 py-4 border-b border-line flex items-center gap-3">
                <Tooltip content={ticket.has_active_appt ? t('callCenter.takeDisabledPaused') : ''} disabled={!ticket.has_active_appt}>
                  <Button
                    color="primary"
                    disabled={!!actionPending || ticket.has_active_appt || !canTake}
                    onClick={handleTake}
                    startIcon={<Phone size={16} />}
                  >
                    {actionPending === 'take' ? t('callCenter.taking') : t('callCenter.take')}
                  </Button>
                </Tooltip>
                {ticket.has_active_appt && (
                  <span className="text-xs text-subtle inline-flex items-center gap-1">
                    <AlertTriangle size={12} />
                    {t('callCenter.takeDisabledPaused')}
                  </span>
                )}
              </div>
            )}

            {/* Set Result */}
            {canSetResult && (
              <div className="px-4 py-4 border-b border-line space-y-2">
                <div className="text-sm font-medium">{t('callCenter.setResult')}</div>
                <TextArea
                  className="w-full"
                  placeholder={t('callCenter.resultNotePlaceholder')}
                  value={resultNote}
                  onChange={(e) => setResultNote(e.target.value)}
                  rows={2}
                />
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
                    className="flex-1"
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
              {events.map((evt) => {
                const isAppointment = evt.event_type === 'APPOINTMENT_SET' || evt.event_type === 'APPOINTMENT_CLEARED';
                const actorLabel = evt.actor_user_id
                  ? `#${evt.actor_user_id}`
                  : t('callCenter.customerActor');
                const promiseDateRaw = isAppointment ? evt.payload?.promise_date : undefined;
                const promiseDate = typeof promiseDateRaw === 'string'
                  ? new Date(promiseDateRaw).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' })
                  : '';
                return (
                  <div key={evt.id} className="flex gap-3 py-3">
                    <div className="shrink-0 pt-0.5">{eventIcon(evt.event_type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {evt.event_type === 'APPOINTMENT_SET' ? (
                          <span className="text-sm">
                            {t('callCenter.appointmentSetEvent', { actor: actorLabel, date: promiseDate })}
                          </span>
                        ) : evt.event_type === 'APPOINTMENT_CLEARED' ? (
                          <span className="text-sm">
                            {t('callCenter.appointmentClearedEvent', { actor: actorLabel })}
                          </span>
                        ) : (
                          <>
                            <span className="text-sm font-medium">
                              {EVENT_TYPE_KEYS[evt.event_type] ? t(EVENT_TYPE_KEYS[evt.event_type]) : evt.event_type}
                            </span>
                            {evt.new_status && (
                              <Badge size="sm" color={statusColor(evt.new_status)}>
                                {STATUS_KEYS[evt.new_status] ? t(STATUS_KEYS[evt.new_status]) : evt.new_status}
                              </Badge>
                            )}
                            {evt.actor_user_id && (
                              <span className="text-xs text-subtle">#{evt.actor_user_id}</span>
                            )}
                          </>
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
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

type FilterMode = '' | 'READY_TO_CALL' | 'PAUSED' | 'CLOSED';

export function TicketQueuePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Table state
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Filters & sort
  const [filterMode, setFilterMode] = useState<FilterMode>('READY_TO_CALL');
  const [filterMineOnly, setFilterMineOnly] = useState(false);
  const [sortBy, setSortBy] = useState<string>('urgency_sort.asc');
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Selection
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);

  const filterOptions = [
    { value: 'READY_TO_CALL', label: t('callCenter.filterReadyToCall') },
    { value: 'PAUSED', label: t('callCenter.filterPaused') },
    { value: 'CLOSED', label: t('callCenter.filterClosed') },
  ];

  const sortOptions = [
    { value: 'urgency_sort.asc', label: t('callCenter.sortRecommended') },
    { value: 'overdue_days.desc.nullslast', label: t('callCenter.sortLongestOverdue') },
    { value: 'overdue_amount.desc.nullslast', label: t('callCenter.sortHighestDebt') },
    { value: 'attempt_count.desc', label: t('callCenter.sortMostAttempts') },
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
    switch (filterMode) {
      case 'READY_TO_CALL':
        params.push('is_takeable=is.true');
        break;
      case 'PAUSED':
        params.push('is_paused_by_appointment=is.true');
        break;
      case 'CLOSED':
        params.push('status=in.(CLOSED_RESOLVED_BY_PAYMENT,CLOSED_CALL_SUCCESS,CLOSED_CANCELED_OR_CLOSED,CLOSED_SUPERSEDED)');
        break;
    }
    if (filterMineOnly) {
      params.push('is_mine=is.true');
    }
    params.push(`order=${sortBy}`);
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    return `/v_ops_call_ticket_list${qs}`;
  }, [search, filterMode, filterMineOnly, sortBy]);

  // Fetch tickets
  const { data, isError, error, isFetching } = useQuery({
    queryKey: ['ticket-queue', pageIndex, pageSize, search, filterMode, filterMineOnly, sortBy],
    queryFn: () => apiClient.getPaginated<Ticket>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const tickets = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  // ── Realtime ────────────────────────────────────────────────────────────
  // Subscribe to ops:queue:branch:<branch_id>. On any event, debounced-refetch
  // the affected row. Don't apply payloads as state diffs — too many derived fields.
  const branchId = user?.branch_id;
  const refetchTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!branchId) return;

    const scheduleRowRefetch = (ticketId: number) => {
      const existing = refetchTimers.current.get(ticketId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        refetchTimers.current.delete(ticketId);
        queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
        queryClient.invalidateQueries({ queryKey: ['ticket-queue'] });
      }, 250);
      refetchTimers.current.set(ticketId, timer);
    };

    const unsub = wsClient.subscribe(`ops:queue:branch:${branchId}`, (raw) => {
      const msg = raw as { type?: string; ticket_id?: number };
      if (typeof msg?.ticket_id !== 'number') return;
      switch (msg.type) {
        case 'ticket_taken':
        case 'ticket_result_set':
        case 'ticket_appointment_set':
        case 'ticket_appointment_cleared':
        case 'ticket_reverted':
        case 'ticket_note_added':
          scheduleRowRefetch(msg.ticket_id);
          break;
        case 'ticket_auto_closed':
          // Closed tickets drop out of most queue views; refetch list to remove them
          // and let the detail page re-evaluate.
          queryClient.invalidateQueries({ queryKey: ['ticket', msg.ticket_id] });
          queryClient.invalidateQueries({ queryKey: ['ticket-queue'] });
          break;
      }
    });

    return () => {
      unsub();
      refetchTimers.current.forEach(timer => clearTimeout(timer));
      refetchTimers.current.clear();
    };
  }, [branchId, queryClient]);

  // Find selected ticket code for mobile header
  const selectedTicket = selectedTicketId ? tickets.find(t => t.id === selectedTicketId) : null;

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile ? (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                  >
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={goBack}>
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              {isRoot && (
                <>
                  <div className="mobile-header-title mobile-header-title-truncate">{t('callCenter.ticketQueue')}</div>
                  <div className="mobile-header-end w-nav" />
                </>
              )}
              {!isRoot && (
                <div className="mobile-header-title mobile-header-title-truncate">
                  {selectedTicket?.code_display ?? selectedTicket?.ticket_code ?? t('callCenter.ticketDetail')}
                </div>
              )}
            </MobileHeader>
          ) : (
            <div key="header" className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('callCenter.ticketQueue')}</h1>
            </div>
          )}

          {/* ── Filter bar ── */}
          {(isRoot || !isMobile) && (
            <div className="flex-none px-4 py-2 border-b border-line">
              <div className="flex flex-wrap items-center gap-2 w-full">
                <div className="flex-[2] min-w-0 basis-24">
                  <Input
                    className="w-full"
                    placeholder={t('common.search')}
                    value={searchInput}
                    onChange={(e) => handleSearch(e.target.value)}
                    size="sm"
                  />
                </div>
                <div className="flex-[2] min-w-0 basis-24">
                  <Select
                    options={filterOptions}
                    value={filterMode || null}
                    onChange={(val) => {
                      setFilterMode((val as FilterMode) ?? '');
                      setPageIndex(0);
                    }}
                    placeholder={t('callCenter.allStatuses')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
                <div className={`min-w-0 basis-24 flex-[2] ${filtersExpanded ? '' : 'hidden'} md:block`}>
                  <Select
                    options={sortOptions}
                    value={sortBy}
                    onChange={(val) => {
                      setSortBy((val as string) ?? 'urgency_sort.asc');
                      setPageIndex(0);
                    }}
                    size="sm"
                    showChevron
                  />
                </div>
                <div className="hidden md:flex items-center shrink-0">
                  <LabeledCheckbox
                    label={t('callCenter.mineOnly')}
                    checked={filterMineOnly}
                    onChange={(e) => {
                      setFilterMineOnly(e.target.checked);
                      setPageIndex(0);
                    }}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`btn-icon-sm shrink-0 md:hidden ${filtersExpanded ? 'text-primary-fg' : ''}`}
                  startIcon={<SlidersHorizontal size={14} />}
                  onClick={() => setFiltersExpanded(!filtersExpanded)}
                />
              </div>
              <div className={`md:hidden ${filtersExpanded ? 'flex' : 'hidden'} items-center mt-2`}>
                <LabeledCheckbox
                  label={t('callCenter.mineOnly')}
                  checked={filterMineOnly}
                  onChange={(e) => {
                    setFilterMineOnly(e.target.checked);
                    setPageIndex(0);
                  }}
                />
              </div>
            </div>
          )}

          <div key="panels" className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* ── Left Panel: Ticket Queue ── */}
            <PageNavPanel id="list" className="w-1/2 xl:w-5/12 border-r border-line flex flex-col" mobileClassName="flex flex-col overflow-hidden">
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
                  getRowProps={(row) => ({
                    'data-state': selectedTicketId === row.original.id ? 'selected' : undefined,
                  })}
                  renderRow={(row) => {
                    const ticket = row.original;
                    const isPaused = ticket.is_paused_by_appointment;
                    const apptCountdown = isPaused ? daysUntil(ticket.next_appointment_at) : null;
                    return (
                      <div
                        className={`px-4 py-2 transition-colors cursor-pointer ${isPaused ? 'bg-surface-muted' : ''}`}
                        onClick={() => {
                          setSelectedTicketId(ticket.id);
                          if (isMobile) goTo('detail');
                        }}
                      >
                        {/* Row 1: contract code + ticket code + amount */}
                        <div className="flex items-center gap-2">
                          {ticket.is_mine && (
                            <Tooltip content={t('callCenter.assignedToMe')}>
                              <User size={12} className="text-primary-fg shrink-0" />
                            </Tooltip>
                          )}
                          <span className="font-medium text-sm truncate">{ticket.ref_contract_code ?? '—'}</span>
                          <span className="text-xs text-subtle truncate shrink-0">{ticket.code_display ?? ticket.ticket_code ?? `#${ticket.id}`}</span>
                          {ticket.overdue_amount > 0 ? (
                            <span className="ml-auto shrink-0 text-sm font-medium text-figure">
                              ฿{formatAmount(ticket.overdue_amount)}
                            </span>
                          ) : ticket.next_due_amount != null && (
                            <span className="ml-auto shrink-0 text-sm text-subtle">
                              ฿{formatAmount(ticket.next_due_amount)}
                            </span>
                          )}
                        </div>
                        {/* Row 2: overdue/due info + badges */}
                        <div className="flex items-center gap-1.5 mt-0.5 -ml-0.5 flex-wrap">
                          {ticket.overdue_days > 0 ? (
                            <Badge size="sm" color={overdueColor(ticket.overdue_days)}>
                              {t('callCenter.overdueDays', { n: ticket.overdue_days })}
                            </Badge>
                          ) : ticket.next_due_date && (
                            <Badge size="sm" color="default">
                              <DateTime value={ticket.next_due_date} showTime={false} />
                            </Badge>
                          )}
                          {ticket.overdue_streak_count > 1 && (
                            <span className="text-xs text-subtle leading-none">
                              {t('callCenter.missedCount', { count: ticket.overdue_streak_count })}
                            </span>
                          )}
                          {ticket.attempt_count > 0 && (
                            <Tooltip content={ticket.last_attempt_at ? t('callCenter.lastAttempt', { when: new Date(ticket.last_attempt_at).toLocaleString() }) : ''}>
                              <Badge size="sm" color="default">
                                <PhoneCall size={10} className="inline-block mr-0.5 -mt-0.5" />
                                {ticket.attempt_count}
                              </Badge>
                            </Tooltip>
                          )}
                          {ticket.is_cooling_down && (
                            <Tooltip content={t('callCenter.cooldownLeft', { duration: formatCooldown(ticket.cooldown_remaining) })}>
                              <Badge size="sm" color="default">
                                <Snowflake size={10} className="inline-block mr-0.5 -mt-0.5" />
                                {formatCooldown(ticket.cooldown_remaining)}
                              </Badge>
                            </Tooltip>
                          )}
                          {isPaused && (
                            <Badge size="sm" color="warning">
                              <CalendarClock size={10} className="inline-block mr-0.5 -mt-0.5" />
                              {apptCountdown != null && apptCountdown > 0
                                ? t('callCenter.appointmentCountdown', { days: apptCountdown })
                                : t('callCenter.pausedBadge')}
                            </Badge>
                          )}
                          <span className="ml-auto shrink-0 flex items-center gap-1">
                            {INTENT_KEYS[ticket.intent_type] && ticket.intent_type === 'OVERDUE_COLLECTION' && (
                              <Badge size="sm" color="danger">
                                {t(INTENT_KEYS[ticket.intent_type])}
                              </Badge>
                            )}
                            <Badge size="sm" color={statusColor(ticket.status)}>
                              {STATUS_KEYS[ticket.status] ? t(STATUS_KEYS[ticket.status]) : ticket.status}
                            </Badge>
                          </span>
                        </div>
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
                <TicketDetailContent
                  ticketId={selectedTicketId}
                  isMobile={isMobile}
                />
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
