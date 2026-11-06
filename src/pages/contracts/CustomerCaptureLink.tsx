// "ส่งลิงก์ให้ลูกค้าถ่าย" — a link (+ QR) the shop sends the customer over
// LINE / chat. The customer opens it on their own phone, no login: consent →
// location (required) → front camera → send. Photos land in the contract
// album's "ลูกค้าถ่ายเอง" group (CUSTOMER_CAPTURED, 0–10). UI_SUMMARY 161.
//
// Same capture-bridge session as the album's own QR, pinned to that group by
// meta.slot — the bridge opens in customer mode on its own when it sees it.
// 24 h (the RPC's max) because the customer doesn't open it right away;
// 10 photos = the group's cap. Works from DRAFT (the RPC ignores state).
//
// The session lives on the page, not in the window: closing the window keeps
// the link alive, reopening shows the same link until it expires or fills.
// Polls fast then fading from each opening (lib/capturePoll) and settles at
// 60 s rather than stopping, so the album fills in as the customer's photos
// arrive hours later.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Loader2, RefreshCw, Smartphone, XCircle, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { useMobileCaptureSession } from './workspace/useMobileCaptureSession';
import { CAPTURE_POLL_TAIL_CUSTOMER_MS } from '../../lib/capturePoll';

const SESSION_META = { slot: 'CUSTOMER_CAPTURED', source: 'customer-link' };
const TTL_MINUTES = 1440;
const MAX_PHOTOS = 10;
/** Backend-side note on the session (data, as the work order gives it). */
const SESSION_NOTE = 'ส่งให้ลูกค้าถ่าย';

export function CustomerCaptureLinkButton({ contractId, contractCode, onUploaded }: {
  contractId: number;
  contractCode: string | null;
  /** Called when the customer's photos arrive, so the album reloads. */
  onUploaded?: () => void;
}) {
  const { t } = useTranslation();
  const { isReadOnlyViewer } = useAuth();
  const [open, setOpen] = useState(false);
  // When the window last opened — the fading poll's clock (lib/capturePoll).
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const capture = useMobileCaptureSession(contractId, contractCode, {
    meta: SESSION_META,
    ttlMinutes: TTL_MINUTES,
    maxUploads: MAX_PHOTOS,
    note: SESSION_NOTE,
    // Fast then fading, and never fully off while the link lives — the
    // customer sends photos long after, and the album must show them.
    pollSince: openedAt,
    pollTail: CAPTURE_POLL_TAIL_CUSTOMER_MS,
  });

  useEffect(() => {
    if (capture.uploadCount > 0) onUploaded?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture.uploadCount]);

  if (isReadOnlyViewer) return null;

  const openWindow = () => {
    if (capture.phase === 'idle' || capture.phase === 'error') capture.start();
    setOpenedAt(Date.now());
    setOpen(true);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 whitespace-nowrap"
        startIcon={<Smartphone size={14} />}
        onClick={openWindow}
      >
        {t('customerCapture.button')}
      </Button>
      <CustomerCaptureLinkModal
        open={open}
        onClose={() => setOpen(false)}
        contractCode={contractCode}
        capture={capture}
      />
    </>
  );
}

function CustomerCaptureLinkModal({ open, onClose, contractCode, capture }: {
  open: boolean;
  onClose: () => void;
  contractCode: string | null;
  capture: ReturnType<typeof useMobileCaptureSession>;
}) {
  const { t } = useTranslation();
  const { phase, session, status, error, uploadCount } = capture;
  const link = session?.qr_payload ?? '';
  const max = status?.max_uploads ?? session?.max_uploads ?? MAX_PHOTOS;
  const ended = phase === 'done';
  // The customer reads Thai whatever language the staff screen is in.
  const message = t('customerCapture.message', { lng: 'th' });
  const errorText = error ? (t(error, { ns: 'apiErrors', defaultValue: '' }) || error) : null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('customerCapture.title')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>

      <div className="modal-content min-w-0">
        <div className="flex flex-col gap-3">
          <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">{contractCode ?? '—'}</div>
            <div className="text-xs text-subtle">{t('customerCapture.target')}</div>
          </div>

          <div className="flex justify-center">
            <div className="w-[232px] h-[232px] rounded-md border border-line bg-white p-4 flex items-center justify-center">
              {session && !ended ? (
                <QRCodeSVG value={link} size={200} />
              ) : phase === 'error' ? (
                <XCircle size={24} className="text-danger" />
              ) : ended ? (
                <AlertTriangle size={24} className="text-warning" />
              ) : (
                <Loader2 size={20} className="animate-spin text-subtler" />
              )}
            </div>
          </div>

          {ended && (
            <div className="alert alert-warning">
              <AlertTriangle size={16} />
              <span>
                {status?.status === 'EXHAUSTED'
                  ? t('customerCapture.endedFull', { max })
                  : t('customerCapture.endedExpired')}
              </span>
            </div>
          )}

          {session && !ended && (
            <>
              <div className="rounded-md bg-surface border border-line px-3 py-2 text-xs font-mono break-all select-all">
                {link}
              </div>
              <div className="flex flex-wrap gap-2">
                <CopyTextButton value={link} label={t('customerCapture.copyLink')} />
                <CopyTextButton value={`${message}\n${link}`} label={t('customerCapture.copyWithMessage')} primary />
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-subtle">{t('customerCapture.expires')}</dt>
                <dd><DateTime value={status?.expires_at ?? session.expires_at} showTime /></dd>
                <dt className="text-subtle">{t('customerCapture.received')}</dt>
                <dd>{t('customerCapture.receivedCount', { count: uploadCount, max })}</dd>
              </dl>
              <div className="text-xs text-subtle flex flex-col gap-1">
                <span className="font-medium">{t('customerCapture.messageLabel')}</span>
                <span className="whitespace-pre-line">{message}</span>
              </div>
            </>
          )}

          <p className="text-xs text-subtler">{t('customerCapture.hint')}</p>
        </div>
      </div>

      <ModalErrorBand message={errorText} />

      <div className="modal-footer">
        {(ended || phase === 'error') && (
          <Button variant="outline" startIcon={<RefreshCw size={16} />} onClick={() => capture.start()}>
            {t('customerCapture.newLink')}
          </Button>
        )}
        <Button variant="primary" onClick={onClose}>{t('common.done')}</Button>
      </div>
    </Modal>
  );
}

function CopyTextButton({ value, label, primary }: { value: string; label: string; primary?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <Button
      size="sm"
      variant={primary ? 'primary' : 'outline'}
      startIcon={copied ? <Check size={14} /> : <Copy size={14} />}
      onClick={copy}
    >
      {copied ? t('common.copied') : label}
    </Button>
  );
}
