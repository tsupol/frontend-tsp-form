// Adjust a paid payout: money transferred on top, or money the shop sent back.
//
// The document's own numbers stay untouched — an adjustment is a separate row
// with its own date and reason, and the "really paid" figure is the document
// total plus the live adjustments. Nothing about ownership or status moves.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Input, InputDatePicker, MaskedInput, RadioGroup, Select, TextArea } from 'tsp-form';
import { Keyboard } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency, makeDatePickerFormat, parseLocalDate, toLocalDateStr } from '../../lib/format';
import { usePartnerPayoutInvalidate } from './usePartnerPayouts';
import type { PartnerPayoutDetail, PayoutAdjustDirection, PayoutAdjustResult } from './partnerPayoutTypes';

const MIN_REASON = 3;

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

interface PayoutAdjustModalProps {
  open: boolean;
  detail: PartnerPayoutDetail | null;
  onClose: () => void;
}

export function PayoutAdjustModal({ open, detail, onClose }: PayoutAdjustModalProps) {
  const { t, i18n } = useTranslation();
  const invalidate = usePartnerPayoutInvalidate();

  const today = toLocalDateStr(new Date());

  const [view, setView] = useState<'form' | 'done'>('form');
  const [direction, setDirection] = useState<PayoutAdjustDirection>('TO_BRANCH');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [paidDate, setPaidDate] = useState(today);
  const [typing, setTyping] = useState(false);
  const [settlementId, setSettlementId] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PayoutAdjustResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setDirection('TO_BRANCH');
    setAmount('');
    setReason('');
    setPaidDate(toLocalDateStr(new Date()));
    setTyping(false);
    setSettlementId('');
    setReference('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  const amountNum = Number(amount);
  const futureDate = !!paidDate && paidDate > today;
  const dirty = !!amount || !!reason.trim() || !!settlementId || !!reference.trim() || paidDate !== today;
  const canSubmit = amountNum > 0 && reason.trim().length >= MIN_REASON && !!paidDate && !futureDate;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const settlementOptions = (detail?.settlements ?? []).map(s => ({
    value: String(s.settlement_id),
    label: `${s.settlement_code} · ${s.contract_code}`,
  }));

  const handleAdjust = async () => {
    if (!detail || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<PayoutAdjustResult>('fn_partner_payout_adjust', {
        p_payout_id: detail.payout_id,
        p_direction: direction,
        p_amount: amountNum,
        p_reason: reason.trim(),
        p_paid_date: paidDate,
        p_settlement_id: settlementId ? Number(settlementId) : null,
        p_reference: reference.trim() || null,
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

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        maxWidth="32rem"
        width="100%"
        ariaLabel={t('partnerPayout.adjustAction')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerPayout.adjustAction')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{detail?.payout_code ?? ''}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {detail?.branch_name}
                  {detail && <> · {t('partnerPayout.adjustedNet')} {fmtCurrency(detail.adjusted_net)}</>}
                </div>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPayout.direction')}</label>
                  <RadioGroup
                    name="payout-adjust-direction"
                    value={direction}
                    onChange={v => setDirection(v as PayoutAdjustDirection)}
                    options={[
                      { value: 'TO_BRANCH', label: t('partnerPayout.direction_TO_BRANCH') },
                      { value: 'FROM_BRANCH', label: t('partnerPayout.direction_FROM_BRANCH') },
                    ]}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPayout.amount')}</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={2}
                    value={amount}
                    onChange={raw => setAmount(raw)}
                    className="w-full"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPayout.reasonRequired')}</label>
                  <TextArea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={2}
                    placeholder={t('partnerPayout.reasonPlaceholder')}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPayout.transferDate')}</label>
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
                  <label className="form-label">{t('partnerPayout.linkedSettlement')}</label>
                  <Select
                    options={settlementOptions}
                    value={settlementId || null}
                    onChange={v => setSettlementId((v as string) ?? '')}
                    placeholder={t('partnerPayout.linkedSettlementPlaceholder')}
                    clearable
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPayout.reference')}</label>
                  <Input
                    value={reference}
                    onChange={e => setReference(e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleAdjust} disabled={saving || !canSubmit}>
                {t('partnerPayout.adjustAction')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerPayout.adjustedHeadline')}
            contractCode={result.payout_code}
            detailRows={[
              { label: t('partnerPayout.direction'), value: t(`partnerPayout.direction_${result.direction}`) },
              { label: t('partnerPayout.amount'), value: fmtCurrency(result.amount) },
              { label: t('partnerPayout.adjustedNet'), value: fmtCurrency(result.adjusted_net), emphasis: true },
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
