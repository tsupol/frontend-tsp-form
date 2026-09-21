// "ใส่ใบขอรับเงิน" — puts another of this shop's waiting requests on the draft.
//
// The list is the same queue the build page reads, narrowed to this shop: the
// backend enforces one shop per document, so offering another shop's request
// here would only produce a rejection. Rows already on this document are gone
// from the queue by definition, so nothing needs filtering out by hand.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, LabeledCheckbox } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency, formatEntityCode } from '../../lib/format';
import { useFundBillCandidates, useFundBillInvalidate } from './useFundBills';
import type { FundBillAddSettlementResult } from './fundBillTypes';

interface FundBillAddSettlementModalProps {
  open: boolean;
  billId: number | null;
  billCode: string;
  branchId: number | null;
  onClose: () => void;
}

export function FundBillAddSettlementModal({
  open, billId, billCode, branchId, onClose,
}: FundBillAddSettlementModalProps) {
  const { t } = useTranslation();
  const invalidate = useFundBillInvalidate();
  const candidates = useFundBillCandidates(open ? branchId : null);

  const [view, setView] = useState<'form' | 'done'>('form');
  const [picked, setPicked] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FundBillAddSettlementResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setPicked([]);
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (picked.length > 0) { setConfirmClose(true); return; }
    forceClose();
  };

  const toggle = (id: number) =>
    setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const pickedTotal = candidates.rows
    .filter(r => picked.includes(r.settlement_id))
    .reduce((sum, r) => sum + (r.net_amount ?? 0), 0);

  /**
   * One call per request — the RPC takes a single settlement.
   *
   * Stopping at the first failure leaves the earlier ones on the document,
   * which is right: each call is its own complete write, and silently undoing
   * them would be a second guess about what the person wanted.
   */
  const handleSubmit = async () => {
    if (billId == null || picked.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      let last: FundBillAddSettlementResult | null = null;
      for (const settlementId of picked) {
        last = await apiClient.rpc<FundBillAddSettlementResult>('fn_fund_bill_add_settlement', {
          p_bill_id: billId,
          p_settlement_id: settlementId,
        });
      }
      setResult(last);
      setView('done');
      invalidate(billId);
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
      invalidate(billId);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        maxWidth="34rem"
        width="100%"
        ariaLabel={t('fundBill.addSettlement')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundBill.addSettlement')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content min-w-0">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{billCode}</div>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                {candidates.isLoading && (
                  <div className="p-6 text-center text-subtler text-sm">
                    {t('common.loading', { defaultValue: 'Loading…' })}
                  </div>
                )}
                {!candidates.isLoading && candidates.rows.length === 0 && (
                  <div className="p-6 text-center text-subtler text-sm">
                    {t('fundBill.noCandidatesForShop')}
                  </div>
                )}
                {candidates.rows.map(row => (
                  <div
                    key={row.settlement_id}
                    className="rounded-md border border-line px-3 py-2.5 min-w-0"
                  >
                    <LabeledCheckbox
                      checked={picked.includes(row.settlement_id)}
                      onChange={() => toggle(row.settlement_id)}
                      label={
                        <>
                          <span className="font-medium">{row.settlement_code}</span>
                          <span className="block text-subtle text-small">
                            {formatEntityCode(row.contract_code)} · {fmtCurrency(row.net_amount)}
                          </span>
                          {row.finance_checked_at && (
                            <span className="block text-subtler text-small">
                              {t('fundBill.checkedAt')}:{' '}
                              <DateTime value={row.finance_checked_at} showTime={false} />
                            </span>
                          )}
                        </>
                      }
                    />
                  </div>
                ))}
              </div>

              {picked.length > 0 && (
                <div className="mt-3 px-3 py-2 rounded-md bg-surface border border-line flex items-center">
                  <span className="text-sm text-subtle">
                    {t('fundBill.pickedCount', { count: picked.length })}
                  </span>
                  <span className="flex-1" />
                  <span className="text-sm font-medium tabular-nums">{fmtCurrency(pickedTotal)}</span>
                </div>
              )}
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleSubmit} disabled={saving || picked.length === 0}>
                {t('common.save')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('fundBill.settlementsAddedHeadline')}
            contractCode={billCode}
            detailRows={[
              { label: t('fundBill.addedCount'), value: String(picked.length) },
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
