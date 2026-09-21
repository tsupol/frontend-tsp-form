// "เพิ่มส่วนลด / ส่วนเพิ่ม" — the only lines a person may add by hand.
//
// Everything else on a document comes from a settlement and is immutable; to
// change one of those you take the whole settlement off instead. These two are
// the escape hatch for a rounding difference or an agreed deduction, and the
// backend refuses one without a reason — so does this form, rather than letting
// a submit fail for something the screen could have said first.
//
// Only offered while the document is a draft; the evaluator stops offering the
// button the moment it is issued.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Input, MaskedInput, RadioGroup, TextArea } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { useFundBillInvalidate } from './useFundBills';
import type { FundBill, FundBillAddLineResult } from './fundBillTypes';

/** A discount takes money back off the shop; a surcharge adds to it. */
type ManualLineType = 'ADJUST_DISCOUNT' | 'ADJUST_SURCHARGE';

interface FundBillAddLineModalProps {
  open: boolean;
  bill: FundBill | null;
  onClose: () => void;
}

export function FundBillAddLineModal({ open, bill, onClose }: FundBillAddLineModalProps) {
  const { t } = useTranslation();
  const invalidate = useFundBillInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [lineType, setLineType] = useState<ManualLineType>('ADJUST_DISCOUNT');
  const [amount, setAmount] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FundBillAddLineResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setLineType('ADJUST_DISCOUNT');
    setAmount('');
    setReasonCode('');
    setNote('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  const amountValue = Number(amount);
  const dirty = !!amount || !!reasonCode.trim() || !!note.trim();
  const canSubmit = amountValue > 0 && reasonCode.trim().length >= 2;

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
      const res = await apiClient.rpc<FundBillAddLineResult>('fn_fund_bill_add_line', {
        p_bill_id: bill.bill_id,
        p_line_type: lineType,
        p_amount: amountValue,
        p_reason_code: reasonCode.trim(),
        p_note: note.trim() || null,
        p_contract_id: null,
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
        ariaLabel={t('fundBill.addLineAction')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundBill.addLineAction')}</h2>
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

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('fundBill.lineTypeLabel')}</label>
                  <RadioGroup
                    name="fund-bill-line-type"
                    value={lineType}
                    onChange={v => setLineType(v as ManualLineType)}
                    options={[
                      { value: 'ADJUST_DISCOUNT', label: t('fundBill.lineType_ADJUST_DISCOUNT') },
                      { value: 'ADJUST_SURCHARGE', label: t('fundBill.lineType_ADJUST_SURCHARGE') },
                    ]}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fundBill.amountRequired')}</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={2}
                    value={amount}
                    onChange={raw => setAmount(raw)}
                    className="w-full"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fundBill.manualReasonRequired')}</label>
                  <Input
                    value={reasonCode}
                    onChange={e => setReasonCode(e.target.value)}
                    className="w-full"
                    placeholder={t('fundBill.manualReasonPlaceholder')}
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
              <Button color="primary" onClick={handleSubmit} disabled={saving || !canSubmit}>
                {t('common.save')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('fundBill.lineAddedHeadline')}
            contractCode={bill?.bill_code ?? ''}
            detailRows={[
              { label: t('fundBill.lineTypeLabel'), value: t(`fundBill.lineType_${lineType}`) },
              { label: t('fundBill.amount'), value: fmtCurrency(amountValue) },
              { label: t('fundBill.manualReason'), value: reasonCode.trim() },
              { label: t('fundBill.netAmount'), value: fmtCurrency(result.net_amount), emphasis: true },
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
