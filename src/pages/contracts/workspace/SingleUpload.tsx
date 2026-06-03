import { useTranslation } from 'react-i18next';
import { ImageUploader } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, Upload } from 'lucide-react';
import { useMediaUrl } from '../../../hooks/useMediaUrl';
import { useUploadSpec } from '../../../hooks/useMediaUrl';

export function SingleUpload({ icon, label, type, fileUrl, uploading, onUpload, disabled, cacheBust = 0 }: {
  icon: React.ReactNode;
  label: string;
  type: string;
  fileUrl: string | null;
  uploading: boolean;
  onUpload: (imgs: UploadedImage[]) => void;
  disabled?: boolean;
  cacheBust?: number;
}) {
  const { url: displayUrl } = useMediaUrl(fileUrl, cacheBust);
  const { t } = useTranslation();
  const spec = useUploadSpec(type);

  const emptyPlaceholder = (
    <div key="empty" className="flex items-center justify-center gap-2 text-subtle text-sm w-full h-40">
      <Upload size={16} className="opacity-50" />
      <span>{t('workspace.clickOrDrag')}</span>
    </div>
  );

  const filledPlaceholder = (
    <div
      key="filled"
      className="relative group rounded-lg overflow-hidden w-full h-40 bg-surface-shallow flex items-center justify-center"
      title={t('workspace.clickToReplace')}
    >
      {displayUrl ? (
        <img
          src={displayUrl}
          alt=""
          className="max-w-full max-h-full object-contain"
        />
      ) : (
        <div className="w-full h-full animate-pulse" />
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
        <span className="text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
          <Upload size={14} />
          {t('workspace.clickToReplace')}
        </span>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {fileUrl ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
        {icon}
        <label className="form-label mb-0">{label}</label>
        {uploading && <span className="text-xs text-subtle">{t('common.loading')}</span>}
      </div>

      <ImageUploader
        resizeOptions={spec.resize}
        sizes={spec.sizes}
        onUpload={onUpload}
        disabled={disabled || uploading || !spec.spec}
        className={
          fileUrl
            ? '!min-h-0 !p-0 !border !border-solid !border-line hover:!border-primary transition-colors'
            : '!min-h-0 !p-0 !border-2 !border-dashed !border-line hover:!border-primary hover:!bg-surface-hover transition-colors'
        }
        placeholder={fileUrl ? filledPlaceholder : emptyPlaceholder}
      />
    </div>
  );
}
