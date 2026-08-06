import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from 'tsp-form';
import { MessageSquare, Minus, X, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/api';
import {
  useChatDock, CHAT_BUBBLE_SIZE, CHAT_PANEL_WIDTH, CHAT_PANEL_HEIGHT,
} from '../contexts/ChatDockContext';
import { ChatThreadPanel } from '../pages/chat/ChatThreadPanel';
import { MediaLightbox } from './MediaLightbox';
import type { ChatInboxRow } from '../pages/chat/chatTypes';

/** Pointer travel (px) past which a press counts as a drag, not a click. A few
 *  px of jitter during a click must still open the panel. */
const DRAG_THRESHOLD = 4;

/**
 * Floating chat dock — collapsed to a draggable bubble, expands into the thread
 * panel. Mounted once at the app shell (see ChatDockProvider), so it renders on
 * every admin route and keeps its state across navigation.
 *
 * Desktop only: on mobile there is nowhere to dock, so chat stays a full page.
 */
export function ChatDock() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    visible, expanded, contractId, position,
    setExpanded, closeDock, setPosition,
  } = useChatDock();

  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Set on pointer-down, cleared once travel passes the threshold. Distinguishes
  // "clicked the bubble" from "dragged the bubble" on pointer-up.
  //
  // These handlers attach to a plain <div> in both states — never a <button>.
  // setPointerCapture redirects every later pointer event to the capturing
  // element, so a button that captures swallows its own click, and controls
  // nested inside a capturing handle never receive theirs.
  const dragIntent = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);

  // Thread meta for the panel header — same row shape the chat page uses.
  const { data: inboxRow } = useQuery({
    queryKey: ['chat-thread-meta', contractId],
    queryFn: async () => {
      const rows = await apiClient.get<ChatInboxRow[]>(
        `/v_branch_chat_list?contract_id=eq.${contractId}&limit=1`,
      );
      return rows[0] ?? null;
    },
    enabled: visible && contractId !== null,
  });

  // Live position for the move handler. Reading `position` from props/state
  // inside the handler would make it a new function on every drag frame; the
  // element then re-renders mid-gesture and loses its pointer capture, so the
  // stream dies after one move. The ref keeps the handler identity stable.
  const positionRef = useRef(position);
  positionRef.current = position;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Skip presses landing on a control INSIDE the handle (the header's
    // minimise/close/open buttons) — capture would swallow their click. The
    // drag surface itself is currentTarget, so exclude it from the search.
    const hit = (e.target as HTMLElement).closest('button,[role="button"],a,input,textarea');
    if (hit && hit !== e.currentTarget) return;
    dragIntent.current = { startX: e.clientX, startY: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const intent = dragIntent.current;
    if (!intent) return;
    const dx = e.clientX - intent.startX;
    const dy = e.clientY - intent.startY;
    if (!intent.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

    if (!intent.moved) {
      intent.moved = true;
      setDragging(true);
    }
    // Anchored to right/bottom, so movement is inverted. setPosition clamps
    // against whichever state is rendered.
    setPosition({
      right: positionRef.current.right - dx,
      bottom: positionRef.current.bottom - dy,
    });
    intent.startX = e.clientX;
    intent.startY = e.clientY;
  }, [setPosition]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const intent = dragIntent.current;
    dragIntent.current = null;
    setDragging(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    // A press that never passed the threshold is a click. Only meaningful on
    // the bubble — on the expanded panel's header a click should do nothing.
    if (intent && !intent.moved && !expanded) setExpanded(true);
  }, [expanded, setExpanded]);

  // Escape collapses the panel to the bubble rather than closing the dock —
  // less destructive, and matches how the modal ESC affordance reads.
  useEffect(() => {
    if (!visible || !expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, expanded, setExpanded]);

  if (!visible) return null;

  const title = inboxRow?.customer_name ?? t('chat.title');

  return (
    <>
      {/* Desktop only — mobile keeps the full chat page. */}
      <div
        className="hidden md:block fixed z-50"
        style={{ right: position.right, bottom: position.bottom }}
      >
        {expanded ? (
          <div
            className="flex flex-col rounded-2xl border border-line bg-bg shadow-lg overflow-hidden animate-pop-in"
            style={{ width: CHAT_PANEL_WIDTH, height: CHAT_PANEL_HEIGHT }}
          >
            {/* Header doubles as the drag handle so the panel moves with the
                bubble's anchor. */}
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className={`flex-none flex items-center gap-2 px-3 py-2 border-b border-line bg-surface ${
                dragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
            >
              <MessageSquare size={16} className="shrink-0 text-subtle" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{title}</div>
                {inboxRow?.contract_code_display && (
                  <div className="text-xs text-subtle truncate tabular-nums">
                    {inboxRow.contract_code_display}
                  </div>
                )}
              </div>
              {contractId !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="btn-icon-sm"
                  startIcon={<ExternalLink size={14} />}
                  onClick={() => navigate(`/admin/chat?contract=${contractId}`)}
                  aria-label={t('chat.dock.openFullPage')}
                  title={t('chat.dock.openFullPage')}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                className="btn-icon-sm"
                startIcon={<Minus size={14} />}
                onClick={() => setExpanded(false)}
                aria-label={t('chat.dock.collapse')}
                title={t('chat.dock.collapse')}
              />
              <Button
                variant="ghost"
                size="sm"
                className="btn-icon-sm"
                startIcon={<X size={14} />}
                onClick={closeDock}
                aria-label={t('chat.dock.close')}
                title={t('chat.dock.close')}
              />
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              {contractId === null ? (
                <div className="flex-1 flex items-center justify-center text-center text-subtler text-sm p-6">
                  {t('chat.dock.noThread')}
                </div>
              ) : (
                <ChatThreadPanel
                  contractId={contractId}
                  onOpenImage={setLightboxKey}
                  hideDesktopHeader
                />
              )}
            </div>
          </div>
        ) : (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(true); } }}
            aria-label={t('chat.dock.expand')}
            title={t('chat.dock.expand')}
            className={`relative flex items-center justify-center rounded-full bg-primary text-primary-contrast shadow-lg transition-transform hover:scale-105 ${
              dragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            style={{ width: CHAT_BUBBLE_SIZE, height: CHAT_BUBBLE_SIZE }}
          >
            <MessageSquare size={22} />
            {!!inboxRow?.unread_count && (
              <span className="absolute -top-1 -right-1 pointer-events-none">
                <Badge size="xs" color="danger">{inboxRow.unread_count}</Badge>
              </span>
            )}
          </div>
        )}
      </div>

      <MediaLightbox
        open={lightboxKey !== null}
        mediaKey={lightboxKey}
        onClose={() => setLightboxKey(null)}
      />
    </>
  );
}
