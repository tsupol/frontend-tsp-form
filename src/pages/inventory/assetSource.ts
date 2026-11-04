// Where a device came from, as one line of text (UI_SUMMARY/158 §3). The
// backend sends the code and the names; only the label is ours. The label word
// differs by who registered it: PARTNER_REGISTER is a deal-partner shop
// registering its own device, DIRECT_REGISTER is an internal branch.

type Translate = (key: string, opts?: Record<string, unknown>) => string;

export interface AssetSourceFields {
  source_kind?: string | null;
  source_po_code?: string | null;
  source_supplier_name?: string | null;
  source_note?: string | null;
  /** Only v_assets has it — the branch stock view shows the label alone. */
  legacy_code?: string | null;
}

export function assetSourceLabel(kind: string, t: Translate): string {
  return t(`asset.sourceKind_${kind}`, { defaultValue: kind });
}

/** The parts after the label, in reading order. */
export function assetSourceDetails(a: AssetSourceFields, t: Translate): string[] {
  const parts: Array<string | null | undefined> = [];
  if (a.source_kind?.startsWith('PO_')) parts.push(a.source_supplier_name, a.source_po_code);
  else if (a.source_kind === 'PARTNER_REGISTER') parts.push(a.source_supplier_name);
  else if (a.source_kind === 'LEGACY_IMPORT' && a.legacy_code) {
    parts.push(t('asset.sourceLegacyCode', { code: a.legacy_code }));
  }
  // What the user typed goes after every kind.
  parts.push(a.source_note);
  return parts.filter((p): p is string => !!p);
}
