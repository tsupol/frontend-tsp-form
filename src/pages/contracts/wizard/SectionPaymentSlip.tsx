import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageUploader } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { XCircle, Receipt } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { uploadToS3 } from '../../../lib/upload';
import { imageConfig } from '../../../config/config';
import { useWizard } from './WizardContext';

export function SectionPaymentSlip() {
  const { t } = useTranslation();
  const { data: wizardData } = useWizard();
  const [uploading, setUploading] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState('');

  const contractId = wizardData.contractId!;

  const handleUpload = async (images: UploadedImage[]) => {
    if (!images.length) return;
    setUploading(true);
    setError('');

    try {
      const cfg = imageConfig.contractPaymentSlip;
      const ts = Date.now();

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const smKey = `uploads/contracts/${contractId}/slip-${ts}-${i}-sm.webp`;
        const lgKey = `uploads/contracts/${contractId}/slip-${ts}-${i}-lg.webp`;

        await uploadToS3(img.file, smKey);
        await uploadToS3(img.originalFile ?? img.file, lgKey);

        await apiClient.rpc('fn_media_upload', {
          p_entity_type: cfg.entityType,
          p_entity_id: contractId,
          p_usage_type: cfg.usageType,
          p_storage_path: { sm: `/${smKey}`, lg: `/${lgKey}` },
        });

        setPreviews(prev => [...prev, img.preview]);
      }

      await apiClient.rpc('fn_contract_save_step', {
        p_contract_id: contractId,
        p_step: 'SLIP',
        p_data: { slip_count: previews.length + images.length },
      }).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 py-6">
      <h2 className="text-lg font-semibold">{t('wizard.paymentSlip')}</h2>
      <p className="text-sm text-subtle">{t('wizard.paymentSlipDesc')}</p>

      {error && (
        <div className="alert alert-danger">
          <XCircle size={18} />
          <div><div className="alert-description">{error}</div></div>
        </div>
      )}

      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {previews.map((src, i) => (
            <div key={i} className="border border-line rounded-lg overflow-hidden aspect-square">
              <img src={src} alt={`Slip ${i + 1}`} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}

      <ImageUploader
        onUpload={handleUpload}
        resizeOptions={imageConfig.contractPaymentSlip.sizes.sm.resize}
        multiple
        maxFiles={5}
        disabled={uploading}
        placeholder={
          <div className="flex flex-col items-center gap-2 py-8 text-subtle">
            <Receipt size={32} className="opacity-40" />
            <span className="text-sm">{uploading ? t('common.saving') : t('wizard.uploadSlip')}</span>
          </div>
        }
      />
    </div>
  );
}
