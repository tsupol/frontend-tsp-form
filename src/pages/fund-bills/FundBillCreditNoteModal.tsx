// "ออกใบลดหนี้" — the only way to undo a document whose money already moved.
//
// This is not a status change. The original stays paid with its amounts intact
// and a new document is issued against it whose lines run the other way; the
// two together come to zero. The screen therefore never looks for a "reversed"
// status — it reads the flag on the original and says so in a banner.
//
// Everything the payment did comes back: the settlements reopen, the devices
// return to the shop at their old cost, and both money books go back to where
// they were. The one thing that does not come back is the finance tick — it has
// to be done again — which is why the success view says it.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Input, TextArea } from 'tsp-form';
import { Smartphone } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { useFundBillInvalidate } from './useFundBills';
import type { FundBill, FundBillCreditNoteResult } from './fundBillTypes';

interface FundBillCreditNoteModalProps {
  open: boolean;
  bill: FundBill | null;
  onClose: () => void;
}

export function FundBillCreditNoteModal({ open, bill, onClose }: FundBillCreditNoteModalProps) {
  const { t } = useTranslation();
  const invalidate = useFundBillInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FundBillCreditNoteResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setReasonCode('');
    setNote('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  const dirty = !!reasonCode.trim() || !!note.trim();
  const canSubmit = reasonCode.trim().length >= 3;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleSubmit = async () => {
    if (!bill || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<FundBillCreditNoteResult>('fn_fund_bill_credit_note', {
        p_bill_id: bill.bill_id,
        p_reason_code: reasonCode.trim(),
        p_note: note.trim() || null,
        p_bank_account_id: null,
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

  const devices = result?.devices ?? [];

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        maxWidth="32rem"
        width="100%"
        ariaLabel={t('fundBill.creditNoteAction')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundBill.creditNoteAction')}</h2>
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
                <span>{t('fundBill.creditNoteWarning')}</span>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('fundBill.creditNoteReasonRequired')}</label>
                  <Input
                    value={reasonCode}
                    onChange={e => setReasonCode(e.target.value)}
                    className="w-full"
                    placeholder={t('fundBill.creditNoteReasonPlaceholder')}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fundBill.note')}</label>
                  <TextArea value={note} onChange={e => setNote(e.target.value)} rows={2} />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={handleSubmit} disabled={saving || !canSubmit}>
                {t('fundBill.creditNoteAction')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('fundBill.creditNoteHeadline')}
            contractCode={result.credit_note_code}
            detailRows={[
              { label: t('fundBill.creditNoteOfBill'), value: result.bill_code },
              { label: t('fundBill.creditNoteReason'), value: result.reason_code },
              {
                label: t('fundBill.settlementsReopened'),
                value: String(result.released_settlements),
              },
              { label: t('fundBill.netAmount'), value: fmtCurrency(result.net_amount), emphasis: true },
            ]}
            extras={
              <div className="flex flex-col gap-3">
                <div className="alert alert-info">
                  <span>{t('fundBill.creditNoteRecheckHint')}</span>
                </div>
                {devices.length > 0 && (
                  <div className="rounded-md border border-line overflow-hidden">
                    <div className="px-3 py-2 bg-surface text-sm font-medium flex items-center gap-2">
                      <Smartphone size={14} className="text-subtle" />
                      {t('fundBill.devicesReturnedToShop', { count: devices.length })}
                    </div>
                    {devices.map(d => (
                      <div key={d.transfer_id} className="px-3 py-2 border-t border-line flex items-center justify-between text-sm">
                        <span className="text-subtle">#{d.asset_id}</span>
                        <span className="tabular-nums">{fmtCurrency(d.cost_basis)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            }
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
