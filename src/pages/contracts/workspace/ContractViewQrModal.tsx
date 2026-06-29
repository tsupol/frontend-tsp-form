import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, XCircle, Copy, Check } from 'lucide-react';
import { useMobileCaptureSession } from './useMobileCaptureSession';

/**
 * Read-only "let the customer read the contract on a 2nd device" QR.
 *
 * Mints a CONTRACT_VIEW capture-bridge session (mig 332) and shows the QR +
 * copy-link. The bridge auto-detects the mode from the contract's signing
 * state: DRAFT/SAVING → preview-all (live, SAMPLE watermark, blank signatures);
 * sealed → print-all (the signed documents, COPY watermark). The UI just mints
 * and shows the QR — it does NOT render the PDF (the bridge owns that page).
 *
 * See UI_FEEDBACK/2026-06-26_DELIVERY_contract_view_readonly.md.
 */
export function ContractViewQrModal({
  open,
  onClose,
  contractId,
  contractCode,
}: {
  open: boolean;
  onClose: () => void;
  contractId: number | null;
  contractCode: string | null;
}) {
  const { t } = useTranslation();
  const { phase, session, error, start, stop } = useMobileCaptureSession(
    contractId,
    contractCode,
    { entityType: 'CONTRACT_VIEW', meta: { source: 'contract-view-readonly' } },
  );
  const [copied, setCopied] = useState(false);

  // Mint on open; stop polling (but keep the session alive) on close.
  useEffect(() => {
    if (open) start();
    // `start` is stable per (contractId, contractCode) and guards re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const handleClose = () => {
    // Keep the view session alive — BE expires it on TTL. Only stop polling.
    stop();
    onClose();
  };

  const copyLink = () => {
    if (!session) return;
    navigator.clipboard?.writeText(session.qr_payload).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  };

  const friendlyError = (code: string | null): string => {
    if (!code) return '';
    return t(code, { ns: 'apiErrors', defaultValue: '' }) || code;
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {t('workspace.contractViewTitle', { defaultValue: 'Let the customer read the contract' })}
        </h2>
        <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
      </div>

      <div className="modal-content">
        {contractCode && <p className="text-sm text-subtle mb-4">{contractCode}</p>}

        {(phase === 'requesting' || phase === 'idle') && (
          <div className="flex flex-col items-center justify-center py-12 text-subtle">
            <Smartphone size={32} className="mb-2 animate-pulse" />
            <span className="text-sm">{t('common.loading', { defaultValue: 'Loading...' })}</span>
          </div>
        )}

        {phase === 'error' && (
          <div className="alert alert-danger">
            <XCircle size={18} />
            <span>{friendlyError(error)}</span>
          </div>
        )}

        {(phase === 'active' || phase === 'done') && session && (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-lg border border-line bg-white p-4">
              <QRCodeSVG value={session.qr_payload} size={224} />
            </div>
            <p className="text-sm text-subtle text-center">
              {t('workspace.contractViewScanHint', {
                defaultValue: 'Scan with the customer’s phone (or your iPad) to open and read the contract.',
              })}
            </p>

            <div className="w-full flex items-center gap-2">
              <input
                readOnly
                value={session.qr_payload}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-md border border-line bg-surface text-subtle truncate"
              />
              <Button
                variant="outline"
                size="sm"
                startIcon={copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                onClick={copyLink}
              >
                {copied
                  ? t('common.copied', { defaultValue: 'Copied' })
                  : t('common.copyLink', { defaultValue: 'Copy link' })}
              </Button>
            </div>

            <p className="text-xs text-subtler text-center">
              {t('workspace.contractViewExpiry', {
                defaultValue: 'Link expires in about 30 minutes.',
              })}
            </p>
          </div>
        )}
      </div>

      <div className="modal-footer">
        <Button color="primary" onClick={handleClose}>
          {t('common.close', { defaultValue: 'Close' })}
        </Button>
      </div>
    </Modal>
  );
}
