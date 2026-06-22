import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { ImageUploader } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, XCircle, CreditCard } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { beMediaUploadFromImage } from '../../../lib/beMedia';
import { useUploadSpec } from '../../../hooks/useMediaUrl';
import { useWorkspace } from './WorkspaceContext';
import { IdPhotoUpload } from './IdPhotoUpload';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ModalDocuments({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { data: workspace, updateData } = useWorkspace();
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

  const handleEvidenceUpload = async (images: UploadedImage[]) => {
    if (!contractId || images.length === 0) return;
    setUploading('evidence');
    setError('');
    try {
      for (let i = 0; i < images.length; i++) {
        const results = await beMediaUploadFromImage({
          type: 'contract_evidence',
          image: images[i],
          params: { contract_id: contractId, idx: evidenceCount + i },
        });

        await apiClient.rpc('fn_media_upload', {
          p_entity_type: 'CONTRACT',
          p_entity_id: contractId,
          p_usage_type: 'EVIDENCE',
          p_storage_path: toPaths(results),
        });
      }

      const newCount = evidenceCount + images.length;
      setEvidenceCount(newCount);
      updateData({ evidenceCount: newCount });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
            <ImageUploader
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
