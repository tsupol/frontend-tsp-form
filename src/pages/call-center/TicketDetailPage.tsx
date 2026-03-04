import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, useSnackbarContext } from 'tsp-form';
import {
  ArrowLeft,
  CheckCircle,
  PhoneOff,
  PhoneCall,
  Phone,
  Undo2,
  MessageSquarePlus,
  XCircle,
  UserPlus,
  StickyNote,
  Zap,
  Clock,
  CirclePlus,
  GitBranchPlus,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

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
  status_label: string;
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

function statusColor(status: string): 'info' | 'warning' | 'success' | 'danger' | undefined {
  if (status === 'QUEUED') return 'info';
  if (status === 'IN_PROGRESS') return 'warning';
  if (status === 'CLOSED_CALL_SUCCESS') return 'success';
  if (status.startsWith('CLOSED_')) return undefined;
  if (status === 'CALL_NO_ANSWER' || status === 'CALL_UNREACHABLE') return 'danger';
  return undefined;
}

function severityColor(severity: number): 'danger' | 'warning' | 'info' | undefined {
  if (severity >= 7) return 'danger';
  if (severity >= 4) return 'warning';
  if (severity >= 2) return 'info';
  return undefined;
}

function eventIcon(eventType: string) {
  switch (eventType) {
    case 'CREATED': return <CirclePlus size={16} className="text-control-label" />;
    case 'TAKEN': return <UserPlus size={16} className="text-info" />;
    case 'TAKEN_OVER': return <UserPlus size={16} className="text-warning" />;
    case 'RESULT_SET': return <PhoneCall size={16} className="text-success" />;
    case 'NOTE_ADDED': return <StickyNote size={16} className="text-control-label" />;
    case 'REVERTED': return <Undo2 size={16} className="text-warning" />;
    case 'AUTO_CLOSED': return <Zap size={16} className="text-control-label" />;
    case 'STAGE_CHANGED': return <GitBranchPlus size={16} className="text-info" />;
    default: return <Clock size={16} className="text-control-label" />;
  }
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const OPEN_STATUSES = ['QUEUED', 'IN_PROGRESS', 'CALL_NO_ANSWER', 'CALL_UNREACHABLE'];

// ── Main Page ────────────────────────────────────────────────────────────────

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();

  const [actionPending, setActionPending] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [noteText, setNoteText] = useState('');
  const [revertNote, setRevertNote] = useState('');

  const ticketId = Number(id);

  // Fetch ticket detail
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => apiClient.rpc<TicketGetResponse>('ops_call_ticket_get', { ticket_id: ticketId }),
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
    await apiClient.rpc('ops_call_ticket_take', { ticket_id: ticketId });
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
    await apiClient.rpc('ops_call_ticket_set_result', { ticket_id: ticketId, result, note: null });
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
    await apiClient.rpc('ops_call_ticket_revert_result', { ticket_id: ticketId, note: revertNote || null });
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
    await apiClient.rpc('ops_call_ticket_add_note', { ticket_id: ticketId, note: noteText.trim() });
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
    return (
      <div className="page-content max-w-[56rem]">
        <div className="text-control-label">{t('common.loading')}</div>
      </div>
    );
  }

  if (isError || !ticket) {
    return (
      <div className="page-content max-w-[56rem]">
        <div className="border border-line bg-surface p-6 rounded-lg text-center">
          <div className="text-danger mb-4">{error instanceof Error ? error.message : t('common.error')}</div>
          <Button variant="ghost" startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/admin/call-center/queue')}>
            {t('callCenter.backToQueue')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content max-w-[56rem] space-y-6">
      {/* Back button + title */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/admin/call-center/queue')} />
        <h1 className="heading-2">{ticket.ticket_code}</h1>
      </div>

      {/* Error alert */}
      {errorMessage && (
        <div key={errorKey} className="alert alert-danger animate-pop-in">
          <XCircle size={18} />
          <div><div className="alert-description">{errorMessage}</div></div>
        </div>
      )}

      {/* Info card */}
      <div className="border border-line bg-surface rounded-lg p-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <div>
            <div className="text-xs text-control-label">{t('callCenter.ticketCode')}</div>
            <div className="font-medium">{ticket.ticket_code}</div>
          </div>
          <div>
            <div className="text-xs text-control-label">{t('callCenter.contractCode')}</div>
            <div className="font-medium">{ticket.ref_contract_code ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-control-label">{t('callCenter.contractSource')}</div>
            <div>{ticket.ref_contract_source ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-control-label">{t('callCenter.status')}</div>
            <Badge size="sm" color={statusColor(ticket.status)}>{ticket.status_label}</Badge>
          </div>
          <div>
            <div className="text-xs text-control-label">{t('callCenter.stage')}</div>
            <Badge size="sm" color={severityColor(ticket.severity)}>
              {ticket.stage} ({ticket.severity})
            </Badge>
          </div>
          <div>
            <div className="text-xs text-control-label">{t('callCenter.assignedTo')}</div>
            <div>{ticket.assigned_to_user_id ? `#${ticket.assigned_to_user_id}` : '—'}</div>
          </div>
          <div>
            <div className="text-xs text-control-label">{t('callCenter.assignedAt')}</div>
            <div>{formatDateTime(ticket.assigned_at)}</div>
          </div>
          <div>
            <div className="text-xs text-control-label">{t('callCenter.createdAt')}</div>
            <div>{formatDateTime(ticket.created_at)}</div>
          </div>
          {ticket.closed_at && (
            <div>
              <div className="text-xs text-control-label">{t('callCenter.closedAt')}</div>
              <div>{formatDateTime(ticket.closed_at)}</div>
            </div>
          )}
          {ticket.closed_reason && (
            <div className="col-span-2">
              <div className="text-xs text-control-label">{t('callCenter.closedReason')}</div>
              <div>{ticket.closed_reason}</div>
            </div>
          )}
          {ticket.next_attempt_after && OPEN_STATUSES.includes(ticket.status) && (
            <div>
              <div className="text-xs text-control-label">{t('callCenter.nextAttempt')}</div>
              <div>{formatDateTime(ticket.next_attempt_after)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      {OPEN_STATUSES.includes(ticket.status) && (
        <div className="border border-line bg-surface rounded-lg p-5 space-y-4">
          {/* Take */}
          {canTake && (
            <Button
              color="primary"
              disabled={!!actionPending}
              onClick={handleTake}
              startIcon={<Phone size={16} />}
            >
              {actionPending === 'take' ? t('callCenter.taking') : t('callCenter.take')}
            </Button>
          )}

          {/* Set Result */}
          {canSetResult && (
            <div className="space-y-2">
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
            <div className="space-y-2">
              <div className="text-sm font-medium">{t('callCenter.revert')}</div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    size="sm"
                    placeholder={t('callCenter.revertNote')}
                    value={revertNote}
                    onChange={(e) => setRevertNote(e.target.value)}
                  />
                </div>
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

          {/* Add Note */}
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('callCenter.addNote')}</div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  size="sm"
                  placeholder={t('callCenter.notePlaceholder')}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
              </div>
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
        </div>
      )}

      {/* Event timeline */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">{t('callCenter.timeline')}</h2>
        {events.length === 0 ? (
          <div className="text-sm text-control-label">{t('common.noData')}</div>
        ) : (
          <div className="border border-line rounded-lg divide-y divide-line">
            {events.map((evt) => (
              <div key={evt.id} className="flex gap-3 px-4 py-3">
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
                      <span className="text-xs text-control-label">#{evt.actor_user_id}</span>
                    )}
                  </div>
                  {evt.note && (
                    <div className="text-sm text-fg/80 mt-1">{evt.note}</div>
                  )}
                  <div className="text-xs text-control-label mt-1">
                    {formatDateTime(evt.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
