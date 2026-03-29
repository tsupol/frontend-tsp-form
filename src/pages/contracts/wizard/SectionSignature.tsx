import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageUploader } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { XCircle, PenLine, Camera } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { uploadToS3 } from '../../../lib/upload';
import { imageConfig } from '../../../config/config';
import { useWizard } from './WizardContext';

export function SectionSignature() {
  const { t } = useTranslation();
  const { data: wizardData } = useWizard();
  const [sigUploading, setSigUploading] = useState(false);
  const [sigPreview, setSigPreview] = useState<string | null>(null);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [evidencePreviews, setEvidencePreviews] = useState<string[]>([]);
  const [error, setError] = useState('');

  const contractId = wizardData.contractId!;

  const handleSignatureUpload = async (images: UploadedImage[]) => {
    if (!images.length) return;
    const img = images[0];
    setSigUploading(true);
    setError('');

    try {
      const cfg = imageConfig.contractSignature;
      const ts = Date.now();
      const smKey = `uploads/contracts/${contractId}/signature-${ts}-sm.webp`;
      const lgKey = `uploads/contracts/${contractId}/signature-${ts}-lg.webp`;

      await uploadToS3(img.file, smKey);
      await uploadToS3(img.originalFile ?? img.file, lgKey);

      await apiClient.rpc('fn_media_upload', {
        p_entity_type: cfg.entityType,
        p_entity_id: contractId,
        p_usage_type: cfg.usageType,
        p_storage_path: { sm: `/${smKey}`, lg: `/${lgKey}` },
      });

      setSigPreview(img.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigUploading(false);
    }
  };

  const handleEvidenceUpload = async (images: UploadedImage[]) => {
    if (!images.length) return;
    setEvidenceUploading(true);
    setError('');

    try {
      const cfg = imageConfig.contractEvidence;
      const ts = Date.now();

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const smKey = `uploads/contracts/${contractId}/evidence-${ts}-${i}-sm.webp`;
        const lgKey = `uploads/contracts/${contractId}/evidence-${ts}-${i}-lg.webp`;

        await uploadToS3(img.file, smKey);
        await uploadToS3(img.originalFile ?? img.file, lgKey);

        await apiClient.rpc('fn_media_upload', {
          p_entity_type: cfg.entityType,
          p_entity_id: contractId,
          p_usage_type: cfg.usageType,
          p_storage_path: { sm: `/${smKey}`, lg: `/${lgKey}` },
        });

        setEvidencePreviews(prev => [...prev, img.preview]);
      }

      // Save step
      await apiClient.rpc('fn_contract_save_step', {
        p_contract_id: contractId,
        p_step: 'SIGNATURE',
        p_data: { signature: !!sigPreview, evidence_count: evidencePreviews.length + images.length },
      }).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEvidenceUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 py-6">
      {error && (
        <div className="alert alert-danger">
          <XCircle size={18} />
          <div><div className="alert-description">{error}</div></div>
        </div>
      )}

      {/* Signature */}
      <div>
        <h2 className="text-lg font-semibold mb-2">{t('wizard.signature')}</h2>
        <p className="text-sm text-subtle mb-3">{t('wizard.signatureDesc')}</p>

        {sigPreview ? (
          <div className="border border-line rounded-lg overflow-hidden">
            <img src={sigPreview} alt="Signature" className="w-full max-h-48 object-contain bg-surface" />
          </div>
        ) : (
          <ImageUploader
            onUpload={handleSignatureUpload}
            resizeOptions={imageConfig.contractSignature.sizes.sm.resize}
            disabled={sigUploading}
            placeholder={
              <div className="flex flex-col items-center gap-2 py-6 text-subtle">
                <PenLine size={28} className="opacity-40" />
                <span className="text-sm">{sigUploading ? t('common.saving') : t('wizard.uploadSignature')}</span>
              </div>
            }
          />
        )}
      </div>

      {/* Evidence */}
      <div>
        <h2 className="text-lg font-semibold mb-2">{t('wizard.evidence')}</h2>
        <p className="text-sm text-subtle mb-3">{t('wizard.evidenceDesc')}</p>

        {evidencePreviews.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {evidencePreviews.map((src, i) => (
              <div key={i} className="border border-line rounded-lg overflow-hidden aspect-square">
                <img src={src} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        )}

        <ImageUploader
          onUpload={handleEvidenceUpload}
          resizeOptions={imageConfig.contractEvidence.sizes.sm.resize}
          multiple
          maxFiles={10}
          disabled={evidenceUploading}
          placeholder={
            <div className="flex flex-col items-center gap-2 py-6 text-subtle">
              <Camera size={28} className="opacity-40" />
              <span className="text-sm">{evidenceUploading ? t('common.saving') : t('wizard.uploadEvidence')}</span>
            </div>
          }
        />
      </div>
    </div>
  );
}
