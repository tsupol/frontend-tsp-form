// Bind signatures to the CONTRACT_OPEN snapshot at activation time.
//
// Why this exists: fn_bill_contract_open auto-creates a COLLECTING
// FULL_CONTRACT snapshot with one party row per required signer — and (mig 251)
// that's LESSEE + every GUARANTOR + LESSOR + both WITNESSes. None are
// pre-signed (signature_media_id starts NULL). The contract only goes ACTIVE
// once the bill is PAID *and* the snapshot is SEALED (all parties signed). The
// old confirm flow paid but never signed, so contracts got stuck at
// "paid, awaiting signature".
//
// The signatures already exist from earlier steps — we do NOT re-capture:
//   • LESSEE / GUARANTOR → a SIGNATURE_PAD contract document (file_url) saved in
//     the Documents step. We re-attach its storage_path as a CONTRACT/SIGNATURE
//     media to mint the media_id fn_contract_signing_sign needs (option 2 — no
//     new media row at capture time; mint it here on confirm).
//   • LESSOR / WITNESS → the bound branch signatory already carries a
//     signature_media_id; we reuse it directly.
//
// Returns the roles it could NOT sign (no signature on file) so the caller can
// surface them instead of silently leaving the contract un-activated.

import { apiClient } from '../../../lib/api';
import { toStoragePath } from '../../../lib/mediaPath';

interface SigningParty {
  signing_id: number;
  party_role: 'LESSEE' | 'GUARANTOR' | 'LESSOR' | 'WITNESS';
  party_index: number;
  customer_id: number | null;
  staff_id: number | null;
  frozen_full_name: string | null;
  signature_media_id: number | null;
  has_signed: boolean;
}

interface SignatureDoc {
  customer_id: number;
  file_url: string;
}

interface SignatoryRow {
  slot: 'LESSOR' | 'WITNESS_1' | 'WITNESS_2';
  signature_media_id: number | null;
}

export interface SignPartiesResult {
  /** Required parties with no signature on file — not signed. */
  unsigned: Array<{ role: string; name: string | null }>;
  /** How many party signatures were submitted. */
  signedCount: number;
}

// Witness party_index → signatory slot.
const WITNESS_SLOT = (index: number): SignatoryRow['slot'] =>
  index === 0 ? 'WITNESS_1' : 'WITNESS_2';

/**
 * Re-attach an existing signature image (file_url / storage key) as a
 * CONTRACT/SIGNATURE media and return the new media_id.
 */
async function attachSignatureMedia(
  holdingId: number,
  contractId: number,
  fileUrl: string,
): Promise<number> {
  const res = await apiClient.rpc<{ media_id: number }>('fn_media_attach', {
    p_holding_id: holdingId,
    p_storage_path: toStoragePath(fileUrl),
    p_variants_json: null,
    p_media_type: 'IMAGE',
    p_access_level: 'CONFIDENTIAL',
    p_mime_type: fileUrl.endsWith('.webp') ? 'image/webp' : 'image/png',
    p_file_size_bytes: null,
    p_original_filename: null,
    p_entity_type: 'CONTRACT',
    p_entity_id: contractId,
    p_usage_type: 'SIGNATURE',
    p_sort_order: 0,
    p_caption: null,
  });
  return res.media_id;
}

/**
 * Sign every unsigned required party on the contract's COLLECTING
 * CONTRACT_OPEN snapshot, reusing already-captured signatures.
 *
 * Must be called AFTER fn_bill_contract_open (which creates the snapshot) and
 * BEFORE fn_bill_payment_confirm, so the snapshot can seal alongside payment.
 */
export async function signContractOpenParties(
  contractId: number,
  holdingId: number,
): Promise<SignPartiesResult> {
  // The CONTRACT_OPEN snapshot is the current COLLECTING FULL_CONTRACT one.
  const snapshots = await apiClient.get<Array<{ signing_id: number }>>(
    `/v_contract_signing_visible?contract_id=eq.${contractId}` +
      `&type=eq.FULL_CONTRACT&status=eq.COLLECTING&change_reason=eq.CONTRACT_OPEN` +
      `&select=signing_id&order=version.desc&limit=1`,
  );
  const signingId = snapshots[0]?.signing_id;
  if (signingId == null) {
    // No open snapshot — nothing to sign (already sealed, or none required).
    return { unsigned: [], signedCount: 0 };
  }

  const parties = await apiClient.get<SigningParty[]>(
    `/v_contract_signing_party?signing_id=eq.${signingId}` +
      `&select=signing_id,party_role,party_index,customer_id,staff_id,frozen_full_name,signature_media_id,has_signed` +
      `&order=party_role,party_index`,
  );

  const pending = parties.filter(p => !p.has_signed && p.signature_media_id == null);
  if (pending.length === 0) return { unsigned: [], signedCount: 0 };

  // Customer signatures captured in the Documents step (file_url per customer).
  const sigDocs = await apiClient.get<SignatureDoc[]>(
    `/v_contract_documents?contract_id=eq.${contractId}&doc_type=eq.SIGNATURE_PAD&select=customer_id,file_url`,
  );
  const sigByCustomer = new Map<number, string>();
  for (const d of sigDocs) {
    if (d.customer_id != null && !sigByCustomer.has(d.customer_id)) {
      sigByCustomer.set(d.customer_id, d.file_url);
    }
  }

  // Branch signatory media (LESSOR / WITNESS) — already real media_ids.
  const signatories = await apiClient.get<SignatoryRow[]>(
    `/v_contract_signatories?contract_id=eq.${contractId}&select=slot,signature_media_id`,
  ).catch(() => [] as SignatoryRow[]);
  const mediaBySlot = new Map<string, number>();
  for (const s of signatories) {
    if (s.signature_media_id != null) mediaBySlot.set(s.slot, s.signature_media_id);
  }

  const unsigned: SignPartiesResult['unsigned'] = [];
  let signedCount = 0;

  for (const party of pending) {
    let mediaId: number | null = null;

    if (party.party_role === 'LESSEE' || party.party_role === 'GUARANTOR') {
      const fileUrl = party.customer_id != null ? sigByCustomer.get(party.customer_id) : undefined;
      if (fileUrl) {
        mediaId = await attachSignatureMedia(holdingId, contractId, fileUrl);
      }
    } else if (party.party_role === 'LESSOR') {
      mediaId = mediaBySlot.get('LESSOR') ?? null;
    } else if (party.party_role === 'WITNESS') {
      mediaId = mediaBySlot.get(WITNESS_SLOT(party.party_index)) ?? null;
    }

    if (mediaId == null) {
      unsigned.push({ role: party.party_role, name: party.frozen_full_name });
      continue;
    }

    await apiClient.rpc('fn_contract_signing_sign', {
      p_signing_id: party.signing_id,
      p_party_role: party.party_role,
      p_party_index: party.party_index,
      p_signature_media_id: mediaId,
    });
    signedCount++;
  }

  return { unsigned, signedCount };
}
