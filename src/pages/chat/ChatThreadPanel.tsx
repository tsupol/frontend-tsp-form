import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button, Skeleton,
} from 'tsp-form';
import {
  ExternalLink, Send, Image as ImageIcon, XCircle,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { wsClient } from '../../lib/api/ws';
import { useAuth } from '../../contexts/AuthContext';
import { formatSmart } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { normalizeKey, toStoragePath } from '../../lib/mediaPath';
import { uploadImage } from '../../lib/upload';
import type { ChatInboxRow, ChatMessage } from './chatTypes';

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

  const [composer, setComposer] = useState('');
  const [sendError, setSendError] = useState('');
  const [uploading, setUploading] = useState(false);

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

  // Realtime: subscribe to chat:contract:<id> while the thread is open. New
  // message → invalidate so React Query refetches. Polling stays as fallback.
  useEffect(() => {
    if (!enabled || contractId === null) return;
    const unsub = wsClient.subscribe(`chat:contract:${contractId}`, () => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', contractId] });
      queryClient.invalidateQueries({ queryKey: ['chat-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'chat-unread'] });
    });
    return unsub;
  }, [contractId, enabled, queryClient]);

  // Auto-scroll: jump to bottom whenever the contract changes (so a freshly
  // opened thread lands at the latest message) or when new messages arrive.
  // Resetting the counter in the same layout effect avoids a race where the
  // reset happens after the scroll check on a thread switch.
  const lastSeenCount = useRef(0);
  const lastSeenContract = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    const contractChanged = lastSeenContract.current !== contractId;
    const newMessages = messages.length > lastSeenCount.current;
    if (contractChanged || newMessages) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      lastSeenCount.current = messages.length;
      lastSeenContract.current = contractId;
    }
  }, [contractId, messages.length]);

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
        p_mime_type: 'image/webp',
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

  type Group = { sender: ChatMessage['sender_type']; messages: ChatMessage[]; startedAt: string };
  const groups: Group[] = useMemo(() => {
    const out: Group[] = [];
    for (const m of messages) {
      const last = out[out.length - 1];
      const sameSender = last && last.sender === m.sender_type;
      const closeInTime = last
        && (new Date(m.created_at).getTime() - new Date(last.messages[last.messages.length - 1].created_at).getTime()) < 5 * 60_000;
      if (sameSender && closeInTime) {
        last.messages.push(m);
      } else {
        out.push({ sender: m.sender_type, messages: [m], startedAt: m.created_at });
      }
    }
    return out;
  }, [messages]);

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
        <div className="flex-none hidden md:flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{title}</div>
            {inboxRow && (
              <div className="text-xs text-subtle">
                <span className="tabular-nums">{inboxRow.contract_code_display}</span>
                {' · '}
                {t('chat.messageCount', { count: inboxRow.total_messages })}
              </div>
            )}
          </div>
          {inboxRow && (
            <Link
              to={`/admin/contracts/search/${contractId}`}
              className="inline-flex items-center gap-1 text-xs text-primary-fg hover:underline shrink-0"
            >
              {t('chat.contractLink')} <ExternalLink size={12} />
            </Link>
          )}
        </div>
      )}

      {/* Mobile-only collapsible details — overlays the top of the message
          list so toggling doesn't push content down. Chevron in MobileHeader
          drives the open state via prop. */}
      {inboxRow && mobileDetailsOpen && (
        <div className="md:hidden absolute top-0 left-0 right-0 z-10 bg-bg border-b border-line shadow-sm animate-fade-in">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-subtle">
              <div className="tabular-nums truncate">{inboxRow.contract_code_display}</div>
              <div>{t('chat.messageCount', { count: inboxRow.total_messages })}</div>
            </div>
            <Link
              to={`/admin/contracts/search/${contractId}`}
              className="inline-flex items-center gap-1 text-xs text-primary-fg hover:underline shrink-0"
            >
              {t('chat.contractLink')} <ExternalLink size={12} />
            </Link>
          </div>
        </div>
      )}

      {/* Scrollable message list */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto better-scroll px-3 py-3 md:px-8">
        {isLoading ? (
          <div className="text-center text-subtle p-8">{t('common.loading')}</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-subtle p-8">{t('chat.emptyThread')}</div>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((g, gi) => {
              const isStaff = g.sender === 'STAFF';
              const isOwn = isStaff && user?.user_id === g.messages[0].sender_id;
              const align = isStaff ? 'items-end' : 'items-start';
              const senderLabel = isStaff
                ? (g.messages[0].sender_name ?? (isOwn ? t('chat.you') : ''))
                : (g.messages[0].sender_name ?? t('chat.customer'));
              return (
                <div key={gi} className={`flex flex-col ${align} gap-1`}>
                  <div className="text-[11px] text-subtle px-1">
                    {senderLabel ? <span className="mr-2">{senderLabel}</span> : null}
                    <span>{formatSmart(g.startedAt, i18n.language)}</span>
                  </div>
                  <div className={`flex flex-col gap-0.5 max-w-[70%] ${align}`}>
                    {g.messages.map(m => (
                      <Bubble key={m.id} message={m} isStaff={isStaff} onOpenImage={onOpenImage} />
                    ))}
                  </div>
                </div>
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
    : 'bg-bg border border-line';

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
    img.onload = () => {
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
      canvas.toBlob(
        blob => {
          if (!blob) {
            reject(new Error('Resize failed'));
            return;
          }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' }));
        },
        'image/webp',
        quality,
      );
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
