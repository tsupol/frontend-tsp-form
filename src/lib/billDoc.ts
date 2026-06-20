// ============================================================================
// Bill print document — a modular block format for thermal (80mm) receipts.
//
// The BE emits a *tree of blocks* instead of a rigid struct. The client lays it
// out against the unified `.bill-receipt` CSS (src/app.css) and prints it via
// the existing window.print() isolation. This file IS the format spec, in code.
//
// Design rules (paper is 72mm printable, single column):
//   - Blocks stack VERTICALLY only. Nesting (`group`) is vertical sectioning,
//     never side-by-side columns.
//   - Horizontal layout exists only WITHIN a line, via `cols` — and columns use
//     a small SEMANTIC vocabulary (flex / align / mono / emphasis / wrap), never
//     raw CSS / Tailwind. Semantic props render identically on web AND native
//     (iOS/Android consume the same payload → SwiftUI/PDF).
//   - Every piece of text is a `TextValue`: a raw string (BE's default, already
//     Thai) OR `{ key, args? }` to be resolved client-side through i18n. This is
//     how one payload supports both translatable and non-translatable text.
//   - Predefined blocks (seller_header / totals / payments / lines) carry
//     STRUCTURED data for the legally-sensitive / money parts — the client owns
//     their layout. Freeform blocks (rows / cols / text) are the long-tail
//     escape hatch.
// ============================================================================

import type { TFunction } from 'i18next';

/** Current format version. Bump when block shapes change; renderers degrade
 *  gracefully on unknown block types rather than throwing. */
export const BILL_DOC_FORMAT = 1;

// ── Text: raw (already-localized) string, or a key the client resolves ──
export type TextValue =
  | string
  | { key: string; args?: Record<string, string | number>; defaultValue?: string };

/** Resolve a TextValue to a printable string. Raw strings pass through
 *  verbatim (BE's "always Thai" default); `{key}` goes through i18n. */
export function resolveText(t: TFunction, v: TextValue | null | undefined): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return t(v.key, { ...v.args, defaultValue: v.defaultValue ?? v.key });
}

// ── Line primitives ──
export type ColAlign = 'left' | 'right' | 'center';
export type Emphasis = 'normal' | 'strong' | 'muted';

/** One cell within a line. Semantic props only — no CSS strings. */
export interface DocCol {
  text: TextValue;
  /** Proportional width weight (like flex-grow). Default 1. */
  flex?: number;
  align?: ColAlign;
  /** Tabular numerals — use for money / codes so columns align. */
  mono?: boolean;
  emphasis?: Emphasis;
  /** Allow wrapping. Default: descriptions wrap, value columns don't. */
  wrap?: boolean;
}

/**
 * A line is either an explicit column array, or a named template (sugar over
 * the two shapes that cover ~90% of receipt lines):
 *   - `kv`   → label (left) + value (right-aligned). The workhorse.
 *   - `text` → one full-width line (titles, addresses, thank-you).
 *   - `cols` → explicit escape hatch when neither template fits.
 */
export type DocLine =
  | { template: 'kv'; label: TextValue; value: TextValue; valueMono?: boolean; emphasis?: Emphasis }
  | { template: 'text'; text: TextValue; align?: ColAlign; emphasis?: Emphasis; wrap?: boolean }
  | { template: 'cols'; cols: DocCol[] };

// ── Structured data carried by predefined blocks ──
export interface SellerHeader {
  company_name?: TextValue | null;
  branch_name?: TextValue | null;
  address?: TextValue | null;
  tel?: TextValue | null;
  is_vat_registered?: boolean;
  tax_id?: string | null;
  tax_branch_code?: string | null;
}

export interface DocLineItem {
  description: TextValue;
  qty: number;
  amount: number;
}

export interface DocTotals {
  /** Pre-VAT base. Omit on non-VAT receipts. */
  subtotal?: number;
  vat_rate?: number;       // e.g. 7
  vat_amount?: number;
  grand_total: number;
}

export interface DocPayment {
  method: TextValue;
  amount: number;
  /** Optional secondary line (bank · account, reference). */
  detail?: TextValue | null;
}

// ── Blocks ──
export type DocBlock =
  // predefined (client owns layout)
  | { type: 'seller_header'; data: SellerHeader }
  | { type: 'lines'; data: { items: DocLineItem[]; qtyLabel?: TextValue } }
  | { type: 'totals'; data: DocTotals & { totalLabel?: TextValue; subtotalLabel?: TextValue; vatLabel?: TextValue } }
  | {
      type: 'payments';
      data: {
        items: DocPayment[];
        paid?: number; paidLabel?: TextValue;
        change?: number; changeLabel?: TextValue;
      };
    }
  | { type: 'void_notice'; data: { text: TextValue; lines?: DocLine[] } }
  // generic / freeform
  | { type: 'text'; text: TextValue; align?: ColAlign; emphasis?: Emphasis; wrap?: boolean }
  | { type: 'rows'; lines: DocLine[] }
  | { type: 'divider'; rule?: boolean }   // rule=true → solid line, else dashed
  | { type: 'space'; size?: number }      // vertical gap in px
  // nestable, vertical-only
  | { type: 'group'; blocks: DocBlock[] };

/** The whole printable document. */
export interface BillDoc {
  format: number;          // BILL_DOC_FORMAT
  paper?: '80mm';          // only thermal for now
  watermark?: TextValue | null;  // e.g. "VOID"
  blocks: DocBlock[];
}

/** Max nesting depth for `group` — receipts never need more, and a cap keeps
 *  the renderer from being a recursion foot-gun. */
export const MAX_GROUP_DEPTH = 3;
