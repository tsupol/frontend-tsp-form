import { useTranslation } from 'react-i18next';
import { Button, Modal } from 'tsp-form';
import { AlertTriangle } from 'lucide-react';

// A picture of the customer's iPhone in Lost Mode, drawn from what the backend
// says will be sent (157 §3). The real screen cannot be captured, so the layout
// follows a published sample of the iOS Lost Mode screen (ManageEngine MDM docs):
// dim clock and date, "Lost iPhone", message, phone, Call, Emergency, footnote.
// Dark in both app themes: it is a device, not part of the page. Styles: app.css.

export interface LostModeScreenContent {
  message: string;
  phone_number: string | null;
  phone_missing: boolean;
  footnote: string | null;
  footnote_is_sample: boolean;
}

const BANGKOK = 'Asia/Bangkok';

export function LostModeLockScreen({ content }: { content: LostModeScreenContent | null }) {
  const { t, i18n } = useTranslation();
  const now = new Date();
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: BANGKOK }).format(now);
  const date = new Intl.DateTimeFormat(i18n.language === 'th' ? 'th-TH' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: BANGKOK,
  }).format(now);

  return (
    <div className={`lost-mode-phone ${content?.phone_missing ? 'lost-mode-phone-below-alert' : ''}`}>
      <div className="lost-mode-phone-island" />
      <div className="lost-mode-phone-time">{time}</div>
      <div className="lost-mode-phone-date">{date}</div>
      <div className="lost-mode-phone-body">
        <div className="lost-mode-phone-title">{t('lostMode.screenTitle')}</div>
        <div className="lost-mode-phone-message">{content?.message}</div>
        {content?.phone_number && (
          <>
            <div className="lost-mode-phone-number">{content.phone_number}</div>
            <div className="lost-mode-phone-call">{t('lostMode.screenCall')}</div>
          </>
        )}
      </div>
      <div className="lost-mode-phone-emergency">{t('lostMode.screenEmergency')}</div>
      {content?.footnote && <div className="lost-mode-phone-footnote">{content.footnote}</div>}
    </div>
  );
}

export function LostModePreviewModal({ open, onClose, content }: {
  open: boolean;
  onClose: () => void;
  content: LostModeScreenContent | null;
}) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} maxWidth="22rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('lostMode.previewTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>×</button>
      </div>
      <div className="modal-content">
        <div className="flex flex-col items-center gap-3">
          {content?.phone_missing && (
            <div className="alert alert-warning w-full">
              <AlertTriangle size={16} />
              <div className="alert-description">{t('lostMode.phoneMissing')}</div>
            </div>
          )}
          <LostModeLockScreen content={content} />
          <div className="text-xs text-subtle text-center">
            {content?.footnote_is_sample && <div>{t('lostMode.sampleContract')}</div>}
            <div>{t('lostMode.previewCaveat')}</div>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
