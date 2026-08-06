import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';

/**
 * Floating chat dock — a chat-head bubble that expands into the thread panel,
 * mounted once at the app shell so it survives route changes with its draft
 * text and scroll position intact.
 *
 * Deliberately NOT auto-opening on incoming messages (owner's call): the nav
 * unread badge signals a new message, the user decides when to look. Popping
 * the panel up mid-task is an interruption.
 */

/** Persisted so the dock comes back where the user parked it. */
const STORAGE_KEY = 'chatDock';
/** Bubble diameter (px) — mirrors the w-14/h-14 on the button. */
export const CHAT_BUBBLE_SIZE = 56;
/** Keep at least this much of the bubble on screen when clamping. */
const EDGE_MARGIN = 8;

/**
 * Bubble position is stored as a distance from the RIGHT/BOTTOM edges rather
 * than absolute x/y: the dock lives bottom-right, so anchoring to those edges
 * keeps it visually put when the window resizes. Absolute coords would drift
 * off-screen the moment the viewport shrinks.
 */
export interface DockPosition {
  right: number;
  bottom: number;
}

const DEFAULT_POSITION: DockPosition = { right: 24, bottom: 24 };

/** Expanded panel size — must match the ChatDock render. */
export const CHAT_PANEL_WIDTH = 380;
export const CHAT_PANEL_HEIGHT = 560;

const sizeFor = (expanded: boolean) => (expanded
  ? { width: CHAT_PANEL_WIDTH, height: CHAT_PANEL_HEIGHT }
  : { width: CHAT_BUBBLE_SIZE, height: CHAT_BUBBLE_SIZE });

interface PersistedState {
  contractId: number | null;
  position: DockPosition;
}

function readPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { contractId: null, position: DEFAULT_POSITION };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      contractId: typeof parsed.contractId === 'number' ? parsed.contractId : null,
      position: parsed.position && typeof parsed.position.right === 'number'
        ? parsed.position
        : DEFAULT_POSITION,
    };
  } catch {
    return { contractId: null, position: DEFAULT_POSITION };
  }
}

/**
 * Keep the dock on screen. Without this, a position saved on a wide monitor
 * puts it off-screen on a laptop with no way to drag it back.
 *
 * The bounds depend on which state is rendered: the dock is anchored to the
 * right/bottom edges, so a `bottom` that is fine for a 56px bubble can push a
 * 560px panel's top off the viewport. Clamping against the CURRENT size keeps
 * both states reachable — clamping only against the bubble let the expanded
 * panel escape upward (and, once collapsed, stranded the bubble below the fold).
 */
export function clampPosition(
  pos: DockPosition,
  size: { width: number; height: number } = { width: CHAT_BUBBLE_SIZE, height: CHAT_BUBBLE_SIZE },
): DockPosition {
  const maxRight = Math.max(EDGE_MARGIN, window.innerWidth - size.width - EDGE_MARGIN);
  const maxBottom = Math.max(EDGE_MARGIN, window.innerHeight - size.height - EDGE_MARGIN);
  return {
    right: Math.min(Math.max(pos.right, EDGE_MARGIN), maxRight),
    bottom: Math.min(Math.max(pos.bottom, EDGE_MARGIN), maxBottom),
  };
}

interface ChatDockValue {
  /** Dock present on screen at all (bubble or panel). Off = nothing rendered. */
  visible: boolean;
  /** Panel expanded vs. collapsed to the bubble. */
  expanded: boolean;
  /** Thread being shown; null renders the empty state. */
  contractId: number | null;
  position: DockPosition;

  /** Show the dock on a specific thread and expand it. */
  openChat: (contractId: number) => void;
  /** Nav toggle: show/hide the whole dock. */
  toggleDock: () => void;
  /** Collapse to bubble / expand to panel. */
  setExpanded: (next: boolean) => void;
  /** Hide the dock entirely. */
  closeDock: () => void;
  setPosition: (next: DockPosition) => void;
}

const ChatDockContext = createContext<ChatDockValue | null>(null);

export function ChatDockProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(readPersisted, []);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpandedState] = useState(true);
  const [contractId, setContractId] = useState<number | null>(initial.contractId);
  const [position, setPositionState] = useState<DockPosition>(initial.position);

  // Persist the thread + position, not `visible` — the dock starts hidden every
  // session. Restoring it open would put a panel over the page on every login.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ contractId, position }));
    } catch { /* private mode / quota — position just won't persist */ }
  }, [contractId, position]);

  // Re-clamp when the window shrinks so the dock can't strand itself.
  useEffect(() => {
    const onResize = () => setPositionState(prev => clampPosition(prev, sizeFor(expanded)));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [expanded]);

  const openChat = useCallback((id: number) => {
    setContractId(id);
    setVisible(true);
    setExpandedState(true);
    setPositionState(prev => clampPosition(prev, sizeFor(true)));
  }, []);

  const toggleDock = useCallback(() => {
    setVisible(prev => {
      // Opening from the nav lands on the last thread, expanded.
      if (!prev) {
        setExpandedState(true);
        setPositionState(p => clampPosition(p, sizeFor(true)));
      }
      return !prev;
    });
  }, []);

  const closeDock = useCallback(() => setVisible(false), []);

  // Re-clamp on every expand/collapse: the two states have different footprints,
  // so a position valid for one can put the other partly off-screen.
  const setExpanded = useCallback((next: boolean) => {
    setExpandedState(next);
    setPositionState(prev => clampPosition(prev, sizeFor(next)));
  }, []);

  // Identity must stay stable across a drag: the dock's pointer-move handler
  // closes over this, and a changing handler re-renders the element mid-gesture
  // and drops its pointer capture. Read `expanded` from a ref, not the closure.
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const setPosition = useCallback(
    (next: DockPosition) => setPositionState(clampPosition(next, sizeFor(expandedRef.current))),
    [],
  );

  const value = useMemo<ChatDockValue>(() => ({
    visible, expanded, contractId, position,
    openChat, toggleDock, setExpanded, closeDock, setPosition,
  }), [visible, expanded, contractId, position, openChat, toggleDock, setExpanded, closeDock, setPosition]);

  return <ChatDockContext.Provider value={value}>{children}</ChatDockContext.Provider>;
}

export function useChatDock() {
  const ctx = useContext(ChatDockContext);
  if (!ctx) throw new Error('useChatDock must be used within ChatDockProvider');
  return ctx;
}
