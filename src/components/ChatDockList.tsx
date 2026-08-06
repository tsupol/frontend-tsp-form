import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { ChatListRow } from '../pages/chat/ChatListRow';
import { sortChatRowsByStatusThenRecency } from '../pages/chat/chatStatus';
import type { ChatInboxRow } from '../pages/chat/chatTypes';

/** Rows per page. Small — the dock rail shows ~5 at a time, so a big first
 *  page would just be latency the user never sees. */
const PAGE_SIZE = 20;
/** Distance from the bottom that triggers loading the next page. */
const LOAD_MORE_THRESHOLD_PX = 160;

interface Props {
  selectedContractId: number | null;
  onSelect: (contractId: number) => void;
}

/**
 * The dock's conversation list — infinite scroll, no search.
 *
 * Deliberately different from the full chat page, which uses numbered
 * pagination plus server-side search: in a 380px rail, page buttons and a
 * filter bar cost more room than they earn. Someone hunting a specific old
 * thread should use the chat page; the dock is for what moved recently.
 */
export function ChatDockList({ selectedContractId, onSelect }: Props) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  // Branch label only means something to multi-branch users; branch staff see
  // one branch, so it is noise there.
  const showBranch = !user?.branch_id;

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['chat-dock-inbox'],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await apiClient.getPaginated<ChatInboxRow>(
        '/v_branch_chat_list?order=last_message_at.desc.nullslast',
        { page: (pageParam as number) + 1, pageSize: PAGE_SIZE },
      );
      return res.data;
    },
    getNextPageParam: (lastPage, allPages) => (
      lastPage.length < PAGE_SIZE ? undefined : allPages.length
    ),
  });

  // Same attention-first ordering the chat page applies, so a thread doesn't
  // sit in a different place depending on where you look at it. Sorting the
  // accumulated set (not per page) keeps it stable as pages arrive.
  const rows = useMemo(
    () => sortChatRowsByStatusThenRecency((data?.pages ?? []).flat()),
    [data],
  );

  return (
    <div
      onScroll={e => {
        const el = e.currentTarget;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_THRESHOLD_PX;
        if (nearBottom && hasNextPage && !isFetchingNextPage) fetchNextPage();
      }}
      className="flex-1 min-h-0 overflow-auto better-scroll"
    >
      {isLoading ? (
        <div className="p-8 text-center text-subtle text-sm">{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-subtle text-sm">{t('chat.empty')}</div>
      ) : (
        <div className="flex flex-col">
          {rows.map(row => (
            <ChatListRow
              key={row.contract_id}
              row={row}
              selected={selectedContractId === row.contract_id}
              onSelect={() => onSelect(row.contract_id)}
              showBranch={showBranch}
              lang={i18n.language}
              t={t}
              compact
            />
          ))}
          {isFetchingNextPage && (
            <div className="py-3 text-center text-xs text-subtle">{t('common.loading')}</div>
          )}
        </div>
      )}
    </div>
  );
}
