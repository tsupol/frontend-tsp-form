// "บันทึกร้านโอนเงินซื้อคืน" — the shop has transferred the buyback money back.
//
// Recording it writes an adjustment row onto the payout that originally paid
// this settlement (145 §7), which is why the success view names that payout and
// offers a way to it: the money is not held here, it is a correction on a
// document that already exists.
//
// The date is the day the transfer really happened; the backend refuses a
// future one, so the button disables before the round trip.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Modal, Button, Input, InputDatePicker, Select, TextArea } from 'tsp-form';
import { ExternalLink, Info, Keyboard } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { FundDayClosedHint, FundPayErrorBand } from '../../components/FundDayPayGuard';
import { amendedDoneRows } from '../../lib/fundDayPay';
import { useFundPayAttempt } from '../../hooks/useFundPayAttempt';
import { fundPaySlipDoneRows, useFundPaySlip } from '../../hooks/useFundPaySlip';
import { FundPaySlipFailedNotice, FundPaySlipField } from '../../components/FundPaySlip';
import { DateTime } from '../../components/DateTime';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency, makeDatePickerFormat, parseLocalDate, toLocalDateStr } from '../../lib/format';
import { usePartnerReturnInvalidate } from './usePartnerReturns';
import { useFundSourceAccounts } from '../fund-bills/useFundBills';
import type {
  PartnerReturnActionsResponse,
  PartnerReturnDetail,
  ReturnBuybackPaidResult,
} from './partnerReturnTypes';

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

interface Props {
  open: boolean;
  detail: PartnerReturnDetail | null;
  actions: PartnerReturnActionsResponse | null;
  onClose: () => void;
}

export function ReturnBuybackPaidModal({ open, detail, actions, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const invalidate = usePartnerReturnInvalidate();

  const today = toLocalDateStr(new Date());

  const [view, setView] = useState<'form' | 'done'>('form');
  const [paidDate, setPaidDate] = useState(today);
  const [typing, setTyping] = useState(false);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  // Which fund account received the shop's transfer (mig 1281, optional). Left
  // blank, the row lands under "ไม่ระบุบัญชี" on the daily money summary (148).
  const [accountId, setAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const attempt = useFundPayAttempt();
  const slip = useFundPaySlip();
  const { reset: resetAttempt } = attempt;
  const { reset: resetSlip } = slip;
  const [result, setResult] = useState<ReturnBuybackPaidResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setPaidDate(toLocalDateStr(new Date()));
    setTyping(false);
    setReference('');
    setNote('');
    setAccountId('');
    setSaving(false);
    resetAttempt();
    resetSlip();
    setResult(null);
    setConfirmClose(false);
  }, [open, resetAttempt, resetSlip]);

  const dirty = paidDate !== today || !!reference.trim() || !!note.trim() || !!accountId || slip.files.length > 0;
  const futureDate = !!paidDate && paidDate > today;
  const canSubmit = !!paidDate && !futureDate;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const amount = (actions?.buyback_amount ?? 0) + (actions?.buyback_fee ?? 0);

  const accounts = useFundSourceAccounts(detail?.company_id ?? null);
  const accountOptions = accounts.map(a => ({
    value: String(a.id),
    label: `${a.bank_name} · ${a.account_number_display ?? a.account_number ?? ''}`,
  }));

  const handleSave = async (amend = false) => {
    if (!detail || !canSubmit) return;
    setSaving(true);
    attempt.setError(null);
    try {
      const res = await apiClient.rpc<ReturnBuybackPaidResult>('fn_partner_return_buyback_paid', {
        p_return_id: detail.return_id,
        p_paid_date: paidDate,
        p_reference: reference.trim() || null,
        p_note: note.trim() || null,
        p_bank_account_id: accountId ? Number(accountId) : null,
        ...attempt.amendParams(amend),
      });
      setResult(res);
      invalidate(detail.return_id);
      // The slip (the shop's transfer) goes on the buyback document's movement
      // the call names (null = nothing through a bank); a failure is reported
      // on the done view, never rolled back.
      await slip.attach(res.payment_id);
      setView('done');
    } catch (err) {
      attempt.fail(err, amend);
    } finally {
      setSaving(false);
    }
  };

  const billId = result?.buyback_bill_id ?? detail?.buyback_bill_id ?? null;

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        maxWidth="32rem"
        width="100%"
        ariaLabel={t('partnerReturn.action_BUYBACK_PAID')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerReturn.action_BUYBACK_PAID')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{detail?.return_code ?? ''}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {detail?.branch_name}
                  {detail?.device_code && <> · {detail.device_code}</>}
                </div>
                {amount > 0 && (
                  <div className="text-sm mt-1">
                    <span className="text-subtle">{t('partnerReturn.buybackTotal')}: </span>
                    <b className="tabular-nums">{fmtCurrency(amount)}</b>
                  </div>
                )}
              </div>

              <div className="alert alert-info mt-3">
                <Info size={16} className="shrink-0" />
                <span>
                  {t('partnerReturn.buybackPaidHint', {
                    code: detail?.paid_bill_code ?? '—',
                  })}
                </span>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerReturn.paidDateRequired')}</label>
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
                    <span className="text-xs text-danger-fg mt-1">{t('partnerReturn.paidDateFuture')}</span>
                  )}
                  {/* Steer away from a closed fund day before pressing (fund day close §B). */}
                  <FundDayClosedHint companyId={detail?.company_id} date={paidDate} enabled={open && !futureDate} />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('partnerReturn.reference')}</label>
                  <Input
                    value={reference}
                    onChange={e => setReference(e.target.value)}
                    className="w-full"
                    placeholder={t('partnerReturn.referencePlaceholder')}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('partnerReturn.bankAccount')}</label>
                  <Select
                    options={accountOptions}
                    value={accountId || null}
                    onChange={v => setAccountId((v as string) ?? '')}
                    placeholder={t('partnerReturn.bankAccountPlaceholder')}
                    clearable
                  />
                  <span className="text-xs text-subtle mt-1">{t('partnerReturn.bankAccountHint')}</span>
                </div>

                <FundPaySlipField
                  slip={slip}
                  disabled={saving}
                  onError={message => attempt.setError({ message, unclosedDate: null, closedDate: null })}
                />

                <div className="flex flex-col">
                  <label className="form-label">{t('partnerReturn.note')}</label>
                  <TextArea value={note} onChange={e => setNote(e.target.value)} rows={2} />
                </div>
              </div>
            </div>

            <FundPayErrorBand attempt={attempt} onAmend={() => { void handleSave(true); }} busy={saving} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={() => { void handleSave(); }} disabled={saving || !canSubmit}>
                {t('common.save')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerReturn.buybackPaidHeadline')}
            contractCode={result.return_code}
            detailRows={[
              {
                label: t('partnerReturn.paidDate'),
                value: <DateTime value={paidDate} showTime={false} />,
              },
              { label: t('partnerReturn.buybackDocument'), value: result.buyback_bill_code },
              ...(result.settles_bill_code
                ? [{ label: t('partnerReturn.payoutDocument'), value: result.settles_bill_code }]
                : []),
              { label: t('partnerReturn.buybackTotal'), value: fmtCurrency(result.amount), emphasis: true },
              ...amendedDoneRows(result.day_close_amended, t, i18n.language),
              ...fundPaySlipDoneRows(slip, t),
            ]}
            extras={slip.outcome?.kind === 'failed' ? <FundPaySlipFailedNotice slip={slip} /> : undefined}
            secondaryAction={billId != null ? {
              label: t('partnerReturn.openPayout'),
              endIcon: <ExternalLink size={14} />,
              onClick: () => { forceClose(); navigate(`/admin/fund-bills/${billId}`); },
            } : undefined}
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
