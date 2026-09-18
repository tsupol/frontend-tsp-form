// Take one settlement back off a draft payout.
//
// The settlement returns to the waiting queue and keeps its "checked" tick, so
// putting it back on a later draft needs no re-checking.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { usePartnerPayoutInvalidate } from './usePartnerPayouts';
import type {
  PayoutSettlementMoveResult,
  PayoutSettlementRow,
} from './partnerPayoutTypes';

interface PayoutRemoveSettlementModalProps {
  open: boolean;
  payoutId: number | null;
  payoutCode: string;
  settlement: PayoutSettlementRow | null;
  onClose: () => void;
}

export function PayoutRemoveSettlementModal({
  open, payoutId, payoutCode, settlement, onClose,
}: PayoutRemoveSettlementModalProps) {
  const { t } = useTranslation();
  const invalidate = usePartnerPayoutInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PayoutSettlementMoveResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

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

  const handleRemove = async () => {
    if (!payoutId || !settlement) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<PayoutSettlementMoveResult>('fn_partner_payout_remove_settlement', {
        p_payout_id: payoutId,
        p_settlement_id: settlement.settlement_id,
        p_note: note.trim() || null,
      });
      setResult(res);
      setView('done');
      invalidate(payoutId);
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
        ariaLabel={t('partnerPayout.removeSettlement')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerPayout.removeSettlement')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{settlement?.settlement_code ?? ''}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {settlement?.contract_code} · {settlement?.customer_name ?? '—'}
                  {settlement && <> · {fmtCurrency(settlement.net_amount)}</>}
                </div>
              </div>

              <div className="alert alert-info mt-3">
                <span>{t('partnerPayout.removeSettlementHint')}</span>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPayout.note')}</label>
                  <TextArea value={note} onChange={e => setNote(e.target.value)} rows={2} />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={handleRemove} disabled={saving}>
                {t('partnerPayout.removeSettlement')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerPayout.removedHeadline')}
            contractCode={payoutCode}
            tone="warning"
            detailRows={[
              { label: t('partnerPayout.settlementCode'), value: result.settlement_code },
              { label: t('partnerPayout.settlements'), value: String(result.settlement_count) },
              { label: t('partnerPayout.netAmount'), value: fmtCurrency(result.net_amount), emphasis: true },
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
