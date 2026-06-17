# In-app document printing — the browser-print pattern (read before adding any print)

This project prints documents (bill receipts, barcode/asset stickers, and now
signing detail) by **mounting printable markup off-screen and calling
`window.print()`**, isolated with `@media print` CSS. It does **not** generate a
server PDF for these (that path is separate — `ContractPreviewModal` +
`PdfCanvasViewer` render a misc-go PDF blob, and is unrelated to this pattern).

Prior sessions have reinvented this and shipped broken prints (blank pages,
clipped receipts, the whole app printing). The mechanism is non-obvious in three
specific places — get those right and it works every time. They are marked
**⚠ GOTCHA** below.

## Where it's used (all consistent — copy any of them)

Bill receipt (marker class `.bill-receipt`, component `BillReceipt`):
- `src/pages/accounting/BillsPage.tsx`
- `src/pages/contracts/ContractDetailPanel.tsx`
- `src/pages/contracts/workspace/PanelReviewPay.tsx` — two flows: post-confirm
  receipt (`billId`) and the **draft invoice** (pre-built `bill` object, no bill
  row exists yet)
- `src/pages/contracts/ActionDoneView.tsx`

Stickers (same pattern, own marker class + dynamically-injected `@page`):
- `src/pages/inventory/AssetsPage.tsx` (`.asset-sticker`, 76×26mm)
- `src/pages/inventory/BarcodesPage.tsx` (`.barcode-sticker`)

Signing detail (`.signing-detail-print`, component `SigningDetailPrint`):
- `src/pages/contracts/SigningDetailModal.tsx`

## The four parts

### 1. A printable component wrapped in ONE marker class

Plain markup wrapped in a single class the print CSS keys on (`.bill-receipt`,
`.signing-detail-print`, etc.). Give it a `hidePrintButton` prop so a host page
can mount it purely for printing without showing the inline button. It should
accept either an id (and fetch) or a pre-built data object (so a draft with no
DB row can print the same markup).

⚠ **STYLE IT AS A NARROW THERMAL RECEIPT, NOT A SCREEN UI.** Default target is
the **80mm thermal printer** (72mm printable) — the same paper as the bill
receipt, not A4. That means:
- **Single column.** The paper is ~72mm wide; a 2- or 3-column data table is
  cramped and unreadable. Stack label/value vertically or as one `space-between`
  row. No wide tables.
- **Text + dashed `<hr>` dividers only.** Do NOT port the on-screen modal's
  bordered/rounded cards, badges, colored chips, or box backgrounds — they read
  as naive and waste the narrow page. Centered title, black text on white,
  signature as a bare `<img>` (no frame).
- **Don't shrink text to fit more in.** Body ~13px, title ~15px — readable on
  thermal output. If it doesn't fit, cut content, don't cut font size.
- **Copy the content, not the screen's layout.** The modal and its print are two
  presentations of the same data; the print picks only what matters (which
  signing, the change, who signed) and drops screen-only chrome.

Only reach for A4 (with a dynamically-injected `@page`, see §3) if the document
genuinely can't work in one 72mm column — most don't need it.

### 2. `@media print` isolation in `src/app.css`, scoped with `body:has(.marker)`

```css
@media print {
    body:has(.bill-receipt) * { visibility: hidden; }
    body:has(.bill-receipt) .bill-receipt,
    body:has(.bill-receipt) .bill-receipt * { visibility: visible; }
    body:has(.bill-receipt) > *:not(:has(.bill-receipt)) { display: none !important; }
}
```

⚠ **GOTCHA 1 — scope every rule with `body:has(.your-marker)`.** Multiple print
flows share one stylesheet. An unscoped `* { visibility: hidden }` blanks the
*other* flows. The `:has()` guard means the rules only fire when that specific
marker is actually mounted, and exactly one is ever mounted at print time.

Also add a `@media screen` rule to hide the printable while it's briefly mounted
during the flow. The wrapper must be `display:contents` (no box of its own), so
hide via the printable node itself by parking it off-screen:

```css
@media screen {
    .print-only-receipt { display: contents; }
    .print-only-receipt .bill-receipt {
        position: absolute; left: -10000px; top: 0;
        visibility: hidden; pointer-events: none;
    }
}
```

⚠ **GOTCHA 4 — that off-screen `position:absolute` MUST be undone in
`@media print`, or the page won't start at the top.** The screen rule parks the
node at `left:-10000px; top:0; position:absolute`. Those declarations are inside
`@media screen` so print *should* ignore them — but be defensive and reset them
in the print block anyway (cascade/specificity surprises, and any stray
positioned ancestor, push the content down or off-page — the symptom is "prints
fine as a bill, but my doc doesn't start at the top"):

```css
@media print {
    .signing-detail-print {
        position: static !important;
        left: auto !important; top: auto !important;
        margin: 0 !important;
    }
}
```

Verify the printable's on-screen container is NOT a positioned/`overflow:hidden`
ancestor either — that's the same failure as mounting inside a Modal (Gotcha 2).
The `createPortal(..., document.body)` mount is what guarantees a clean top.

### 3. `@page` size

- **Bill receipt** uses the default `@page { size: 80mm auto; margin: 0 }`
  declared once in the `@media print` block (Xprinter XP-80C thermal, 72mm
  printable).
- **Anything that is NOT an 80mm receipt** (stickers, A4 documents) must
  **inject its own `@page` dynamically** at print time and remove it after, so
  it doesn't fight the 80mm default:

```ts
const styleEl = document.createElement('style');
styleEl.id = 'signing-detail-print-page';
styleEl.textContent = '@media print { @page { size: A4; margin: 12mm; } }';
document.head.appendChild(styleEl);
try { window.print(); } finally { styleEl.remove(); }
```

### 4. The trigger — pre-warm, portal to body, two RAFs

```tsx
const [printReady, setPrintReady] = useState(false);

const handlePrint = useCallback(async () => {
  // Pre-warm every query the printable depends on, so it paints fully
  // BEFORE the print dialog opens (a loading spinner would print otherwise).
  try {
    await queryClient.fetchQuery({ queryKey: [...], queryFn: ... });
  } catch { /* fall through — printable shows its own loading state */ }

  setPrintReady(true);
  // Two RAFs: React commits, browser paints, THEN open the dialog.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.print();
    setPrintReady(false);
  }));
}, [queryClient, ...]);

// Mount off-screen via a body portal — NOT inside a Modal.
{printReady && createPortal(
  <div className="print-only-receipt" aria-hidden>
    <BillReceipt billId={billId} hidePrintButton />
  </div>,
  document.body,
)}
```

⚠ **GOTCHA 2 — `createPortal(..., document.body)`, never inside a `<Modal>`.**
The tsp-form Modal portals into a `fixed` / `overflow-hidden` container that does
not map to the `@page` box, so the document gets clipped or positioned wrong.
Mount the printable as a direct child of `<body>`.

⚠ **GOTCHA 3 — two nested `requestAnimationFrame` before `window.print()`.**
One RAF (or none) fires before React has committed and the browser has painted,
so the dialog captures a blank or half-rendered node. Two RAFs is the proven
delay. Do not replace with `setTimeout` guesses.

Put `print:hidden` on the on-screen Print button and any toolbar so they don't
appear in the output.

## Checklist for a new print

1. Printable component in one marker class; takes id-or-object; `hidePrintButton`.
2. Styled as a printed document — text + rules, NOT the screen modal's cards/badges/boxes.
3. `@media print` block in `app.css` scoped with `body:has(.marker)` (3 rules).
4. `@media screen` rule: wrapper `display:contents` + park the printable off-screen.
5. `@media print` resets the printable's `position`/`left`/`top`/`margin` so it starts at the top.
6. `@page`: reuse 80mm default for receipts; inject+remove dynamically otherwise.
7. Trigger: pre-warm queries → `setPrintReady(true)` → two RAFs → `window.print()`.
8. `createPortal` to `document.body`, never inside a Modal.
9. `print:hidden` on buttons/toolbars.
