import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { ImageUploader } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, XCircle, CreditCard, ImagePlus } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { beMediaUploadFromImage } from '../../../lib/beMedia';
import { toStoragePath } from '../../../lib/mediaPath';
import { translateApiError } from '../../../lib/apiErrors';
import { useUploadSpec } from '../../../hooks/useMediaUrl';
import { useAuth } from '../../../contexts/AuthContext';
import { uploadContractPhoto } from '../uploadContractPhoto';
import { useWorkspace } from './WorkspaceContext';
import { IdPhotoUpload } from './IdPhotoUpload';
import { SingleImageUploader } from '../../../components/SingleImageUploader';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** The "general" photo group of the contract album (UI_SUMMARY/141 §1) — the
 *  old flat album, where a photo with no handover role belongs. */
const GENERAL_PHOTO_SLOT = 'ATTACHMENT';

export function ModalDocuments({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { data: workspace, updateData } = useWorkspace();
  const { user } = useAuth();
  const contractId = workspace.contractId;
  const customerId = workspace.customerId;

  const [idPhotoUploaded, setIdPhotoUploaded] = useState(workspace.hasIdPhoto);
  const [signatureUploaded, setSignatureUploaded] = useState(workspace.hasSignature);
  const [evidenceCount, setEvidenceCount] = useState(workspace.evidenceCount);
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');

  const signature = useUploadSpec('contract_signature');
  const evidence = useUploadSpec('contract_evidence');

  const toPaths = (results: Record<string, { key: string }>) => {
    const out: Record<string, string> = {};
    for (const [size, r] of Object.entries(results)) out[size] = `/${r.key}`;
    return out;
  };

  const handleIdPhotoUpload = async (images: UploadedImage[]) => {
    if (!contractId || !customerId || images.length === 0) return;
    setUploading('idPhoto');
    setError('');
    try {
      const results = await beMediaUploadFromImage({
        type: 'customer_id_card',
        image: images[0],
        params: { customer_id: customerId },
      });

      await apiClient.rpc('fn_media_upload', {
        p_entity_type: 'CUSTOMER',
        p_entity_id: customerId,
        p_usage_type: 'ID_CARD',
        p_storage_path: toPaths(results),
      });

      setIdPhotoUploaded(true);
      updateData({ hasIdPhoto: true });

      await apiClient.rpc('fn_contract_save_step', {
        p_contract_id: contractId,
        p_step: 'ID_PHOTO',
        p_data: { uploaded: true },
      }).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading('');
    }
  };

  const handleSignatureUpload = async (images: UploadedImage[]) => {
    if (!contractId || !customerId || images.length === 0) return;
    setUploading('signature');
    setError('');
    try {
      const results = await beMediaUploadFromImage({
        type: 'contract_signature',
        image: images[0],
        params: { contract_id: contractId, customer_id: customerId },
      });

      await apiClient.rpc('fn_media_upload', {
        p_entity_type: 'CONTRACT',
        p_entity_id: contractId,
        p_usage_type: 'SIGNATURE',
        p_storage_path: toPaths(results),
      });

      setSignatureUploaded(true);
      updateData({ hasSignature: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading('');
    }
  };

  /**
   * Contract photos from the wizard go into the SAME album the contract detail
   * page shows, through the same call (UI_SUMMARY/141 §3).
   *
   * This step used to upload through be-media and let be-media record the row
   * itself. That path has no slot for a photo group, and BE confirmed on
   * 2026-09-18 it never will — the group lives in core.entity_media, which only
   * fn_media_attach writes. Photos added the old way arrived with no group at
   * all, so they did not count towards the "handover photos complete" gate a
   * deal-partner shop must pass to close out its settlement.
   *
   * The group used here is ATTACHMENT — "general", the old flat album (doc 141
   * §1). It is the right one: the wizard runs before handover, so these are
   * ordinary contract photos, not one of the four handover groups. A user who
   * wants one filed as handover evidence drags it there on the contract's photo
   * tab, which is a single RPC and no re-upload.
   */
  const handleEvidenceUpload = async (images: UploadedImage[]) => {
    if (!contractId || images.length === 0) return;
    if (user?.holding_id == null) { setError(t('common.error')); return; }
    setUploading('evidence');
    setError('');
    try {
      for (const image of images) {
        const up = await uploadContractPhoto(contractId, image);
        await apiClient.rpc('fn_media_attach', {
          p_holding_id: user.holding_id,
          p_storage_path: toStoragePath(up.primaryKey),
          p_variants_json: up.variantsJson,
          p_media_type: 'IMAGE',
          p_access_level: 'CONFIDENTIAL',
          p_mime_type: up.contentType,
          p_file_size_bytes: up.fileSize,
          p_original_filename: up.fileName,
          p_entity_type: 'CONTRACT',
          p_entity_id: contractId,
          p_usage_type: GENERAL_PHOTO_SLOT,
          // null appends to the end of the group (mig 1252).
          p_sort_order: null,
          p_caption: null,
        });
      }

      const newCount = evidenceCount + images.length;
      setEvidenceCount(newCount);
      updateData({ evidenceCount: newCount });
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setUploading('');
    }
  };

  if (!contractId) return null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="40rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('workspace.cardDocuments')}</h2>
      </div>
      <div className="modal-content" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        <div className="flex flex-col gap-5">
          {error && (
            <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{error}</div></div></div>
          )}

          {/* ID Card Photo */}
          <IdPhotoUpload
            icon={<CreditCard size={14} />}
            label={t('workspace.docIdPhoto')}
            type="customer_id_card"
            fileUrl={null}
            presentWithoutKey={idPhotoUploaded}
            uploading={uploading === 'idPhoto'}
            onUpload={handleIdPhotoUpload}
            disabled={!customerId}
          />

          <div className="border-t border-line" />

          {/* Signature */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {signatureUploaded ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
              <label className="form-label mb-0">{t('workspace.docSignature')}</label>
              {uploading === 'signature' && <span className="text-xs text-subtle">{t('common.loading')}</span>}
            </div>
            <SingleImageUploader
              previewUrl={null}
              onRemove={() => {}}
              resizeOptions={signature.resize}
              sizes={signature.sizes}
              onUpload={handleSignatureUpload}
              disabled={uploading === 'signature' || !signature.spec || !customerId}
            />
          </div>

          <div className="border-t border-line" />

          {/* Evidence */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {evidenceCount > 0 ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
              <label className="form-label mb-0">{t('workspace.docEvidence')} ({evidenceCount})</label>
              {uploading === 'evidence' && <span className="text-xs text-subtle">{t('common.loading')}</span>}
            </div>
            <ImageUploader
              resizeOptions={evidence.resize}
              sizes={evidence.sizes}
              onUpload={handleEvidenceUpload}
              disabled={uploading === 'evidence' || !evidence.spec}
              multiple
              maxFiles={evidence.spec?.max_files}
              placeholder={
                <div className="flex flex-col items-center justify-center gap-1 text-subtle">
                  <ImagePlus size={20} className="opacity-60" />
                  <span className="text-xs">{t('imageUploader.dropHintSingle')}</span>
                </div>
              }
            />
          </div>

        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
