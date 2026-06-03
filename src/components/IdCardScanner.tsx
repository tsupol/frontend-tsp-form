import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageUploader, Button } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, Loader2, ScanLine, Trash2, Upload, XCircle } from 'lucide-react';
import { scanIdCard, type ScanResult, type ProgressEvent } from '../lib/ocr/extractIdCard';

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

interface Props {
  /** Called with the detected fields when OCR finishes. */
  onDetected: (fields: DetectedIdCardFields) => void;
  /** Optional persistence callback — receives the original image when scanning succeeds. Use this to also upload the ID card to the server. */
  onPersist?: (img: UploadedImage) => void | Promise<void>;
  /** Optional callback fired when the user clears the scanner. */
  onClear?: () => void;
  /** Disabled while parent is busy. */
  disabled?: boolean;
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

export function IdCardScanner({ onDetected, onPersist, onClear, disabled }: Props) {
  const { t } = useTranslation();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectedIdCardFields | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
    setScanning(false);
    setProgress(null);
    setError(null);
    setResult(null);
    onClear?.();
  };

  const handleUpload = async (images: UploadedImage[]) => {
    if (images.length === 0) return;
    const img = images[0];
    // Prefer the ORIGINAL file — ImageUploader's resize step softens small inputs
    // and re-encodes to webp 0.9, which costs us pass-1 landmark accuracy.
    const file = img.originalFile ?? img.file;
    if (!file) {
      setError(t('ocr.errorScanFailed'));
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
    setResult(null);
    setScanning(true);
    setProgress({ phase: 'load' });

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const scan = await scanIdCard(file, {
        signal: abort.signal,
        onProgress: (p) => setProgress(p),
      });
      if (abort.signal.aborted) return;

      if (!scan.ok) {
        setError(scan.reason === 'fit_failed' ? t('ocr.errorFitFailed') : t('ocr.errorScanFailed'));
        setScanning(false);
        return;
      }

      const fields = resultToFields(scan);
      setResult(fields);
      onDetected(fields);

      if (onPersist) {
        try { await onPersist(img); } catch { /* user can re-upload from Documents */ }
      }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      setError(t('ocr.errorScanFailed'));
    } finally {
      setScanning(false);
    }
  };

  const showEmpty = !previewUrl && !scanning && !result && !error;

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
          previewUrl
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
              {previewUrl && (
                <img key="preview" src={previewUrl} alt="" className="max-w-full max-h-40 object-contain" />
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

      {result && !scanning && (
        <div className="flex flex-col gap-1.5 text-xs border border-line rounded-md p-2 bg-surface-shallow">
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
        </div>
      )}
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
