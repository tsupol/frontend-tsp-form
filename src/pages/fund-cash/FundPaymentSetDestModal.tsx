// "แก้บัญชีปลายทาง" — say which of the SHOP's accounts a transfer really went
// to (mig 1579, fn_fund_payment_set_dest).
//
// For a transfer recorded against the shop's main account when the money in
// fact went to a PromptPay number (found from the bank's SMS or the slip).
// Only a bank transfer OUT to a shop can be corrected, only its destination
// changes — the amount, the date and the fund's own source account stay — and
// the reason is required: it goes into the document's history as
// PAYMENT_DEST_SET. A closed fund day does not matter here, because no money
// moves. Reversing the payment itself is still the credit note's job.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, TextArea } from 'tsp-form';
import { Landmark } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { bankAccountLabel } from '../../lib/bankAccount';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { BankAccountInline } from '../../components/BankAccountLine';
import {
  ShopPayoutDestField, useShopPayoutDestChoice, destAsAccount, destFromPrefixed, payoutDestErrorText,
  SHOP_PAYOUT_ACCOUNTS_KEY, type DestAccount,
} from '../../components/ShopPayoutDestField';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { useFundBillInvalidate } from '../fund-bills/useFundBills';

/** The slice of a payment row this window needs — `v_fund_bill_payments`
 *  carries it on the document, and the per-shop history on the payout tab. */
export interface FundPaymentDestTarget {
  payment_id: number;
  bill_code: string;
  /** The shop (`party_id` of a BRANCH row). */
  branch_id: number;
  paid_date: string;
  amount: number;
  dest_bank_code: string | null;
  dest_bank_name: string | null;
  dest_bank_name_en: string | null;
  dest_account_no: string | null;
  dest_account_number_display: string | null;
  dest_account_name: string | null;
}

interface SetDestResult {
  changed: boolean;
  payment_id: number;
  bill_id: number;
  bill_code: string;
  branch_id: number;
  branch_name: string;
  amount: number;
  paid_date: string;
  reason: string;
  from_dest: DestAccount | null;
  dest_account: DestAccount | null;
}

interface Props {
  open: boolean;
  payment: FundPaymentDestTarget | null;
  onClose: () => void;
}

export function FundPaymentSetDestModal({ open, payment: paymentProp, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const invalidateBills = useFundBillInvalidate();

  // Keep the row through the close transition (the host nulls it on close).
  const last = useRef(paymentProp);
  if (paymentProp) last.current = paymentProp;
  const payment = paymentProp ?? last.current;

  const dest = useShopPayoutDestChoice(open ? payment?.branch_id ?? null : null);
  const { reset: resetDest } = dest;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SetDestResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form'); setReason(''); setBusy(false); setError(''); setResult(null); setConfirmClose(false);
    resetDest();
  }, [open, paymentProp?.payment_id, resetDest]);

  const current = payment ? destFromPrefixed(payment as unknown as Record<string, unknown>, 'dest_') : null;
  const label = (d: DestAccount | null) => (d ? bankAccountLabel(destAsAccount(d), t, i18n.language) : '—');

  const dirty = dest.changed || !!reason.trim();
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'form' && dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (!payment || !dest.complete || !reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      // The main account is sent explicitly here: the RPC takes the three
      // fields, and "back to the main account" is a real correction.
      const picked = dest.isOther ? null : dest.selected;
      const res = await apiClient.rpc<SetDestResult>('fn_fund_payment_set_dest', {
        p_payment_id: payment.payment_id,
        ...(picked
          ? {
            p_dest_bank_code: picked.bank_code,
            p_dest_account_no: picked.account_no,
            p_dest_account_name: picked.account_name,
          }
          : dest.params()),
        p_reason: reason.trim(),
      });
      setResult(res);
      setView('done');
      invalidateBills(res.bill_id);
      queryClient.invalidateQueries({ queryKey: [...SHOP_PAYOUT_ACCOUNTS_KEY] });
      queryClient.invalidateQueries({ queryKey: ['partner-payout-history'] });
    } catch (err) {
      setError(payoutDestErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%" ariaLabel={t('fundPaymentDest.title')}>
        <div className="modal-header">
          <h2 className="modal-title">{t('fundPaymentDest.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'done' && result ? (
          <ActionDoneView
            headline={result.changed ? t('fundPaymentDest.done') : t('fundPaymentDest.unchanged')}
            contractCode={result.bill_code}
            detailRows={[
              { label: t('fundPaymentDest.from'), value: label(result.from_dest ?? current) },
              { label: t('fundPaymentDest.to'), value: label(result.dest_account), emphasis: true },
              { label: t('fundPaymentDest.reason'), value: result.reason },
            ]}
            extras={!result.changed
              ? <div className="alert alert-info"><span>{t('fundPaymentDest.unchangedHint')}</span></div>
              : undefined}
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content">
              {payment && (
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{payment.bill_code}</div>
                  <div className="text-xs text-subtle mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <DateTime value={payment.paid_date} showTime={false} />
                    <span className="tabular-nums">· {fmtCurrency(payment.amount)}</span>
                  </div>
                  <div className="text-xs text-subtle mt-1 inline-flex items-center gap-1 flex-wrap">
                    <Landmark size={12} />
                    {t('fundPaymentDest.now')}:
                    {current
                      ? <BankAccountInline account={destAsAccount(current)} />
                      : <span>—</span>}
                    {current?.account_name && <span>· {current.account_name}</span>}
                  </div>
                </div>
              )}
              <div className="form-grid mt-4">
                <ShopPayoutDestField choice={dest} label={t('fundPaymentDest.to')} disabled={busy} />
                <div className="flex flex-col">
                  <label className="form-label">{t('fundPaymentDest.reason')} *</label>
                  <TextArea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={2}
                    placeholder={t('fundPaymentDest.reasonPlaceholder')}
                    disabled={busy}
                  />
                </div>
              </div>
              <p className="text-xs text-subtle m-0 mt-3">{t('fundPaymentDest.hint')}</p>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={() => { void submit(); }} disabled={busy || !dest.complete || !reason.trim()}>
                {t('fundPaymentDest.submit')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%" ariaLabel={t('common.unsavedChanges')}>
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
