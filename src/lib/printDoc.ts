// ============================================================================
// printDoc — cross-browser print isolation for the off-screen body-portal
// pattern (see .claude/in-app-print-pattern.md).
//
// The @media print isolation used to be scoped with `body:has(.bill-receipt)`.
// iOS Safari does NOT evaluate `:has()` during print rendering, so on iPad none
// of the isolation rules fired and the whole app printed instead of the bill.
//
// Fix: toggle an explicit marker class on <body> right before window.print()
// and remove it after. The print CSS keys on `body.printing-bill` (a plain
// class selector every browser honors) instead of `body:has(...)`. The app root
// (#root) is hidden and only the printable portal (a direct body child, sibling
// of #root) is shown.
//
// One marker per flow. Call printWithMarker('bill') to print the bill receipt,
// etc. The marker classes line up with the PRINT_MARKERS map below and the
// `body.printing-*` rules in src/app.css.
// ============================================================================

export type PrintMarker = 'bill' | 'barcode-sticker' | 'asset-sticker' | 'signing-detail' | 'stock-count';

const bodyClass = (marker: PrintMarker) => `printing-${marker}`;

/**
 * Add the flow's body marker class, run window.print() (optionally with a
 * caller-supplied @page <style> already injected by the caller), then always
 * remove the marker. Safe to call after the printable is mounted + painted
 * (two RAFs, per the pattern).
 */
export function printWithMarker(marker: PrintMarker): void {
  const cls = bodyClass(marker);
  document.body.classList.add(cls);
  try {
    window.print();
  } finally {
    document.body.classList.remove(cls);
  }
}
