// "ตั้งเป้าเงินสด" — how much the fund wants sitting in its own accounts.
//
// The owner's routine (doc 155): each month the fund tops its accounts back up
// to the target, and takes out whatever is above it. The target belongs to the
// fund, not to any one account. Setting the same figure again changes nothing
// and writes no history (`changed: false`), which the done view says.
//
// Clearing the target is its own choice rather than an empty amount, so an
// amount left blank by accident can never remove it.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, LabeledCheckbox, MaskedInput, Modal, TextArea } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import type { CashTargetSetResult } from './useFundCash';

interface FundCashTargetModalProps {
  open: boolean;
  companyId: number | null;
  companyName: string;
  current: number | null;
  onClose: () => void;
}

export function FundCashTargetModal({ open, companyId, companyName, current, onClose }: FundCashTargetModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [amount, setAmount] = useState('');
  const [clear, setClear] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CashTargetSetResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setAmount(current != null ? String(current) : '');
    setClear(false);
    setReason('');
    setSaving(false);
    setError('');
    setResult(null);
    setConfirmClose(false);
    // `current` is read once per opening; a refetch underneath must not wipe typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const initialAmount = current != null ? String(current) : '';
  const dirty = clear || amount !== initialAmount || !!reason.trim();
  const amountValue = Number(amount);
  const canSubmit = clear ? current != null : amount !== '' && amountValue >= 0;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (saving) return;
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleSave = async () => {
    if (companyId == null || !canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiClient.rpc<CashTargetSetResult>('fn_fund_cash_target_set', {
        p_company_id: companyId,
        p_target: clear ? null : amountValue,
        p_reason: reason.trim() || null,
      });
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ['fund-book', 'cash-position'] });
      queryClient.invalidateQueries({ queryKey: ['fund-book', 'cash-target-log'] });
      setView('done');
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const money = (v: number | null) => (v == null ? t('fundCash.noTarget') : fmtCurrency(v));

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%" ariaLabel={t('fundCash.setTarget')}>
        <div className="modal-header">
          <h2 className="modal-title">{t('fundCash.setTarget')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'done' && result ? (
          <ActionDoneView
            headline={result.changed ? t('fundCash.targetSaved') : t('fundCash.targetUnchanged')}
            tone={result.changed ? 'success' : 'neutral'}
            contractCode={companyName}
            detailRows={[
              { label: t('fundCash.targetBefore'), value: money(result.before) },
              { label: t('fundCash.targetAfter'), value: money(result.after), emphasis: true },
              ...(reason.trim() ? [{ label: t('fundCash.reason'), value: reason.trim() }] : []),
            ]}
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{companyName}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {t('fundCash.currentTarget')}: {money(current)}
                </div>
              </div>
              <div className="mt-3 text-sm text-subtle">{t('fundCash.targetExplain')}</div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('fundCash.targetAmount')}</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={2}
                    value={clear ? '' : amount}
                    onChange={raw => { setAmount(raw); setError(''); }}
                    className="w-full"
                    disabled={clear}
                  />
                  {current != null && (
                    <div className="mt-2">
                      <LabeledCheckbox
                        label={t('fundCash.clearTarget')}
                        checked={clear}
                        onChange={e => setClear(e.target.checked)}
                      />
                    </div>
                  )}
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('fundCash.reason')}</label>
                  <TextArea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder={t('fundCash.reasonPlaceholder')} />
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={() => { void handleSave(); }} disabled={saving || !canSubmit}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%" ariaLabel={t('common.unsavedChanges')}>
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
