// Chat thread status surfaces — split into three exports:
//
//   <ChatStatusInline />     — chip + setter-line, sits next to customer name
//                              in the thread header (read-only display).
//   <ChatThreadActionsMenu/> — the `...` button that hosts every staff action
//                              (set status × 4, pin a note, history). BS/BM only.
//   <ChatPinnedNoteRow />    — only renders when pinned_note is non-null.
//                              Shows the note + its own `...` menu (edit / clear).
//
// Backend ref: UI_FEEDBACK/2026-06-09_DELIVERED_chat_thread_status.md
// Spec: UI_FEEDBACK/2026-06-09_RECOMMEND_chat_thread_status_ui_integration.md

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Badge, Button, MenuItem, Modal, PopOver, TextArea, useSnackbarContext,
} from 'tsp-form';
import {
  CheckCircle, ClipboardCheck, History, MessageSquareWarning, MoreHorizontal,
  Pencil, Pin, PinOff, Wallet, Wrench, XCircle,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatSmart } from '../../lib/format';
import { CHAT_STATUS_VALUES, type ChatInboxRow, type ChatStatus } from './chatTypes';
import { chatStatusBadgeColor } from './chatStatus';
import { ChatStatusLogModal } from './ChatStatusLogModal';

const BRANCH_ROLES = ['BRANCH_STAFF', 'BRANCH_MANAGER'];

const STATUS_ICONS: Record<ChatStatus, React.ReactNode> = {
  WAITING_REPLY:   <MessageSquareWarning size={14} />,
  WAITING_FINANCE: <Wallet size={14} />,
  WAITING_TECH:    <Wrench size={14} />,
  RESOLVED:        <ClipboardCheck size={14} />,
};

// ── Status chip + setter-line (split so the header can lay them out separately)

export function ChatStatusBadge({ row }: { row: ChatInboxRow }) {
  const { t } = useTranslation();
  const status = row.chat_status;
  if (!status) return null;
  return (
    <Badge size="xs" color={chatStatusBadgeColor(status)}>
      {t(`chat.status.${status}`)}
    </Badge>
  );
}

export function ChatStatusSetterLine({ row, lang }: { row: ChatInboxRow; lang: string }) {
  const { t } = useTranslation();
  if (!row.chat_status || !row.chat_status_set_at) return null;
  const isSystem = row.chat_status_set_by_user_id === null;
  const user = isSystem ? t('chat.setStatus.setBySystem') : (row.chat_status_set_by_username ?? '');
  const when = formatSmart(row.chat_status_set_at, lang);
  return (
    <span className="text-[11px] text-subtle truncate">
      {t('chat.setStatus.setByLine', { user, when })}
    </span>
  );
}

// ── ChatThreadActionsMenu ────────────────────────────────────────────────────
//
// `...` button + dropdown. Holds: 4 set-status items, optionally "Pin a note"
// (only when pinned_note is null), and "History". Hidden for non-BS/BM roles.

interface ActionsMenuProps {
  contractId: number;
  inboxRow: ChatInboxRow;
}

export function ChatThreadActionsMenu({ contractId, inboxRow }: ActionsMenuProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canEdit = BRANCH_ROLES.includes(user?.role_code ?? '');

  const [open, setOpen] = useState(false);
  const [statusModalTarget, setStatusModalTarget] = useState<ChatStatus | null>(null);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);

  const { setStatusMutation, setNoteMutation } = useChatStatusMutations({
    contractId,
    onStatusSuccess: () => setStatusModalTarget(null),
    onNoteSuccess: () => setNoteModalOpen(false),
  });

  if (!canEdit) {
    // Read-only roles still need history access? Per DELIVERED §5, view-only
    // roles do not see the audit drill-down (read perm = write perm). So we
    // render nothing here.
    return null;
  }

  return (
    <>
      <PopOver
        isOpen={open}
        onClose={() => setOpen(false)}
        placement="bottom"
        align="end"
        offset={4}
        openDelay={0}
        trigger={
          <button
            type="button"
            className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer bg-transparent border-none"
            onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
            aria-label={t('chat.actions.menu')}
          >
            <MoreHorizontal size={18} className="opacity-70" />
          </button>
        }
      >
        <div className="py-1 min-w-[200px]">
          <div className="px-3 pt-1.5 pb-1 text-[11px] uppercase tracking-wide text-subtle">
            {t('chat.setStatus.title')}
          </div>
          {CHAT_STATUS_VALUES.map(s => (
            <MenuItem
              key={s}
              icon={STATUS_ICONS[s]}
              label={t(`chat.setStatus.${s.toLowerCase()}`)}
              onClick={() => { setOpen(false); setStatusModalTarget(s); }}
            />
          ))}
          <div className="border-t border-line my-1" />
          {!inboxRow.pinned_note && (
            <MenuItem
              icon={<Pin size={14} />}
              label={t('chat.pinnedNote.add')}
              onClick={() => { setOpen(false); setNoteModalOpen(true); }}
            />
          )}
          <MenuItem
            icon={<History size={14} />}
            label={t('chat.auditLog.open')}
            onClick={() => { setOpen(false); setLogModalOpen(true); }}
          />
        </div>
      </PopOver>

      <SetStatusModal
        open={statusModalTarget !== null}
        targetStatus={statusModalTarget}
        pending={setStatusMutation.isPending}
        onClose={() => setStatusModalTarget(null)}
        onSubmit={(note) => {
          if (!statusModalTarget) return;
          setStatusMutation.mutate({ status: statusModalTarget, note: note || null });
        }}
      />

      <EditPinnedNoteModal
        open={noteModalOpen}
        initial=""
        pending={setNoteMutation.isPending}
        onClose={() => setNoteModalOpen(false)}
        onSubmit={(note) => setNoteMutation.mutate(note || null)}
      />

      <ChatStatusLogModal
        open={logModalOpen}
        onClose={() => setLogModalOpen(false)}
        contractId={contractId}
      />
    </>
  );
}

// ── ChatPinnedNoteRow ────────────────────────────────────────────────────────

export function ChatPinnedNoteRow({ contractId, inboxRow, lang }: {
  contractId: number;
  inboxRow: ChatInboxRow;
  lang: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canEdit = BRANCH_ROLES.includes(user?.role_code ?? '');

  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const { setNoteMutation } = useChatStatusMutations({
    contractId,
    onNoteSuccess: () => setEditOpen(false),
  });

  const note = inboxRow.pinned_note;
  if (!note) return null;

  const setBy = inboxRow.pinned_note_at
    ? t('chat.pinnedNote.setBy', {
        user: inboxRow.pinned_note_by_username ?? '—',
        when: formatSmart(inboxRow.pinned_note_at, lang),
      })
    : null;

  return (
    <div className="flex-none border-b border-line bg-warning-soft px-3 py-2 flex items-start gap-2">
      <Pin size={14} className="text-warning shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1 text-xs">
        <div className="break-words whitespace-pre-wrap">{note}</div>
        {setBy && <div className="text-[11px] text-subtle mt-0.5">{setBy}</div>}
      </div>
      {canEdit && (
        <>
          <PopOver
            isOpen={menuOpen}
            onClose={() => setMenuOpen(false)}
            placement="bottom"
            align="end"
            offset={4}
            openDelay={0}
            trigger={
              <button
                type="button"
                className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer bg-transparent border-none shrink-0"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
                aria-label={t('chat.actions.menu')}
              >
                <MoreHorizontal size={16} className="opacity-70" />
              </button>
            }
          >
            <div className="py-1 min-w-[160px]">
              <MenuItem
                icon={<Pencil size={14} />}
                label={t('chat.pinnedNote.edit')}
                onClick={() => { setMenuOpen(false); setEditOpen(true); }}
              />
              <MenuItem
                icon={<PinOff size={14} />}
                label={t('chat.pinnedNote.clear')}
                onClick={() => { setMenuOpen(false); setNoteMutation.mutate(null); }}
              />
            </div>
          </PopOver>

          <EditPinnedNoteModal
            open={editOpen}
            initial={note}
            pending={setNoteMutation.isPending}
            onClose={() => setEditOpen(false)}
            onSubmit={(updated) => setNoteMutation.mutate(updated || null)}
          />
        </>
      )}
    </div>
  );
}

// ── Mutations (shared) ───────────────────────────────────────────────────────

function useChatStatusMutations({ contractId, onStatusSuccess, onNoteSuccess }: {
  contractId: number;
  onStatusSuccess?: () => void;
  onNoteSuccess?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['chat-thread-meta', contractId] });
    queryClient.invalidateQueries({ queryKey: ['chat-inbox'] });
    queryClient.invalidateQueries({ queryKey: ['chat-thread-status-log', contractId] });
  };

  const setStatusMutation = useMutation({
    mutationFn: async (payload: { status: ChatStatus; note: string | null }) => {
      return apiClient.rpc('fn_chat_status_set', {
        p_contract_id: contractId,
        p_status: payload.status,
        p_note: payload.note,
      });
    },
    onSuccess: () => {
      invalidate();
      addSnackbar({
        type: 'success',
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} /><span>{t('chat.setStatus.setSuccess')}</span>
          </div>
        ),
      });
      onStatusSuccess?.();
    },
    onError: (err) => {
      addSnackbar({
        type: 'error',
        message: (
          <div className="alert alert-danger">
            <XCircle size={16} /><span>{describeApiError(err, t, 'chat.setStatus.setFailed')}</span>
          </div>
        ),
      });
    },
  });

  const setNoteMutation = useMutation({
    mutationFn: async (note: string | null) => {
      return apiClient.rpc('fn_chat_note_set', {
        p_contract_id: contractId,
        p_note: note,
      });
    },
    onSuccess: () => {
      invalidate();
      addSnackbar({
        type: 'success',
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} /><span>{t('chat.pinnedNote.saveSuccess')}</span>
          </div>
        ),
      });
      onNoteSuccess?.();
    },
    onError: (err) => {
      addSnackbar({
        type: 'error',
        message: (
          <div className="alert alert-danger">
            <XCircle size={16} /><span>{describeApiError(err, t, 'chat.pinnedNote.saveFailed')}</span>
          </div>
        ),
      });
    },
  });

  return { setStatusMutation, setNoteMutation };
}

// ── Modals ───────────────────────────────────────────────────────────────────

function SetStatusModal({ open, targetStatus, pending, onClose, onSubmit }: {
  open: boolean;
  targetStatus: ChatStatus | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');

  useEffect(() => { if (open) setNote(''); }, [open]);

  const label = targetStatus ? t(`chat.setStatus.${targetStatus.toLowerCase()}`) : '';

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('chat.setStatus.title')}: {label}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>×</button>
      </div>
      <div className="modal-content">
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('chat.setStatus.notePrompt')}</label>
            <TextArea
              rows={3}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t('chat.setStatus.notePrompt')}
            />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          {t('chat.setStatus.cancel')}
        </Button>
        <Button variant="primary" onClick={() => onSubmit(note.trim())} disabled={pending}>
          {t('chat.setStatus.save')}
        </Button>
      </div>
    </Modal>
  );
}

function EditPinnedNoteModal({ open, initial, pending, onClose, onSubmit }: {
  open: boolean;
  initial: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState(initial);

  useEffect(() => { if (open) setNote(initial); }, [open, initial]);

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('chat.pinnedNote.title')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>×</button>
      </div>
      <div className="modal-content">
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('chat.pinnedNote.subtitle')}</label>
            <TextArea
              rows={4}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t('chat.pinnedNote.placeholder')}
              maxLength={300}
            />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          {t('chat.pinnedNote.cancel')}
        </Button>
        <Button variant="primary" onClick={() => onSubmit(note.trim())} disabled={pending}>
          {t('chat.pinnedNote.save')}
        </Button>
      </div>
    </Modal>
  );
}

function describeApiError(
  err: unknown,
  t: (k: string, opts?: Record<string, unknown>) => string,
  fallbackKey: string,
): string {
  if (err instanceof ApiError) {
    const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
    return translated || err.message || t(fallbackKey);
  }
  if (err instanceof Error) return err.message;
  return t(fallbackKey);
}
