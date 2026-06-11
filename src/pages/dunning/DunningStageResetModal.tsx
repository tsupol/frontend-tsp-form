// "Reset to default" confirm modal for one dunning stage. Resetting drops the
// holding override and falls back to the system template default. The action
// itself has no further input — it's a single confirm-and-go.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from 'tsp-form';
import { XCircle, RotateCcw } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { useDunningStages } from './useDunningStages';
import type { DunningModule, DunningStageRow } from './dunningTypes';

interface Props {
  open: boolean;
  onClose: () => void;
  module: DunningModule;
  row: DunningStageRow | null;
}

function describeApiError(
  err: unknown,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  if (err instanceof ApiError) {
    const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
    return translated || err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function DunningStageResetModal({ open, onClose, module, row }: Props) {
  const { t } = useTranslation();
  const { reset } = useDunningStages(module);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open) setErrorMessage('');
  }, [open]);

  const handleConfirm = async () => {
    if (!row) return;
    setErrorMessage('');
    try {
      await reset.mutateAsync(row.stage);
      onClose();
    } catch (err) {
      setErrorMessage(describeApiError(err, t));
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('dunningSystem.resetTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {errorMessage && (
          <div className="alert alert-danger mb-4">
            <XCircle size={16} />
            <span>{errorMessage}</span>
          </div>
        )}
        <p className="text-sm">{t('dunningSystem.resetBody', { stage: row?.stage ?? '' })}</p>
        {row && (
          <div className="mt-3 text-xs bg-surface border border-line rounded-md p-3 space-y-1">
            <div className="flex justify-between"><span className="text-subtle">{t('dunningSystem.fieldDayFrom')}</span><span className="tabular-nums">{row.template.day_from}</span></div>
            <div className="flex justify-between"><span className="text-subtle">{t('dunningSystem.fieldDayTo')}</span><span className="tabular-nums">{row.template.day_to == null ? '∞' : row.template.day_to}</span></div>
            <div className="flex justify-between"><span className="text-subtle">{t('dunningSystem.fieldPriority')}</span><span className="tabular-nums">{row.template.priority}</span></div>
            <div className="flex justify-between"><span className="text-subtle">{t('dunningSystem.fieldActive')}</span><span>{row.template.active ? t('dunningSystem.active') : t('dunningSystem.inactive')}</span></div>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={handleConfirm} disabled={reset.isPending} startIcon={<RotateCcw size={14} />}>
          {reset.isPending ? t('common.loading') : t('dunningSystem.resetConfirm')}
        </Button>
      </div>
    </Modal>
  );
}
