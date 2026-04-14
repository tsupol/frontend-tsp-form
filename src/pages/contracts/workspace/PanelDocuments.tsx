import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from 'tsp-form';
import { ImageUploader, RESIZE_PRESETS } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, XCircle, CreditCard, PenLine, FileImage, Trash2 } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { uploadToS3 } from '../../../lib/upload';
import { config } from '../../../config/config';
import { useWorkspace } from './WorkspaceContext';
import { useAuth } from '../../../contexts/AuthContext';

interface EntityMedia {
  entity_media_id: number;
  usage_type: string;
  sort_order: number;
  storage_path: string;
  is_active: boolean;
}

interface Props { onClose: () => void }

export function PanelDocuments({ onClose }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: workspace, updateData } = useWorkspace();
  const contractId = workspace.contractId;

  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');

  // Fetch existing media for this contract
  const { data: media = [] } = useQuery({
    queryKey: ['contract-media', contractId],
    queryFn: () => apiClient.get<EntityMedia[]>(
      `/v_entity_media?entity_type=eq.CONTRACT&entity_id=eq.${contractId}&is_active=eq.true&order=usage_type,sort_order`
    ),
    enabled: !!contractId,
  });

  const idScans = media.filter(m => m.usage_type === 'ID_SCAN');
  const signatures = media.filter(m => m.usage_type === 'SIGNATURE');
  const evidence = media.filter(m => m.usage_type === 'EVIDENCE');

  const handleUpload = async (images: UploadedImage[], usageType: string, pathPrefix: string, mode: 'single' | 'gallery') => {
    if (!contractId || images.length === 0 || !user) return;
    setUploading(usageType);
    setError('');
    try {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const idx = mode === 'single' ? '' : `-${(mode === 'gallery' ? evidence.length + i : i)}`;
        const key = `uploads/contracts/${contractId}/${pathPrefix}${idx}.webp`;

        await uploadToS3(img.file, key);
        await apiClient.rpc('fn_media_attach', {
          p_holding_id: user.holding_id,
          p_storage_path: `/${key}`,
          p_variants_json: null,
          p_media_type: 'IMAGE',
          p_access_level: usageType === 'EVIDENCE' ? 'CONFIDENTIAL' : 'RESTRICTED',
          p_mime_type: 'image/webp',
          p_file_size_bytes: img.file.size,
          p_original_filename: img.originalFile?.name ?? img.file.name,
          p_entity_type: 'CONTRACT',
          p_entity_id: contractId,
          p_usage_type: usageType,
          p_sort_order: mode === 'single' ? 0 : evidence.length + i,
        });
      }

      // Refresh media list
      queryClient.invalidateQueries({ queryKey: ['contract-media', contractId] });

      // Update workspace flags
      if (usageType === 'ID_SCAN') updateData({ hasIdPhoto: true });
      else if (usageType === 'SIGNATURE') updateData({ hasSignature: true });
      else if (usageType === 'EVIDENCE') updateData({ evidenceCount: evidence.length + images.length });

      // Save step
      await apiClient.rpc('fn_contract_save_step', {
        p_contract_id: contractId,
        p_step: 'ID_PHOTO',
        p_data: { uploaded: true },
      }).catch(() => {});
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.code || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally { setUploading(''); }
  };

  const handleDetach = async (entityMediaId: number) => {
    try {
      await apiClient.rpc('fn_media_detach', { p_entity_media_id: entityMediaId });
      queryClient.invalidateQueries({ queryKey: ['contract-media', contractId] });
    } catch {}
  };

  if (!contractId) return null;

  return (
    <div className="p-4 flex flex-col max-w-2xl">
      {error && <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{error}</div></div></div>}

      {/* ID Card / Scan */}
      <UploadSection
        icon={<CreditCard size={14} />}
        label={t('workspace.docIdPhoto')}
        done={idScans.length > 0}
        uploading={uploading === 'ID_SCAN'}
        media={idScans}
        onUpload={(imgs) => handleUpload(imgs, 'ID_SCAN', 'id-card', 'single')}
        onDetach={handleDetach}
        resizeOptions={RESIZE_PRESETS.large}
        t={t}
      />

      <div className="border-t border-line my-4" />

      {/* Signature */}
      <UploadSection
        icon={<PenLine size={14} />}
        label={t('workspace.docSignature')}
        done={signatures.length > 0}
        uploading={uploading === 'SIGNATURE'}
        media={signatures}
        onUpload={(imgs) => handleUpload(imgs, 'SIGNATURE', 'signature', 'single')}
        onDetach={handleDetach}
        resizeOptions={RESIZE_PRESETS.large}
        t={t}
      />

      <div className="border-t border-line my-4" />

      {/* Evidence (gallery) */}
      <UploadSection
        icon={<FileImage size={14} />}
        label={`${t('workspace.docEvidence')} (${evidence.length})`}
        done={evidence.length > 0}
        uploading={uploading === 'EVIDENCE'}
        media={evidence}
        onUpload={(imgs) => handleUpload(imgs, 'EVIDENCE', 'evidence', 'gallery')}
        onDetach={handleDetach}
        resizeOptions={RESIZE_PRESETS.large}
        multiple
        t={t}
      />

      <div className="border-t border-line my-4" />

      {/* Shipping address */}
      <ShippingSection contractId={contractId} workspace={workspace} updateData={updateData} t={t} />
    </div>
  );
}

// ── Upload section with thumbnails ──────────────────────────────────────

function UploadSection({ icon, label, done, uploading, media, onUpload, onDetach, resizeOptions, multiple, t }: {
  icon: React.ReactNode;
  label: string;
  done: boolean;
  uploading: boolean;
  media: EntityMedia[];
  onUpload: (imgs: UploadedImage[]) => void;
  onDetach: (id: number) => void;
  resizeOptions: object;
  multiple?: boolean;
  t: (key: string) => string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {done ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
        {icon}
        <label className="form-label mb-0">{label}</label>
        {uploading && <span className="text-xs text-subtle">{t('common.loading')}</span>}
      </div>

      {/* Existing thumbnails */}
      {media.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {media.map(m => (
            <div key={m.entity_media_id} className="relative group w-20 h-20 rounded border border-line overflow-hidden">
              <img
                src={`${config.s3BaseUrl}${m.storage_path}`}
                alt=""
                className="w-full h-full object-cover"
              />
              <button
                className="absolute top-0.5 right-0.5 p-0.5 rounded bg-danger/80 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                onClick={() => onDetach(m.entity_media_id)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ImageUploader
        resizeOptions={resizeOptions}
        onUpload={onUpload}
        disabled={uploading}
        multiple={multiple}
      />
    </div>
  );
}

// ── Shipping section ────────────────────────────────────────────────────

function ShippingSection({ contractId, workspace, updateData, t }: {
  contractId: number;
  workspace: { hasShippingAddress: boolean };
  updateData: (u: Record<string, unknown>) => void;
  t: (key: string) => string;
}) {
  const [recipientName, setRecipientName] = useState('');
  const [recipientTel, setRecipientTel] = useState('');
  const [shippingNote, setShippingNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      await apiClient.rpc('fn_contract_shipping_address_upsert', {
        p_contract_id: contractId,
        p_recipient_name: recipientName.trim() || null,
        p_recipient_tel: recipientTel.trim() || null,
        p_note: shippingNote.trim() || null,
      });
      updateData({ hasShippingAddress: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.code || err.message);
      } else setError(String(err));
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {workspace.hasShippingAddress ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
        <label className="form-label mb-0">{t('workspace.docShipping')}</label>
      </div>
      {error && <div className="alert alert-danger text-xs mb-2"><XCircle size={14} /><span>{error}</span></div>}
      <div className="form-grid">
        <div className="flex gap-3">
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('workspace.recipientName')}</label>
            <Input size="sm" value={recipientName} onChange={e => setRecipientName(e.target.value)} className="w-full" />
          </div>
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('workspace.recipientTel')}</label>
            <Input size="sm" value={recipientTel} onChange={e => setRecipientTel(e.target.value)} className="w-full" />
          </div>
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('workspace.shippingNote')}</label>
          <Input size="sm" value={shippingNote} onChange={e => setShippingNote(e.target.value)} className="w-full" />
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" color="primary" onClick={handleSave} disabled={saving}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
