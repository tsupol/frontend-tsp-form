// The contract photo checklist (fn_contract_photo_status) and the album query
// keys, shared by the grouped album and the photo window's pinned summary.

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

/** One group's line in fn_contract_photo_status. */
export interface PhotoStatusSlot {
  slot: string;
  label_th: string;
  label_en: string;
  required: boolean;
  min: number;
  max: number | null;
  count: number;
  ok: boolean;
  locks_with_settlement: boolean;
}

export interface PhotoStatus {
  contract_id: number;
  complete: boolean;
  missing: string[];
  total_photos: number;
  /** false → every group with locks_with_settlement is frozen. */
  editable: boolean;
  /** `lock_kind` names which document froze the album: SETTLEMENT or RETURN. */
  lock: {
    code?: string;
    lock_kind?: string;
    settlement_status?: string;
    settlement_code?: string;
    return_code?: string;
    return_status?: string;
  } | null;
  slots: PhotoStatusSlot[];
}

/** The two groups a deal-partner shop fills to support its credit request
 *  (mig 1559) — attached while drafting, read by the credit desk on the
 *  request, locked once it approves. Codes are the contract; labels come
 *  from the slots view. */
export const CREDIT_PHOTO_SLOTS = ['CREDIT_WORK', 'CREDIT_OTHER'];
export const isCreditPhotoSlot = (slot: string) => CREDIT_PHOTO_SLOTS.includes(slot);

export const photosKey = (contractId: number) => ['contract-photo-groups', contractId] as const;
export const statusKey = (contractId: number) => ['contract-photo-status', contractId] as const;

/** The checklist — the only source of "complete", "missing" and "editable".
 *  Shared cache, so a pinned summary and the groups read the same answer. */
export function useContractPhotoStatus(contractId: number) {
  return useQuery({
    queryKey: statusKey(contractId),
    queryFn: () => apiClient.rpc<PhotoStatus>('fn_contract_photo_status', { p_contract_id: contractId }),
    // 0 = "not applicable" (CreditSupportPhotosCard on a non-shop contract) —
    // without this every contract overview fired a 400 CONTRACT_NOT_FOUND.
    enabled: contractId > 0,
    staleTime: 15 * 1000,
  });
}

/** One photo of the contract album, any group. */
export interface ContractPhoto {
  entity_media_id: number;
  media_id: number;
  usage_type: string;
  sort_order: number;
  caption: string | null;
  storage_path: string;
  variants_json: Record<string, string> | null;
  /** Locked per photo (mig 1559: the credit desk approved the request) —
   *  no remove / move / caption edit; new photos may still be added. */
  is_locked: boolean;
}

/** Every photo in the album, all groups in one read. `slots` = the groups to
 *  read; the query waits until it is known. */
export function useContractAlbumPhotos(contractId: number, slots: string[]) {
  return useQuery({
    queryKey: photosKey(contractId),
    queryFn: () => apiClient.get<ContractPhoto[]>(
      `/v_entity_media?entity_type=eq.CONTRACT&entity_id=eq.${contractId}`
      + `&usage_type=in.(${slots.join(',')})`
      + '&select=entity_media_id,media_id,usage_type,sort_order,caption,storage_path,variants_json,is_locked'
      + '&order=usage_type,sort_order',
    ),
    enabled: slots.length > 0,
    staleTime: 30 * 1000,
  });
}
