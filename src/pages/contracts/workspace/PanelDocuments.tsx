import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from 'tsp-form';
import { ImageUploader } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, XCircle, CreditCard } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { uploadToS3 } from '../../../lib/upload';
import { imageConfig } from '../../../config/config';
import { useWorkspace } from './WorkspaceContext';

interface Props { onClose: () => void }

export function PanelDocuments({ onClose }: Props) {
  const { t } = useTranslation();
  const { data: workspace, updateData } = useWorkspace();
  const contractId = workspace.contractId;

  const [idPhotoUploaded, setIdPhotoUploaded] = useState(workspace.hasIdPhoto);
  const [signatureUploaded, setSignatureUploaded] = useState(workspace.hasSignature);
  const [evidenceCount, setEvidenceCount] = useState(workspace.evidenceCount);
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');

  const [recipientName, setRecipientName] = useState('');
  const [recipientTel, setRecipientTel] = useState('');
  const [shippingNote, setShippingNote] = useState('');
  const [savingShipping, setSavingShipping] = useState(false);

  const smResize = imageConfig.customerIdCard.sizes.sm.resize;

  const handleUpload = async (images: UploadedImage[], usage: string, prefix: string) => {
    if (!contractId || images.length === 0) return;
    setUploading(usage);
    setError('');
    try {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const ts = Date.now();
        const smKey = `uploads/contracts/${contractId}/${prefix}-${ts}-${i}-sm.webp`;
        const lgKey = `uploads/contracts/${contractId}/${prefix}-${ts}-${i}-lg.webp`;
        await uploadToS3(img.file, smKey);
        await uploadToS3(img.originalFile ?? img.file, lgKey);
        await apiClient.rpc('fn_media_upload', {
          p_entity_type: 'CONTRACT', p_entity_id: contractId, p_usage_type: usage,
          p_storage_path: { sm: `/${smKey}`, lg: `/${lgKey}` },
        });
      }
      if (usage === 'ID_CARD') { setIdPhotoUploaded(true); updateData({ hasIdPhoto: true }); }
      else if (usage === 'SIGNATURE') { setSignatureUploaded(true); updateData({ hasSignature: true }); }
      else if (usage === 'EVIDENCE') { const n = evidenceCount + images.length; setEvidenceCount(n); updateData({ evidenceCount: n }); }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setUploading(''); }
  };

  const handleSaveShipping = async () => {
    if (!contractId) return;
    setSavingShipping(true); setError('');
    try {
      await apiClient.rpc('fn_contract_shipping_address_upsert', {
        p_contract_id: contractId,
        p_recipient_name: recipientName.trim() || null,
        p_recipient_tel: recipientTel.trim() || null,
        p_note: shippingNote.trim() || null,
      });
      updateData({ hasShippingAddress: true });
    } catch (err) {
      if (err instanceof ApiError) { const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : ''); setError(tr || err.message); }
      else setError(String(err));
    } finally { setSavingShipping(false); }
  };

  if (!contractId) return null;

  return (
    <div className="p-4 flex flex-col gap-5 max-w-2xl">
      {error && <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{error}</div></div></div>}

      <div>
        <div className="flex items-center gap-2 mb-2">
          {idPhotoUploaded ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
          <label className="form-label mb-0">{t('workspace.docIdPhoto')}</label>
          {uploading === 'ID_CARD' && <span className="text-xs text-subtle">{t('common.loading')}</span>}
        </div>
        <ImageUploader resizeOptions={smResize} onUpload={(imgs) => handleUpload(imgs, 'ID_CARD', 'id-card')} disabled={uploading === 'ID_CARD'}
          placeholder={<div className="flex flex-col items-center gap-2 py-6 text-subtle"><CreditCard size={24} className="opacity-40" /><span className="text-xs">{t('wizard.uploadIdCard')}</span></div>} />
      </div>

      <div className="border-t border-line" />
      <div>
        <div className="flex items-center gap-2 mb-2">
          {signatureUploaded ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
          <label className="form-label mb-0">{t('workspace.docSignature')}</label>
          {uploading === 'SIGNATURE' && <span className="text-xs text-subtle">{t('common.loading')}</span>}
        </div>
        <ImageUploader resizeOptions={smResize} onUpload={(imgs) => handleUpload(imgs, 'SIGNATURE', 'signature')} disabled={uploading === 'SIGNATURE'} />
      </div>

      <div className="border-t border-line" />
      <div>
        <div className="flex items-center gap-2 mb-2">
          {evidenceCount > 0 ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
          <label className="form-label mb-0">{t('workspace.docEvidence')} ({evidenceCount})</label>
          {uploading === 'EVIDENCE' && <span className="text-xs text-subtle">{t('common.loading')}</span>}
        </div>
        <ImageUploader resizeOptions={smResize} onUpload={(imgs) => handleUpload(imgs, 'EVIDENCE', 'evidence')} disabled={uploading === 'EVIDENCE'} />
      </div>

      <div className="border-t border-line" />
      <div>
        <div className="flex items-center gap-2 mb-2">
          {workspace.hasShippingAddress ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
          <label className="form-label mb-0">{t('workspace.docShipping')}</label>
        </div>
        <div className="form-grid gap-3">
          <div className="flex gap-3">
            <div className="flex flex-col flex-1"><label className="form-label text-xs">{t('workspace.recipientName')}</label><Input size="sm" value={recipientName} onChange={e => setRecipientName(e.target.value)} className="w-full" /></div>
            <div className="flex flex-col flex-1"><label className="form-label text-xs">{t('workspace.recipientTel')}</label><Input size="sm" value={recipientTel} onChange={e => setRecipientTel(e.target.value)} className="w-full" /></div>
          </div>
          <div className="flex flex-col"><label className="form-label text-xs">{t('workspace.shippingNote')}</label><Input size="sm" value={shippingNote} onChange={e => setShippingNote(e.target.value)} className="w-full" /></div>
        </div>
        <div className="flex justify-end mt-2"><Button size="sm" color="primary" onClick={handleSaveShipping} disabled={savingShipping}>{savingShipping ? t('common.loading') : t('common.save')}</Button></div>
      </div>

      <div className="sticky bottom-0 bg-bg border-t border-line py-3 flex justify-end -mx-4 px-4">
        <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </div>
  );
}
