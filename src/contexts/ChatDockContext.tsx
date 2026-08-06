import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import {
  clampPosition, dockSizeFor, DEFAULT_DOCK_POSITION, type DockPosition,
} from './chatDockGeometry';

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

const DEFAULT_POSITION = DEFAULT_DOCK_POSITION;
const sizeFor = dockSizeFor;

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
  /** Back to the conversation list (keeps the thread selected for highlight). */
  showList: () => void;
  /** True when the dock is showing the list instead of a thread. */
  listView: boolean;
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
  // Start on the list when there's no thread to resume; otherwise straight into
  // the last conversation, which is what "resume what I was doing" means.
  const [listView, setListView] = useState(initial.contractId === null);

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
    setListView(false);
    setVisible(true);
    setExpandedState(true);
    setPositionState(prev => clampPosition(prev, sizeFor(true)));
  }, []);

  const showList = useCallback(() => setListView(true), []);

  const toggleDock = useCallback(() => {
    setVisible(prev => {
      // Opening from the nav lands on the last thread, expanded — or on the
      // list when there is no thread to resume.
      if (!prev) {
        setExpandedState(true);
        setListView(current => (contractId === null ? true : current));
        setPositionState(p => clampPosition(p, sizeFor(true)));
      }
      return !prev;
    });
  }, [contractId]);

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
    visible, expanded, contractId, position, listView,
    openChat, showList, toggleDock, setExpanded, closeDock, setPosition,
  }), [
    visible, expanded, contractId, position, listView,
    openChat, showList, toggleDock, setExpanded, closeDock, setPosition,
  ]);

  return <ChatDockContext.Provider value={value}>{children}</ChatDockContext.Provider>;
}

export function useChatDock() {
  const ctx = useContext(ChatDockContext);
  if (!ctx) throw new Error('useChatDock must be used within ChatDockProvider');
  return ctx;
}
