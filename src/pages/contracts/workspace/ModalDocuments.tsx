import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { ImageUploader } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, XCircle, CreditCard } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { uploadToS3 } from '../../../lib/upload';
import { imageConfig } from '../../../config/config';
import { useWorkspace } from './WorkspaceContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ModalDocuments({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { data: workspace, updateData } = useWorkspace();
  const contractId = workspace.contractId;

  const [idPhotoUploaded, setIdPhotoUploaded] = useState(workspace.hasIdPhoto);
  const [signatureUploaded, setSignatureUploaded] = useState(workspace.hasSignature);
  const [evidenceCount, setEvidenceCount] = useState(workspace.evidenceCount);
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');


  const handleIdPhotoUpload = async (images: UploadedImage[]) => {
    if (!contractId || images.length === 0) return;
    setUploading('idPhoto');
    setError('');
    try {
      const img = images[0];
      const ts = Date.now();
      const smKey = `uploads/contracts/${contractId}/id-card-${ts}-sm.webp`;
      const lgKey = `uploads/contracts/${contractId}/id-card-${ts}-lg.webp`;

      await uploadToS3(img.file, smKey);
      await uploadToS3(img.originalFile ?? img.file, lgKey);

      await apiClient.rpc('fn_media_upload', {
        p_entity_type: 'CONTRACT',
        p_entity_id: contractId,
        p_usage_type: 'ID_CARD',
        p_storage_path: { sm: `/${smKey}`, lg: `/${lgKey}` },
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
    if (!contractId || images.length === 0) return;
    setUploading('signature');
    setError('');
    try {
      const img = images[0];
      const ts = Date.now();
      const smKey = `uploads/contracts/${contractId}/signature-${ts}-sm.webp`;
      const lgKey = `uploads/contracts/${contractId}/signature-${ts}-lg.webp`;

      await uploadToS3(img.file, smKey);
      await uploadToS3(img.originalFile ?? img.file, lgKey);

      await apiClient.rpc('fn_media_upload', {
        p_entity_type: 'CONTRACT',
        p_entity_id: contractId,
        p_usage_type: 'SIGNATURE',
        p_storage_path: { sm: `/${smKey}`, lg: `/${lgKey}` },
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
        const img = images[i];
        const ts = Date.now();
        const smKey = `uploads/contracts/${contractId}/evidence-${ts}-${i}-sm.webp`;
        const lgKey = `uploads/contracts/${contractId}/evidence-${ts}-${i}-lg.webp`;

        await uploadToS3(img.file, smKey);
        await uploadToS3(img.originalFile ?? img.file, lgKey);

        await apiClient.rpc('fn_media_upload', {
          p_entity_type: 'CONTRACT',
          p_entity_id: contractId,
          p_usage_type: 'EVIDENCE',
          p_storage_path: { sm: `/${smKey}`, lg: `/${lgKey}` },
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

  const smResize = imageConfig.customerIdCard.sizes.sm.resize;

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
          <div>
            <div className="flex items-center gap-2 mb-2">
              {idPhotoUploaded ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
              <label className="form-label mb-0">{t('workspace.docIdPhoto')}</label>
              {uploading === 'idPhoto' && <span className="text-xs text-subtle">{t('common.loading')}</span>}
            </div>
            <ImageUploader
              resizeOptions={smResize}
              onUpload={handleIdPhotoUpload}
              disabled={uploading === 'idPhoto'}
              placeholder={
                <div className="flex flex-col items-center gap-2 py-6 text-subtle">
                  <CreditCard size={24} className="opacity-40" />
                  <span className="text-xs">{t('wizard.uploadIdCard')}</span>
                </div>
              }
            />
          </div>

          <div className="border-t border-line" />

          {/* Signature */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {signatureUploaded ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
              <label className="form-label mb-0">{t('workspace.docSignature')}</label>
              {uploading === 'signature' && <span className="text-xs text-subtle">{t('common.loading')}</span>}
            </div>
            <ImageUploader
              resizeOptions={smResize}
              onUpload={handleSignatureUpload}
              disabled={uploading === 'signature'}
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
              resizeOptions={smResize}
              onUpload={handleEvidenceUpload}
              disabled={uploading === 'evidence'}
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
