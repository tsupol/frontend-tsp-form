import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageUploader } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { XCircle, CreditCard } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { uploadToS3 } from '../../../lib/upload';
import { imageConfig } from '../../../config/config';
import { useWizard } from './WizardContext';

export function SectionCustomerPhoto() {
  const { t } = useTranslation();
  const { data: wizardData } = useWizard();
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const contractId = wizardData.contractId!;

  const handleUpload = async (images: UploadedImage[]) => {
    if (!images.length) return;
    const img = images[0];
    setUploading(true);
    setError('');

    try {
      const cfg = imageConfig.customerIdCard;
      const ts = Date.now();
      // Use contract_id in path — proves customer was present at this contract signing
      const smKey = `uploads/contracts/${contractId}/id-card-${ts}-sm.webp`;
      const lgKey = `uploads/contracts/${contractId}/id-card-${ts}-lg.webp`;

      await uploadToS3(img.file, smKey);
      await uploadToS3(img.originalFile ?? img.file, lgKey);

      await apiClient.rpc('fn_media_upload', {
        p_entity_type: 'CONTRACT',
        p_entity_id: contractId,
        p_usage_type: cfg.usageType,
        p_storage_path: { sm: `/${smKey}`, lg: `/${lgKey}` },
      });

      setPreview(img.preview);
      setUploaded(true);

      await apiClient.rpc('fn_contract_save_step', {
        p_contract_id: contractId,
        p_step: 'ID_PHOTO',
        p_data: { customer_photo: true },
      }).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 py-6">
      <h2 className="text-lg font-semibold">{t('wizard.idCardPhoto')}</h2>
      <p className="text-sm text-subtle">{t('wizard.idCardPhotoDesc')}</p>

      {error && (
        <div className="alert alert-danger">
          <XCircle size={18} />
          <div><div className="alert-description">{error}</div></div>
        </div>
      )}

      {preview ? (
        <div className="border border-line rounded-lg overflow-hidden">
          <img src={preview} alt="ID Card" className="w-full max-h-64 object-contain bg-surface" />
        </div>
      ) : (
        <ImageUploader
          onUpload={handleUpload}
          resizeOptions={imageConfig.customerIdCard.sizes.sm.resize}
          disabled={uploading}
          placeholder={
            <div className="flex flex-col items-center gap-2 py-8 text-subtle">
              <CreditCard size={32} className="opacity-40" />
              <span className="text-sm">{uploading ? t('common.saving') : t('wizard.uploadIdCard')}</span>
            </div>
          }
        />
      )}

      {uploaded && (
        <div className="text-sm text-success">{t('wizard.photoUploaded')}</div>
      )}
    </div>
  );
}
