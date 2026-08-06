/**
 * Geometry + position maths for the floating chat dock.
 *
 * Split out of ChatDockContext so that file only exports components — mixing
 * component and non-component exports breaks Vite's fast refresh.
 */

/** Bubble diameter (px) — mirrors the inline size on the collapsed dock. */
export const CHAT_BUBBLE_SIZE = 56;
/** Expanded panel size — must match the ChatDock render. */
export const CHAT_PANEL_WIDTH = 380;
export const CHAT_PANEL_HEIGHT = 560;
/** Keep at least this much of the dock on screen when clamping. */
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

export const DEFAULT_DOCK_POSITION: DockPosition = { right: 24, bottom: 24 };

export const dockSizeFor = (expanded: boolean) => (expanded
  ? { width: CHAT_PANEL_WIDTH, height: CHAT_PANEL_HEIGHT }
  : { width: CHAT_BUBBLE_SIZE, height: CHAT_BUBBLE_SIZE });

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
  size: { width: number; height: number } = dockSizeFor(false),
): DockPosition {
  const maxRight = Math.max(EDGE_MARGIN, window.innerWidth - size.width - EDGE_MARGIN);
  const maxBottom = Math.max(EDGE_MARGIN, window.innerHeight - size.height - EDGE_MARGIN);
  return {
    right: Math.min(Math.max(pos.right, EDGE_MARGIN), maxRight),
    bottom: Math.min(Math.max(pos.bottom, EDGE_MARGIN), maxBottom),
  };
}
