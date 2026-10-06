// "ถอดใบขอรับเงิน" — takes one request, and every line it brought, off the draft.
//
// The request goes back to the queue with its finance tick intact, so it can go
// straight onto another document without being checked again. Saying that here
// is the point of the modal: without it, taking a request off looks like it
// might undo the check.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency, formatEntityCode } from '../../lib/format';
import { useFundBillInvalidate } from './useFundBills';
import type { FundBillRemoveSettlementResult } from './fundBillTypes';

interface FundBillRemoveSettlementModalProps {
  open: boolean;
  billId: number | null;
  billCode: string;
  settlementId: number | null;
  settlementCode: string | null;
  contractCode: string | null;
  /** The payment request's own net, as the backend states it. */
  netAmount: number | null;
  onClose: () => void;
}

export function FundBillRemoveSettlementModal({
  open, billId, billCode, settlementId, settlementCode, contractCode, netAmount, onClose,
}: FundBillRemoveSettlementModalProps) {
  const { t } = useTranslation();
  const invalidate = useFundBillInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FundBillRemoveSettlementResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // The parent clears its selection as it closes, so hold the last values for
  // the duration of the close transition.
  const [shownCode, setShownCode] = useState<string | null>(settlementCode);
  useEffect(() => { if (settlementCode) setShownCode(settlementCode); }, [settlementCode]);

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

  const handleSubmit = async () => {
    if (billId == null || settlementId == null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<FundBillRemoveSettlementResult>('fn_fund_bill_remove_settlement', {
        p_bill_id: billId,
        p_settlement_id: settlementId,
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
        ariaLabel={t('fundBill.removeSettlement')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundBill.removeSettlement')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{shownCode ?? ''}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {billCode}
                  {contractCode && <> · {formatEntityCode(contractCode)}</>}
                  {' · '}{fmtCurrency(netAmount)}
                </div>
              </div>

              <div className="mt-3 alert alert-info">
                <span>{t('fundBill.removeKeepsCheck')}</span>
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
                {t('fundBill.removeSettlement')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('fundBill.settlementRemovedHeadline')}
            contractCode={shownCode ?? billCode}
            detailRows={[
              { label: t('fundBill.linesRemoved'), value: String(result.removed_lines) },
              { label: t('fundBill.contractsOnDocument'), value: String(result.contract_count) },
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
