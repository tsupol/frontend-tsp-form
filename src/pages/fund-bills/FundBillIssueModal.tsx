// "ออกใบ" — a draft payout becomes ISSUED and its lines are frozen.
//
// Nothing moves money here; paying is the next button. The warning says the
// one thing that changes for the person: after this, a wrong line can no
// longer be fixed on this document — only cancelled and rebuilt.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { Banknote } from 'lucide-react';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { useFundBillInvalidate } from './useFundBills';
import type { FundBill, FundBillIssueResult } from './fundBillTypes';

interface FundBillIssueModalProps {
  open: boolean;
  bill: FundBill | null;
  onClose: () => void;
  /** The issued bill's next job is recording the payment; the done step offers it as the primary button. Called after this modal closes. */
  onPay?: () => void;
}

export function FundBillIssueModal({ open, bill, onClose, onPay }: FundBillIssueModalProps) {
  const { t } = useTranslation();
  const invalidate = useFundBillInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setNote('');
    setSaving(false);
    setError(null);
    setConfirmClose(false);
  }, [open]);

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (note.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleIssue = async () => {
    if (!bill) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient.rpc<FundBillIssueResult>('fn_fund_bill_issue', {
        p_bill_id: bill.bill_id,
        p_note: note.trim() || null,
      });
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
        ariaLabel={t('fundBill.action_ISSUE')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundBill.action_ISSUE')}</h2>
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
                <span>{t('fundBill.issueFreezesLines')}</span>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('fundBill.issueNote')}</label>
                  <TextArea value={note} onChange={e => setNote(e.target.value)} rows={2} />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button onClick={handleIssue} disabled={saving || !bill}>
                {t('fundBill.action_ISSUE')}
              </Button>
            </div>
          </>
        ) : (
          <ActionDoneView
            headline={t('fundBill.issuedHeadline')}
            contractCode={bill?.bill_code ?? ''}
            stateTransition={{
              from: t('fundBill.status_DRAFT'),
              to: t('fundBill.status_ISSUED'),
            }}
            detailRows={onPay ? undefined : [
              { label: t('fundBill.issuedNext'), value: t('fundBill.action_PAY') },
            ]}
            secondaryAction={onPay ? {
              label: t('fundBill.action_PAY'),
              startIcon: <Banknote size={16} />,
              isNextStep: true,
              onClick: () => { forceClose(); onPay(); },
            } : undefined}
            doneLabel={onPay ? t('common.later') : undefined}
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
