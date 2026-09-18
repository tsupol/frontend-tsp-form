// Finance sends a close-out back to the shop for correction (140 §4).
//
// The reason list is a ref view, so reasons can be added or retired without a
// deploy. A reason flagged `requires_note` makes the note mandatory — the
// backend enforces it with REASON_REQUIRED, and the button is disabled until
// three characters are typed so the round trip is not the first the user hears
// of it.
//
// Sending back re-opens the shop's handover photos and clears the finance tick,
// so it is confirmed before it happens.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea, Select } from 'tsp-form';
import { AlertTriangle, Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import {
  usePartnerSettlementInvalidate,
  usePartnerSettlementReturnReasons,
} from './usePartnerSettlements';
import type {
  PartnerSettlementDetail,
  PartnerSettlementCloseReturnResult,
} from './partnerSettlementTypes';

/** The backend's own floor for a required note. */
const NOTE_MIN_LENGTH = 3;

interface PartnerSettlementReturnModalProps {
  open: boolean;
  detail: PartnerSettlementDetail | null;
  onClose: () => void;
  /** Called once the user dismisses the success view. */
  onReturned?: () => void;
}

export function PartnerSettlementReturnModal({
  open, detail, onClose, onReturned,
}: PartnerSettlementReturnModalProps) {
  const { t, i18n } = useTranslation();
  const invalidate = usePartnerSettlementInvalidate();
  const reasons = usePartnerSettlementReturnReasons();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PartnerSettlementCloseReturnResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setReasonCode('');
    setNote('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
    setConfirmSend(false);
  }, [open]);

  // The parent clears its selection as it closes, so keep the last settlement
  // on screen through the exit transition.
  const settlementCode = detail?.settlement_code ?? '';

  const reasonOptions = reasons.map(r => ({
    value: r.code,
    label: i18n.language === 'th' ? r.name_th : r.name_en,
  }));
  const chosen = reasons.find(r => r.code === reasonCode);
  const noteRequired = !!chosen?.requires_note;
  const canSubmit = !!reasonCode
    && (!noteRequired || note.trim().length >= NOTE_MIN_LENGTH);

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (reasonCode || note.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleReturn = async () => {
    if (!detail || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<PartnerSettlementCloseReturnResult>(
        'fn_partner_settlement_close_return',
        {
          p_settlement_id: detail.settlement_id,
          p_reason_code: reasonCode,
          p_note: note.trim() || null,
        },
      );
      setConfirmSend(false);
      setResult(res);
      setView('done');
      invalidate();
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
      // Back to the form so the error band is what is on screen.
      setConfirmSend(false);
    } finally {
      setSaving(false);
    }
  };

  const title = t('partnerSettlement.returnTitle');

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        maxWidth="30rem"
        width="100%"
        ariaLabel={title}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{settlementCode}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {detail?.branch_name}
                  {detail?.net_amount != null && <> · {fmtCurrency(detail.net_amount)}</>}
                </div>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerSettlement.returnReason')}</label>
                  <Select
                    options={reasonOptions}
                    value={reasonCode || null}
                    onChange={v => setReasonCode((v as string) ?? '')}
                    placeholder={t('partnerSettlement.returnReasonPlaceholder')}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">
                    {noteRequired
                      ? t('partnerSettlement.returnNoteRequired')
                      : t('partnerSettlement.returnNote')}
                  </label>
                  <TextArea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={3}
                    placeholder={t('partnerSettlement.returnNotePlaceholder')}
                  />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button
                color="danger"
                onClick={() => setConfirmSend(true)}
                disabled={saving || !canSubmit}
              >
                {title}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerSettlement.returnDone')}
            contractCode={settlementCode}
            tone="warning"
            stateTransition={{
              from: t('partnerSettlement.status.CLOSE_SUBMITTED'),
              to: t('partnerSettlement.status.NEEDS_FIX'),
              toColor: 'warning',
            }}
            detailRows={[
              {
                label: t('partnerSettlement.returnReason'),
                value: reasonOptions.find(o => o.value === result.reason_code)?.label
                  ?? result.reason_code,
              },
            ]}
            extras={
              <div className="alert alert-info">
                <Info size={16} className="shrink-0" />
                <span>{t('partnerSettlement.returnDoneHint')}</span>
              </div>
            }
            onClose={() => { onReturned?.(); forceClose(); }}
          />
        )}
      </Modal>

      <Modal
        open={confirmSend}
        onClose={() => setConfirmSend(false)}
        maxWidth="26rem"
        width="100%"
        ariaLabel={title}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
        </div>
        <div className="modal-content">
          <p className="text-sm">{t('partnerSettlement.confirmReturnBody')}</p>
          <div className="mt-3 px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">{settlementCode}</div>
            <div className="text-sm text-subtle mt-0.5">
              {reasonOptions.find(o => o.value === reasonCode)?.label}
            </div>
            {note.trim() && <div className="text-sm mt-1">{note.trim()}</div>}
          </div>
          <div className="alert alert-warning mt-3">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{t('partnerSettlement.confirmReturnHint')}</span>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmSend(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button color="danger" onClick={handleReturn} disabled={saving}>
            {t('partnerSettlement.confirmReturnAction')}
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
