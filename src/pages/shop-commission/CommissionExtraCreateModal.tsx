// Bundle one shop's released commission tranches into a commission document
// (fn_fund_bill_commission_extra_create, mig 1401). The document comes out as a
// DRAFT and from there follows the ordinary fund-bill path: issue, pay, void,
// credit note.
//
// "Nothing ready" is not a failure: the backend answers COMMISSION_EXTRA_EMPTY
// with what is still waiting, and that is shown as the answer, in amber.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, TextArea } from 'tsp-form';
import { FileText } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency } from '../../lib/format';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { useFundBillInvalidate } from '../fund-bills/useFundBills';
import type { CommissionExtraQueueRow } from './useShopCommission';
import { waitingSummary } from './shopCommissionTypes';

interface CreateResult {
  bill_id: number;
  bill_code: string;
  status: string;
  line_count: number;
  contract_count: number;
  net_amount: number;
  skipped: { wait_day_close: number; wait_day_end?: number; wait_hold: number; in_bill: number } | null;
}

interface Props {
  open: boolean;
  shop: CommissionExtraQueueRow | null;
  onClose: () => void;
  onOpenBill: (billId: number) => void;
}

export function CommissionExtraCreateModal({ open, shop: shopProp, onClose, onOpenBill }: Props) {
  const { t } = useTranslation();
  const invalidate = useFundBillInvalidate();

  // The parent clears the shop on close; keep the last one through the exit.
  const lastShop = useRef(shopProp);
  if (shopProp) lastShop.current = shopProp;
  const shop = shopProp ?? lastShop.current;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) {
      setView('form');
      setNote('');
      setError(null);
      setWarning(null);
      setResult(null);
    }
  }, [open, shopProp?.branch_id]);

  const handleCreate = async () => {
    if (!shop) return;
    setSaving(true);
    setError(null);
    setWarning(null);
    try {
      const res = await apiClient.rpc<CreateResult>('fn_fund_bill_commission_extra_create', {
        p_branch_id: shop.branch_id,
        ...(note.trim() ? { p_note: note.trim() } : {}),
      });
      setResult(res);
      setView('done');
      invalidate(res.bill_id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'FUND.VALIDATION.COMMISSION_EXTRA_EMPTY') {
        const p = err.messageParams ?? {};
        setWarning(t('shopCommission.extraEmpty', { parts: waitingSummary(p, t) }));
        // The queue was behind the backend — refresh it so the row says so too.
        invalidate();
      } else {
        setError(translateApiError(err, t));
      }
    } finally {
      setSaving(false);
    }
  };

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done' || saving) { if (!saving) forceClose(); return; }
    if (note.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  // Nothing ready: say what the steps are waiting for and keep the button off,
  // instead of letting a click round-trip to the backend's EMPTY answer.
  const nothingReady = (shop?.ready_count ?? 0) === 0;
  const waitingLine = shop && nothingReady
    ? t('shopCommission.extraEmpty', {
        parts: waitingSummary({
          wait_day_close: shop.wait_day_close_count,
          wait_day_end: shop.wait_day_end_count,
          wait_hold: shop.wait_hold_count,
        }, t),
      })
    : null;

  const skipped = result?.skipped;
  const skippedTotal = skipped ? skipped.wait_day_close + (skipped.wait_day_end ?? 0) + skipped.wait_hold + skipped.in_bill : 0;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('shopCommission.extraCreateTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="form-grid">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{shop?.branch_name ?? '—'}</div>
                  <div className="text-xs text-subtle">
                    {waitingLine ?? (
                      <>
                        {t('shopCommission.queueReady', { count: shop?.ready_count ?? 0 })}
                        {' · '}{fmtCurrency(shop?.ready_amount ?? 0)}
                      </>
                    )}
                  </div>
                </div>
                <p className="text-sm text-subtle -mt-2">{t('shopCommission.extraCreateHint')}</p>
                <div className="flex flex-col">
                  <label className="form-label">{t('fundBill.note')}</label>
                  <TextArea rows={2} value={note} onChange={e => setNote(e.target.value)} />
                </div>
              </div>
            </div>
            <ModalErrorBand message={warning} variant="warning" onDismiss={() => setWarning(null)} />
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleCreate} disabled={saving || !shop || nothingReady}>
                {t('shopCommission.extraCreateAction')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('shopCommission.extraCreatedHeadline')}
            contractCode={result.bill_code}
            detailRows={[
              { label: t('shopCommission.trancheCount'), value: String(result.line_count) },
              { label: t('shopCommission.contracts'), value: String(result.contract_count) },
              { label: t('fundBill.netAmount'), value: fmtCurrency(result.net_amount), emphasis: true },
              ...(skipped && skippedTotal > 0
                ? [{
                    label: t('shopCommission.nextRound'),
                    value: t('shopCommission.skippedSummary', { parts: waitingSummary(skipped, t) }),
                  }]
                : []),
            ]}
            extras={<p className="text-sm text-subtle">{t('shopCommission.extraCreatedNext')}</p>}
            secondaryAction={{
              label: t('shopCommission.goToDraft'),
              startIcon: <FileText size={16} />,
              isNextStep: true,
              onClick: () => { const id = result.bill_id; forceClose(); onOpenBill(id); },
            }}
            doneLabel={t('common.later')}
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
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
