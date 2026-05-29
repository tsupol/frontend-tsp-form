import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { X } from 'lucide-react';
import { SignatureCapture } from './SignatureCapture';

interface Props {
  open: boolean;
  onClose: () => void;
  fileUrl: string | null;
  uploading: boolean;
  disabled?: boolean;
  cacheBust?: number;
  onUpload: (imgs: UploadedImage[]) => void;
  onSigned?: () => void; // fires once after a successful upload while open
}

export function ContractSignModal({
  open, onClose, fileUrl, uploading, disabled, cacheBust, onUpload, onSigned,
}: Props) {
  const { t } = useTranslation();
  const initialFileUrlRef = useRef<string | null>(null);
  const wasUploadingRef = useRef(false);

  // Snapshot the fileUrl when the modal opens. Once an upload finishes and
  // fileUrl changes, fire onSigned() so the parent can close everything.
  useEffect(() => {
    if (open) {
      initialFileUrlRef.current = fileUrl;
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    if (wasUploadingRef.current && !uploading && fileUrl && fileUrl !== initialFileUrlRef.current) {
      onSigned?.();
    }
    wasUploadingRef.current = uploading;
  }, [uploading, fileUrl, open, onSigned]);

  return (
    <Modal open={open} onClose={onClose} maxWidth="42rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('contract.signModalTitle', { defaultValue: 'Sign contract' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-content">
        <SignatureCapture
          fileUrl={fileUrl}
          uploading={uploading}
          disabled={disabled}
          cacheBust={cacheBust}
          onUpload={onUpload}
          startInEditing
        />
      </div>
      <div className="modal-footer">
        <Button onClick={onClose} disabled={uploading}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
