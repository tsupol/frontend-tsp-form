// Audit log drill-down for a chat thread's status + pinned-note history.
// Backend ref: api.v_chat_thread_status_log
// Spec: UI_FEEDBACK/2026-06-09_RECOMMEND_chat_thread_status_ui_integration.md §3.2

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Skeleton } from 'tsp-form';
import { Pin, History, Cog } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { formatSmart } from '../../lib/format';
import type { ChatStatus, ChatThreadStatusLogRow } from './chatTypes';

interface Props {
  open: boolean;
  onClose: () => void;
  contractId: number;
}

export function ChatStatusLogModal({ open, onClose, contractId }: Props) {
  const { t, i18n } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ['chat-thread-status-log', contractId],
    queryFn: () => apiClient.get<ChatThreadStatusLogRow[]>(
      `/v_chat_thread_status_log?contract_id=eq.${contractId}&order=changed_at.desc&limit=50`,
    ),
    enabled: open,
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="36rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('chat.auditLog.title')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>×</button>
      </div>
      <div className="modal-content">
        {isLoading ? (
          <div className="flex flex-col gap-2 py-2">
            <Skeleton variant="rectangular" height={40} />
            <Skeleton variant="rectangular" height={40} />
            <Skeleton variant="rectangular" height={40} />
          </div>
        ) : !data || data.length === 0 ? (
          <div className="text-center text-subtle text-sm py-8">
            {t('chat.auditLog.empty')}
          </div>
        ) : (
          <ol className="flex flex-col">
            {data.map((row, i) => (
              <LogRow
                key={row.log_id}
                row={row}
                lang={i18n.language}
                isLast={i === data.length - 1}
              />
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}

function LogRow({ row, lang, isLast }: { row: ChatThreadStatusLogRow; lang: string; isLast: boolean }) {
  const { t } = useTranslation();
  const isSystem = row.changed_by_kind === 'SYSTEM';
  const user = isSystem
    ? t('chat.auditLog.systemUser')
    : (row.changed_by_username ?? '—');
  const when = formatSmart(row.changed_at, lang);

  let title: React.ReactNode;
  let detail: React.ReactNode = null;

  if (row.event_kind === 'STATUS_CHANGE') {
    if (row.to_status) {
      const statusLabel = t(`chat.status.${row.to_status as ChatStatus}`);
      title = (
        <span>
          <span className="font-medium">{user}</span>{' '}
          {t('chat.auditLog.actionSet', { status: statusLabel })}
        </span>
      );
    } else {
      // Cleared (auto from cron on RESOLVED expiry, or any future explicit clear)
      title = (
        <span>
          <span className="font-medium">{user}</span>{' '}
          {t('chat.auditLog.actionCleared')}
        </span>
      );
    }
    if (row.note) {
      detail = <span className="text-subtle italic">"{row.note}"</span>;
    }
  } else {
    // NOTE_CHANGE — decide add / edit / clear based on from/to.
    const hadBefore = !!row.from_note;
    const hasAfter = !!row.to_note;
    let actionKey: 'noteAdded' | 'noteEdited' | 'noteCleared';
    if (!hadBefore && hasAfter)      actionKey = 'noteAdded';
    else if (hadBefore && !hasAfter) actionKey = 'noteCleared';
    else                             actionKey = 'noteEdited';
    title = (
      <span>
        <span className="font-medium">{user}</span>{' '}
        {t(`chat.auditLog.${actionKey}`)}
      </span>
    );
    if (row.to_note) {
      detail = <span className="text-subtle">"{row.to_note}"</span>;
    }
  }

  return (
    <li className={`flex items-start gap-2 py-2 ${!isLast ? 'border-b border-line' : ''}`}>
      <div className="shrink-0 w-7 h-7 rounded-full bg-surface-soft text-subtle flex items-center justify-center mt-0.5">
        {row.event_kind === 'NOTE_CHANGE' ? <Pin size={14} /> : isSystem ? <Cog size={14} /> : <History size={14} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm">{title}</div>
        {detail && <div className="text-xs mt-0.5 break-words">{detail}</div>}
        <div className="text-[11px] text-subtle mt-0.5 tabular-nums">{when}</div>
      </div>
    </li>
  );
}
