# PdfCanvasViewer — black-page gotcha (read before touching it)

`src/components/PdfCanvasViewer.tsx` renders a multi-page PDF as a vertical
stack of `<canvas>` elements (pdf.js v6, `pdfjs-dist@6`). It's used by the
contract PDF preview (`ContractPreviewModal` → server-rendered PDF blob).

## The bug that keeps coming back: black pages (often page 1, sometimes 1–2)

Symptom: a page shows **black** in the preview. A telltale variant is a
**white flash, then black** — the page renders correctly, then goes dark.

### What it is NOT
- **Not a data problem.** The downloaded PDF is always clean; only the
  on-screen canvas preview goes black. Same misc-go bytes either way — the
  download bypasses the canvas entirely. So never chase the render payload or
  `buildContractRenderData` for this.
- **Not a transparent-background problem.** pdf.js v6's `render()` already
  defaults `background` to opaque white (`rgb(255,255,255)`). Passing
  `background: '#ffffff'` changes nothing. Don't add it thinking it helps.
- **Not fixable by `requestAnimationFrame` timing hacks.** A rAF before
  `page.render()` only ever passes by luck of timing; it is not the fix.

### What it actually is
Setting `canvas.width`/`canvas.height` **always clears the backing store** to
transparent, which composites **black** over the viewer's dark `#525659`
backdrop. The page effect re-runs (React **StrictMode double-invokes** effects
in dev, AND `targetWidth` changes as the container's ResizeObserver settles).
On the re-run, unconditionally reassigning the canvas size **wipes an
already-good render**, and the second render either doesn't land or gets
cancelled → the page stays black. Early pages churn most during initial
layout, so they show it worst.

### The fix (in place — keep it)
1. **Only resize/redraw when the size actually changed AND we haven't already
   rendered this size.** Track the last successfully-rendered width in a ref
   (`renderedWidthRef`); if a re-run sees the same size already rendered, return
   early and leave the good pixels untouched. Never clear a correct canvas.
2. **Cancel the in-flight `RenderTask` on cleanup** (`renderTaskRef.current?.cancel()`)
   so a superseded pass can't clear-then-abandon the canvas.
3. Let pdf.js **own the canvas**: pass `canvas` to `page.render`, do NOT call
   `canvas.getContext('2d')` / `fillRect` yourself. Grabbing the context first
   desyncs pdf.js's internal state and corrupts the FIRST page specifically
   (vertical flip + wrong scale). This was a real regression — don't reintroduce it.

### If you must debug it again
- Verify via the canvas pixels, not screenshots: sample `getImageData` center
  of each page's canvas. Black = `rgb(0,0,0)`, good = `~rgb(255,255,255)`.
- Reproduce in the running app (contract overview → Print contract PDF →
  Preview). Pages are A4 (taller than wide); the 2048px backing-buffer cap
  applies to the long side but only lowers resolution, it does not cause black.
- The fix must make pages 1–2 follow the **identical** path as 3–4. If only
  some pages are black, you're looking at a re-run/clear race, not data.
