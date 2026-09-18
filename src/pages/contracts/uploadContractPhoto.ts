import type { UploadedImage } from 'tsp-form';
import { beMediaUploadFromImage, CONTRACT_EVIDENCE_TYPE } from '../../lib/beMedia';
import { toStoragePath } from '../../lib/mediaPath';

/**
 * Resize → be-media (sm + md) → the storage keys, ready for `fn_media_attach`.
 *
 * `idx` is a timestamp, not a position: two photos added at once would collide
 * on an identical count, and be-media derives the object name from what we send
 * until it starts minting the leaf itself.
 *
 * Shared by the contract photo album (ContractPhotoGroups) and the contract-open
 * wizard's document step (workspace/ModalDocuments) — both put photos into the
 * same album through the same RPC (UI_SUMMARY/141 §3), so there is one copy of
 * this and it lives in its own file rather than being exported from a component
 * module.
 */
export async function uploadContractPhoto(contractId: number, image: UploadedImage) {
  const results = await beMediaUploadFromImage({
    type: CONTRACT_EVIDENCE_TYPE,
    image,
    params: { contract_id: contractId, idx: Date.now() },
  });
  const primary = results.md ?? results.sm ?? Object.values(results)[0];
  if (!primary) throw new Error('Upload returned no key');
  const variantsJson: Record<string, string> = {};
  for (const [size, r] of Object.entries(results)) {
    if (r?.key) variantsJson[size] = toStoragePath(r.key);
  }
  return {
    primaryKey: primary.key,
    variantsJson,
    contentType: primary.content_type,
    fileSize: image.variants?.md?.file.size ?? image.file?.size ?? null,
    fileName: image.originalFile?.name ?? null,
  };
}
