// "ยกเลิกใบ" — only before any money has moved.
//
// Once a transfer row exists the backend refuses this and points at the credit
// note instead, so the evaluator normally hides the button by then. The reason
// is mandatory: a cancelled document stays on the list forever and the next
// person reading it has only this line to go on.
//
// Settlements on the document go back to the queue with their finance tick
// intact — that is the part worth saying on the success view, because it is
// what the person has to do next.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { useFundBillInvalidate } from './useFundBills';
import type { FundBill, FundBillVoidResult } from './fundBillTypes';

interface FundBillVoidModalProps {
  open: boolean;
  bill: FundBill | null;
  onClose: () => void;
}

export function FundBillVoidModal({ open, bill, onClose }: FundBillVoidModalProps) {
  const { t } = useTranslation();
  const invalidate = useFundBillInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FundBillVoidResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setReason('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  const canSubmit = reason.trim().length >= 3;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (reason.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleVoid = async () => {
    if (!bill || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<FundBillVoidResult>('fn_fund_bill_void', {
        p_bill_id: bill.bill_id,
        p_reason: reason.trim(),
      });
      setResult(res);
      setView('done');
      invalidate(bill.bill_id);
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        maxWidth="30rem"
        width="100%"
        ariaLabel={t('fundBill.voidAction')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundBill.voidAction')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{bill?.bill_code ?? ''}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {bill?.branch_name}
                  {bill && <> · {fmtCurrency(bill.net_amount)}</>}
                </div>
              </div>

              <div className="mt-3 alert alert-warning">
                <span>{t('fundBill.voidReleasesSettlements')}</span>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('fundBill.voidReasonRequired')}</label>
                  <TextArea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={3}
                    placeholder={t('fundBill.voidReasonPlaceholder')}
                  />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={handleVoid} disabled={saving || !canSubmit}>
                {t('fundBill.voidAction')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('fundBill.voidedHeadline')}
            contractCode={bill?.bill_code ?? ''}
            stateTransition={{
              from: t('fundBill.status_DRAFT'),
              to: t('fundBill.status_VOIDED'),
              toColor: 'default',
            }}
            detailRows={[
              { label: t('fundBill.voidReason'), value: reason.trim() },
            ]}
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        maxWidth="24rem"
        width="100%"
        ariaLabel={t('common.unsavedChanges')}
      >
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
