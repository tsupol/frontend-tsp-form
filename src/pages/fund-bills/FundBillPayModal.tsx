// "บันทึกจ่ายเงิน" — recorded after the money has actually left the bank.
//
// One press writes both transfer rows: the shop's real transfer, and the fund
// company's own commission, which is recorded as paid without touching a bank
// account. The success view says both numbers, because someone reconciling a
// statement will only ever find the first one there.
//
// The date is the day of the real transfer, not today by necessity, and the
// backend refuses a future one. Source account and reference are optional
// because a transfer made outside the system may have neither on hand.
//
// The success view lists the devices that just became holding property: that
// is the part of this action nobody can undo casually, so it is shown rather
// than summarised.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Input, InputDatePicker, Select, TextArea } from 'tsp-form';
import { Keyboard, Smartphone } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { FundDayClosedHint, FundPayErrorBand } from '../../components/FundDayPayGuard';
import { amendedDoneRows } from '../../lib/fundDayPay';
import { useFundPayAttempt } from '../../hooks/useFundPayAttempt';
import { fundPaySlipDoneRows, useFundPaySlip } from '../../hooks/useFundPaySlip';
import { FundPaySlipFailedNotice, FundPaySlipField } from '../../components/FundPaySlip';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency, makeDatePickerFormat, parseLocalDate, toLocalDateStr } from '../../lib/format';
import { useFundBillInvalidate, useFundSourceAccounts } from './useFundBills';
import type { FundBill, FundBillPayResult } from './fundBillTypes';
import { fundBillShownTotal } from './fundBillTypes';

function parseTypedDate(raw: string): Date | null {
  if (raw.length !== 8) return null;
  const day = parseInt(raw.slice(0, 2), 10);
  const month = parseInt(raw.slice(2, 4), 10);
  let year = parseInt(raw.slice(4, 8), 10);
  if (year > 2400) year -= 543;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

interface FundBillPayModalProps {
  open: boolean;
  bill: FundBill | null;
  onClose: () => void;
}

export function FundBillPayModal({ open, bill, onClose }: FundBillPayModalProps) {
  const { t, i18n } = useTranslation();
  const invalidate = useFundBillInvalidate();
  const accounts = useFundSourceAccounts(bill?.company_id ?? null);

  const today = toLocalDateStr(new Date());

  const [view, setView] = useState<'form' | 'done'>('form');
  const [paidDate, setPaidDate] = useState(today);
  const [typing, setTyping] = useState(false);
  const [accountId, setAccountId] = useState<string>('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const attempt = useFundPayAttempt();
  const slip = useFundPaySlip();
  const { reset: resetAttempt } = attempt;
  const { reset: resetSlip } = slip;
  const [result, setResult] = useState<FundBillPayResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setPaidDate(toLocalDateStr(new Date()));
    setTyping(false);
    setAccountId('');
    setReference('');
    setNote('');
    setSaving(false);
    resetAttempt();
    resetSlip();
    setResult(null);
    setConfirmClose(false);
  }, [open, resetAttempt, resetSlip]);

  const dirty = paidDate !== today || !!accountId || !!reference.trim() || !!note.trim() || slip.files.length > 0;
  const futureDate = !!paidDate && paidDate > today;
  const canSubmit = !!paidDate && !futureDate;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const accountOptions = accounts.map(a => ({
    value: String(a.id),
    label: `${a.bank_name} · ${a.account_number_display ?? a.account_number ?? ''}`,
  }));

  const handlePay = async (amend = false) => {
    if (!bill || !canSubmit) return;
    setSaving(true);
    attempt.setError(null);
    try {
      const res = await apiClient.rpc<FundBillPayResult>('fn_fund_bill_pay', {
        p_bill_id: bill.bill_id,
        p_paid_date: paidDate,
        p_source_bank_account_id: accountId ? Number(accountId) : null,
        p_reference: reference.trim() || null,
        p_note: note.trim() || null,
        ...attempt.amendParams(amend),
      });
      setResult(res);
      invalidate(bill.bill_id);
      // The pay is recorded; the slip goes on the movement the pay named
      // (null = no bank transfer this time, so no slip step) and its failure
      // is reported on the done view, never rolled back.
      await slip.attach(res.payment_id);
      setView('done');
    } catch (err) {
      attempt.fail(err, amend);
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
        ariaLabel={t('fundBill.payAction')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundBill.payAction')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{bill?.bill_code ?? ''}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {bill?.branch_name}
                  {bill && <> · {fmtCurrency(fundBillShownTotal(bill))}</>}
                </div>
              </div>

              {/* The bank will only ever show the shop's transfer. Saying so here
               *  stops the company's own line being hunted for on a statement.
               *  A commission document has no company side, so the band would
               *  only confuse there. */}
              {bill?.bill_purpose !== 'COMMISSION_EXTRA' && (
                <div className="mt-3 alert alert-info">
                  <span>{t('fundBill.payTwoRowsHint')}</span>
                </div>
              )}

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('fundBill.paidDateRequired')}</label>
                  <InputDatePicker
                    value={parseLocalDate(paidDate)}
                    onChange={v => { setPaidDate(toLocalDateStr(v)); attempt.setError(null); }}
                    dateFormat={makeDatePickerFormat(i18n.language)}
                    locale={i18n.language}
                    calendar="gregorian"
                    typingMode={typing}
                    onTypingModeChange={setTyping}
                    typingMask="##/##/####"
                    typingPlaceholder="DD/MM/YYYY"
                    parseTypedDate={parseTypedDate}
                    endIcon={<Keyboard size={16} />}
                    onEndIconClick={() => setTyping(v => !v)}
                    error={futureDate}
                  />
                  {futureDate && (
                    <span className="text-xs text-danger-fg mt-1">{t('fundBill.paidDateFuture')}</span>
                  )}
                  {/* Steer away from a closed fund day before pressing (fund day close §B). */}
                  <FundDayClosedHint companyId={bill?.company_id} date={paidDate} enabled={open && !futureDate} />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fundBill.sourceAccount')}</label>
                  <Select
                    options={accountOptions}
                    value={accountId || null}
                    onChange={v => setAccountId((v as string) ?? '')}
                    placeholder={t('fundBill.sourceAccountPlaceholder')}
                    clearable
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fundBill.reference')}</label>
                  <Input
                    value={reference}
                    onChange={e => setReference(e.target.value)}
                    className="w-full"
                    placeholder={t('fundBill.referencePlaceholder')}
                  />
                </div>

                <FundPaySlipField
                  slip={slip}
                  disabled={saving}
                  onError={message => attempt.setError({ message, unclosedDate: null, closedDate: null })}
                />

                <div className="flex flex-col">
                  <label className="form-label">{t('fundBill.note')}</label>
                  <TextArea value={note} onChange={e => setNote(e.target.value)} rows={2} />
                </div>
              </div>
            </div>

            <FundPayErrorBand attempt={attempt} onAmend={() => { void handlePay(true); }} busy={saving} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={() => { void handlePay(); }} disabled={saving || !canSubmit}>
                {t('fundBill.payAction')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('fundBill.paidHeadline')}
            contractCode={result.bill_code}
            stateTransition={{
              from: t('fundBill.status_ISSUED'),
              to: t('fundBill.status_PAID'),
              toColor: 'success',
            }}
            detailRows={[
              { label: t('fundBill.paidDate'), value: <DateTime value={result.paid_date} showTime={false} /> },
              { label: t('fundBill.branchTransferred'), value: fmtCurrency(result.branch_net), emphasis: true },
              // A commission document carries no company share — its line would
              // only ever read ฿0.
              ...(bill?.bill_purpose !== 'COMMISSION_EXTRA'
                ? [{ label: t('fundBill.companyRecorded'), value: fmtCurrency(result.company_net) }]
                : []),
              ...(result.source_account_display
                ? [{ label: t('fundBill.sourceAccount'), value: result.source_account_display }]
                : []),
              ...(result.reference
                ? [{ label: t('fundBill.reference'), value: result.reference }]
                : []),
              ...amendedDoneRows(result.day_close_amended, t, i18n.language),
              ...fundPaySlipDoneRows(slip, t),
            ]}
            extras={devices.length > 0 || slip.outcome?.kind === 'failed' || bill?.bill_purpose === 'COMMISSION_EXTRA' ? (
              <div className="flex flex-col gap-3">
                <FundPaySlipFailedNotice slip={slip} />
                {bill?.bill_purpose === 'COMMISSION_EXTRA' && (
                  <div className="alert alert-info"><span>{t('shopCommission.paidTranchesHint')}</span></div>
                )}
                {devices.length > 0 && (
                <div className="rounded-md border border-line overflow-hidden">
                  <div className="px-3 py-2 bg-surface text-sm font-medium flex items-center gap-2">
                    <Smartphone size={14} className="text-subtle" />
                    {t('fundBill.devicesMovedToHolding', { count: devices.length })}
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
            ) : undefined}
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
