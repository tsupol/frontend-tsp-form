// Record that a clawback has been paid back.
//
// The money comes from whoever was liable — the shop, or the fund company out of
// its own book. Either way the fund's capital goes back up, so this is a normal
// receipt: the date is when the money actually arrived and the backend refuses a
// future one.
//
// The whole amount comes back at once. There is no partial collection in this
// flow, so there is no amount field to get wrong.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Input, InputDatePicker, RadioGroup, Select, TextArea } from 'tsp-form';
import { Keyboard } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { FundDayClosedHint, FundPayErrorBand } from '../../components/FundDayPayGuard';
import { amendedDoneRows } from '../../lib/fundDayPay';
import { useFundPayAttempt } from '../../hooks/useFundPayAttempt';
import { fundPaySlipDoneRows, useFundPaySlip } from '../../hooks/useFundPaySlip';
import { FundPaySlipFailedNotice, FundPaySlipField } from '../../components/FundPaySlip';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency, makeDatePickerFormat, parseLocalDate, toLocalDateStr } from '../../lib/format';
import { useFundSourceAccounts } from '../fund-bills/useFundBills';
import { useFundClawbackInvalidate } from './useFundClawback';
import type { FundClawbackCollectResult } from './fundClawbackTypes';
import type { FundBill } from '../fund-bills/fundBillTypes';
import { fundBillShownTotal } from '../fund-bills/fundBillTypes';

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

interface FundClawbackCollectModalProps {
  open: boolean;
  bill: FundBill | null;
  onClose: () => void;
}

export function FundClawbackCollectModal({ open, bill, onClose }: FundClawbackCollectModalProps) {
  const { t, i18n } = useTranslation();
  const invalidate = useFundClawbackInvalidate();
  const accounts = useFundSourceAccounts(open ? (bill?.company_id ?? null) : null);

  const today = toLocalDateStr(new Date());

  const [view, setView] = useState<'form' | 'done'>('form');
  const [paidDate, setPaidDate] = useState(today);
  const [typing, setTyping] = useState(false);
  const [method, setMethod] = useState('TRANSFER');
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const attempt = useFundPayAttempt();
  const slip = useFundPaySlip();
  const { reset: resetAttempt } = attempt;
  const { reset: resetSlip } = slip;
  const [result, setResult] = useState<FundClawbackCollectResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // Hold the last document through the close transition.
  const [shown, setShown] = useState<FundBill | null>(bill);
  useEffect(() => { if (bill) setShown(bill); }, [bill]);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setPaidDate(toLocalDateStr(new Date()));
    setTyping(false);
    setMethod('TRANSFER');
    setAccountId('');
    setReference('');
    setNote('');
    setSaving(false);
    resetAttempt();
    resetSlip();
    setResult(null);
    setConfirmClose(false);
  }, [open, resetAttempt, resetSlip]);

  const futureDate = !!paidDate && paidDate > today;
  const dirty = paidDate !== today || !!accountId || !!reference.trim() || !!note.trim() || slip.files.length > 0;
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

  const handleSubmit = async (amend = false) => {
    if (!shown || !canSubmit) return;
    setSaving(true);
    attempt.setError(null);
    try {
      const res = await apiClient.rpc<FundClawbackCollectResult>('fn_fund_clawback_collect', {
        p_bill_id: shown.bill_id,
        p_paid_date: paidDate,
        p_method: method,
        p_bank_account_id: accountId ? Number(accountId) : null,
        p_reference: reference.trim() || null,
        p_note: note.trim() || null,
        ...attempt.amendParams(amend),
      });
      setResult(res);
      invalidate();
      // The slip goes on the movement the call names (the fund book's row when
      // the clawback split across two books; null = nothing through a bank);
      // a failure is reported on the done view, never rolled back.
      await slip.attach(res.payment_id);
      setView('done');
    } catch (err) {
      attempt.fail(err, amend);
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
        ariaLabel={t('fundClawback.collectAction')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundClawback.collectAction')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{shown?.bill_code ?? ''}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {shown?.branch_name ?? shown?.company_name}
                  {shown && <> · {fmtCurrency(fundBillShownTotal(shown))}</>}
                </div>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('fundClawback.receivedOnRequired')}</label>
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
                    <span className="text-xs text-danger-fg mt-1">{t('fundClawback.dateFuture')}</span>
                  )}
                  {/* Steer away from a closed fund day before pressing (fund day close §B). */}
                  <FundDayClosedHint companyId={bill?.company_id} date={paidDate} enabled={open && !futureDate} />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fundClawback.method')}</label>
                  <RadioGroup
                    name="fund-clawback-method"
                    value={method}
                    onChange={v => setMethod(v as string)}
                    options={[
                      { value: 'TRANSFER', label: t('fundClawback.method_TRANSFER') },
                      { value: 'CASH', label: t('fundClawback.method_CASH') },
                    ]}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fundClawback.bankAccount')}</label>
                  <Select
                    options={accountOptions}
                    value={accountId || null}
                    onChange={v => setAccountId((v as string) ?? '')}
                    placeholder={t('fundClawback.bankAccountPlaceholder')}
                    clearable
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fundClawback.reference')}</label>
                  <Input
                    value={reference}
                    onChange={e => setReference(e.target.value)}
                    className="w-full"
                  />
                </div>

                <FundPaySlipField
                  slip={slip}
                  disabled={saving}
                  onError={message => attempt.setError({ message, unclosedDate: null, closedDate: null })}
                />

                <div className="flex flex-col">
                  <label className="form-label">{t('fundClawback.note')}</label>
                  <TextArea value={note} onChange={e => setNote(e.target.value)} rows={2} />
                </div>
              </div>
            </div>

            <FundPayErrorBand attempt={attempt} onAmend={() => { void handleSubmit(true); }} busy={saving} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={() => { void handleSubmit(); }} disabled={saving || !canSubmit}>
                {t('fundClawback.collectAction')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('fundClawback.collectedHeadline')}
            contractCode={result.bill_code}
            detailRows={[
              { label: t('fundClawback.receivedOn'), value: <DateTime value={result.paid_date} showTime={false} /> },
              { label: t('fundClawback.amount'), value: fmtCurrency(result.amount), emphasis: true },
              ...amendedDoneRows(result.day_close_amended, t, i18n.language),
              ...fundPaySlipDoneRows(slip, t),
            ]}
            extras={slip.outcome?.kind === 'failed' ? <FundPaySlipFailedNotice slip={slip} /> : undefined}
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
