// "ถอดบรรทัดแก้มือ" — removes one hand-entered discount or surcharge.
//
// Only a hand-entered line can go: a line that came from a settlement is part
// of what the shop asked for, and removing it would make the document disagree
// with the request behind it. To drop one of those you take the whole
// settlement off instead, which is a different button on a different row.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { useFundBillInvalidate } from './useFundBills';
import type { FundBillLine, FundBillRemoveLineResult } from './fundBillTypes';

interface FundBillRemoveLineModalProps {
  open: boolean;
  billId: number | null;
  billCode: string;
  line: FundBillLine | null;
  onClose: () => void;
}

export function FundBillRemoveLineModal({
  open, billId, billCode, line, onClose,
}: FundBillRemoveLineModalProps) {
  const { t, i18n } = useTranslation();
  const invalidate = useFundBillInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FundBillRemoveLineResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // The parent clears its selection as it closes, so the body has to keep
  // rendering the last line through the close transition or the panel
  // collapses mid-animation.
  const [shown, setShown] = useState<FundBillLine | null>(line);
  useEffect(() => { if (line) setShown(line); }, [line]);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setNote('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (note.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const lineLabel = shown
    ? (i18n.language === 'th' && shown.line_type_name
      ? shown.line_type_name
      : t(`fundBill.lineType_${shown.line_type}`, { defaultValue: shown.line_type }))
    : '';

  const handleSubmit = async () => {
    if (billId == null || !shown) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<FundBillRemoveLineResult>('fn_fund_bill_remove_line', {
        p_bill_id: billId,
        p_line_id: shown.line_id,
        p_note: note.trim() || null,
      });
      setResult(res);
      setView('done');
      invalidate(billId);
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
        maxWidth="28rem"
        width="100%"
        ariaLabel={t('fundBill.removeLineAction')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundBill.removeLineAction')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{billCode}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {lineLabel}
                  {shown && <> · {fmtCurrency(shown.amount)}</>}
                </div>
                {shown?.reason_code && (
                  <div className="text-xs text-subtle mt-0.5">{shown.reason_code}</div>
                )}
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('fundBill.note')}</label>
                  <TextArea value={note} onChange={e => setNote(e.target.value)} rows={2} />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={handleSubmit} disabled={saving}>
                {t('fundBill.removeLineAction')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('fundBill.lineRemovedHeadline')}
            contractCode={billCode}
            detailRows={[
              { label: t('fundBill.lineTypeLabel'), value: lineLabel },
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
