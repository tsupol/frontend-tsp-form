import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, Upload } from 'lucide-react';
import { useMediaUrl, useUploadSpec } from '../../../hooks/useMediaUrl';
import {
  IdPhotoCropModal,
  buildWebpVariantsFromImage,
  pickPrimaryLabel,
  type IdPhotoCropResult,
  type ResizedTarget,
} from '../../../components/IdPhotoCropModal';

export function IdPhotoUpload({ icon, label, type, fileUrl, uploading, onUpload, disabled, cacheBust = 0, presentWithoutKey }: {
  icon: React.ReactNode;
  label: string;
  type: string;
  fileUrl: string | null;
  uploading: boolean;
  onUpload: (imgs: UploadedImage[]) => void;
  disabled?: boolean;
  cacheBust?: number;
  /** Shows the "uploaded" checkmark when the host doesn't have a resolvable key
      (e.g. a flow that only tracks a boolean). When set, fileUrl is ignored. */
  presentWithoutKey?: boolean;
}) {
  const { url: displayUrl } = useMediaUrl(fileUrl, cacheBust);
  const { t } = useTranslation();
  const spec = useUploadSpec(type);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pickedFile, setPickedFile] = useState<File | null>(null);

  const isDisabled = disabled || uploading || !spec.spec;
  const hasPhoto = presentWithoutKey || !!fileUrl;
  const showThumb = !!fileUrl;

  const handlePickFile = () => {
    if (isDisabled) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setPickedFile(f);
  };

  const handleCropConfirm = async (result: IdPhotoCropResult) => {
    const sourceFile = pickedFile;
    if (!sourceFile || !spec.spec) return;
    try {
      const baseName = sourceFile.name.replace(/\.[^.]+$/, '');
      const targets: ResizedTarget[] = spec.spec.sizes.map(s => ({ label: s.label, width: s.width }));
      const variants = await buildWebpVariantsFromImage(result.croppedImage, baseName, targets, spec.spec.quality);
      const primaryLabel = pickPrimaryLabel(targets);
      const primary = variants[primaryLabel]?.file ?? Object.values(variants)[0]?.file;
      if (!primary) throw new Error('No variant produced');

      const image: UploadedImage = {
        id: Math.random().toString(36).slice(2),
        originalFile: sourceFile,
        originalWidth: result.croppedImage.naturalWidth,
        originalHeight: result.croppedImage.naturalHeight,
        originalSize: sourceFile.size,
        file: primary,
        preview: '',
        width: result.croppedImage.naturalWidth,
        height: result.croppedImage.naturalHeight,
        size: primary.size,
        variants,
      };

      setPickedFile(null);
      onUpload([image]);
    } finally {
      URL.revokeObjectURL(result.croppedUrl);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {hasPhoto ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
        {icon}
        <label className="form-label mb-0">{label}</label>
        {uploading && <span className="text-xs text-subtle">{t('common.loading')}</span>}
      </div>

      <button
        type="button"
        onClick={handlePickFile}
        disabled={isDisabled}
        className={
          'w-full block ' +
          (hasPhoto
            ? 'relative group rounded-lg overflow-hidden h-40 bg-surface-shallow border border-solid border-line hover:border-primary transition-colors cursor-pointer disabled:cursor-not-allowed'
            : 'flex items-center justify-center gap-2 h-40 rounded-lg border-2 border-dashed border-line hover:border-primary hover:bg-surface-hover transition-colors text-subtle text-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 bg-transparent')
        }
      >
        {hasPhoto ? (
          <>
            {showThumb && displayUrl ? (
              <img src={displayUrl} alt="" className="w-full h-full object-contain" />
            ) : showThumb ? (
              <div className="w-full h-full animate-pulse" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-subtle">
                <CheckCircle size={24} className="text-success" />
                <span className="text-xs">{t('workspace.clickToReplace')}</span>
              </div>
            )}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              <span className="text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
                <Upload size={14} />
                {t('workspace.clickToReplace')}
              </span>
            </div>
          </>
        ) : (
          <>
            <Upload size={16} className="opacity-50" />
            <span>{t('workspace.clickOrDrag')}</span>
          </>
        )}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        disabled={isDisabled}
      />

      <IdPhotoCropModal
        source={pickedFile}
        onConfirm={handleCropConfirm}
        onCancel={() => setPickedFile(null)}
      />
    </div>
  );
}
