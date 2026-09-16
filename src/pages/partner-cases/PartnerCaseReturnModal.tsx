// Reviewer's "send it back" dialog.
//
// The same dialog does double duty: on a waiting request it returns it to the
// shop, and on an already-approved one it takes the approval back. The reason
// list is a ref view, and `requires_note` on the chosen reason (only "Other"
// today) makes the note mandatory — the backend enforces it either way, so the
// FE just disables the button rather than nagging.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea, Select, Badge } from 'tsp-form';
import { AlertTriangle, Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { usePartnerCaseInvalidate, usePartnerCaseReturnReasons } from './usePartnerCases';
import type {
  PartnerCaseDetail,
  PartnerCaseReturnReason,
  PartnerCaseReturnResult,
} from './partnerCaseTypes';

interface PartnerCaseReturnModalProps {
  open: boolean;
  detail: PartnerCaseDetail | null;
  onClose: () => void;
  /** Called after a successful return so the queue page can move on. */
  onReturned?: () => void;
}

export function PartnerCaseReturnModal({ open, detail, onClose, onReturned }: PartnerCaseReturnModalProps) {
  const { t, i18n } = useTranslation();
  const invalidate = usePartnerCaseInvalidate();
  const reasons = usePartnerCaseReturnReasons();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reasonCode, setReasonCode] = useState<PartnerCaseReturnReason | ''>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockingBillIds, setBlockingBillIds] = useState<number[]>([]);
  const [result, setResult] = useState<PartnerCaseReturnResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  // Sending back is one-way — the backend refuses every action on a returned
  // request afterwards, and only the shop can revive it by resubmitting. So the
  // reviewer confirms before it happens.
  const [confirmSend, setConfirmSend] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setReasonCode('');
    setNote('');
    setSaving(false);
    setError(null);
    setBlockingBillIds([]);
    setResult(null);
    setConfirmClose(false);
    setConfirmSend(false);
  }, [open]);

  const contractCode = detail?.contract_code ?? '';
  // Returning an approved request is taking the approval back — say so.
  const isUnapprove = detail?.status === 'APPROVED';

  const reasonOptions = reasons.map(r => ({
    value: r.code,
    label: i18n.language === 'th' ? r.name_th : r.name_en,
  }));
  const chosen = reasons.find(r => r.code === reasonCode);
  const noteRequired = !!chosen?.requires_note;
  const canSubmit = !!reasonCode && (!noteRequired || !!note.trim());

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
    setBlockingBillIds([]);
    try {
      const res = await apiClient.rpc<PartnerCaseReturnResult>('fn_partner_case_return', {
        p_case_id: detail.case_id,
        p_reason_code: reasonCode,
        p_note: note.trim() || null,
      });
      setConfirmSend(false);
      setResult(res);
      setView('done');
      invalidate(detail.contract_id);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'PARTNER.STATE.OPEN_BILL_MUST_BE_VOIDED') {
          const ids = (err.messageParams as { bill_ids?: number[] } | undefined)?.bill_ids;
          if (Array.isArray(ids)) setBlockingBillIds(ids);
        }
        setError(translateApiError(err, t));
      } else {
        setError(String(err));
      }
      // Drop back to the form so the error band is the thing on screen.
      setConfirmSend(false);
    } finally {
      setSaving(false);
    }
  };

  const title = isUnapprove ? t('partnerCase.unapprove') : t('partnerCase.return');

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
                <div className="font-medium text-sm">{contractCode}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {detail?.customer_name}
                  {detail?.financed_amount != null && <> · {fmtCurrency(detail.financed_amount)}</>}
                </div>
              </div>

              {isUnapprove && (
                <div className="alert alert-warning mt-3">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{t('partnerCase.unapproveHint')}</span>
                </div>
              )}

              {blockingBillIds.length > 0 && (
                <div className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2.5">
                  <div className="text-sm font-medium text-danger-fg">
                    {t('partnerCase.voidBillFirstReviewer')}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {blockingBillIds.map(id => (
                      <Badge key={id} color="danger" size="sm">#{id}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerCase.returnReason')}</label>
                  <Select
                    options={reasonOptions}
                    value={reasonCode || null}
                    onChange={v => setReasonCode((v as PartnerCaseReturnReason) ?? '')}
                    placeholder={t('partnerCase.returnReasonPlaceholder')}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">
                    {noteRequired ? t('partnerCase.returnNoteRequired') : t('partnerCase.returnNote')}
                  </label>
                  <TextArea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={3}
                    placeholder={t('partnerCase.returnNotePlaceholder')}
                  />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button color="danger" onClick={() => setConfirmSend(true)} disabled={saving || !canSubmit}>
                {title}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={isUnapprove ? t('partnerCase.unapproveDone') : t('partnerCase.returnDone')}
            contractCode={contractCode}
            tone="warning"
            stateTransition={{
              from: t(result.was_approved ? 'contract.state_APPROVED' : 'contract.state_PENDING_APPROVAL'),
              to: t('contract.state_DRAFT'),
              toColor: 'info',
            }}
            detailRows={[
              {
                label: t('partnerCase.returnReason'),
                value: reasonOptions.find(o => o.value === result.reason_code)?.label ?? result.reason_code,
              },
            ]}
            extras={
              <div className="alert alert-info">
                <Info size={16} className="shrink-0" />
                <span>{t('partnerCase.returnDoneHint')}</span>
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
          <p className="text-sm">
            {isUnapprove
              ? t('partnerCase.confirmUnapproveBody')
              : t('partnerCase.confirmReturnBody')}
          </p>
          <div className="mt-3 px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">{contractCode}</div>
            <div className="text-sm text-subtle mt-0.5">
              {reasonOptions.find(o => o.value === reasonCode)?.label}
            </div>
            {note.trim() && <div className="text-sm mt-1">{note.trim()}</div>}
          </div>
          <div className="alert alert-warning mt-3">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{t('partnerCase.confirmReturnIrreversible')}</span>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmSend(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button color="danger" onClick={handleReturn} disabled={saving}>
            {t('partnerCase.confirmReturnAction')}
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
