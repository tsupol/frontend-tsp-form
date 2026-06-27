// Bind the STAFF signatures (LESSOR + WITNESS) to the CONTRACT_OPEN snapshot at
// activation time. The customer parties (LESSEE / CO_LESSEE) are intentionally
// left COLLECTING — they sign later on the capture bridge (iPad QR), not here.
// See UI_FEEDBACK/2026-06-26_GUIDE_contract_signing_bridge_delivery_flow §6.1.
//
// Why staff-only: fn_bill_contract_open auto-creates a COLLECTING FULL_CONTRACT
// snapshot with one party row per required signer (LESSEE + every CO_LESSEE +
// LESSOR + both WITNESSes), all unsigned. The snapshot seals only once EVERY
// party is signed. LESSOR/WITNESS signatures are pre-registered staff sigs that
// already carry a signature_media_id — we bind those now so the only parties
// left COLLECTING are the customer-facing ones the bridge will collect.
//
// We do NOT touch LESSEE/CO_LESSEE: no SIGNATURE_PAD pre-sign, no auto-bind.
// Leaving them COLLECTING is what gives the bridge a roster to capture.
//
// Returns the staff roles it could NOT bind (no signatory media) so the caller
// can surface a real mis-configuration instead of a silently stuck contract.

import { apiClient } from '../../../lib/api';

interface SigningParty {
  signing_id: number;
  party_role: 'LESSEE' | 'CO_LESSEE' | 'LESSOR' | 'WITNESS';
  party_index: number;
  customer_id: number | null;
  staff_id: number | null;
  frozen_full_name: string | null;
  signature_media_id: number | null;
  has_signed: boolean;
}

interface SignatoryRow {
  slot: 'LESSOR' | 'WITNESS_1' | 'WITNESS_2';
  signature_media_id: number | null;
}

export interface SignPartiesResult {
  /** Staff parties (LESSOR/WITNESS) with no bound signatory media — a real config error. */
  unsigned: Array<{ role: string; name: string | null }>;
  /** How many staff party signatures were bound. */
  signedCount: number;
}

// Witness party_index → signatory slot.
const WITNESS_SLOT = (index: number): SignatoryRow['slot'] =>
  index === 0 ? 'WITNESS_1' : 'WITNESS_2';

/**
 * Bind the STAFF signatures (LESSOR + WITNESS) on the contract's COLLECTING
 * CONTRACT_OPEN snapshot. Customer parties (LESSEE/CO_LESSEE) are left
 * COLLECTING for the capture bridge.
 *
 * Must be called AFTER fn_bill_contract_open (which creates the snapshot). The
 * snapshot will NOT seal here — it seals once the customer parties also sign on
 * the bridge.
 */
export async function signContractOpenParties(
  contractId: number,
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

  // Staff parties only — customer parties (LESSEE/CO_LESSEE) stay COLLECTING for
  // the bridge, so we never bind them here.
  const pending = parties.filter(
    p => !p.has_signed
      && p.signature_media_id == null
      && (p.party_role === 'LESSOR' || p.party_role === 'WITNESS'),
  );
  if (pending.length === 0) return { unsigned: [], signedCount: 0 };

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

    if (party.party_role === 'LESSOR') {
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
