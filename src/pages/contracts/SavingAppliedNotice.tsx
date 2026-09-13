import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { PiggyBank, AlertTriangle, CheckCircle } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';

/**
 * Saving-wallet notices for the contract-open payment step.
 * See `savingAutoFill.ts` for why the wallet is auto-spent.
 *
 * Three pieces, each at a different moment:
 *   • SavingRowNote      — live readout inside the wallet payment row
 *   • SavingUnusedWarning — inline band under the total, while editing
 *   • SavingUnusedConfirmDialog — the gate at Confirm, only when saving is
 *     left unspent. There is deliberately NO announce-on-entry dialog: a
 *     dialog that only tells you something is nagging, so the decision lives
 *     at the one moment it becomes irreversible.
 */

/** Live "using X of Y" line shown inside the saving payment row. */
export function SavingRowNote({ used, available }: { used: number; available: number }) {
  const { t } = useTranslation();
  const full = used >= available - 0.01;
  return (
    <div className={`flex items-center gap-1.5 text-xs ${full ? 'text-info-fg' : 'text-warning-fg'}`}>
      <PiggyBank size={12} />
      <span>
        {t('wizard.savingRowUsage', {
          used: fmtCurrency(used),
          available: fmtCurrency(available),
        })}
      </span>
    </div>
  );
}

/** Inline warning shown while the rows leave part of the saving balance unspent. */
export function SavingUnusedWarning({ unused }: { unused: number }) {
  const { t } = useTranslation();
  if (unused <= 0.01) return null;
  return (
    <div className="alert alert-warning mt-3">
      <AlertTriangle size={16} />
      <div className="flex flex-col gap-1 min-w-0">
        <div className="alert-title">{t('wizard.savingUnusedTitle')}</div>
        <div className="alert-description">
          {t('wizard.savingUnusedBody', { amount: fmtCurrency(unused) })}
        </div>
      </div>
    </div>
  );
}

/**
 * Confirm gate: opening the contract while part (or all) of the saving
 * balance goes unspent. Cancel returns to the form so they can fix the rows.
 */
export function SavingUnusedConfirmDialog({
  open,
  onClose,
  onConfirm,
  used,
  available,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  used: number;
  available: number;
}) {
  const { t } = useTranslation();
  const unused = Math.max(0, available - used);
  const usingNone = used <= 0.01;

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('wizard.savingConfirmTitle')}</h2>
      </div>
      <div className="modal-content">
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          <div className="flex flex-col gap-1 min-w-0">
            <div className="alert-title">
              {usingNone
                ? t('wizard.savingConfirmNoneTitle', { amount: fmtCurrency(available) })
                : t('wizard.savingConfirmPartialTitle', {
                    used: fmtCurrency(used),
                    available: fmtCurrency(available),
                  })}
            </div>
            <div className="alert-description">
              {t('wizard.savingConfirmBody', { amount: fmtCurrency(unused) })}
            </div>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={onConfirm} startIcon={<CheckCircle size={16} />}>
          {t('wizard.savingConfirmCta')}
        </Button>
      </div>
    </Modal>
  );
}
