// Reverse a paid payout, whole.
//
// There is no per-contract undo: one wrong contract out of five means the whole
// document is reversed and a new one issued for the other four. The system
// treats the money as returned the moment this is pressed — the actual refund
// is settled between people, outside the app — so it asks for confirmation
// before it happens.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Select, TextArea } from 'tsp-form';
import { AlertTriangle, Smartphone } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { usePartnerPayoutInvalidate, usePayoutReverseReasons, usePayoutSourceAccounts } from './usePartnerPayouts';
import type { PartnerPayoutDetail, PayoutReverseResult } from './partnerPayoutTypes';

const MIN_NOTE = 3;

interface PayoutReverseModalProps {
  open: boolean;
  detail: PartnerPayoutDetail | null;
  onClose: () => void;
}

export function PayoutReverseModal({ open, detail, onClose }: PayoutReverseModalProps) {
  const { t, i18n } = useTranslation();
  const invalidate = usePartnerPayoutInvalidate();
  const reasons = usePayoutReverseReasons();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  // Which fund account the money came back into (mig 1281, optional). Left blank,
  // the row lands under "ไม่ระบุบัญชี" on the daily money summary (148).
  const [accountId, setAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PayoutReverseResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setReasonCode('');
    setNote('');
    setAccountId('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
    setConfirmSend(false);
  }, [open]);

  const accounts = usePayoutSourceAccounts(detail?.company_id ?? null);
  const accountOptions = accounts.map(a => ({
    value: String(a.id),
    label: `${a.bank_name} · ${a.account_number_display ?? a.account_number ?? ''}`,
  }));

  const reasonOptions = reasons.map(r => ({
    value: r.code,
    label: i18n.language === 'th' ? r.name_th : r.name_en,
  }));
  const chosen = reasons.find(r => r.code === reasonCode);
  const noteRequired = !!chosen?.requires_note;
  const canSubmit = !!reasonCode && (!noteRequired || note.trim().length >= MIN_NOTE);

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (reasonCode || note.trim() || accountId) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleReverse = async () => {
    if (!detail || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<PayoutReverseResult>('fn_partner_payout_reverse', {
        p_payout_id: detail.payout_id,
        p_reason_code: reasonCode,
        p_note: note.trim() || null,
        p_bank_account_id: accountId ? Number(accountId) : null,
      });
      setConfirmSend(false);
      setResult(res);
      setView('done');
      invalidate(detail.payout_id);
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
      setConfirmSend(false);
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
        maxWidth="30rem"
        width="100%"
        ariaLabel={t('partnerPayout.reverseAction')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerPayout.reverseAction')}</h2>
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
              </div>

              <div className="alert alert-warning mt-3">
                <AlertTriangle size={16} className="shrink-0" />
                <span>{t('partnerPayout.reverseHint')}</span>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPayout.reverseReason')}</label>
                  <Select
                    options={reasonOptions}
                    value={reasonCode || null}
                    onChange={v => setReasonCode((v as string) ?? '')}
                    placeholder={t('partnerPayout.reverseReasonPlaceholder')}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPayout.bankAccountBack')}</label>
                  <Select
                    options={accountOptions}
                    value={accountId || null}
                    onChange={v => setAccountId((v as string) ?? '')}
                    placeholder={t('partnerPayout.bankAccountPlaceholder')}
                    clearable
                  />
                  <span className="text-xs text-subtle mt-1">{t('partnerPayout.bankAccountHint')}</span>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">
                    {noteRequired ? t('partnerPayout.noteRequired') : t('partnerPayout.note')}
                  </label>
                  <TextArea value={note} onChange={e => setNote(e.target.value)} rows={3} />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={() => setConfirmSend(true)} disabled={saving || !canSubmit}>
                {t('partnerPayout.reverseAction')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerPayout.reversedHeadline')}
            contractCode={result.payout_code}
            tone="warning"
            stateTransition={{
              from: t('partnerPayout.status_PAID'),
              to: t('partnerPayout.status_REVERSED'),
              toColor: 'warning',
            }}
            detailRows={[
              {
                label: t('partnerPayout.reverseReason'),
                value: reasonOptions.find(o => o.value === result.reason_code)?.label ?? result.reason_code,
              },
              { label: t('partnerPayout.releasedSettlements'), value: String(result.released_settlements) },
              { label: t('partnerPayout.netAmount'), value: fmtCurrency(result.net_amount), emphasis: true },
            ]}
            extras={devices.length > 0 ? (
              <div className="rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface text-sm font-medium flex items-center gap-2">
                  <Smartphone size={14} className="text-subtle" />
                  {t('partnerPayout.devicesReturnedToShop', { count: devices.length })}
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
        open={confirmSend}
        onClose={() => setConfirmSend(false)}
        maxWidth="26rem"
        width="100%"
        ariaLabel={t('partnerPayout.reverseAction')}
      >
        <div className="modal-header"><h2 className="modal-title">{t('partnerPayout.reverseAction')}</h2></div>
        <div className="modal-content">
          <p className="text-sm">{t('partnerPayout.confirmReverseBody')}</p>
          <div className="mt-3 px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">{detail?.payout_code ?? ''}</div>
            <div className="text-sm text-subtle mt-0.5">
              {reasonOptions.find(o => o.value === reasonCode)?.label}
            </div>
            {note.trim() && <div className="text-sm mt-1">{note.trim()}</div>}
          </div>
          <div className="alert alert-warning mt-3">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{t('partnerPayout.confirmReverseIrreversible')}</span>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmSend(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button color="danger" onClick={handleReverse} disabled={saving}>
            {t('partnerPayout.reverseAction')}
          </Button>
        </div>
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
