import { Button } from 'tsp-form';
import { Trash2, X } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   Dev sandbox — every "remove/delete" affordance currently in the codebase,
   reproduced verbatim so the inconsistency is visible side by side. Source file
   + line noted on each. Goal: decide one standard control for icon removes.
   ──────────────────────────────────────────────────────────────────────────── */

function Row({ title, where, children }: { title: string; where: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-line">
      <div className="w-72 shrink-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-subtle">{where}</div>
      </div>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}

export function DevRemoveButtonsPage() {
  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-semibold mb-1">Remove buttons — current variants</h1>
      <p className="text-sm text-subtle mb-4">
        Each row is the exact markup used in that file. Several styles for the same
        intent (remove a line / row / item). Pick one standard.
      </p>

      {/* ── Variant A: tsp-form Button icon (the "correct" one per the guide) ── */}
      <Row title="A — tsp-form Button, btn-icon-sm" where="ContractFeeModal / LateFeeCollectModal line remove">
        <Button size="sm" variant="ghost" className="btn-icon-sm" startIcon={<Trash2 size={14} />} aria-label="Remove" />
        <span className="text-xs text-subtle">ghost icon, square, sized to control</span>
      </Row>

      {/* ── Variant B: ghost icon raw button, red on hover ───────────────────── */}
      <Row title="B — raw ghost <button>, red on hover" where="PanelCoLessee:649 / PanelContactRef:143">
        <button
          className="p-1.5 rounded hover:bg-danger-soft cursor-pointer text-subtle hover:text-danger transition-colors bg-transparent border-none"
          aria-label="Remove"
        >
          <Trash2 size={16} />
        </button>
        <span className="text-xs text-subtle">subtle → danger on hover</span>
      </Row>

      {/* ── Variant C: solid red text button ─────────────────────────────────── */}
      <Row title="C — solid red text button" where="PanelCoLessee:641 (hover:bg-danger/80)">
        <button className="px-2 py-1 rounded text-xs font-medium bg-danger text-white hover:bg-danger-soft cursor-pointer border-none">
          ลบ
        </button>
        <span className="text-xs text-subtle">filled danger, text label</span>
      </Row>

      {/* ── Variant D: round red corner badge (image overlay) ────────────────── */}
      <Row title="D — round red corner badge" where="ContractAttachments:443 / ContractDetailPanel:513 (hover:bg-danger/90)">
        <div className="relative w-16 h-16 rounded-md bg-surface-subtle border border-line">
          <button
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center shadow-sm hover:bg-danger-soft disabled:opacity-50 border-none p-0 cursor-pointer"
            aria-label="Remove"
          >
            <X size={12} />
          </button>
        </div>
        <span className="text-xs text-subtle">absolute overlay on a thumbnail — arguably its own pattern</span>
      </Row>

      {/* ── Variant E: full-height red clear bar ─────────────────────────────── */}
      <Row title="E — full-height red bar" where="PriceCheckPage:415 (clear input)">
        <div className="relative w-40 h-9 rounded-md border border-line bg-surface">
          <button className="absolute right-0 top-0 bottom-0 w-9 flex items-center justify-center bg-danger text-white cursor-pointer border-none rounded-r-md" aria-label="Clear">
            <X size={14} />
          </button>
        </div>
        <span className="text-xs text-subtle">different intent (clear field), not a list remove</span>
      </Row>
    </div>
  );
}
