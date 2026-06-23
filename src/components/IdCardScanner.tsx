import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageUploader, Button } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, Copy, Loader2, ScanLine, Trash2, Upload, XCircle } from 'lucide-react';
import { scanIdCard, type ScanResult, type ProgressEvent } from '../lib/ocr/extractIdCard';
import {
  IdPhotoCropModal,
  buildWebpVariantsFromImage,
  pickPrimaryLabel,
  type IdPhotoCropResult,
  type ResizedTarget,
} from './IdPhotoCropModal';
import { useUploadSpec } from '../hooks/useMediaUrl';

export interface DetectedIdCardFields {
  cid: string | null;
  cidValid: boolean;
  prefix: string | null;
  firstName: string | null;
  lastName: string | null;
  /** ISO date string (YYYY-MM-DD) — Gregorian. */
  dob: string | null;
  /** Raw DOB text from OCR — shown when ISO parse failed. */
  dobRaw: string | null;
  /** Raw single-line Thai name from OCR. */
  fullNameTh: string | null;
}

/** Field key for per-field copy actions. Mirrors the form fields, not the
    full DetectedIdCardFields type (drops cidValid + dobRaw + fullNameTh). */
export type IdCardField = 'cid' | 'prefix' | 'firstName' | 'lastName' | 'dob';

interface Props {
  /** Called with the detected fields when the user applies all detected
      values (or, in legacy mode without `currentFields`, automatically when
      OCR finishes). */
  onDetected: (fields: DetectedIdCardFields) => void;
  /** Optional persistence callback — receives the original image when scanning succeeds. Use this to also upload the ID card to the server. */
  onPersist?: (img: UploadedImage) => void | Promise<void>;
  /** Optional callback fired when the user clears the scanner. */
  onClear?: () => void;
  /** Disabled while parent is busy. */
  disabled?: boolean;
  /** URL of an already-saved ID card image to show when the user hasn't scanned in this session. Upload a new image to replace it (the old one stays on the server until the new upload completes). */
  existingImageUrl?: string | null;
  /** Current form values for the fields the scanner detects. When given, the
      result panel renders as a merge UI — each row shows current vs OCR'd
      value with a per-field Copy button. Without this prop, `onDetected`
      fires immediately when OCR succeeds (legacy behavior). */
  currentFields?: Partial<Record<IdCardField, string>>;
  /** Per-field copy handler. Required when `currentFields` is given. */
  onCopyField?: (field: IdCardField, value: string) => void;
  /** Allow copying the detected CID into the form. Off by default because CID
      is an immutable match-key once a customer exists (the co-lessee panel
      disables it); on for the new-customer registration form where ID number
      is still editable. */
  onCopyCid?: boolean;
}

const EMPTY_FIELDS: DetectedIdCardFields = {
  cid: null, cidValid: false,
  prefix: null, firstName: null, lastName: null,
  dob: null, dobRaw: null, fullNameTh: null,
};

function isEmptyResult(f: DetectedIdCardFields): boolean {
  return !f.cid && !f.prefix && !f.firstName && !f.lastName && !f.dob && !f.dobRaw && !f.fullNameTh;
}

function resultToFields(r: ScanResult): DetectedIdCardFields {
  return {
    cid: r.cid?.thirteen ? r.cid.text : (r.cid?.text ?? null),
    cidValid: !!r.cid?.checksumValid,
    prefix: r.prefixTh ?? null,
    firstName: r.firstNameTh ?? null,
    lastName: r.lastNameTh ?? null,
    dob: r.dobIso ?? null,
    dobRaw: r.dobRaw ?? null,
    fullNameTh: r.fullNameTh ?? null,
  };
}

function progressLabel(p: ProgressEvent | null, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!p) return '';
  switch (p.phase) {
    case 'load': return t('ocr.phaseLoad');
    case 'upscale': return t('ocr.phaseUpscale');
    case 'pass1': return t('ocr.phasePass1');
    case 'detect': return t('ocr.phaseDetect');
    case 'pass2': return t('ocr.phasePass2', { step: p.step, total: p.total });
    case 'done': return t('ocr.phaseDone');
  }
}

export function IdCardScanner({ onDetected, onPersist, onClear, disabled, existingImageUrl, currentFields, onCopyField, onCopyCid }: Props) {
  const { t } = useTranslation();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectedIdCardFields | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const persistSpec = useUploadSpec('customer_id_card');

  // Revoke the old object URL whenever it changes; clean up on unmount too.
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // Abort an in-flight scan only on unmount — NOT on every previewUrl change,
  // since handleUpload sets previewUrl right before starting the scan.
  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPickedFile(null);
    setScanning(false);
    setProgress(null);
    setError(null);
    setResult(null);
    setExistingCleared(true);
    onClear?.();
  };

  // Step 1: receive image from ImageUploader → open crop modal with the ORIGINAL
  // (uncompressed) frame. ImageUploader's webp resize hurts OCR accuracy, and
  // re-encoding twice (camera → webp → crop) compounds it. We discard the
  // ImageUploader output entirely and work from originalFile.
  const handleUpload = (images: UploadedImage[]) => {
    if (images.length === 0) return;
    const file = images[0].originalFile ?? images[0].file;
    if (!file) {
      setError(t('ocr.errorScanFailed'));
      return;
    }
    setError(null);
    setResult(null);
    setPickedFile(file);
  };

  // Step 2: crop confirmed → feed lossless PNG to OCR, build WebP variants
  // from the same cropped pixels for persistence.
  const handleCropConfirm = async (crop: IdPhotoCropResult) => {
    const source = pickedFile;
    if (!source) {
      URL.revokeObjectURL(crop.croppedUrl);
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(crop.croppedUrl);
    setPickedFile(null);
    setScanning(true);
    setProgress({ phase: 'load' });

    const abort = new AbortController();
    abortRef.current = abort;

    const persistCroppedImage = async () => {
      if (!onPersist || !persistSpec.spec) return;
      try {
        const baseName = source.name.replace(/\.[^.]+$/, '');
        const targets: ResizedTarget[] = persistSpec.spec.sizes.map(s => ({ label: s.label, width: s.width }));
        const variants = await buildWebpVariantsFromImage(crop.croppedImage, baseName, targets, persistSpec.spec.quality);
        const primaryLabel = pickPrimaryLabel(targets);
        const primary = variants[primaryLabel]?.file ?? Object.values(variants)[0]?.file;
        if (!primary) return;
        const image: UploadedImage = {
          id: Math.random().toString(36).slice(2),
          originalFile: source,
          originalWidth: crop.croppedImage.naturalWidth,
          originalHeight: crop.croppedImage.naturalHeight,
          originalSize: source.size,
          file: primary,
          preview: '',
          width: crop.croppedImage.naturalWidth,
          height: crop.croppedImage.naturalHeight,
          size: primary.size,
          variants,
        };
        await onPersist(image);
      } catch { /* user can re-upload from Documents */ }
    };

    try {
      // OCR reads the lossless PNG of the cropped region.
      const scan = await scanIdCard(crop.pngBlob, {
        signal: abort.signal,
        onProgress: (p) => setProgress(p),
      });
      if (abort.signal.aborted) return;

      // OCR may fail when the upload isn't a Thai ID (passport, work permit,
      // other doc). Don't block — surface an empty result so the user can
      // type fields manually, and still persist the cropped photo.
      const fields = scan.ok ? resultToFields(scan) : EMPTY_FIELDS;
      setResult(fields);
      // In merge mode (currentFields given), the user copies fields manually
      // — don't write detected values into the form automatically.
      if (!currentFields && scan.ok) {
        onDetected(fields);
      }

      await persistCroppedImage();
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      // Worker crash or unexpected error — still keep the photo and let the
      // user fill in fields manually instead of forcing a re-upload.
      setResult(EMPTY_FIELDS);
      await persistCroppedImage();
    } finally {
      setScanning(false);
    }
  };

  const handleCropCancel = () => {
    setPickedFile(null);
  };

  // Local override of `existingImageUrl` so the user can clear a previously-
  // saved card image visually without us needing a delete RPC.
  const [existingCleared, setExistingCleared] = useState(false);
  const visibleExisting = !existingCleared && !previewUrl ? existingImageUrl : null;
  const displayUrl = previewUrl ?? visibleExisting ?? null;
  const showEmpty = !displayUrl && !scanning && !result && !error;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ScanLine size={14} className="text-subtle" />
        <span className="form-label mb-0">{t('ocr.title')}</span>
        {result && !error && (
          <CheckCircle size={14} className="text-success" />
        )}
      </div>

      <ImageUploader
        multiple={false}
        resizeOptions={{ maxWidth: 2400, mode: 'contain', format: 'webp', quality: 0.9 }}
        onUpload={handleUpload}
        disabled={disabled || scanning}
        className={
          displayUrl
            ? '!min-h-0 !p-0 !border !border-solid !border-line hover:!border-primary transition-colors'
            : '!min-h-0 !p-0 !border-2 !border-dashed !border-line hover:!border-primary hover:!bg-surface-hover transition-colors'
        }
        placeholder={
          showEmpty ? (
            <div key="empty" className="flex flex-col items-center justify-center gap-1 text-subtle text-sm w-full py-6">
              <Upload size={18} className="opacity-60" />
              <span>{t('ocr.dropHint')}</span>
              <span className="text-xs">{t('ocr.dropSubhint')}</span>
            </div>
          ) : (
            <div key="filled" className="relative w-full bg-surface-shallow flex items-center justify-center p-2">
              {displayUrl && (
                <img key="preview" src={displayUrl} alt="" className="max-w-full max-h-40 object-contain" />
              )}
              {scanning && (
                <div key="overlay" className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1.5 text-white text-xs">
                  <Loader2 size={18} className="animate-spin" />
                  <span>{progressLabel(progress, t)}</span>
                </div>
              )}
            </div>
          )
        }
      />

      {error && (
        <div className="alert alert-danger">
          <XCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {visibleExisting && !result && !scanning && !error && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={reset} startIcon={<Trash2 size={14} />}>
            {t('ocr.rescan')}
          </Button>
        </div>
      )}

      {result && !scanning && isEmptyResult(result) && (
        <div className="flex items-center justify-between gap-2 text-xs border border-line rounded-md p-2 bg-surface-shallow">
          <span className="text-subtle">{t('ocr.noFieldsDetected')}</span>
          <Button variant="ghost" size="sm" onClick={reset} startIcon={<Trash2 size={14} />}>
            {t('ocr.rescan')}
          </Button>
        </div>
      )}

      {result && !scanning && !isEmptyResult(result) && (
        <div className="flex flex-col gap-1.5 text-xs border border-line rounded-md p-2 bg-surface-shallow">
          {currentFields ? (
            <>
              <MergeRow
                label={t('ocr.fieldCid')}
                current={currentFields.cid ?? ''}
                detected={result.cid}
                warn={result.cid != null && !result.cidValid ? t('ocr.cidChecksumBad') : null}
                onCopy={(v) => onCopyField?.('cid', v)}
                noCopy={!onCopyCid}
              />
              <MergeRow
                label={t('ocr.fieldPrefix')}
                current={currentFields.prefix ?? ''}
                detected={result.prefix}
                onCopy={(v) => onCopyField?.('prefix', v)}
              />
              <MergeRow
                label={t('ocr.fieldFirstName')}
                current={currentFields.firstName ?? ''}
                detected={result.firstName}
                onCopy={(v) => onCopyField?.('firstName', v)}
              />
              <MergeRow
                label={t('ocr.fieldLastName')}
                current={currentFields.lastName ?? ''}
                detected={result.lastName}
                onCopy={(v) => onCopyField?.('lastName', v)}
              />
              <MergeRow
                label={t('ocr.fieldDob')}
                current={currentFields.dob ?? ''}
                detected={result.dob ?? result.dobRaw}
                warn={!result.dob && result.dobRaw ? t('ocr.dobUnparsed') : null}
                onCopy={(v) => onCopyField?.('dob', v)}
              />
              <div className="flex justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={reset} startIcon={<Trash2 size={14} />}>
                  {t('ocr.rescan')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <DetectedRow label={t('ocr.fieldCid')} value={result.cid}
                warn={result.cid != null && !result.cidValid ? t('ocr.cidChecksumBad') : null} />
              <DetectedRow label={t('ocr.fieldPrefix')} value={result.prefix} />
              <DetectedRow label={t('ocr.fieldFirstName')} value={result.firstName} />
              <DetectedRow label={t('ocr.fieldLastName')} value={result.lastName} />
              <DetectedRow label={t('ocr.fieldDob')} value={result.dob ?? result.dobRaw}
                warn={!result.dob && result.dobRaw ? t('ocr.dobUnparsed') : null} />
              <div className="flex justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={reset} startIcon={<Trash2 size={14} />}>
                  {t('ocr.rescan')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <IdPhotoCropModal
        source={pickedFile}
        onConfirm={handleCropConfirm}
        onCancel={handleCropCancel}
      />
    </div>
  );
}

function DetectedRow({ label, value, warn }: { label: string; value: string | null; warn?: string | null }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-subtle shrink-0 w-20">{label}</span>
      <span className="break-all flex-1">{value || <span className="text-subtle">—</span>}</span>
      {warn && <span className="text-warning-fg text-[10px] shrink-0">{warn}</span>}
    </div>
  );
}

/* Merge UI row: shows the form's current value, the OCR-detected value, and
   a Copy button when they differ. Copy is hidden when OCR didn't detect
   anything (no value to copy) or when the detected value already matches. */
function MergeRow({ label, current, detected, warn, onCopy, noCopy }: {
  label: string;
  current: string;
  detected: string | null;
  warn?: string | null;
  onCopy: (value: string) => void;
  /** When set, never show a copy button (used for immutable fields like CID). */
  noCopy?: boolean;
}) {
  const hasDetected = !!detected;
  const sameAsCurrent = hasDetected && current.trim() === (detected ?? '').trim();
  const canCopy = !noCopy && hasDetected && !sameAsCurrent;
  return (
    <div className="flex items-center gap-2">
      <span className="text-subtle shrink-0 w-20">{label}</span>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {current && (
          <span className="break-all text-subtle text-[10px] opacity-80">
            {current}
          </span>
        )}
        <span className={`break-all ${canCopy ? 'font-medium text-primary-fg' : sameAsCurrent ? 'text-success' : ''}`}>
          {detected || <span className="text-subtle">—</span>}
        </span>
      </div>
      {warn && <span className="text-warning-fg text-[10px] shrink-0">{warn}</span>}
      {canCopy ? (
        <Button
          size="sm"
          variant="outline"
          className="btn-icon-xs shrink-0"
          startIcon={<Copy size={12} />}
          onClick={() => onCopy(detected!)}
          aria-label="Copy"
        />
      ) : sameAsCurrent ? (
        <CheckCircle size={14} className="text-success shrink-0" />
      ) : (
        <span className="w-5 shrink-0" />
      )}
    </div>
  );
}
