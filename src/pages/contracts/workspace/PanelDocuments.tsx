import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, XCircle, CreditCard, FileImage, Trash2, Upload, Info } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { uploadFromImage, deleteMedia } from '../../../lib/upload';
import { useMediaUrl } from '../../../hooks/useMediaUrl';
import { useWorkspace } from './WorkspaceContext';
import { useAuth } from '../../../contexts/AuthContext';
import { SingleUpload } from './SingleUpload';
import { SignatureCapture } from './SignatureCapture';

interface CustomerDocument {
  id: number;
  customer_id: number;
  doc_type: string;
  file_url: string;
  is_active: boolean;
  uploaded_at: string;
}

interface ContractDocument {
  id: number;
  contract_id: number;
  customer_id: number | null;
  customer_name: string | null;
  doc_type: string;
  file_url: string;
  uploaded_at: string;
}

interface EntityMedia {
  entity_media_id: number;
  usage_type: string;
  sort_order: number;
  storage_path: string;
  created_at: string;
}

interface Props { onClose: () => void }

export function PanelDocuments({ onClose: _onClose }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: workspace, invalidateDocs, invalidateCustomer } = useWorkspace();
  const contractId = workspace.contractId;
  const customerId = workspace.customerId;

  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');
  const [cacheBust, setCacheBust] = useState(0);

  // Fetch customer documents (ID_CARD_FRONT)
  const { data: customerDocs = [] } = useQuery({
    queryKey: ['customer-documents', customerId],
    queryFn: () => apiClient.get<CustomerDocument[]>(
      `/v_customer_documents?customer_id=eq.${customerId}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true`
    ),
    enabled: !!customerId,
  });

  // Fetch contract documents (SIGNATURE_PAD)
  const { data: contractDocs = [] } = useQuery({
    queryKey: ['contract-documents', contractId],
    queryFn: () => apiClient.get<ContractDocument[]>(
      `/v_contract_documents?contract_id=eq.${contractId}&doc_type=eq.SIGNATURE_PAD`
    ),
    enabled: !!contractId,
  });

  // Fetch contract media (ATTACHMENT — gallery, stays on entity_media)
  const { data: contractMedia = [] } = useQuery({
    queryKey: ['contract-media', contractId],
    queryFn: () => apiClient.get<EntityMedia[]>(
      `/v_entity_media?entity_type=eq.CONTRACT&entity_id=eq.${contractId}&usage_type=eq.ATTACHMENT&order=created_at.desc`
    ),
    enabled: !!contractId,
  });

  const idCard = customerDocs[0] ?? null;
  const signature = contractDocs.find(d => d.customer_id === customerId) ?? null;
  const attachments = contractMedia;

  // ── ID Card upload ──────────────────────────────────────────────────
  const uploadIdCard = async (images: UploadedImage[]) => {
    if (!customerId || images.length === 0) return;
    setUploading('ID_CARD');
    setError('');
    try {
      const results = await uploadFromImage({
        type: 'customer_id_card',
        image: images[0],
        params: { customer_id: customerId },
      });
      const key = results.lg?.key ?? Object.values(results)[0]?.key;
      if (!key) throw new Error('Upload returned no key');
      await apiClient.rpc('fn_customer_document_upload', {
        p_customer_id: customerId,
        p_doc_type: 'ID_CARD_FRONT',
        p_file_url: `/${key}`,
      });
      queryClient.invalidateQueries({ queryKey: ['customer-documents', customerId] });
      setCacheBust(n => n + 1);
      invalidateCustomer();
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

  // ── Signature upload ────────────────────────────────────────────────
  const uploadSignature = async (images: UploadedImage[]) => {
    if (!contractId || !customerId || images.length === 0) return;
    setUploading('SIGNATURE');
    setError('');
    try {
      const results = await uploadFromImage({
        type: 'contract_signature',
        image: images[0],
        params: { contract_id: contractId, customer_id: customerId },
      });
      const key = results.sm?.key ?? Object.values(results)[0]?.key;
      if (!key) throw new Error('Upload returned no key');
      await apiClient.rpc('fn_contract_document_upload', {
        p_contract_id: contractId,
        p_doc_type: 'SIGNATURE_PAD',
        p_file_url: `/${key}`,
        p_customer_id: customerId,
      });
      queryClient.invalidateQueries({ queryKey: ['contract-documents', contractId] });
      setCacheBust(n => n + 1);
      invalidateDocs();
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

  // ── Gallery upload (contract evidence photos) ───────────────────────
  const uploadGallery = async (images: UploadedImage[]) => {
    if (!contractId || images.length === 0 || !user) return;
    setUploading('ATTACHMENT');
    setError('');
    try {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const results = await uploadFromImage({
          type: 'contract_evidence',
          image: img,
          idx: attachments.length + i,
          params: { contract_id: contractId },
        });
        const primary = results.sm?.key ?? Object.values(results)[0]?.key;
        if (!primary) throw new Error('Upload returned no key');
        await apiClient.rpc('fn_media_attach', {
          p_holding_id: user.holding_id,
          p_storage_path: `/${primary}`,
          p_variants_json: Object.fromEntries(
            Object.entries(results).map(([s, r]) => [s, `/${r.key}`]),
          ),
          p_media_type: 'IMAGE',
          p_access_level: 'CONFIDENTIAL',
          p_mime_type: 'image/webp',
          p_file_size_bytes: img.file?.size ?? img.originalSize,
          p_original_filename: img.originalFile?.name ?? img.file?.name ?? '',
          p_entity_type: 'CONTRACT',
          p_entity_id: contractId,
          p_usage_type: 'ATTACHMENT',
          p_sort_order: attachments.length + i,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['contract-media', contractId] });
      invalidateDocs();
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
    const media = attachments.find(m => m.entity_media_id === entityMediaId);
    try {
      await apiClient.rpc('fn_media_detach', { p_entity_media_id: entityMediaId });
      if (media?.storage_path) {
        deleteMedia({ private: [media.storage_path] }).catch(() => {});
      }
      queryClient.invalidateQueries({ queryKey: ['contract-media', contractId] });
      invalidateDocs();
    } catch {}
  };

  if (!contractId) return null;

  return (
    <div className="p-4 flex flex-col gap-8 max-w-2xl">
      {error && <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{error}</div></div></div>}

      {/* ID Card / Passport */}
      <SingleUpload
        icon={<CreditCard size={14} />}
        label={t('workspace.docIdPhoto')}
        fileUrl={idCard?.file_url ?? null}
        uploading={uploading === 'ID_CARD'}
        onUpload={uploadIdCard}
        disabled={!customerId}
        cacheBust={cacheBust}
      />

      {/* Signature */}
      <SignatureCapture
        fileUrl={signature?.file_url ?? null}
        uploading={uploading === 'SIGNATURE'}
        onUpload={uploadSignature}
        disabled={!customerId}
        cacheBust={cacheBust}
      />

      {/* Contract Photos (gallery) */}
      <GalleryUpload
        label={t('workspace.docEvidence')}
        media={attachments}
        uploading={uploading === 'ATTACHMENT'}
        onUpload={uploadGallery}
        onDetach={handleDetach}
        cacheBust={cacheBust}
      />
    </div>
  );
}

// ── Gallery upload — entire area is dropzone, grid thumbnails ──────────

function GalleryUpload({ label, media, uploading, onUpload, onDetach, cacheBust }: {
  label: string;
  media: EntityMedia[];
  uploading: boolean;
  onUpload: (imgs: UploadedImage[]) => void;
  onDetach: (id: number) => void;
  cacheBust: number;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-delete]')) return;
    if (uploading) return;
    inputRef.current?.click();
  }, [uploading]);

  const processFiles = useCallback((files: FileList) => {
    if (uploading || files.length === 0) return;
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, 10);
    if (imageFiles.length === 0) return;

    const results: UploadedImage[] = [];
    let processed = 0;

    imageFiles.forEach(file => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxW = 1280, maxH = 1280;
        let w = img.width, h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (blob) {
            results.push({
              id: Math.random().toString(36).slice(2),
              file: new File([blob], file.name, { type: 'image/webp' }),
              originalFile: file,
              preview: URL.createObjectURL(blob),
              width: w, height: h,
              originalWidth: img.width, originalHeight: img.height,
              size: blob.size, originalSize: file.size,
            });
          }
          processed++;
          if (processed === imageFiles.length && results.length > 0) {
            onUpload(results);
          }
        }, 'image/webp', 0.85);
      };
      img.src = url;
    });
  }, [uploading, onUpload]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
    e.target.value = '';
  }, [processFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files) processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {media.length > 0 ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
        <FileImage size={14} />
        <label className="form-label mb-0">{label} ({media.length})</label>
        {uploading && <span className="text-xs text-subtle">{t('common.loading')}</span>}
      </div>

      <div className="alert alert-info mb-2">
        <Info size={14} />
        <div className="alert-description">{t('workspace.docEvidenceHint')}</div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
        disabled={uploading}
      />

      <div
        className={`border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-line hover:border-primary/40'
        }`}
        onClick={handleClick}
        onDrop={handleDrop}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
      >
        {media.length > 0 && (
          <div className="grid grid-cols-4 gap-2 p-2">
            {media.map(m => (
              <GalleryThumb key={m.entity_media_id} media={m} cacheBust={cacheBust} onDetach={onDetach} />
            ))}
          </div>
        )}

        <div className={`flex items-center justify-center gap-2 text-subtle text-xs ${media.length > 0 ? 'py-2 border-t border-dashed border-line mx-2' : 'py-6'}`}>
          <Upload size={14} className="opacity-50" />
          <span>{media.length > 0 ? t('workspace.dropOrClick') : t('workspace.clickOrDrag')}</span>
        </div>
      </div>
    </div>
  );
}

function GalleryThumb({ media, cacheBust, onDetach }: {
  media: EntityMedia;
  cacheBust: number;
  onDetach: (id: number) => void;
}) {
  const { url } = useMediaUrl(media.storage_path, 'private', cacheBust);
  return (
    <div className="relative group aspect-square rounded overflow-hidden border border-line">
      {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-surface-shallow animate-pulse" />}
      <button
        data-delete
        className="absolute top-0.5 right-0.5 p-0.5 rounded bg-danger/80 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onDetach(media.entity_media_id); }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
