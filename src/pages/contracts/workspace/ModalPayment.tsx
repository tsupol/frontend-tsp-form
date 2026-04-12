// ModalPayment is not used as a standalone modal — payment UI lives in CardPayment.tsx
// This file exists as a no-op modal for the openModal='payment' case

import { Modal, Button } from 'tsp-form';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ModalPayment({ open, onClose }: Props) {
  const { t } = useTranslation();

  // Payment is handled inline via CardPayment, not in a modal.
  // This modal is a placeholder — the openModal='payment' state is not used.
  return (
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('workspace.cardPayment')}</h2>
      </div>
      <div className="modal-content">
        <p className="text-sm text-subtle">{t('workspace.paymentInline')}</p>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
