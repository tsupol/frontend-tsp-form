// Add one more waiting settlement to a draft payout.
//
// The picker offers only the same shop's candidates — a payout is one shop by
// rule — and only the ones the backend says are payable; the rest are shown
// with their reason so it is clear why they cannot be added rather than simply
// missing.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { usePayoutCandidates, usePartnerPayoutInvalidate } from './usePartnerPayouts';
import type { PayoutSettlementMoveResult } from './partnerPayoutTypes';

interface PayoutAddSettlementModalProps {
  open: boolean;
  payoutId: number | null;
  payoutCode: string;
  branchId: number | null;
  onClose: () => void;
}

export function PayoutAddSettlementModal({
  open, payoutId, payoutCode, branchId, onClose,
}: PayoutAddSettlementModalProps) {
  const { t } = useTranslation();
  const invalidate = usePartnerPayoutInvalidate();
  const candidates = usePayoutCandidates(open ? branchId : null);

  const [view, setView] = useState<'form' | 'done'>('form');
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PayoutSettlementMoveResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setSaving(null);
    setError(null);
    setResult(null);
  }, [open]);

  // Nothing is typed here, so there is nothing to lose on close.
  const handleClose = () => onClose();

  const handleAdd = async (settlementId: number) => {
    if (!payoutId) return;
    setSaving(settlementId);
    setError(null);
    try {
      const res = await apiClient.rpc<PayoutSettlementMoveResult>('fn_partner_payout_add_settlement', {
        p_payout_id: payoutId,
        p_settlement_id: settlementId,
      });
      setResult(res);
      setView('done');
      invalidate(payoutId);
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setSaving(null);
    }
  };

  const rows = candidates.rows;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      maxWidth="34rem"
      width="100%"
      ariaLabel={t('partnerPayout.addSettlement')}
    >
      <div className="modal-header">
        <h2 className="modal-title">{t('partnerPayout.addSettlement')}</h2>
        <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
      </div>

      {view === 'form' ? (
        <>
          <div className="modal-content">
            {rows.length === 0 ? (
              <div className="p-6 text-center text-subtler">{t('partnerPayout.candidatesEmpty')}</div>
            ) : (
              <div className="rounded-md border border-line overflow-hidden">
                {rows.map(r => (
                  <div
                    key={r.settlement_id}
                    className="px-3 py-2.5 border-b border-line last:border-b-0 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{r.settlement_code}</span>
                        <span className="flex-1" />
                        <span className="text-sm tabular-nums shrink-0">{fmtCurrency(r.net_amount)}</span>
                      </div>
                      <div className="text-sm mt-0.5 truncate">
                        {r.contract_code} · {r.customer_name ?? '—'}
                      </div>
                      <div className="text-xs text-subtle mt-0.5">
                        <DateTime value={r.close_submitted_at} showTime />
                      </div>
                      {!r.is_payable && r.payout_blocking_reason && (
                        <div className="text-xs text-warning-fg mt-1 inline-flex items-center gap-1">
                          <AlertTriangle size={13} className="shrink-0" />
                          {t(`partnerPayout.blocking_${r.payout_blocking_reason}`, {
                            defaultValue: r.payout_blocking_reason,
                          })}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!r.is_payable || saving != null}
                      onClick={() => handleAdd(r.settlement_id)}
                    >
                      {t('partnerPayout.add')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <ModalErrorBand message={error} onDismiss={() => setError(null)} />

          <div className="modal-footer">
            <Button variant="ghost" onClick={handleClose}>{t('common.close', { defaultValue: 'Close' })}</Button>
          </div>
        </>
      ) : result && (
        <ActionDoneView
          headline={t('partnerPayout.addedHeadline')}
          contractCode={payoutCode}
          detailRows={[
            { label: t('partnerPayout.settlementCode'), value: result.settlement_code },
            { label: t('partnerPayout.settlements'), value: String(result.settlement_count) },
            { label: t('partnerPayout.netAmount'), value: fmtCurrency(result.net_amount), emphasis: true },
          ]}
          onClose={handleClose}
        />
      )}
    </Modal>
  );
}
