// "จ่ายแล้ว" — recorded after the money has actually left the bank.
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
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency, makeDatePickerFormat, parseLocalDate, toLocalDateStr } from '../../lib/format';
import { usePartnerPayoutInvalidate, usePayoutSourceAccounts } from './usePartnerPayouts';
import type { PartnerPayoutDetail, PayoutPayResult } from './partnerPayoutTypes';

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

interface PayoutPayModalProps {
  open: boolean;
  detail: PartnerPayoutDetail | null;
  onClose: () => void;
}

export function PayoutPayModal({ open, detail, onClose }: PayoutPayModalProps) {
  const { t, i18n } = useTranslation();
  const invalidate = usePartnerPayoutInvalidate();
  const accounts = usePayoutSourceAccounts(detail?.company_id ?? null);

  const today = toLocalDateStr(new Date());

  const [view, setView] = useState<'form' | 'done'>('form');
  const [paidDate, setPaidDate] = useState(today);
  const [typing, setTyping] = useState(false);
  const [accountId, setAccountId] = useState<string>('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PayoutPayResult | null>(null);
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
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  const dirty = paidDate !== today || !!accountId || !!reference.trim() || !!note.trim();
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

  const handlePay = async () => {
    if (!detail || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<PayoutPayResult>('fn_partner_payout_pay', {
        p_payout_id: detail.payout_id,
        p_paid_date: paidDate,
        p_source_bank_account_id: accountId ? Number(accountId) : null,
        p_reference: reference.trim() || null,
        p_note: note.trim() || null,
      });
      setResult(res);
      setView('done');
      invalidate(detail.payout_id);
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
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
        ariaLabel={t('partnerPayout.payAction')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerPayout.payAction')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{detail?.payout_code ?? ''}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {detail?.branch_name}
                  {detail && <> · {fmtCurrency(detail.net_amount)}</>}
                </div>
                {detail?.payout_account_no && (
                  <div className="text-xs text-subtle mt-0.5">
                    {detail.payout_bank_code} · {detail.payout_account_no} · {detail.payout_account_name}
                  </div>
                )}
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPayout.paidDateRequired')}</label>
                  <InputDatePicker
                    value={parseLocalDate(paidDate)}
                    onChange={v => setPaidDate(toLocalDateStr(v))}
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
                    <span className="text-xs text-danger-fg mt-1">{t('partnerPayout.paidDateFuture')}</span>
                  )}
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPayout.sourceAccount')}</label>
                  <Select
                    options={accountOptions}
                    value={accountId || null}
                    onChange={v => setAccountId((v as string) ?? '')}
                    placeholder={t('partnerPayout.sourceAccountPlaceholder')}
                    clearable
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPayout.reference')}</label>
                  <Input
                    value={reference}
                    onChange={e => setReference(e.target.value)}
                    className="w-full"
                    placeholder={t('partnerPayout.referencePlaceholder')}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPayout.note')}</label>
                  <TextArea value={note} onChange={e => setNote(e.target.value)} rows={2} />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handlePay} disabled={saving || !canSubmit}>
                {t('partnerPayout.payAction')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerPayout.paidHeadline')}
            contractCode={result.payout_code}
            stateTransition={{
              from: t('partnerPayout.status_DRAFT'),
              to: t('partnerPayout.status_PAID'),
              toColor: 'success',
            }}
            detailRows={[
              { label: t('partnerPayout.paidDate'), value: result.paid_date },
              { label: t('partnerPayout.settlements'), value: String(result.settlement_count) },
              ...(result.source_account_display
                ? [{ label: t('partnerPayout.sourceAccount'), value: result.source_account_display }]
                : []),
              ...(result.reference
                ? [{ label: t('partnerPayout.reference'), value: result.reference }]
                : []),
              { label: t('partnerPayout.netAmount'), value: fmtCurrency(result.net_amount), emphasis: true },
            ]}
            extras={devices.length > 0 ? (
              <div className="rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface text-sm font-medium flex items-center gap-2">
                  <Smartphone size={14} className="text-subtle" />
                  {t('partnerPayout.devicesMovedToHolding', { count: devices.length })}
                </div>
                {devices.map(d => (
                  <div key={d.transfer_id} className="px-3 py-2 border-t border-line flex items-center justify-between text-sm">
                    <span className="text-subtle">#{d.asset_id}</span>
                    <span className="tabular-nums">{fmtCurrency(d.cost_basis)}</span>
                  </div>
                ))}
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
