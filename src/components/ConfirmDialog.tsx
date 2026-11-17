import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';

/**
 * Generic confirm dialog. Use instead of native window.confirm() for
 * destructive actions like deleting a row.
 *
 * Pattern:
 *   const [confirming, setConfirming] = useState(false);
 *   ...
 *   <Button onClick={() => setConfirming(true)} />
 *   <ConfirmDialog
 *     open={confirming}
 *     onClose={() => setConfirming(false)}
 *     onConfirm={() => { mutation.mutate(); setConfirming(false); }}
 *     message={t('foo.confirmRemove')}
 *     confirmLabel={t('common.delete')}
 *     color="danger"
 *   />
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  color = 'danger',
  confirmVariant = 'solid',
  titleIcon,
  confirmIcon,
  pending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Optional title; defaults to "Confirm". */
  title?: string;
  /** Body text or node. */
  message: React.ReactNode;
  /** Label of the confirm button. Defaults to t('common.confirm'). */
  confirmLabel?: string;
  /** Label of the cancel button. Defaults to t('common.cancel'). */
  cancelLabel?: string;
  /** Confirm button color. Defaults to 'danger' since these are usually destructive. */
  color?: 'primary' | 'danger';
  /** Confirm button fill — match the button that opened the dialog when two look alike. */
  confirmVariant?: 'solid' | 'outline';
  /** Icon before the title, e.g. the opening button's icon. */
  titleIcon?: React.ReactNode;
  /** Icon on the confirm button. */
  confirmIcon?: React.ReactNode;
  /** Disables both buttons while a mutation is in flight. */
  pending?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title inline-flex items-center gap-2">{titleIcon}{title ?? t('common.confirm')}</h2>
      </div>
      <div className="modal-content">
        <p className="text-sm">{message}</p>
      </div>
      <div className="modal-footer">
        <Button type="button" onClick={onClose} disabled={pending}>
          {cancelLabel ?? t('common.cancel')}
        </Button>
        <Button type="button" color={color} variant={confirmVariant} startIcon={confirmIcon} onClick={onConfirm} disabled={pending}>
          {pending ? t('common.saving') : (confirmLabel ?? t('common.confirm'))}
        </Button>
      </div>
    </Modal>
  );
}
