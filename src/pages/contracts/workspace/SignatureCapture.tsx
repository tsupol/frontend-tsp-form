import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, resizeToVariants } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, PenLine, Upload, Camera, Eraser, Undo2, Save, Loader2 } from 'lucide-react';
import { useMediaUrl } from '../../../hooks/useMediaUrl';
import { SignaturePad, type SignaturePadHandle } from '../../../components/SignaturePad';

type SigMode = 'draw' | 'upload' | 'camera';

// Signature specs (contract_signature, branch_signatory_signature) store a
// single 'sm' variant at 320px. Both the drawn pad and a photo of a paper
// signature route through this so every consumer reads `variants.sm`
// uniformly — no single-variant special-casing downstream.
const SIG_SIZE = 320;

interface Props {
  fileUrl: string | null;
  uploading: boolean;
  disabled?: boolean;
  cacheBust?: number;
  onUpload: (imgs: UploadedImage[]) => void;
  // When true, skip the "saved view + Replace button" intermediate state and
  // render the capture UI directly. Used inside the sign modal where the user
  // already clicked "sign" — showing a Replace button there is redundant.
  startInEditing?: boolean;
}

// Wrap a single-variant `resizeToVariants` result as an UploadedImage with the
// `variants` map populated (and top-level `file` mirrored from it for any
// consumer still reading `.file`). `originalFile` is the untouched source.
function toUploadedImage(
  variants: Awaited<ReturnType<typeof resizeToVariants>>,
  originalFile: File,
): UploadedImage {
  const sm = variants.sm;
  return {
    id: Math.random().toString(36).slice(2),
    file: sm?.file,
    originalFile,
    preview: sm?.preview,
    width: sm?.width,
    height: sm?.height,
    originalWidth: sm?.width ?? 0,
    originalHeight: sm?.height ?? 0,
    size: sm?.size,
    originalSize: originalFile.size,
    variants,
  };
}

// Photo-of-paper-signature → 320px webp (JPEG fallback on Safari < 17.4, mime
// reported honestly by resizeToVariants).
async function resizePhotoForUpload(file: File): Promise<UploadedImage> {
  const variants = await resizeToVariants(
    file,
    { sm: { maxWidth: SIG_SIZE, maxHeight: SIG_SIZE, quality: 0.85, format: 'webp', mode: 'contain' } },
    'signature',
  );
  return toUploadedImage(variants, file);
}

export function SignatureCapture({ fileUrl, uploading, disabled, cacheBust = 0, onUpload, startInEditing = false }: Props) {
  const { t } = useTranslation();
  const { url: displayUrl } = useMediaUrl(fileUrl, cacheBust);
  const [mode, setMode] = useState<SigMode>('draw');
  const [editing, setEditing] = useState(false);
  const [sigEmpty, setSigEmpty] = useState(true);
  const [justSaved, setJustSaved] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const wasUploadingRef = useRef(false);

  // When an upload completes successfully, flash a transient "saved" state on
  // the action button, then exit editing mode so the new preview shows.
  useEffect(() => {
    if (wasUploadingRef.current && !uploading && fileUrl) {
      setJustSaved(true);
      const t = setTimeout(() => {
        setJustSaved(false);
        setEditing(false);
      }, 1000);
      wasUploadingRef.current = uploading;
      return () => clearTimeout(t);
    }
    wasUploadingRef.current = uploading;
  }, [uploading, fileUrl]);

  const handleDrawSave = async () => {
    const blob = await padRef.current?.toBlob('image/png');
    if (!blob) return;
    const source = new File([blob], `signature-${Date.now()}.png`, { type: 'image/png' });
    // Drawn line art → 320px PNG (lossless, preserves transparency). Goes
    // through the same resizer so the output is a `variants.sm` like the
    // photo path; mime is reported honestly (PNG here, never re-labelled).
    const variants = await resizeToVariants(
      source,
      { sm: { maxWidth: SIG_SIZE, maxHeight: SIG_SIZE, format: 'png', mode: 'contain' } },
      'signature',
    );
    onUpload([toUploadedImage(variants, source)]);
  };

  const handlePhotoFile = async (file: File) => {
    try {
      const img = await resizePhotoForUpload(file);
      onUpload([img]);
    } catch {
      // ignore — caller surfaces upload errors via its own state
    }
  };

  const handleUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (f) handlePhotoFile(f);
  };

  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (f) handlePhotoFile(f);
  };

  // Saved view — show preview + Replace button.
  // Skipped when startInEditing is set (e.g. inside the sign modal).
  if (fileUrl && !editing && !startInEditing) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle size={14} className="text-success" />
          <PenLine size={14} />
          <label className="form-label mb-0">{t('workspace.docSignature')}</label>
          {uploading && <span className="text-xs text-subtle">{t('common.loading')}</span>}
        </div>
        <div
          className={`relative border rounded-lg overflow-hidden bg-white aspect-[3/1] w-full flex items-center justify-center transition-colors ${
            justSaved ? 'border-success ring-2 ring-success/30' : 'border-line'
          }`}
        >
          {displayUrl ? (
            <img
              src={displayUrl}
              alt=""
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <div className="w-full h-full bg-surface-shallow animate-pulse" />
          )}
          {justSaved && (
            <div className="absolute inset-0 bg-success-soft flex items-center justify-center pointer-events-none">
              <CheckCircle size={32} className="text-success drop-shadow" />
            </div>
          )}
        </div>
        <div>
          <Button
            onClick={() => { setEditing(true); setMode('draw'); setSigEmpty(true); }}
            disabled={disabled || uploading}
            startIcon={<Eraser size={16} />}
          >
            {t('workspace.sigRetake')}
          </Button>
        </div>
      </div>
    );
  }

  // Capture view
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 mb-1">
        {fileUrl ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
        <PenLine size={14} />
        <label className="form-label mb-0">{t('workspace.docSignature')}</label>
        {uploading && <span className="text-xs text-subtle">{t('common.loading')}</span>}
      </div>

      <div role="tablist" className="inline-flex border border-line rounded-md p-0.5 self-start bg-surface-shallow">
        {([
          { id: 'draw', label: t('workspace.sigModeDraw'), icon: PenLine },
          { id: 'upload', label: t('workspace.sigModeUpload'), icon: Upload },
          { id: 'camera', label: t('workspace.sigModeCamera'), icon: Camera },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            disabled={disabled || uploading}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors ${
              mode === id
                ? 'bg-item-active-bg text-item-active-fg font-medium'
                : 'text-subtle hover:text-fg'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {mode === 'draw' && (
        <div className="flex flex-col gap-2">
          <div className={`relative border rounded-lg overflow-hidden bg-white aspect-[3/1] w-full transition-colors ${
            justSaved ? 'border-success ring-2 ring-success/30' : 'border-line'
          }`}>
            <SignaturePad ref={padRef} onChange={setSigEmpty} />
            {justSaved && (
              <div className="absolute inset-0 bg-success-soft flex items-center justify-center pointer-events-none">
                <CheckCircle size={32} className="text-success drop-shadow" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => padRef.current?.undo()}
              disabled={sigEmpty || uploading || disabled}
              startIcon={<Undo2 size={16} />}
            >
              {t('workspace.sigUndo')}
            </Button>
            <Button
              onClick={() => { padRef.current?.clear(); setSigEmpty(true); }}
              disabled={sigEmpty || uploading || disabled}
              startIcon={<Eraser size={16} />}
            >
              {t('workspace.sigClear')}
            </Button>
            <Button
              color={justSaved ? 'success' : 'primary'}
              onClick={handleDrawSave}
              disabled={sigEmpty || uploading || disabled || justSaved}
              startIcon={
                justSaved ? <CheckCircle size={16} />
                : uploading ? <Loader2 size={16} className="animate-spin" />
                : <Save size={16} />
              }
            >
              {justSaved ? t('common.saved') : uploading ? t('common.saving') : t('workspace.sigSave')}
            </Button>
          </div>
        </div>
      )}

      {mode === 'upload' && (
        <div className="flex flex-col items-start gap-2 w-full">
          <div
            className={`flex items-center justify-center gap-2 py-4 px-6 border-2 border-dashed rounded-lg cursor-pointer transition-colors text-sm w-full ${
              justSaved
                ? 'border-success bg-success-soft text-success'
                : 'border-line text-subtle hover:border-primary hover:bg-surface-hover'
            }`}
            onClick={() => !disabled && !uploading && !justSaved && uploadInputRef.current?.click()}
          >
            {justSaved ? (
              <>
                <CheckCircle size={16} />
                <span>{t('common.saved')}</span>
              </>
            ) : (
              <>
                <Upload size={16} className="opacity-50" />
                <span>{t('workspace.clickOrDrag')}</span>
              </>
            )}
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUploadChange}
            disabled={disabled || uploading}
          />
        </div>
      )}

      {mode === 'camera' && (
        <div className="flex flex-col items-start gap-2">
          <div className="flex items-center justify-center gap-3 border-2 border-dashed border-line rounded-lg py-6 w-full">
            <Button
              color={justSaved ? 'success' : 'primary'}
              onClick={() => cameraInputRef.current?.click()}
              disabled={disabled || uploading || justSaved}
              startIcon={
                justSaved ? <CheckCircle size={16} />
                : uploading ? <Loader2 size={16} className="animate-spin" />
                : <Camera size={16} />
              }
            >
              {justSaved ? t('common.saved') : uploading ? t('common.saving') : t('workspace.sigTakePhoto')}
            </Button>
          </div>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleCameraChange}
            disabled={disabled || uploading}
          />
        </div>
      )}
    </div>
  );
}
