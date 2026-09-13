import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { PiggyBank, AlertTriangle, CheckCircle } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';

/**
 * Saving-wallet announce dialog + unused-balance warning for the
 * contract-open payment step. See `savingAutoFill.ts` for the why.
 */

/** One-shot dialog: "this contract has X saved — we already applied Y of it". */
export function SavingAppliedDialog({
  open,
  onClose,
  savingBalance,
  applied,
}: {
  open: boolean;
  onClose: () => void;
  savingBalance: number;
  applied: number;
}) {
  const { t } = useTranslation();
  const leftover = savingBalance - applied;

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('wizard.savingAppliedTitle')}</h2>
      </div>
      <div className="modal-content">
        <div className="alert alert-info">
          <PiggyBank size={16} />
          <div className="flex flex-col gap-1 min-w-0">
            <div className="alert-title">
              {t('wizard.savingAppliedBalance', { amount: fmtCurrency(savingBalance) })}
            </div>
            <div className="alert-description">
              {t('wizard.savingAppliedBody', { amount: fmtCurrency(applied) })}
            </div>
            {leftover > 0.01 && (
              <div className="alert-description">
                {t('wizard.savingAppliedLeftover', { amount: fmtCurrency(leftover) })}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button color="primary" onClick={onClose} startIcon={<CheckCircle size={16} />}>
          {t('common.continue')}
        </Button>
      </div>
    </Modal>
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
