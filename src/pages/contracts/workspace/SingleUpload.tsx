import { useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, Upload } from 'lucide-react';
import { useMediaUrl } from '../../../hooks/useMediaUrl';
import type { Privacy } from '../../../lib/upload';

export function SingleUpload({ icon, label, fileUrl, uploading, onUpload, disabled, cacheBust = 0, privacy = 'private' }: {
  icon: React.ReactNode;
  label: string;
  fileUrl: string | null;
  uploading: boolean;
  onUpload: (imgs: UploadedImage[]) => void;
  disabled?: boolean;
  cacheBust?: number;
  privacy?: Privacy;
}) {
  const { url: displayUrl } = useMediaUrl(fileUrl, privacy, cacheBust);
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(() => {
    if (disabled || uploading) return;
    inputRef.current?.click();
  }, [disabled, uploading]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

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
        if (!blob) return;
        const resized = new File([blob], file.name, { type: 'image/webp' });
        onUpload([{
          id: Math.random().toString(36).slice(2),
          file: resized, originalFile: file,
          preview: URL.createObjectURL(blob),
          width: w, height: h,
          originalWidth: img.width, originalHeight: img.height,
          size: blob.size, originalSize: file.size,
        }]);
      }, 'image/webp', 0.85);
    };
    img.src = url;
  }, [onUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const dt = new DataTransfer();
      dt.items.add(file);
      if (inputRef.current) {
        inputRef.current.files = dt.files;
        inputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }, [disabled, uploading]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {fileUrl ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
        {icon}
        <label className="form-label mb-0">{label}</label>
        {uploading && <span className="text-xs text-subtle">{t('common.loading')}</span>}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled || uploading}
      />

      {fileUrl ? (
        <div
          className="relative group cursor-pointer rounded-lg border-2 border-transparent hover:border-primary/40 transition-colors overflow-hidden"
          style={{ maxWidth: '20rem' }}
          onClick={handleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          title={t('workspace.clickToReplace')}
        >
          {displayUrl ? (
            <img
              src={displayUrl}
              alt=""
              className="w-full h-auto rounded-lg"
            />
          ) : (
            <div className="w-full h-40 bg-surface-shallow animate-pulse rounded-lg" />
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
            <span className="text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
              <Upload size={14} />
              {t('workspace.clickToReplace')}
            </span>
          </div>
        </div>
      ) : (
        <div
          className="flex items-center justify-center gap-2 py-4 px-6 border-2 border-dashed border-line rounded-lg cursor-pointer hover:border-primary hover:bg-surface-hover transition-colors text-subtle text-sm"
          style={{ maxWidth: '20rem' }}
          onClick={handleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <Upload size={16} className="opacity-50" />
          <span>{t('workspace.clickOrDrag')}</span>
        </div>
      )}
    </div>
  );
}
