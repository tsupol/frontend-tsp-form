// Bind the LESSOR staff signature to the CONTRACT_OPEN snapshot at activation
// time. Customer parties (LESSEE / CO_LESSEE) AND witnesses are intentionally
// left COLLECTING — they are collected later, not here.
// See UI_FEEDBACK/2026-06-26_GUIDE_contract_signing_bridge_delivery_flow §6.1.
//
// Why LESSOR-only: fn_bill_contract_open auto-creates a COLLECTING FULL_CONTRACT
// snapshot with one party row per required signer (LESSEE + every CO_LESSEE +
// LESSOR + N empty WITNESS placeholders), all unsigned. The snapshot seals only
// once EVERY party is signed. LESSOR is the one pre-registered branch staff
// signature that already carries a signature_media_id — we bind it now.
//
// WITNESSES are NOT bound here. Since the witness-at-signing redesign (BE mig
// 345/346/400) the snapshot emits `required_witness_count` EMPTY witness slots
// straight from policy; they have no name and no media on purpose and are
// assigned at the signing ceremony via fn_signing_assign_witness — never
// pre-bound from branch signatories, and signing one directly is rejected
// (CONTRACT.STATE.WITNESS_NOT_ASSIGNED). So an unbound WITNESS is the expected
// state at payment, not a config error. Treating it as one wrongly blocked the
// payment step when a branch has no witness signatory registered.
//
// We do NOT touch LESSEE/CO_LESSEE/WITNESS: no pre-sign, no auto-bind. Leaving
// them COLLECTING is what gives the ceremony/bridge a roster to capture.
//
// Returns the LESSOR role if it could NOT be bound (no signatory media) so the
// caller can surface a real mis-configuration instead of a silently stuck
// contract.

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

// (Witnesses are assigned at the signing ceremony, not pre-bound here.)

export interface SignPartiesResult {
  /** LESSOR party with no bound signatory media — a real config error. */
  unsigned: Array<{ role: string; name: string | null }>;
  /** How many staff party signatures were bound. */
  signedCount: number;
}

/**
 * Bind the LESSOR staff signature on the contract's COLLECTING CONTRACT_OPEN
 * snapshot. Customer parties (LESSEE/CO_LESSEE) and WITNESS placeholders are
 * left COLLECTING for the ceremony/bridge.
 *
 * Must be called AFTER fn_bill_contract_open (which creates the snapshot). The
 * snapshot will NOT seal here — it seals once the remaining parties also sign.
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

  // LESSOR only. Customer parties (LESSEE/CO_LESSEE) and WITNESS placeholders
  // stay COLLECTING — witnesses are assigned at the signing ceremony via
  // fn_signing_assign_witness, never pre-bound here (BE mig 345/346/400).
  const pending = parties.filter(
    p => !p.has_signed
      && p.signature_media_id == null
      && p.party_role === 'LESSOR',
  );
  if (pending.length === 0) return { unsigned: [], signedCount: 0 };

  // Branch LESSOR signatory media — already a real media_id.
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
    const mediaId = mediaBySlot.get('LESSOR') ?? null;

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
