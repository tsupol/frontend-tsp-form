import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageUploader, RESIZE_PRESETS } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { XCircle, CreditCard } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { uploadToS3 } from '../../../lib/upload';
import { useAuth } from '../../../contexts/AuthContext';
import { useWizard } from './WizardContext';

export function SectionCustomerPhoto() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: wizardData } = useWizard();
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const contractId = wizardData.contractId!;

  const handleUpload = async (images: UploadedImage[]) => {
    if (!images.length || !user) return;
    const img = images[0];
    setUploading(true);
    setError('');

    try {
      // Single upload with deterministic ID-based path
      const key = `uploads/contracts/${contractId}/id-card.webp`;

      await uploadToS3(img.file, key);
      await apiClient.rpc('fn_media_attach', {
        p_holding_id: user.holding_id,
        p_storage_path: `/${key}`,
        p_variants_json: null,
        p_media_type: 'IMAGE',
        p_access_level: 'RESTRICTED',
        p_mime_type: 'image/webp',
        p_file_size_bytes: img.file.size,
        p_original_filename: img.originalFile?.name ?? img.file.name,
        p_entity_type: 'CONTRACT',
        p_entity_id: contractId,
        p_usage_type: 'ID_SCAN',
        p_sort_order: 0,
      });

      setPreview(img.preview);
      setUploaded(true);

      await apiClient.rpc('fn_contract_save_step', {
        p_contract_id: contractId,
        p_step: 'ID_PHOTO',
        p_data: { customer_photo: true },
      }).catch(() => {});
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.code || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
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
          resizeOptions={RESIZE_PRESETS.large}
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
