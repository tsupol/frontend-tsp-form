import type { TFunction } from 'i18next';
import { Badge, Tooltip } from 'tsp-form';
import { Image as ImageIcon, Pin } from 'lucide-react';
import { formatSmart } from '../../lib/format';
import { chatStatusBadgeColor, contractStateBadgeColor, contractStateLabel } from './chatStatus';
import type { ChatInboxRow } from './chatTypes';

interface Props {
  row: ChatInboxRow;
  selected: boolean;
  onSelect: () => void;
  /** Branch label — only meaningful for multi-branch users (company/holding). */
  showBranch: boolean;
  lang: string;
  t: TFunction;
  /** Drops the code/badge cluster and the pinned note. The dock's rail is far
   *  narrower than the page's, and the full cluster wraps to three lines there. */
  compact?: boolean;
}

/**
 * One row of the chat inbox. Shared by the full chat page and the floating
 * dock so the two lists can't drift apart — a row means the same thing and
 * carries the same signals wherever it appears.
 */
export function ChatListRow({ row, selected, onSelect, showBranch, lang, t, compact }: Props) {
  const isImage = row.last_message_type === 'IMAGE';

  return (
    <button
      type="button"
      className={`text-left px-3 py-2.5 border-b border-line cursor-pointer transition-colors ${
        selected ? 'bg-primary-soft' : 'hover:bg-surface-hover'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="text-sm font-medium truncate min-w-0">
          {row.customer_name ?? '—'}
        </div>
        {/* Timestamp and unread count sit on ONE line — stacking them cost the
            row an extra line, so unread threads were taller than read ones and
            the list jumped as counts cleared. */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] text-subtle tabular-nums">
            {formatSmart(row.last_message_at, lang)}
          </span>
          {row.unread_count > 0 && (
            <Badge size="sm" color="primary">{row.unread_count}</Badge>
          )}
        </div>
      </div>

      {/* One flex-wrap cluster: code + all badges flow to a second line when the
          rail is too narrow to fit them on one row, instead of overlapping. */}
      <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-0.5">
        <div className="text-[11px] text-subtle truncate font-mono min-w-0 max-w-full">
          {row.contract_code_display}
        </div>
        {!compact && showBranch && row.branch_name && (
          <Badge size="xs" color="secondary">{row.branch_name}</Badge>
        )}
        {/* Contract-state badge — only when not ACTIVE, so normal rooms stay
            uncluttered (BE §3). */}
        {row.contract_state && row.contract_state !== 'ACTIVE' && (
          <Badge size="xs" color={contractStateBadgeColor(row.contract_state)}>
            {contractStateLabel(row.contract_state, t)}
          </Badge>
        )}
        {row.chat_status && (
          <Badge size="xs" color={chatStatusBadgeColor(row.chat_status)}>
            {t(`chat.status.${row.chat_status}`)}
          </Badge>
        )}
      </div>

      <div className="text-xs text-subtle truncate mt-0.5">
        {isImage ? (
          <span className="inline-flex items-center gap-1">
            <ImageIcon size={12} /> {t('chat.imageMessage')}
          </span>
        ) : (
          row.last_message_text ?? ''
        )}
      </div>

      {!compact && row.pinned_note && (
        <Tooltip content={row.pinned_note} placement="bottom">
          <div className="flex items-center gap-1 text-[11px] text-subtle mt-1 min-w-0">
            <Pin size={11} className="shrink-0 text-warning" />
            <span className="truncate">{row.pinned_note}</span>
          </div>
        </Tooltip>
      )}
    </button>
  );
}
