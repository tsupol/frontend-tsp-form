import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Badge, Button, Skeleton, useSnackbarContext,
} from 'tsp-form';
import {
  ChevronRight, CheckCircle, ExternalLink, FileText, Image as ImageIcon, Send, XCircle,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { wsClient } from '../../lib/api/ws';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency, formatSmart } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { normalizeKey, toStoragePath } from '../../lib/mediaPath';
import { uploadImage, encodeCanvas, renameForExt, mimeFromKey } from '../../lib/upload';
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

const MAX_TEXTAREA_LINES = 6;
const TEXTAREA_LINE_HEIGHT_PX = 20;

interface Props {
  contractId: number | null;
  /** If null, image clicks are no-ops. Lift to parent to open MediaLightbox. */
  onOpenImage: (key: string) => void;
  /** Hide the desktop header (e.g. when the parent layout shows its own title). */
  hideDesktopHeader?: boolean;
  /** Whether the mobile-only details strip (contract code + link) is open. */
  mobileDetailsOpen?: boolean;
}

export function ChatThreadPanel({ contractId, onOpenImage, hideDesktopHeader, mobileDetailsOpen }: Props) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();

  const [composer, setComposer] = useState('');
  const [sendError, setSendError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedSlip, setSelectedSlip] = useState<SubmissionRow | null>(null);

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

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['chat-messages', contractId],
    queryFn: () => apiClient.get<ChatMessage[]>(
      `/v_branch_chat_messages?contract_id=eq.${contractId}&order=created_at.asc`,
    ),
    enabled,
    refetchInterval: 15_000,
  });

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

  // Reset composer state when switching threads
  useEffect(() => {
    setComposer('');
    setSendError('');
  }, [contractId]);

  const markedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || contractId === null) return;
    if (markedRef.current === contractId) return;
    markedRef.current = contractId;
    apiClient.rpc('chat_mark_read', { p_contract_id: contractId })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['chat-inbox'] });
        queryClient.invalidateQueries({ queryKey: ['nav', 'chat-unread'] });
      })
      .catch(err => console.warn('[chat] mark_read failed', err));
  }, [contractId, enabled, queryClient]);

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
    const reload = () => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', contractId] });
      queryClient.invalidateQueries({ queryKey: ['chat-thread-submissions', contractId] });
      queryClient.invalidateQueries({ queryKey: ['chat-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['chat-thread-meta', contractId] });
      queryClient.invalidateQueries({ queryKey: ['chat-thread-status-log', contractId] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'chat-unread'] });
    };
    const unsubChat = wsClient.subscribe(`chat:contract:${contractId}`, reload);
    const unsubSlip = wsClient.subscribe(`slip:contract:${contractId}`, reload);
    return () => { unsubChat(); unsubSlip(); };
  }, [contractId, enabled, queryClient]);

  // Auto-scroll: jump to bottom whenever the contract changes (so a freshly
  // opened thread lands at the latest item) or when new messages/slips arrive.
  const lastSeenCount = useRef(0);
  const lastSeenContract = useRef<number | null>(null);
  const itemCount = messages.length + submissions.length;
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    const contractChanged = lastSeenContract.current !== contractId;
    const newItems = itemCount > lastSeenCount.current;
    if (contractChanged || newItems) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      lastSeenCount.current = itemCount;
      lastSeenContract.current = contractId;
    }
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
      queryClient.invalidateQueries({ queryKey: ['chat-messages', contractId] });
      queryClient.invalidateQueries({ queryKey: ['chat-inbox'] });
    },
    onError: (err) => {
      setSendError(translateApiError(err, t));
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !enabled || contractId === null) return;
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
      const resized = await resizeImageToWebp(file, 1280, 0.82);
      const idx = countChatImages(messages);
      const result = await uploadImage({
        type: 'chat_image',
        file: resized,
        size: 'lg',
        idx,
        params: { contract_id: contractId },
      });
      const attached = await apiClient.rpc<{ media_id: number }>('fn_media_attach', {
        p_holding_id: user.holding_id,
        p_storage_path: toStoragePath(result.key),
        p_variants_json: null,
        p_media_type: 'IMAGE',
        p_access_level: 'CONFIDENTIAL',
        p_mime_type: mimeFromKey(result.key),
        p_file_size_bytes: resized.size,
        p_original_filename: file.name,
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
    }
  };

  const timeline = useMemo(
    () => buildChatTimeline(messages, submissions),
    [messages, submissions],
  );

  if (contractId === null) {
    return (
      <div className="h-full flex items-center justify-center text-subtler p-8">
        {t('chat.selectToView')}
      </div>
    );
  }

  const title = inboxRow?.customer_name ?? t('chat.title');

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full relative">
      {!hideDesktopHeader && (
        <div className="flex-none hidden md:flex items-start justify-between gap-3 px-4 py-3 border-b border-line">
          <div className="min-w-0 flex-1 flex flex-col gap-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium truncate">{title}</span>
              {inboxRow && <ChatStatusBadge row={inboxRow} />}
            </div>
            {inboxRow && <ChatStatusSetterLine row={inboxRow} lang={i18n.language} />}
            {inboxRow && (
              <div className="text-xs text-subtle flex items-center gap-2">
                <Link
                  to={`/admin/contracts/search/${contractId}`}
                  className="inline-flex items-center gap-1 text-primary-fg hover:underline tabular-nums"
                >
                  {inboxRow.contract_code_display}
                  <ExternalLink size={12} />
                </Link>
                <span>·</span>
                <span>{t('chat.messageCount', { count: inboxRow.total_messages })}</span>
              </div>
            )}
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
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium truncate">{inboxRow.customer_name ?? t('chat.title')}</span>
                <ChatStatusBadge row={inboxRow} />
              </div>
              <ChatStatusSetterLine row={inboxRow} lang={i18n.language} />
              <div className="text-xs text-subtle flex items-center gap-2">
                <Link
                  to={`/admin/contracts/search/${contractId}`}
                  className="inline-flex items-center gap-1 text-primary-fg hover:underline tabular-nums"
                >
                  {inboxRow.contract_code_display}
                  <ExternalLink size={12} />
                </Link>
                <span>·</span>
                <span>{t('chat.messageCount', { count: inboxRow.total_messages })}</span>
              </div>
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

      {/* Scrollable timeline (chat + slips merged) */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto better-scroll px-3 py-3 md:px-8">
        {isLoading ? (
          <div className="text-center text-subtle p-8">{t('common.loading')}</div>
        ) : timeline.length === 0 ? (
          <div className="text-center text-subtle p-8">{t('chat.emptyThread')}</div>
        ) : (
          <div className="flex flex-col gap-3">
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
            placeholder={t('chat.composerPlaceholder')}
            disabled={sendMutation.isPending || uploading}
            className="w-full resize-none bg-transparent border-0 outline-0 px-3 pt-3 pb-1 text-xs md:text-sm leading-5 placeholder:text-subtle"
            style={{ minHeight: TEXTAREA_LINE_HEIGHT_PX }}
          />
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="btn-icon-sm"
              startIcon={<ImageIcon size={18} />}
              onClick={() => fileInputRef.current?.click()}
              disabled={sendMutation.isPending || uploading}
              aria-label={t('chat.attachImage')}
              title={t('chat.attachImage')}
            />
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

  if (item.kind === 'slip') {
    return (
      <SlipEventCard submission={item.data} lang={lang} onOpen={() => onOpenSlip(item.data)} />
    );
  }

  const m = item.data;
  const isStaff = m.sender_type === 'STAFF';
  const isOwn = isStaff && currentUserId === m.sender_id;
  const align = isStaff ? 'items-end' : 'items-start';
  const senderLabel = isStaff
    ? (m.sender_name ?? (isOwn ? t('chat.you') : ''))
    : (m.sender_name ?? t('chat.customer'));

  // LINE-style layout: sender name on top of a new run, bubble on its own
  // row with the wall-clock time on the *outside* edge (left of staff
  // bubbles, right of customer bubbles), bottom-aligned.
  const clock = new Date(m.created_at).toLocaleTimeString(
    lang === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB',
    { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok', hour12: false },
  );
  const timeNode = (
    <span className="text-[10px] text-subtle/60 tabular-nums shrink-0 self-end pb-1">{clock}</span>
  );
  return (
    <div className={`flex flex-col ${align} ${showSender ? 'gap-1 mt-1' : 'gap-0.5 -mt-2'}`}>
      {showSender && senderLabel && (
        <div className="text-[11px] text-subtle px-1">{senderLabel}</div>
      )}
      <div className={`flex items-end gap-1.5 max-w-[80%] ${isStaff ? 'flex-row' : 'flex-row-reverse'}`}>
        {timeNode}
        <Bubble message={m} isStaff={isStaff} onOpenImage={onOpenImage} />
      </div>
    </div>
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
            {submission.is_staff_submitted && (
              <Badge size="xs" color="info">{t('chat.slipStaffSubmitted')}</Badge>
            )}
          </div>
          <div className="text-[11px] text-subtle mt-0.5 flex items-center gap-2">
            <span>{t('chat.slipSubmitted')}</span>
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
  const { url: displayUrl } = useMediaUrl(storageKey);

  if (message.message_type === 'IMAGE' && storageKey) {
    return (
      <button
        type="button"
        onClick={() => onOpenImage(storageKey)}
        className={`rounded-2xl overflow-hidden max-w-xs ${isStaff ? 'self-end' : 'self-start'} border border-line block bg-transparent p-0 cursor-zoom-in`}
        aria-label={t('chat.imageMessage')}
      >
        {displayUrl ? (
          <ImageWithSkeleton src={displayUrl} alt={t('chat.imageMessage')} />
        ) : (
          <Skeleton variant="rectangular" width={192} height={144} />
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
        className={`block w-full h-auto ${loaded ? '' : 'absolute inset-0 opacity-0'}`}
      />
    </div>
  );
}

function countChatImages(messages: ChatMessage[]): number {
  return messages.filter(m => m.message_type === 'IMAGE').length;
}

async function resizeImageToWebp(file: File, maxDim: number, quality: number): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unsupported'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const { blob, mime, ext } = await encodeCanvas(canvas, quality);
        resolve(new File([blob], renameForExt(file.name, ext), { type: mime }));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Resize failed'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}

function translateApiError(err: unknown, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (err instanceof ApiError) {
    const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
    return translated || err.message;
  }
  if (err instanceof Error) return err.message;
  return t('chat.sendFailed');
}
