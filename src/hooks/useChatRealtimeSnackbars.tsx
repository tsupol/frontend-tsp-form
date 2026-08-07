import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbarContext } from 'tsp-form';
import { apiClient } from '../lib/api';
import { wsClient } from '../lib/api/ws';
import { useAuth } from '../contexts/AuthContext';
import { useChatDock } from '../contexts/ChatDockContext';
import { ChatSnackbar } from '../components/ChatSnackbar';
import type { ChatInboxRow } from '../pages/chat/chatTypes';

interface ChatWsPayload {
  type?: string;
  message_id?: number;
  contract_id?: number;
  sender_type?: 'CUSTOMER' | 'STAFF';
  sender_id?: number;
  message_type?: 'TEXT' | 'IMAGE';
  created_at?: string;
}

const RECENT_MS = 5_000;

/**
 * App-wide chat notifier. Subscribes to `chat:contract:<id>` for every contract
 * with a thread in `v_branch_chat_list`. When a new CUSTOMER message arrives
 * and the user isn't already viewing that exact thread, pop a snackbar.
 *
 * - Skips messages the current staff sent themselves.
 * - Skips when the URL is /admin/chat?contract=<that-id>.
 * - First message on a brand-new contract: caught by the 60s inbox poll —
 *   snackbar fires on the next message after that. Acceptable trade-off vs.
 *   a branch-wide subscription whose payload we can't currently rely on.
 */
export function useChatRealtimeSnackbars() {
  const { isAuthenticated, user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { openChat } = useChatDock();
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;

  // Latest values without re-binding WS handlers.
  const locationRef = useRef(location);
  locationRef.current = location;
  const userIdRef = useRef(user?.user_id);
  userIdRef.current = user?.user_id;

  // Fetch the inbox so we know which contract channels to subscribe to. Same
  // query key as ChatPage → React Query dedupes.
  const { data } = useQuery({
    queryKey: ['chat-inbox', 'global'],
    queryFn: () =>
      apiClient.get<ChatInboxRow[]>(
        '/v_branch_chat_list?order=last_message_at.desc.nullslast&limit=200',
      ),
    enabled: isAuthenticated,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!isAuthenticated || !data?.length) return;

    const unsubs: Array<() => void> = [];
    for (const row of data) {
      const contractId = row.contract_id;
      const unsub = wsClient.subscribe(`chat:contract:${contractId}`, (raw) => {
        const payload = raw as ChatWsPayload;
        if (payload?.type !== 'chat_message') return;

        // Drop our own messages
        if (
          payload.sender_type === 'STAFF'
          && payload.sender_id != null
          && payload.sender_id === userIdRef.current
        ) return;

        // Drop if user is viewing this exact thread
        const loc = locationRef.current;
        if (loc.pathname === '/admin/chat') {
          const sp = new URLSearchParams(loc.search);
          if (sp.get('contract') === String(contractId)) return;
        }

        // Drop stale replays (e.g. on reconnect)
        if (payload.created_at) {
          const age = Date.now() - new Date(payload.created_at).getTime();
          if (age > RECENT_MS) return;
        }

        const isImage = payload.message_type === 'IMAGE';
        const sender = row.customer_name?.trim() || t('chat.customer');
        const body = isImage
          ? t('chat.newImage')
          : (row.last_message_text?.trim() || t('chat.newMessage'));

        // Refresh inbox so badge counts + preview update
        queryClient.invalidateQueries({ queryKey: ['chat-inbox'] });
        queryClient.invalidateQueries({ queryKey: ['nav', 'chat-unread'] });

        addSnackbar({
          duration: 6000,
          message: (
            <ChatSnackbar
              sender={sender}
              body={body}
              isImage={isImage}
              onOpen={() => {
                // Desktop pops the floating dock so the user keeps whatever
                // page they were on; mobile has no dock, so it navigates.
                if (window.matchMedia('(min-width: 768px)').matches) {
                  openChatRef.current(contractId);
                } else {
                  navigateRef.current(`/admin/chat?contract=${contractId}`);
                }
              }}
            />
          ),
        });
      });
      unsubs.push(unsub);
    }
    return () => { unsubs.forEach(u => u()); };
  }, [isAuthenticated, data, addSnackbar, queryClient, t]);
}
