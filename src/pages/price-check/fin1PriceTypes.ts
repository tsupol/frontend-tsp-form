// ตารางราคาไฟแนนซ์ (FIN1) — one row per contractable model, priced or not.
// Staff read v_fin1_price_list (adds can_edit); a deal-partner shop reads
// v_partner_fin1_price_list through the partner-view rewrite (same columns).
// UI_FEEDBACK/2026-10-18_IMPLEMENT_fin1_price_table_page.md (mig 1457) +
// _edit_dialog.md (mig 1458–1460).

export interface Fin1PriceRow {
  brand_id: number;
  brand_name: string;
  family_id: number;
  family_name: string;
  model_id: number;
  model_name: string;
  product_display_name: string;
  has_price: boolean;
  retail_price: number | null;
  price_updated_at: string | null;
  uplift_min: number | null;
  uplift_max: number | null;
  /** MODEL = the model's own frame · POLICY = the holding default. */
  uplift_source: 'MODEL' | 'POLICY' | null;
  accepts_used: boolean;
  used_retail_min: number | null;
  used_retail_max: number | null;
  used_uplift_min: number | null;
  used_uplift_max: number | null;
  has_upcoming: boolean;
  next_effective_from: string | null;
  next_retail_price: number | null;
  next_uplift_min: number | null;
  next_uplift_max: number | null;
  next_used_retail_min: number | null;
  next_used_retail_max: number | null;
  next_used_uplift_min: number | null;
  next_used_uplift_max: number | null;
  /** Staff view only — absent for a shop. */
  can_edit?: boolean;
}

export type PriceState = '' | 'priced' | 'unpriced';

export interface Fin1PriceFilters {
  q: string;
  brand: string;
  family: string;
  priceState: PriceState;
  usedOnly: boolean;
  upcomingOnly: boolean;
}

export const EMPTY_FILTERS: Fin1PriceFilters = {
  q: '', brand: '', family: '', priceState: '', usedOnly: false, upcomingOnly: false,
};

export function applyFilters(rows: Fin1PriceRow[], f: Fin1PriceFilters): Fin1PriceRow[] {
  const tokens = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(r => {
    if (f.brand && String(r.brand_id) !== f.brand) return false;
    if (f.family && String(r.family_id) !== f.family) return false;
    if (f.priceState === 'priced' && !r.has_price) return false;
    if (f.priceState === 'unpriced' && r.has_price) return false;
    if (f.usedOnly && !r.accepts_used) return false;
    if (f.upcomingOnly && !r.has_upcoming) return false;
    if (tokens.length) {
      const hay = (r.product_display_name || `${r.brand_name} ${r.family_name} ${r.model_name}`).toLowerCase();
      if (!tokens.every(tk => hay.includes(tk))) return false;
    }
    return true;
  });
}
