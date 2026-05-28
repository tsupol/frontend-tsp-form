import { ArrowRightFromLine, Printer } from 'lucide-react';
import { MobileHeader } from 'tsp-form';

// Static printer setup guide for the XP-420B (and equivalent thermal label
// printers). The app injects @page { size: 76mm 26mm; margin: 0 } — that
// matches the *printable area* of the label, which is what the print head
// can reach. The physical sticker is a bit larger; the "expose" values tell
// the driver where the 3×1 in printable rectangle starts on the media.

const PRINTABLE = {
  width: { in: '3.00', mm: '76.2' },
  height: { in: '1.00', mm: '25.4' },
};
const EXPOSE = {
  lr: { in: '0.08', mm: '2.0' },
};

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-sm text-subtle min-w-32">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface-hover text-xs font-semibold">
        {n}
      </span>
      <div className="flex-1 pt-0.5 text-sm leading-relaxed">{children}</div>
    </li>
  );
}

export function PrinterSetupPage() {
  return (
    <>
      <MobileHeader className="mobile-header-scrolled-shadow md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          Printer Setup
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content max-w-4xl">
        <div className="flex items-center gap-2 mb-4 max-md:hidden">
          <Printer size={20} />
          <h1 className="heading-2">Printer Setup</h1>
        </div>

      <p className="text-sm text-subtle mb-6">
        One-time configuration for thermal label printing (barcode stickers,
        asset stickers). The app sets the page size to the label's printable
        area automatically; you only need to configure the printer driver
        defaults below so the printable rectangle lines up with the media.
      </p>

      {/* Label spec card */}
      <div className="card mb-6">
        <h2 className="heading-3 mb-1">Label specification</h2>
        <p className="text-xs text-subtle mb-3">
          The <strong>printable area</strong> (what the print head can reach)
          is what the app targets. The physical label is slightly larger; the
          <strong> expose</strong> values tell the driver how far inside the
          physical edges the printable rectangle starts.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Spec label="Printable width"  value={`${PRINTABLE.width.in} in  (${PRINTABLE.width.mm} mm)`} />
          <Spec label="Printable height" value={`${PRINTABLE.height.in} in  (${PRINTABLE.height.mm} mm)`} />
          <Spec label="Expose — Left"   value={`${EXPOSE.lr.in} in  (${EXPOSE.lr.mm} mm)`} />
          <Spec label="Expose — Right"  value={`${EXPOSE.lr.in} in  (${EXPOSE.lr.mm} mm)`} />
          <Spec label="Expose — Top"    value="0" />
          <Spec label="Expose — Bottom" value="0" />
          <Spec label="Orientation" value="Portrait" />
          <Spec label="Scale" value="100% / Actual size" />
        </div>
      </div>

      {/* Windows */}
      <div className="card mb-6">
        <h2 className="heading-3 mb-1">Windows</h2>
        <p className="text-xs text-subtle mb-4">
          Set both the driver default <em>and</em> the Chrome/Edge print dialog
          so every print job uses the label size.
        </p>

        <h3 className="text-sm font-semibold mb-2">Driver defaults</h3>
        <ol className="space-y-2 mb-5">
          <Step n={1}>
            Open <span className="font-mono">Settings → Bluetooth &amp; devices → Printers &amp; scanners</span>,
            select the label printer (e.g. <span className="font-mono">XP-420B</span>) →
            <span className="font-mono"> Printing preferences</span>.
          </Step>
          <Step n={2}>
            <span className="font-mono">Page Setup</span> tab → <span className="font-mono">Stock</span>:
            choose a custom size and set the printable area to
            <span className="font-mono"> Width = {PRINTABLE.width.in} in ({PRINTABLE.width.mm} mm)</span>,
            <span className="font-mono"> Height = {PRINTABLE.height.in} in ({PRINTABLE.height.mm} mm)</span>.
            Save the stock as <span className="font-mono">Label 3.00 × 1.00</span> so it
            shows up in the size dropdown.
          </Step>
          <Step n={3}>
            <span className="font-mono">Expose</span> (or <span className="font-mono">Media offset</span>) —
            this is the distance from the physical label edge to where the
            printable area begins, not a margin inside it. Set
            <span className="font-mono"> Left = {EXPOSE.lr.in} in ({EXPOSE.lr.mm} mm)</span>,
            <span className="font-mono"> Right = {EXPOSE.lr.in} in ({EXPOSE.lr.mm} mm)</span>,
            <span className="font-mono"> Top = 0</span>, <span className="font-mono">Bottom = 0</span>.
          </Step>
          <Step n={4}>
            <span className="font-mono">Orientation = Portrait</span>. Click
            <span className="font-mono"> Apply</span> then <span className="font-mono">OK</span>.
          </Step>
        </ol>

        <h3 className="text-sm font-semibold mb-2">Chrome / Edge print dialog</h3>
        <ol className="space-y-2">
          <Step n={1}>
            When the browser print dialog opens, set
            <span className="font-mono"> Destination</span> to the label printer.
          </Step>
          <Step n={2}>
            <span className="font-mono">Paper size</span>: pick the saved
            <span className="font-mono"> Label 3.00 × 1.00</span>. If it's not in
            the list, use <span className="font-mono">More settings → Paper size →
            Custom</span> and enter
            <span className="font-mono"> {PRINTABLE.width.in} × {PRINTABLE.height.in} in</span>.
          </Step>
          <Step n={3}>
            <span className="font-mono">Margins = None</span>,
            <span className="font-mono"> Scale = Default (100%)</span>,
            <span className="font-mono"> Options → Headers and footers = off</span>,
            <span className="font-mono"> Background graphics = on</span>.
          </Step>
          <Step n={4}>
            Tick <span className="font-mono">"Use system dialog"</span> the first
            time so the driver defaults from the steps above take effect, then
            print. Subsequent prints can use the regular browser dialog.
          </Step>
        </ol>
      </div>

      {/* iPad */}
      <div className="card mb-6">
        <h2 className="heading-3 mb-1">iPad / iOS</h2>
        <p className="text-xs text-subtle mb-4">
          iOS AirPrint does not expose custom paper sizes; you must drive the
          printer either through the vendor's iOS app or via a Mac/Windows
          share. The on-printer settings below are the equivalent of the
          Windows driver defaults.
        </p>

        <h3 className="text-sm font-semibold mb-2">Vendor app (recommended)</h3>
        <ol className="space-y-2 mb-5">
          <Step n={1}>
            Install the printer's iOS companion app from the App Store
            (e.g. <span className="font-mono">XPrinter</span> for XP-420B). Pair
            over Bluetooth or USB-C.
          </Step>
          <Step n={2}>
            In the app, open <span className="font-mono">Settings → Paper / Label</span> and set:
            <div className="mt-2 ml-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
              <Spec label="Printable width"  value={`${PRINTABLE.width.in} in (${PRINTABLE.width.mm} mm)`} />
              <Spec label="Printable height" value={`${PRINTABLE.height.in} in (${PRINTABLE.height.mm} mm)`} />
              <Spec label="Left expose"  value={`${EXPOSE.lr.in} in (${EXPOSE.lr.mm} mm)`} />
              <Spec label="Right expose" value={`${EXPOSE.lr.in} in (${EXPOSE.lr.mm} mm)`} />
              <Spec label="Top expose"    value="0" />
              <Spec label="Bottom expose" value="0" />
              <Spec label="Density" value="Medium (or per vendor default)" />
              <Spec label="Speed"   value="4 in/s" />
            </div>
          </Step>
          <Step n={3}>
            Save as the default profile so Safari's <span className="font-mono">Share → Print</span>
            uses these values.
          </Step>
        </ol>

        <h3 className="text-sm font-semibold mb-2">Safari → AirPrint (fallback)</h3>
        <ol className="space-y-2">
          <Step n={1}>
            In Safari on the iPad, tap <span className="font-mono">Share → Print</span>.
            Select the AirPrint-shared label printer.
          </Step>
          <Step n={2}>
            Pinch the print preview to confirm the sticker fills the label
            edge-to-edge. iOS will not show paper-size pickers — the size comes
            from the printer's saved profile from the previous section.
          </Step>
          <Step n={3}>
            If the print is misaligned, re-open the vendor app and verify
            <span className="font-mono"> Printable width = {PRINTABLE.width.in} in ({PRINTABLE.width.mm} mm)</span>,
            <span className="font-mono"> Printable height = {PRINTABLE.height.in} in ({PRINTABLE.height.mm} mm)</span>,
            and <span className="font-mono">Left/Right expose = {EXPOSE.lr.in} in ({EXPOSE.lr.mm} mm)</span>.
            iOS caches the AirPrint settings — toggling the printer off/on
            forces a refresh.
          </Step>
        </ol>
      </div>

        <p className="text-xs text-subtler">
          The app targets a printable area of
          <span className="font-mono"> {PRINTABLE.width.mm} mm × {PRINTABLE.height.mm} mm</span>
          ({PRINTABLE.width.in} in × {PRINTABLE.height.in} in) for both barcode
          and asset stickers. If you change label media, update both the printer
          profile above and ask a developer to update the
          <span className="font-mono"> @page</span> rule in the app.
        </p>
      </div>
    </>
  );
}
