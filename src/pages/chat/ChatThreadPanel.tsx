import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  useQuery, useInfiniteQuery, useMutation, useQueryClient, type InfiniteData,
} from '@tanstack/react-query';
import {
  Badge, Button, PopOver, Skeleton, Tooltip, useSnackbarContext, resizeToVariants,
} from 'tsp-form';
import {
  ChevronRight, ChevronDown, CheckCircle, ExternalLink, FileText, Image as ImageIcon, Send, Smile,
  XCircle, AlertTriangle, Check, CheckCheck,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { wsClient } from '../../lib/api/ws';
import { useAuth } from '../../contexts/AuthContext';
import { useChatDock } from '../../contexts/ChatDockContext';
import { fmtCurrency, formatSmart } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { normalizeKey, toStoragePath } from '../../lib/mediaPath';
import { mimeFromKey } from '../../lib/upload';
import { beMediaUpload } from '../../lib/beMedia';
import {
  SubmissionReviewDrawer,
  submissionStatusColor,
  type SubmissionRow,
} from '../../components/SubmissionReviewDrawer';
import { buildChatTimeline, type ChatTimelineItem } from './chatTimeline';
import type { ChatInboxRow, ChatMessage } from './chatTypes';
import {
  ChatStatusBadge, ChatStatusSetterLine, ChatThreadActionsMenu, ChatPinnedNoteRow,
} from './ChatStatusHeader';
import { contractStateBadgeColor, contractStateLabel, lesseeRoleLabel } from './chatStatus';
import { EmojiPicker } from './EmojiPicker';
import { pushRecentEmoji } from './emojiData';
import { translateApiError } from '../../lib/apiErrors';

const MAX_TEXTAREA_LINES = 6;
const TEXTAREA_LINE_HEIGHT_PX = 20;
/** Messages per keyset page (doc 66 §④ specifies 50). */
const MESSAGE_PAGE_SIZE = 50;
/** Distance from the top that triggers loading the previous page. */
const LOAD_OLDER_THRESHOLD_PX = 120;
/**
 * How far up the user can be before incoming messages stop following. Expressed
 * as a fraction of the visible height rather than a fixed pixel count: scrolling
 * up by half a screen is a deliberate "I'm reading back" gesture at any panel
 * size, whereas a fixed threshold is trigger-happy in the tall chat page and
 * lenient in the short dock.
 */
const FOLLOW_BOTTOM_FRACTION = 0.5;
/** Distance from the bottom past which the scroll-to-bottom button appears. */
const SHOW_JUMP_BUTTON_PX = 200;

interface Props {
  contractId: number | null;
  /** If null, image clicks are no-ops. Lift to parent to open MediaLightbox. */
  onOpenImage: (key: string) => void;
  /** Hide the desktop header (e.g. when the parent layout shows its own title). */
  hideDesktopHeader?: boolean;
  /** Whether the mobile-only details strip (contract code + link) is open. */
  mobileDetailsOpen?: boolean;
  /** Set when this panel IS the floating dock. Suppresses the "carry this
   *  thread into the dock" behaviour on the contract link — the thread is
   *  already there, and re-opening would be a no-op that hides the list. */
  inDock?: boolean;
}

export function ChatThreadPanel({
  contractId, onOpenImage, hideDesktopHeader, mobileDetailsOpen, inDock,
}: Props) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const { openChat } = useChatDock();

  // Leaving the chat page for the contract shouldn't drop the conversation:
  // carry it into the floating dock so it's still open when you land there.
  // No-op when this panel already IS the dock.
  const handleContractLinkClick = () => {
    if (!inDock && contractId !== null) openChat(contractId);
  };

  const [composer, setComposer] = useState('');
  const [sendError, setSendError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedSlip, setSelectedSlip] = useState<SubmissionRow | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  /** Bumped on send so the scroll effect re-runs immediately, not on the next poll. */
  const [sendTick, setSendTick] = useState(0);
  /**
   * Newest message that arrived while the user was reading back, shown in the
   * jump-to-bottom bar. Null when the view is following the bottom normally.
   */
  const [pendingBelow, setPendingBelow] = useState<ChatMessage | null>(null);
  /**
   * True while the view is scrolled away from the bottom, driving the
   * scroll-to-bottom affordance. Mirrors what `stickToBottom` tracks in a ref —
   * the ref is read inside effects where a re-render would be wrong, this is
   * for rendering.
   */
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const enabled = contractId !== null && !Number.isNaN(contractId);

  const { data: inboxRow } = useQuery({
    queryKey: ['chat-thread-meta', contractId],
    queryFn: async () => {
      const rows = await apiClient.get<ChatInboxRow[]>(
        `/v_branch_chat_list?contract_id=eq.${contractId}&limit=1`,
      );
      return rows[0] ?? null;
    },
    enabled,
  });

  // Messages are keyset-paged, newest page first (doc 66 §4 / IMPLEMENT §④).
  // Offset paging is wrong for chat: the set grows at the head, so OFFSET n
  // shifts under us and page 2 repeats or skips a row. The cursor is the
  // oldest created_at we already hold, which no insert can disturb.
  //
  // We fetch DESC (there is no way to ask for "the newest 50" ascending) and
  // reverse per page at the flatten step so the timeline stays oldest-first.
  const {
    data: messagePages,
    isLoading,
    fetchNextPage: fetchOlderMessages,
    hasNextPage: hasOlderMessages,
    isFetchingNextPage: isFetchingOlderMessages,
  } = useInfiniteQuery({
    queryKey: ['chat-messages', contractId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiClient.get<ChatMessage[]>(
      `/v_branch_chat_messages?contract_id=eq.${contractId}`
      + `&order=created_at.desc,id.desc&limit=${MESSAGE_PAGE_SIZE}`
      + (pageParam ? `&created_at=lt.${encodeURIComponent(pageParam)}` : ''),
    ),
    // A short page means we reached the start of the thread.
    getNextPageParam: (lastPage) => (
      lastPage.length < MESSAGE_PAGE_SIZE
        ? undefined
        : lastPage[lastPage.length - 1]?.created_at ?? undefined
    ),
    enabled,
    // No refetchInterval: the WS subscription below appends live. Polling the
    // whole thread every 15s was the thing this page-size change is meant to
    // stop paying for.
  });

  // Pages arrive newest-first, each page internally DESC. Reverse both levels
  // to get one flat oldest-first list for the timeline builder.
  const messages = useMemo(
    () => (messagePages?.pages ?? []).slice().reverse().flatMap(page => page.slice().reverse()),
    [messagePages],
  );
  /** Latest messages, for effects that must not re-run when they change. */
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  // Slips for the same contract — merged into the timeline alongside messages.
  // See UI_FEEDBACK/2026-06-02_RECOMMEND_chat_slip_interleaved_timeline_pattern.md
  const { data: submissions = [] } = useQuery({
    queryKey: ['chat-thread-submissions', contractId],
    queryFn: () => apiClient.get<SubmissionRow[]>(
      `/v_payment_submissions?contract_id=eq.${contractId}&order=submitted_at.asc&limit=100`,
    ),
    enabled,
    refetchInterval: 30_000,
  });

  // Refresh ONLY the newest page and merge it over the cache. Used by both the
  // WS event and our own send — neither may invalidate ['chat-messages'],
  // because invalidating an infinite query refetches EVERY loaded page (ten
  // pages back = whole thread re-downloaded per message, the exact cost keyset
  // paging exists to avoid).
  //
  // Refetching page 0 rather than only fetching rows newer than the newest
  // cached one costs the same single request but also catches mutations to
  // rows already on screen — is_read flipping when the customer reads our
  // message. A newer-than cursor structurally cannot see those.
  const refreshNewestMessages = useCallback(async () => {
    if (contractId === null) return;
    const key = ['chat-messages', contractId];

    // Nothing cached yet — let the normal query populate page 0.
    if (!queryClient.getQueryData<InfiniteData<ChatMessage[]>>(key)) {
      queryClient.invalidateQueries({ queryKey: key });
      return;
    }

    const newestPage = await apiClient.get<ChatMessage[]>(
      `/v_branch_chat_messages?contract_id=eq.${contractId}`
      + `&order=created_at.desc,id.desc&limit=${MESSAGE_PAGE_SIZE}`,
    );

    queryClient.setQueryData<InfiniteData<ChatMessage[]>>(key, (prev) => {
      if (!prev) return prev;
      const [, ...older] = prev.pages;
      // Older pages may already hold rows that the refreshed page 0 now also
      // covers (page 0 always starts at the head, so a quiet thread re-reads
      // the same rows). Drop those from page 0 — keeping the older page's copy
      // preserves the cursor chain, which is derived from page boundaries.
      const inOlderPages = new Set(older.flat().map(m => m.id));
      const head = newestPage.filter(m => !inOlderPages.has(m.id));
      return { ...prev, pages: [head, ...older] };
    });
  }, [contractId, queryClient]);

  // Reset composer state when switching threads
  useEffect(() => {
    setComposer('');
    setSendError('');
    setEmojiOpen(false);
    // A freshly opened thread starts pinned to its newest message.
    stickToBottom.current = true;
    wasAtBottom.current = 0;
    setPendingBelow(null);
    // Re-baseline: the next thread's newest message is not "new".
    lastAnnounced.current = null;
  }, [contractId]);

  // Marks the WHOLE room read (chat_mark_read is idempotent). Fired on open and
  // again whenever a customer message lands while the room is on screen — an
  // open-only mark leaves mid-conversation arrivals unread in the DB, so the
  // inbox and nav badge count messages the user is literally looking at.
  //
  // A hidden tab defers the mark until the tab is visible again: the customer's
  // app renders is_read as a read receipt, and auto-marking a room nobody is
  // looking at would fake it.
  const pendingMarkRead = useRef(false);
  const markRead = useCallback(() => {
    if (contractId === null) return;
    if (document.visibilityState !== 'visible') { pendingMarkRead.current = true; return; }
    pendingMarkRead.current = false;
    apiClient.rpc('chat_mark_read', { p_contract_id: contractId })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['chat-inbox'] });
        queryClient.invalidateQueries({ queryKey: ['nav', 'counters'] });
      })
      .catch(err => console.warn('[chat] mark_read failed', err));
  }, [contractId, queryClient]);

  const markedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || contractId === null) return;
    if (markedRef.current === contractId) return;
    markedRef.current = contractId;
    markRead();
  }, [contractId, enabled, markRead]);

  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.visibilityState === 'visible' && pendingMarkRead.current) markRead();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled, markRead]);

  // Realtime: subscribe to chat:contract:<id> + slip:contract:<id> while the
  // thread is open. Either event reloads both queries — the timeline merge
  // re-runs and re-renders. Polling stays as fallback.
  //
  // chat:branch:<id> is subscribed by ChatPage globally; status / pinned-note
  // events flow through there and invalidate ['chat-inbox'], which the meta
  // query rides on. We still refetch the meta + audit log here so a status
  // flip from another tab updates the open thread's header instantly.
  useEffect(() => {
    if (!enabled || contractId === null) return;

    // Sidecar queries are cheap single rows — plain invalidate is fine.
    const reloadSidecars = () => {
      queryClient.invalidateQueries({ queryKey: ['chat-thread-submissions', contractId] });
      queryClient.invalidateQueries({ queryKey: ['chat-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['chat-thread-meta', contractId] });
      queryClient.invalidateQueries({ queryKey: ['chat-thread-status-log', contractId] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'chat-unread'] });
    };

    // Messages refresh page 0 rather than invalidate — see refreshNewestMessages.
    const onChatEvent = (raw: unknown) => {
      refreshNewestMessages().catch(err => console.warn('[chat] refresh failed', err));
      reloadSidecars();
      // A customer message landing in the open room is being read right now —
      // mark it before the user has to leave and re-enter the thread.
      const p = raw as { type?: string; sender_type?: string };
      if (p?.type === 'chat_message' && p.sender_type === 'CUSTOMER') markRead();
    };

    const unsubChat = wsClient.subscribe(`chat:contract:${contractId}`, onChatEvent);
    const unsubSlip = wsClient.subscribe(`slip:contract:${contractId}`, reloadSidecars);
    return () => { unsubChat(); unsubSlip(); };
  }, [contractId, enabled, queryClient, refreshNewestMessages, markRead]);

  // Snapshot the first unread CUSTOMER message ID on initial load — this
  // pins the "unread below" divider so it stays put as the user reads, just
  // like Slack / iMessage. Resets when the user switches contracts.
  const [unreadAnchorId, setUnreadAnchorId] = useState<number | null>(null);
  const anchorSnapshotForContract = useRef<number | null>(null);
  useEffect(() => {
    anchorSnapshotForContract.current = null;
    setUnreadAnchorId(null);
  }, [contractId]);
  useEffect(() => {
    if (anchorSnapshotForContract.current === contractId) return;
    if (!messages.length) return;
    const firstUnread = messages.find(m => m.sender_type === 'CUSTOMER' && !m.is_read);
    setUnreadAnchorId(firstUnread ? firstUnread.id : null);
    anchorSnapshotForContract.current = contractId;
  }, [messages, contractId]);

  // Auto-scroll: jump to bottom whenever the contract changes (so a freshly
  // opened thread lands at the latest item) or when new messages/slips arrive.
  const lastSeenCount = useRef(0);
  const lastSeenContract = useRef<number | null>(null);
  const itemCount = messages.length + submissions.length;

  // Prepending older messages grows the content ABOVE the viewport. The browser
  // holds scrollTop fixed, so the view appears to jump backwards. Capture the
  // height before the page lands and restore the delta after, which pins the
  // row the user was reading. (CSS overflow-anchor does this natively but
  // Safari doesn't implement it, so the manual restore stays.)
  const pendingPrependHeight = useRef<number | null>(null);
  // Set when the user sends: their own message must always land at the bottom,
  // even if they had scrolled up to read history. Incoming messages don't get
  // this — yanking someone away from what they're reading is worse than a
  // missed scroll, and the count comparison already handles the common case
  // where they're sitting at the bottom.
  const forceScrollBottom = useRef(false);
  // How far from the bottom the user was BEFORE this render. Measured on the
  // scroll event, because by the time a layout effect runs the new message has
  // already grown the content and the distance no longer reflects intent.
  const wasAtBottom = useRef(0);
  // While true, any content growth re-pins the view to the bottom. Set when we
  // scroll there; cleared as soon as the user scrolls up.
  const stickToBottom = useRef(true);
  /** Last message id surfaced in the jump-to-bottom bar, so it isn't re-announced. */
  const lastAnnounced = useRef<number | null>(null);
  const loadOlderMessages = () => {
    if (!hasOlderMessages || isFetchingOlderMessages || !scrollRef.current) return;
    // Reading history — the prepend must not be yanked back to the bottom.
    stickToBottom.current = false;
    pendingPrependHeight.current = scrollRef.current.scrollHeight;
    fetchOlderMessages();
  };

  // Announce a message that landed while the user was reading back.
  //
  // Keyed on the newest message ID, NOT on itemCount: the two scroll effects
  // below both write lastSeenCount, and whichever runs first leaves the other
  // seeing "no new items". Tracking the ID sidesteps that bookkeeping entirely
  // and is also correct when a prepend and an arrival land in the same pass.
  const newestMessageId = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (newestMessageId === null) return;
    // First render of a thread establishes the baseline; nothing is "new" yet.
    if (lastAnnounced.current === null) {
      lastAnnounced.current = newestMessageId;
      return;
    }
    if (newestMessageId === lastAnnounced.current) return;
    lastAnnounced.current = newestMessageId;
    // Following the bottom — the message is about to be visible anyway.
    if (stickToBottom.current) return;
    setPendingBelow(messagesRef.current[messagesRef.current.length - 1] ?? null);
  }, [newestMessageId]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || pendingPrependHeight.current === null) return;
    const delta = el.scrollHeight - pendingPrependHeight.current;
    pendingPrependHeight.current = null;
    if (delta > 0) el.scrollTop += delta;
    // Keep the bottom-scroll effect from reading this growth as new messages.
    lastSeenCount.current = itemCount;
  }, [itemCount]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const contractChanged = lastSeenContract.current !== contractId;
    const newItems = itemCount > lastSeenCount.current;
    const forced = forceScrollBottom.current;
    if (!contractChanged && !newItems && !forced) return;
    // Only clear the force flag once the sent message has actually landed.
    // setQueryData resolves a tick or two after onSuccess, so clearing it on
    // the first render after send would consume it before the new row exists —
    // the scroll then waited for the next poll (~5s late).
    if (forced && newItems) forceScrollBottom.current = false;

    // An incoming message only pulls the view down if the user was already at
    // the bottom. Someone who scrolled up to read history keeps their place —
    // being yanked away mid-sentence is worse than having to scroll down. Our
    // OWN sends bypass this (forced), as does opening a thread.
    //
    // wasAtBottom is captured on the scroll event, i.e. BEFORE this render grew
    // the content. Measuring here instead would include the new message's own
    // height and read as "scrolled up" every time.
    if (newItems && !contractChanged && !forced
        && wasAtBottom.current > el.clientHeight * FOLLOW_BOTTOM_FRACTION) {
      // The bar itself is driven by the newest-message-ID effect above.
      lastSeenCount.current = itemCount;
      return;
    }

    // On contract change, prefer the unread divider as the landing position
    // (Slack / Line behavior) so the user sees context above + new below.
    // Falls through to bottom-scroll when no divider is present or new items
    // arrived without a contract switch.
    let scrolled = false;
    if (contractChanged && !forced) {
      const divider = el.querySelector<HTMLElement>('[data-chat-unread-divider]');
      if (divider) {
        divider.scrollIntoView({ block: 'center' });
        scrolled = true;
        // Landed mid-thread on purpose — don't let the pin drag it down.
        stickToBottom.current = false;
      }
    }
    if (!scrolled) {
      const pin = () => {
        el.scrollTop = el.scrollHeight;
        // Keep the follow-check honest: a programmatic scroll may not fire a
        // scroll event before the next message arrives, and a stale distance
        // would read as "user scrolled up" and stop following.
        wasAtBottom.current = 0;
      };
      pin();

      // The content keeps growing AFTER this effect runs: the optimistic
      // bubble is replaced by the server row, images resolve their intrinsic
      // size, text rewraps. Measured on a real send — the effect pinned
      // correctly at t=198ms, then the list grew 33px at t=243ms and the view
      // was left short. Watch for those late changes and re-pin.
      stickToBottom.current = true;
    }
    lastSeenCount.current = itemCount;
    lastSeenContract.current = contractId;
  }, [contractId, itemCount, unreadAnchorId, sendTick]);

  // Hold the view at the bottom while `stickToBottom` is set, re-pinning on
  // every size change until the user scrolls away.
  //
  // Chasing the settle with a timer did not work: content grows in several
  // late bursts (optimistic bubble -> server row -> image/text reflow) and a
  // fixed window sometimes closed first, leaving the newest message 40-80px
  // below the fold on roughly half of sends. A standing observer has no such
  // race — it simply re-pins whenever the content moves.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = el.firstElementChild ?? el;
    const observer = new ResizeObserver(() => {
      if (!stickToBottom.current) return;
      el.scrollTop = el.scrollHeight;
      wasAtBottom.current = 0;
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [contractId, itemCount]);

  // Auto-resize the textarea between 1 and MAX_TEXTAREA_LINES.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = MAX_TEXTAREA_LINES * TEXTAREA_LINE_HEIGHT_PX;
    const desired = Math.min(el.scrollHeight, max);
    el.style.height = `${desired}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [composer]);

  const sendMutation = useMutation({
    mutationFn: async (payload: { text: string; mediaId: number | null }) => {
      return apiClient.rpc('staff_chat_send', {
        p_contract_id: contractId,
        p_message_text: payload.text || null,
        p_media_id: payload.mediaId,
      });
    },
    onSuccess: () => {
      setComposer('');
      setSendError('');
      // Our own message always lands at the bottom, wherever the user was.
      // The bump re-runs the scroll effect, whose deps would otherwise not
      // change until the new row arrives from setQueryData.
      forceScrollBottom.current = true;
      stickToBottom.current = true;
      // Sending jumps us to the bottom, so nothing is left unseen below.
      setPendingBelow(null);
      setSendTick(n => n + 1);
      // Pull our own message in too — the WS echo may not come back to the
      // sender, and invalidating would refetch every loaded page.
      refreshNewestMessages().catch(err => console.warn('[chat] refresh failed', err));
      queryClient.invalidateQueries({ queryKey: ['chat-inbox'] });
    },
    onError: (err) => {
      setSendError(translateApiError(err, t));
    },
    // The textarea is disabled while the send is in flight, which drops focus to
    // <body>. Re-focus once it is interactive again so the caret never leaves
    // the composer — typing the next message must not need a click.
    onSettled: () => {
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
  });

  const handleSend = () => {
    const text = composer.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate({ text, mediaId: null });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Insert an emoji at the textarea caret (or append when unfocused), keep the
  // picker open for multi-emoji bursts, and bump it to the front of recents.
  const handleEmojiPick = (char: string) => {
    pushRecentEmoji(char);
    const el = textareaRef.current;
    setComposer(prev => {
      if (!el) return prev + char;
      const start = el.selectionStart ?? prev.length;
      const end = el.selectionEnd ?? prev.length;
      const next = prev.slice(0, start) + char + prev.slice(end);
      // Restore caret after the inserted glyph once React re-renders.
      requestAnimationFrame(() => {
        const pos = start + char.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      });
      return next;
    });
  };

  const uploadImage = async (file: File) => {
    if (!enabled || contractId === null) return;
    if (!file.type.startsWith('image/')) {
      setSendError(t('chat.imageInvalid'));
      return;
    }
    if (!user?.holding_id) {
      setSendError(t('chat.sendFailed'));
      return;
    }
    setSendError('');
    setUploading(true);
    try {
      // idx makes the R2 key unique per image (the leaf is chat-{idx}-{size}.{ext}).
      // Must be unique per upload, NOT a count of existing images — sending two
      // images before the message list refetches gives the same count and the
      // deterministic key collides (both overwrite one object). Timestamp is
      // unique per send and shared between this message's sm + lg variants.
      const idx = Date.now();
      // Resize to both variants in one pass: lg = full-screen source, sm =
      // bubble thumbnail. webp output, JPEG fallback on Safari < 17.4 (mime
      // reported honestly by resizeToVariants).
      const variants = await resizeToVariants(file, {
        sm: { maxWidth: 320, maxHeight: 320, quality: 0.82, format: 'webp', mode: 'contain' },
        lg: { maxWidth: 1280, maxHeight: 1280, quality: 0.82, format: 'webp', mode: 'contain' },
      });
      const smFile = variants.sm.file;
      const lgFile = variants.lg.file;
      const [smResult, lgResult] = await Promise.all([
        beMediaUpload({ type: 'chat_image', file: smFile, size: 'sm', params: { contract_id: contractId, idx } }),
        beMediaUpload({ type: 'chat_image', file: lgFile, size: 'lg', params: { contract_id: contractId, idx } }),
      ]);
      const attached = await apiClient.rpc<{ media_id: number }>('fn_media_attach', {
        p_holding_id: user.holding_id,
        p_storage_path: toStoragePath(lgResult.key),
        p_variants_json: { sm: toStoragePath(smResult.key), lg: toStoragePath(lgResult.key) },
        p_media_type: 'IMAGE',
        p_access_level: 'CONFIDENTIAL',
        p_mime_type: mimeFromKey(lgResult.key),
        p_file_size_bytes: lgFile.size,
        // Clipboard images arrive with no name at all — fall back so the
        // record never carries an empty filename.
        p_original_filename: file.name || lgFile.name,
        p_entity_type: 'CHAT_MESSAGE',
        p_entity_id: contractId,
        p_usage_type: 'CHAT_IMAGE',
        p_sort_order: 0,
        p_caption: null,
      });
      sendMutation.mutate({ text: '', mediaId: attached.media_id });
    } catch (err) {
      setSendError(translateApiError(err, t));
    } finally {
      setUploading(false);
      // Same reason as the send mutation: uploading disables the composer, so
      // put the caret back once it is usable again.
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void uploadImage(file);
  };

  /**
   * Paste-to-send: screenshots land on the clipboard as an image item with no
   * name. Text pastes carry no file item, so they fall through to the default
   * textarea behaviour untouched.
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (sendMutation.isPending || uploading) return;
    const item = Array.from(e.clipboardData.items).find(
      i => i.kind === 'file' && i.type.startsWith('image/'),
    );
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    // Only now claim the event — an image is going up, so the browser must not
    // also drop its filename into the composer.
    e.preventDefault();
    void uploadImage(file);
  };

  /** Catch up to the newest message and resume following it. */
  const jumpToNewest = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottom.current = true;
    wasAtBottom.current = 0;
    setPendingBelow(null);
    setAwayFromBottom(false);
  };

  const timeline = useMemo(
    () => buildChatTimeline(messages, submissions, unreadAnchorId),
    [messages, submissions, unreadAnchorId],
  );

  if (contractId === null) {
    return (
      <div className="h-full flex items-center justify-center text-subtler p-8">
        {t('chat.selectToView')}
      </div>
    );
  }

  const title = inboxRow?.customer_name ?? t('chat.title');

  // Multi-branch users (company / holding, no branch_id) see chats from every
  // สาขา — surface which branch this thread belongs to. Branch users see one
  // branch only, so the label is redundant and hidden.
  const showBranch = !user?.branch_id;

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full relative">
      {!hideDesktopHeader && (
        <div className="flex-none hidden md:flex items-start justify-between gap-3 px-4 py-3 border-b border-line">
          <div className="min-w-0 flex-1 flex flex-col gap-1">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="text-sm font-medium truncate">{title}</span>
              {inboxRow && <ChatStatusBadge row={inboxRow} />}
              {inboxRow && <ContractStateBadge row={inboxRow} />}
            </div>
            {inboxRow && <ChatStatusSetterLine row={inboxRow} lang={i18n.language} />}
            {inboxRow && (
              <div className="text-xs text-subtle flex items-center gap-2">
                <Link
                  to={`/admin/contracts/search/${contractId}`}
                  onClick={handleContractLinkClick}
                  className="inline-flex items-center gap-1 text-primary-fg hover:underline tabular-nums"
                >
                  {inboxRow.contract_code_display}
                  <ExternalLink size={12} />
                </Link>
                <span>·</span>
                <span>{t('chat.messageCount', { count: inboxRow.total_messages })}</span>
                {showBranch && inboxRow.branch_name && (
                  <>
                    <span>·</span>
                    <Badge size="xs" color="secondary">{inboxRow.branch_name}</Badge>
                  </>
                )}
              </div>
            )}
            {inboxRow && <ChatCustomerRoster row={inboxRow} />}
          </div>
          {inboxRow && (
            <ChatThreadActionsMenu contractId={contractId} inboxRow={inboxRow} />
          )}
        </div>
      )}

      {/* Mobile-only collapsible details — overlays the top of the message
          list so toggling doesn't push content down. Chevron in MobileHeader
          drives the open state via prop. */}
      {inboxRow && mobileDetailsOpen && (
        <div className="md:hidden absolute top-0 left-0 right-0 z-10 bg-bg border-b border-line shadow-sm animate-fade-in">
          <div className="px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 flex flex-col gap-1">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span className="text-sm font-medium truncate">{inboxRow.customer_name ?? t('chat.title')}</span>
                <ChatStatusBadge row={inboxRow} />
                <ContractStateBadge row={inboxRow} />
              </div>
              <ChatStatusSetterLine row={inboxRow} lang={i18n.language} />
              <div className="text-xs text-subtle flex items-center gap-2">
                <Link
                  to={`/admin/contracts/search/${contractId}`}
                  onClick={handleContractLinkClick}
                  className="inline-flex items-center gap-1 text-primary-fg hover:underline tabular-nums"
                >
                  {inboxRow.contract_code_display}
                  <ExternalLink size={12} />
                </Link>
                <span>·</span>
                <span>{t('chat.messageCount', { count: inboxRow.total_messages })}</span>
                {showBranch && inboxRow.branch_name && (
                  <>
                    <span>·</span>
                    <Badge size="xs" color="secondary">{inboxRow.branch_name}</Badge>
                  </>
                )}
              </div>
              <ChatCustomerRoster row={inboxRow} />
            </div>
            <ChatThreadActionsMenu contractId={contractId} inboxRow={inboxRow} />
          </div>
        </div>
      )}

      {/* Pinned-note row — only renders when a note exists. Has its own
          ... menu for edit / clear. */}
      {inboxRow && (
        <ChatPinnedNoteRow contractId={contractId} inboxRow={inboxRow} lang={i18n.language} />
      )}

      {/* Payment-blocked warning — driven by contract_can_receive_payment,
          never derived from state code (BE §3). Staff must not tell the
          customer to transfer money on a contract that can't receive it. */}
      {inboxRow?.contract_can_receive_payment === false && (
        <div className="flex-none px-3 py-2 border-b border-line">
          <div className="alert alert-danger">
            <AlertTriangle size={16} />
            <span>{t('chat.cannotReceivePayment')}</span>
          </div>
        </div>
      )}

      {/* Scrollable timeline (chat + slips merged). The relative wrapper anchors
          the jump-to-bottom bar over the timeline's lower edge without letting
          it scroll away with the content. */}
      <div className="flex-1 min-h-0 relative flex flex-col">
      <div
        ref={scrollRef}
        onScroll={e => {
          const el = e.currentTarget;
          const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          wasAtBottom.current = fromBottom;
          // Scrolling away releases the pin; scrolling back re-arms it.
          const nearBottom = fromBottom <= el.clientHeight * FOLLOW_BOTTOM_FRACTION;
          stickToBottom.current = nearBottom;
          // Back in the live zone — the bar has nothing left to announce.
          if (nearBottom && pendingBelow) setPendingBelow(null);
          // The button appears on any real scroll-away, well before the
          // half-screen point where following stops — otherwise there is a dead
          // zone where the view is off the bottom with no way back.
          setAwayFromBottom(fromBottom > SHOW_JUMP_BUTTON_PX);
          if (el.scrollTop <= LOAD_OLDER_THRESHOLD_PX) loadOlderMessages();
        }}
        className="flex-1 min-h-0 overflow-auto better-scroll px-3 py-3 md:px-8"
      >
        {isLoading ? (
          <div className="text-center text-subtle p-8">{t('common.loading')}</div>
        ) : timeline.length === 0 ? (
          <div className="text-center text-subtle p-8">{t('chat.emptyThread')}</div>
        ) : (
          <div className="flex flex-col gap-3">
            {isFetchingOlderMessages && (
              <div className="text-center text-xs text-subtle py-2">{t('chat.loadingOlder')}</div>
            )}
            {timeline.map((item, i) => {
              // Suppress the sender label when this message continues a run
              // from the same sender within 5 minutes — LINE/iMessage style.
              let showSender = true;
              if (item.kind === 'message') {
                const prev = timeline[i - 1];
                if (
                  prev?.kind === 'message'
                  && prev.data.sender_type === item.data.sender_type
                  && (item.timestamp.getTime() - prev.timestamp.getTime()) < 5 * 60_000
                ) {
                  showSender = false;
                }
              }
              return (
                <TimelineRow
                  key={item.id}
                  item={item}
                  showSender={showSender}
                  currentUserId={user?.user_id ?? null}
                  lang={i18n.language}
                  onOpenImage={onOpenImage}
                  onOpenSlip={setSelectedSlip}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Scroll-to-bottom button — any time the view is off the bottom, with or
          without a new message. Sits above the preview bar when both show, so
          the two never overlap. */}
      {awayFromBottom && !pendingBelow && (
        <button
          type="button"
          onClick={jumpToNewest}
          aria-label={t('chat.scrollToBottom')}
          title={t('chat.scrollToBottom')}
          className="absolute right-3 bottom-1.5 md:right-8 z-10 flex items-center justify-center w-9 h-9 rounded-full border border-line bg-surface-elevated/95 backdrop-blur shadow-lg cursor-pointer hover:bg-surface-hover transition-colors animate-pop-in"
        >
          <ChevronDown size={18} className="text-subtle" />
        </button>
      )}

      {/* Jump-to-bottom bar — appears only when a message arrived while the
          user was reading back. One line, truncated, click to catch up. */}
      {pendingBelow && (
        <button
          type="button"
          onClick={jumpToNewest}
          className="absolute left-3 right-3 bottom-1.5 md:left-8 md:right-8 z-10 flex items-center gap-2 min-w-0 px-3 py-2 rounded-full border border-line bg-surface-elevated/95 backdrop-blur shadow-lg text-left cursor-pointer hover:bg-surface-hover transition-colors animate-pop-in"
        >
          {/* Who it's from, capped so a long name can't crowd out the preview.
              min-w-0 + max-w (not shrink-0) so `truncate` has a bounded box. */}
          <span className="min-w-0 max-w-[8rem] truncate text-xs font-medium text-primary-fg">
            {pendingBelow.sender_name?.trim()
              || (pendingBelow.sender_type === 'CUSTOMER' ? t('chat.customer') : t('chat.staff'))}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-subtle">
            {pendingBelow.message_type === 'IMAGE'
              ? t('chat.imageMessage')
              : (pendingBelow.message_text ?? '')}
          </span>
          <ChevronDown size={14} className="shrink-0 text-subtle" />
        </button>
      )}
      </div>

      {/* Composer pinned at panel bottom */}
      <div className="flex-none bg-bg px-1 pb-1 md:px-3 md:pb-3">
        {sendError && (
          <div className="alert alert-danger mb-2 animate-pop-in">
            <XCircle size={16} />
            <div><div className="alert-description text-xs">{sendError}</div></div>
          </div>
        )}
        <div className="rounded-lg md:rounded-2xl border border-line bg-bg shadow-sm flex flex-col">
          <textarea
            ref={textareaRef}
            rows={1}
            value={composer}
            onChange={e => setComposer(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t('chat.composerPlaceholder')}
            disabled={sendMutation.isPending || uploading}
            className="w-full resize-none bg-transparent border-0 outline-0 px-3 pt-3 pb-1 text-xs md:text-sm leading-5 placeholder:text-subtle"
            style={{ minHeight: TEXTAREA_LINE_HEIGHT_PX }}
          />
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="btn-icon-sm"
                startIcon={<ImageIcon size={18} />}
                onMouseDown={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                disabled={sendMutation.isPending || uploading}
                aria-label={t('chat.attachImage')}
                title={t('chat.attachImage')}
              />
              <PopOver
                isOpen={emojiOpen}
                onClose={() => setEmojiOpen(false)}
                placement="top"
                align="start"
                offset={8}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="btn-icon-sm"
                    startIcon={<Smile size={18} />}
                    onClick={() => setEmojiOpen(o => !o)}
                    disabled={sendMutation.isPending || uploading}
                    aria-label={t('chat.emoji.button')}
                    title={t('chat.emoji.button')}
                  />
                }
              >
                <EmojiPicker onPick={handleEmojiPick} />
              </PopOver>
            </div>
            <div className="flex items-center gap-2">
              {uploading && (
                <span className="text-xs text-subtle">{t('chat.uploading')}</span>
              )}
              <Button
                color="primary"
                size="sm"
                className="btn-icon-sm"
                startIcon={<Send size={16} />}
                disabled={!composer.trim() || sendMutation.isPending || uploading}
                // Keep the caret in the composer: without this the button takes
                // focus, then goes disabled as the text clears, stranding focus
                // on <body>.
                onMouseDown={e => e.preventDefault()}
                onClick={handleSend}
                aria-label={t('chat.send')}
              />
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <SubmissionReviewDrawer
        row={selectedSlip}
        open={!!selectedSlip}
        onClose={() => setSelectedSlip(null)}
        onSuccess={(action) => {
          setSelectedSlip(null);
          queryClient.invalidateQueries({ queryKey: ['chat-thread-submissions', contractId] });
          queryClient.invalidateQueries({ queryKey: ['payment-submissions'] });
          queryClient.invalidateQueries({ queryKey: ['payment-submissions-pending-count'] });
          queryClient.invalidateQueries({ queryKey: ['nav', 'pending-submissions-summary'] });
          const key =
            action === 'approve' ? 'paymentSubmissions.approveSuccess'
              : action === 'reject' ? 'paymentSubmissions.rejectSuccess'
                : 'paymentSubmissions.reopenSuccess';
          addSnackbar({
            type: 'success',
            message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t(key)}</span></div>,
          });
        }}
      />
    </div>
  );
}

function TimelineRow({ item, showSender, currentUserId, lang, onOpenImage, onOpenSlip }: {
  item: ChatTimelineItem;
  showSender: boolean;
  currentUserId: number | null;
  lang: string;
  onOpenImage: (key: string) => void;
  onOpenSlip: (row: SubmissionRow) => void;
}) {
  const { t } = useTranslation();

  if (item.kind === 'daySeparator') {
    return <DaySeparator dayKey={item.key} />;
  }

  if (item.kind === 'unreadDivider') {
    return <UnreadDivider />;
  }

  if (item.kind === 'slip') {
    return (
      <SlipEventCard submission={item.data} lang={lang} onOpen={() => onOpenSlip(item.data)} />
    );
  }

  const m = item.data;
  const isStaff = m.sender_type === 'STAFF';
  const isOwn = isStaff && currentUserId === m.sender_id;
  const align = isStaff ? 'items-end' : 'items-start';
  // Name both sides. A thread can hold more than one customer — LESSEE + any
  // CO_LESSEE join the same chat from the app — so naming the customer sender
  // tells staff which obligor said what. v_branch_chat_messages.sender_name
  // resolves the ACTUAL sender (with prefix) for CUSTOMER rows (mig 016/07).
  // Own staff messages keep the "(You)" suffix so you can self-spot.
  const baseName = isStaff
    ? (m.sender_name ?? t('chat.unknownStaff', { defaultValue: 'Staff' }))
    : (m.sender_name ?? t('chat.unknownCustomer', { defaultValue: 'Customer' }));
  const senderLabel = isStaff && isOwn
    ? `${baseName} ${t('chat.youSuffix', { defaultValue: '(You)' })}`
    : baseName;

  // LINE-style layout: sender name on top of a new run, bubble on its own
  // row with the wall-clock time on the *outside* edge (left of staff
  // bubbles, right of customer bubbles), bottom-aligned.
  const clock = new Date(m.created_at).toLocaleTimeString(
    lang === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB',
    { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok', hour12: false },
  );
  // Read receipt — STAFF bubbles only. `is_read` always means "the OTHER side
  // read it", so on a CUSTOMER bubble it would say "staff read it", which is
  // noise to the staffer reading the screen. LINE-style: ✓ grey = no record
  // yet, ✓✓ blue + time = the customer's app opened the room.
  // chat_mark_read marks the WHOLE room at once, so read_at is when they opened
  // the room, not when they read this line — hence "เปิดอ่าน", never "read this
  // message at". And never write "customer hasn't read it": the app can
  // auto-mark a room left open, and a lock-screen banner leaves no record at
  // all, so both directions produce false readings.
  const timeNode = (
    <span className="flex flex-col items-end gap-0.5 shrink-0 self-end pb-1">
      <span className="text-[10px] text-subtle tabular-nums">{clock}</span>
      {isStaff && <ReadReceipt isRead={m.is_read} readAt={m.read_at} lang={lang} />}
    </span>
  );
  // Co-lessee tag beside the sender name (mig 843). Only for CO_LESSEE
  // customers — STAFF sender_role is null, PRIMARY is the default and skipped
  // to avoid clutter. Unknown roles fall back to the raw code.
  const showCoLesseeTag = !isStaff && m.sender_role === 'CO_LESSEE';
  return (
    <div className={`flex flex-col ${align} ${showSender && senderLabel ? 'gap-1 mt-1' : 'gap-0.5 -mt-2'}`}>
      {showSender && senderLabel && (
        <div className="text-[11px] text-subtle px-1 flex items-center gap-1">
          <span>{senderLabel}</span>
          {showCoLesseeTag && (
            <Badge size="xs" color="info">{lesseeRoleLabel(m.sender_role, t)}</Badge>
          )}
        </div>
      )}
      <div className={`flex items-end gap-1.5 max-w-[80%] ${isStaff ? 'flex-row' : 'flex-row-reverse'}`}>
        {timeNode}
        <Bubble message={m} isStaff={isStaff} onOpenImage={onOpenImage} />
      </div>
    </div>
  );
}

// ✓ / ✓✓ beside a STAFF bubble. Never rendered on a customer bubble — see the
// note at the call site.
function ReadReceipt({ isRead, readAt, lang }: {
  isRead: boolean;
  readAt: string | null;
  lang: string;
}) {
  const { t } = useTranslation();

  if (!isRead) {
    // "no record of it being opened" — NOT "the customer hasn't read it".
    return (
      <Tooltip content={t('chat.readReceipt.noRecord')}>
        <span className="inline-flex items-center text-subtler">
          <Check size={12} />
        </span>
      </Tooltip>
    );
  }

  const clock = readAt
    ? new Date(readAt).toLocaleTimeString(
      lang === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB',
      { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok', hour12: false },
    )
    : null;

  return (
    <Tooltip content={t('chat.readReceipt.openedHint')}>
      <span className="inline-flex items-center gap-0.5 text-info-fg">
        <CheckCheck size={12} />
        {clock && <span className="text-[10px] tabular-nums">{clock}</span>}
      </span>
    </Tooltip>
  );
}

function DaySeparator({ dayKey }: { dayKey: string }) {
  const { t } = useTranslation();

  // Compare against today/yesterday in Bangkok time. The simplest portable way
  // is to shift now() by the same offset chatTimeline uses and compare keys.
  const now = new Date();
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const today = bkk.toISOString().slice(0, 10);
  const yest = new Date(bkk.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <div className="flex items-center gap-2 my-2">
      <div className="flex-1 border-t border-line" />
      <span className="text-[11px] text-subtle px-2">
        {dayKey === today
          ? t('chat.today')
          : dayKey === yest
            ? t('chat.yesterday')
            : <DateTime value={`${dayKey}T00:00:00+07:00`} showTime={false} />}
      </span>
      <div className="flex-1 border-t border-line" />
    </div>
  );
}

function UnreadDivider() {
  const { t } = useTranslation();
  return (
    <div
      data-chat-unread-divider
      className="flex items-center gap-2 my-1"
      aria-label={t('chat.unreadBelow', { defaultValue: 'Unread messages below' })}
    >
      <div className="flex-1 border-t border-danger/40" />
      <span className="text-[11px] text-danger font-medium px-2 uppercase tracking-wide">
        {t('chat.unreadBelow', { defaultValue: 'Unread messages below' })}
      </span>
      <div className="flex-1 border-t border-danger/40" />
    </div>
  );
}

function SlipEventCard({ submission, lang, onOpen }: {
  submission: SubmissionRow;
  lang: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={onOpen}
        className="w-full max-w-md text-left bg-bg border border-line rounded-xl px-3 py-2.5 hover:bg-surface-hover transition-colors cursor-pointer flex items-center gap-3"
      >
        <div className="shrink-0 w-9 h-9 rounded-full bg-primary-soft text-primary-fg flex items-center justify-center">
          <FileText size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium tabular-nums">
              {fmtCurrency(submission.amount)}
            </span>
            <Badge size="xs" color={submissionStatusColor(submission.status)}>
              {t(`paymentSubmissions.status_${submission.status}`)}
            </Badge>
            {submission.submitter_role === 'CO_LESSEE' && (
              <Badge size="xs" color="info">{t('paymentSubmissions.submitterRole_CO_LESSEE')}</Badge>
            )}
            {submission.is_staff_submitted && (
              <Badge size="xs" color="info">{t('chat.slipStaffSubmitted')}</Badge>
            )}
          </div>
          <div className="text-[11px] text-subtle mt-0.5 flex items-center gap-2 flex-wrap">
            {submission.code_display && (
              <>
                <span className="tabular-nums">{submission.code_display}</span>
                <span>·</span>
              </>
            )}
            <span>{submission.customer_name ?? t('chat.slipSubmitted')}</span>
            <span>·</span>
            <span>{formatSmart(submission.submitted_at, lang)}</span>
          </div>
          {submission.status === 'REJECTED' && submission.reject_reason && (
            <div className="text-xs text-danger mt-1 break-words">
              {t('chat.slipRejectReason')}: {submission.reject_reason}
            </div>
          )}
        </div>
        <ChevronRight size={16} className="text-subtle shrink-0" />
      </button>
    </div>
  );
}

function Bubble({ message, isStaff, onOpenImage }: {
  message: ChatMessage;
  isStaff: boolean;
  onOpenImage: (key: string) => void;
}) {
  const { t } = useTranslation();
  const bubbleClass = isStaff
    ? 'bg-primary text-primary-contrast'
    : 'bg-surface';

  const storageKey = message.media_url ? normalizeKey(message.media_url) : null;
  // Bubble preview uses the sm thumbnail; lightbox opens the full lg image.
  const thumbKey = message.media_url_sm ? normalizeKey(message.media_url_sm) : null;
  const { url: displayUrl } = useMediaUrl(thumbKey);

  if (message.message_type === 'IMAGE' && storageKey) {
    return (
      <button
        type="button"
        onClick={() => onOpenImage(storageKey)}
        className={`rounded-2xl overflow-hidden ${isStaff ? 'self-end' : 'self-start'} border border-line block bg-transparent p-0 cursor-zoom-in`}
        aria-label={t('chat.imageMessage')}
      >
        {thumbKey && displayUrl ? (
          <ImageWithSkeleton src={displayUrl} alt={t('chat.imageMessage')} />
        ) : thumbKey ? (
          <Skeleton variant="rectangular" width={120} height={120} />
        ) : (
          <div className="flex items-center justify-center w-[120px] h-[120px] bg-surface text-subtle">
            <ImageIcon size={32} />
          </div>
        )}
      </button>
    );
  }

  return (
    <div
      className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${bubbleClass}`}
      title={new Date(message.created_at).toLocaleString()}
    >
      {message.message_text ?? (
        <span className="text-subtle italic">
          <DateTime value={message.created_at} />
        </span>
      )}
    </div>
  );
}

function ImageWithSkeleton({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative">
      {!loaded && (
        <Skeleton variant="rectangular" width={192} height={144} className="block" />
      )}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        className={`block max-w-[200px] max-h-[200px] w-auto h-auto object-contain ${loaded ? '' : 'absolute inset-0 opacity-0'}`}
      />
    </div>
  );
}


// Contract-state badge — shown only when the state is not ACTIVE (an active
// contract is the norm and needs no badge). Tolerates unknown codes.
function ContractStateBadge({ row }: { row: ChatInboxRow }) {
  const { t } = useTranslation();
  const state = row.contract_state;
  if (!state || state === 'ACTIVE') return null;
  return (
    <Badge size="xs" color={contractStateBadgeColor(state)}>
      {contractStateLabel(state, t)}
    </Badge>
  );
}

// Roster of every lessee on the contract (PRIMARY first, from the view).
// Lets staff see who can speak in the room before reading a message.
function ChatCustomerRoster({ row }: { row: ChatInboxRow }) {
  const { t } = useTranslation();
  const people = row.customers ?? [];
  // With 0–1 customers there's nothing the header doesn't already say.
  if (people.length <= 1) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-subtle">
      {people.map(c => (
        <span key={c.customer_id} className="inline-flex items-center gap-1">
          <span className="truncate max-w-[10rem]">{c.name ?? '—'}</span>
          <Badge size="xs" color={c.role === 'PRIMARY' ? 'default' : 'info'}>
            {lesseeRoleLabel(c.role, t)}
          </Badge>
        </span>
      ))}
    </div>
  );
}

