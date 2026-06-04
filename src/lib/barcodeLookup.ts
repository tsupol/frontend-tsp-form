import { apiClient, ApiError } from './api';

export interface BarcodeSearchHit {
  barcode_id: number;
  barcode: string;
  barcode_type: string | null;
  is_primary: boolean;
  source: string | null;
  variant_id: number;
  sku_code: string;
  sku_name: string;
  manufacturer_color: string | null;
  master_color_code: string | null;
  color_group: string | null;
  model_id: number;
  model_code: string;
  model_name: string;
  family_id: number;
  family_code: string;
  family_name: string;
  brand_id: number;
  brand_code: string;
  brand_name: string;
  category_code: string | null;
}

/** A digits-only string of 8+ chars — heuristic for an EAN/UPC barcode. */
export function looksLikeBarcode(raw: string): boolean {
  return /^\d{8,}$/.test(raw.trim());
}

/**
 * Look up a barcode → variant/model via `barcode_search` RPC.
 * Returns null on BARCODE.NOT_FOUND so callers can fall back to text search.
 * Rethrows any other error.
 */
export async function lookupBarcode(barcode: string): Promise<BarcodeSearchHit | null> {
  try {
    return await apiClient.rpc<BarcodeSearchHit>('barcode_search', { p_barcode: barcode.trim() });
  } catch (err) {
    if (err instanceof ApiError && (err.code?.includes('NOT_FOUND') || err.messageKey?.includes('not_found'))) {
      return null;
    }
    throw err;
  }
}
