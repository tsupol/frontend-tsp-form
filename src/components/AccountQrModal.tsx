// A bank account's payment QR, for a customer to scan at the counter. Laid out like the
// app's other QR windows (sign / view QR): a title, whose account it is, the QR on a
// white card at a size a phone camera reads from a screen, and one line saying what it
// is for. Not a full-screen image viewer — a giant QR is harder to scan, not easier.
// The data must outlive `open`: the caller clears its selection on close, so the last
// account is held while the window animates out.

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from 'tsp-form';
import { BankAccountLine } from './BankAccountLine';
import { publicMediaUrl } from '../lib/mediaPath';
import type { BankAccountLike } from '../lib/bankAccount';

export interface AccountQr {
  /** Window title, e.g. "QR ค่างวด". */
  title: string;
  /** What the QR is for, under it. */
  hint?: string;
  account: BankAccountLike;
  /** Storage key of the PUBLIC QR image. */
  qrKey: string;
}

export function AccountQrModal({ qr: qrProp, onClose }: { qr: AccountQr | null; onClose: () => void }) {
  const { t } = useTranslation();
  const last = useRef(qrProp);
  if (qrProp) last.current = qrProp;
  const qr = qrProp ?? last.current;

  return (
    <Modal open={!!qrProp} onClose={onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{qr?.title}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>
      <div className="modal-content">
        {qr && (
          <div className="flex flex-col items-center gap-4" data-testid="account-qr-modal">
            <div className="w-full px-3 py-2.5 rounded-md bg-surface border border-line">
              <BankAccountLine account={qr.account} showWhere={false} />
            </div>
            {/* White card even in dark mode: a QR needs a light quiet zone to scan. */}
            <div className="rounded-lg border border-line bg-white p-3">
              <img src={publicMediaUrl(qr.qrKey)} alt={qr.title} width={224} height={224} className="block w-56 h-56 object-contain" />
            </div>
            {qr.hint && <p className="text-sm text-subtle text-center">{qr.hint}</p>}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
