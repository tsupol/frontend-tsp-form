// Reviewer's "approve this request" dialog.
//
// There is no PIN on this flow, so the guard against a mis-click is a typed
// confirmation: the dialog shows four digits and the reviewer types them back.
// The digits are generated once per opening (never from Math.random inside
// render, which would change on every keystroke).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea, Input } from 'tsp-form';
import { Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { usePartnerCaseInvalidate } from './usePartnerCases';
import type { PartnerCaseApproveResult, PartnerCaseDetail } from './partnerCaseTypes';

interface PartnerCaseApproveModalProps {
  open: boolean;
  detail: PartnerCaseDetail | null;
  onClose: () => void;
  /** Called after a successful approval so the queue page can move on. */
  onApproved?: () => void;
}

const randomFourDigits = () => String(Math.floor(1000 + Math.random() * 9000));

export function PartnerCaseApproveModal({ open, detail, onClose, onApproved }: PartnerCaseApproveModalProps) {
  const { t } = useTranslation();
  const invalidate = usePartnerCaseInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [challenge, setChallenge] = useState('');
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PartnerCaseApproveResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setChallenge(randomFourDigits());
    setTyped('');
    setNote('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  // The modal keeps rendering through its close transition, so hold the last
  // request rather than blanking when the parent clears its selection.
  const contractCode = detail?.contract_code ?? '';

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (note.trim() || typed) { setConfirmClose(true); return; }
    forceClose();
  };

  const matches = typed === challenge;

  const handleApprove = async () => {
    if (!detail || !matches) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<PartnerCaseApproveResult>('fn_partner_case_approve', {
        p_case_id: detail.case_id,
        p_note: note.trim() || null,
      });
      setResult(res);
      setView('done');
      invalidate(detail.contract_id);
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
        maxWidth="30rem"
        width="100%"
        ariaLabel={t('partnerCase.approve')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerCase.approve')}</h2>
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

              <div className="alert alert-info mt-3">
                <Info size={16} className="shrink-0" />
                <span>{t('partnerCase.approveHint')}</span>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">
                    {t('partnerCase.confirmDigits', { digits: challenge })}
                  </label>
                  <Input
                    value={typed}
                    onChange={e => setTyped(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    inputMode="numeric"
                    autoComplete="off"
                    className="w-full tabular-nums"
                    placeholder={challenge}
                    error={typed.length === 4 && !matches}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('partnerCase.approveNote')}</label>
                  <TextArea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={2}
                    placeholder={t('partnerCase.approveNotePlaceholder')}
                  />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button color="primary" onClick={handleApprove} disabled={saving || !matches || !detail}>
                {t('partnerCase.approve')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerCase.approveDone')}
            contractCode={contractCode}
            stateTransition={{
              from: t('contract.state_PENDING_APPROVAL'),
              to: t('contract.state_APPROVED'),
              toColor: 'success',
            }}
            detailRows={[
              {
                label: t('partnerCase.usableUntil'),
                value: <DateTime value={result.approved_expires_at} showTime />,
                emphasis: true,
              },
              { label: t('partnerCase.photosLocked'), value: result.photo_slots_locked },
            ]}
            onClose={() => { onApproved?.(); forceClose(); }}
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
