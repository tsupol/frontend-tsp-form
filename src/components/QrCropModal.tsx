// Square crop before a payment QR is uploaded (owner 11-10). Shops pick whatever their bank
// app exports — often the whole "Thai QR Payment" poster, logo, shop name and all — and the
// QR window then shows the code at a third of its box, too small to scan from a screen. The
// shop frames just the code here; only that square is uploaded.
// Same cropper as the ID-card crop window (tsp-form ImageCropper), locked to 1:1, PNG out so
// the code's edges stay sharp. Stacks over the account window; always mounted, `source`
// opens it.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ImageCropper, Modal, Slider, type ImageCropperRef } from 'tsp-form';
import { RotateCcw, RotateCw, Scissors } from 'lucide-react';

const VIEWPORT = 320;
/** Plenty for a phone camera reading a screen; a bank QR is ~40 modules across. */
const OUTPUT_PX = 1200;

export function QrCropModal({ source, onConfirm, onCancel }: {
  /** The picked file; non-null opens the window. */
  source: File | null;
  /** The cropped square as a PNG file, named after the source. */
  onConfirm: (file: File) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const cropperRef = useRef<ImageCropperRef>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (source) {
      setZoom(1);
      setRotation(0);
      setBusy(false);
    }
  }, [source]);

  const minZoomPct = Math.round((cropperRef.current?.minZoom ?? 0.1) * 100);
  const maxZoomPct = Math.round((cropperRef.current?.maxZoom ?? 4) * 100);

  const confirm = () => {
    if (!source || !cropperRef.current) return;
    setBusy(true);
    cropperRef.current.crop((blob) => {
      const base = source.name.replace(/\.[^.]+$/, '') || 'qr';
      onConfirm(new File([blob], `${base}-qr.png`, { type: 'image/png' }));
    });
  };

  const turn = (delta: 90 | -90) => {
    const next = Math.max(-180, Math.min(180, delta > 0 ? Math.floor(rotation / 90) * 90 + 90 : Math.ceil(rotation / 90) * 90 - 90));
    cropperRef.current?.setRotation(next);
  };

  return (
    <Modal open={source != null} onClose={busy ? () => {} : onCancel} maxWidth="26rem" width="100%" ariaLabel={t('settings.bankAccounts.qr.cropTitle')}>
      <div className="modal-header">
        <h2 className="modal-title">{t('settings.bankAccounts.qr.cropTitle')}</h2>
      </div>
      <div className="modal-content">
        <p className="text-sm text-subtle mb-3">{t('settings.bankAccounts.qr.cropHint')}</p>
        {source && (
          <div className="flex flex-col items-center gap-3" data-testid="qr-crop">
            <div style={{ width: VIEWPORT, maxWidth: '100%' }}>
              <ImageCropper
                ref={cropperRef}
                src={source}
                aspectRatio={1}
                outputType="image/png"
                outputWidth={OUTPUT_PX}
                viewportWidth={VIEWPORT}
                rotation
                onZoomChange={(z) => setZoom(z)}
                onRotationChange={setRotation}
              />
            </div>
            <div className="flex items-center gap-3 w-full">
              <span className="text-xs text-subtle w-12 shrink-0">{t('idPhoto.zoom')}</span>
              <Slider min={minZoomPct} max={maxZoomPct} step={1} value={Math.round(zoom * 100)} onChange={(v) => cropperRef.current?.setZoom(v / 100)} />
              <span className="text-xs text-subtle tabular-nums w-12 text-right shrink-0">{Math.round(zoom * 100)}%</span>
            </div>
            <div className="flex items-center gap-2 w-full">
              <span className="text-xs text-subtle w-12 shrink-0">{t('idPhoto.rotate')}</span>
              <Button size="sm" variant="outline" startIcon={<RotateCcw size={14} />} onClick={() => turn(-90)} disabled={busy} aria-label={t('settings.bankAccounts.qr.rotateLeft')} />
              <Button size="sm" variant="outline" startIcon={<RotateCw size={14} />} onClick={() => turn(90)} disabled={busy} aria-label={t('settings.bankAccounts.qr.rotateRight')} />
            </div>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>{t('common.cancel')}</Button>
        <Button color="primary" startIcon={<Scissors size={14} />} onClick={confirm} disabled={busy} data-testid="qr-crop-confirm">
          {busy ? t('common.saving') : t('settings.bankAccounts.qr.cropConfirm')}
        </Button>
      </div>
    </Modal>
  );
}
