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
  /** Disables both buttons while a mutation is in flight. */
  pending?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{title ?? t('common.confirm')}</h2>
      </div>
      <div className="modal-content">
        <p className="text-sm">{message}</p>
      </div>
      <div className="modal-footer">
        <Button type="button" onClick={onClose} disabled={pending}>
          {cancelLabel ?? t('common.cancel')}
        </Button>
        <Button type="button" color={color} onClick={onConfirm} disabled={pending}>
          {pending ? t('common.saving') : (confirmLabel ?? t('common.confirm'))}
        </Button>
      </div>
    </Modal>
  );
}
