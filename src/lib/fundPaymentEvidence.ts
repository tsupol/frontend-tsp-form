// Evidence photos for one movement of a fund-money document (mig 1293,
// UI_SUMMARY/149 §9c) — the upload half, shared by the evidence strip on the
// document (FundPaymentEvidence) and the optional slip on the five pay windows.
//
// Pipeline: resize → be-media upload (be-media runs fn_media_upload_check itself
// with the forwarded JWT) → fn_media_attach with all 13 arguments (the function
// has a 12- and a 13-argument overload; sending fewer gives PGRST203).

import { resizeToVariants } from 'tsp-form';
import { apiClient } from './api';
import { toStoragePath } from './mediaPath';
import {
  beMediaUpload,
  FUND_PAYMENT_EVIDENCE_RESIZE,
  FUND_PAYMENT_EVIDENCE_TYPE,
} from './beMedia';

export const FUND_PAYMENT_EVIDENCE_ENTITY_TYPE = 'FUND_BILL_PAYMENT';
export const FUND_PAYMENT_EVIDENCE_USAGE_TYPE = 'TRANSFER_EVIDENCE';

/**
 * Upload one photo and register it against one movement. Throws on failure.
 * Callers with several photos call this one at a time: be-media mints the index
 * per request for this type, and parallel sends have collided on other albums.
 */
export async function uploadFundPaymentEvidenceFile(
  paymentId: number,
  file: File,
  holdingId: number,
): Promise<void> {
  const variants = await resizeToVariants(file, FUND_PAYMENT_EVIDENCE_RESIZE);
  const small = variants.sm?.file;
  const large = variants.lg?.file;
  if (!small || !large) throw new Error('resize produced no image');

  // Uploaded so a thumbnail exists at the service; the key is not kept,
  // because the variants column only accepts public paths and this album
  // is private — the registry row carries the large key alone.
  await beMediaUpload({
    type: FUND_PAYMENT_EVIDENCE_TYPE,
    file: small,
    size: 'sm',
    params: { payment_id: paymentId },
  });
  const lgRes = await beMediaUpload({
    type: FUND_PAYMENT_EVIDENCE_TYPE,
    file: large,
    size: 'lg',
    params: { payment_id: paymentId },
  });

  await apiClient.rpc('fn_media_attach', {
    p_holding_id: holdingId,
    p_storage_path: toStoragePath(lgRes.key),
    // Private keys only — the variants column rejects private paths.
    p_variants_json: null,
    p_media_type: 'IMAGE',
    // This album has no PRIVATE level; RESTRICTED is what 149 §9c specifies.
    p_access_level: 'RESTRICTED',
    // The mime follows the bytes (a browser without webp encode gives JPEG).
    p_mime_type: lgRes.content_type,
    p_file_size_bytes: large.size,
    p_original_filename: file.name || null,
    p_entity_type: FUND_PAYMENT_EVIDENCE_ENTITY_TYPE,
    p_entity_id: paymentId,
    p_usage_type: FUND_PAYMENT_EVIDENCE_USAGE_TYPE,
    p_sort_order: 0,
    p_caption: null,
  });
}

/**
 * The movement a slip belongs to, for a pay call that does not return one.
 *
 * Only fn_fund_movement_confirm returns `payment_id`; fn_fund_bill_pay,
 * fn_fund_bill_credit_note, fn_fund_clawback_collect and
 * fn_partner_return_buyback_paid return the document only (mig 1411). So this
 * reads the document's newest live movement that touched a bank account
 * (`held_by <> NONE` — the fund company's own INTERNAL row never carries a
 * slip, matching FundBillDetailPanel). Newest = the one this press wrote; for a
 * clawback that wrote one row per book it is the row the backend's own log
 * points at. Remove once the backend returns the id.
 */
export async function findSlipPaymentId(billId: number): Promise<number | null> {
  const rows = await apiClient.get<{ payment_id: number }[]>(
    `/v_fund_bill_payments?bill_id=eq.${billId}&held_by=neq.NONE&voided_at=is.null`
    + '&select=payment_id&order=payment_id.desc&limit=1',
  );
  return rows[0]?.payment_id ?? null;
}
