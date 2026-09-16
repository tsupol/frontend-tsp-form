// Shop-side "ask for credit approval" dialog.
//
// The note is optional, so the form is a single TextArea. The real work is on
// the failure side: `fn_partner_case_submit` rejects with the same checklist
// the wizard shows (PARTNER.VALIDATION.NOT_READY carries `params.errors`), and
// that list is what tells the shop what to go and fix.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { usePartnerCaseInvalidate } from './usePartnerCases';
import type { PartnerCaseSubmitResult } from './partnerCaseTypes';

interface PartnerCaseSubmitModalProps {
  open: boolean;
  contractId: number | null;
  contractCode: string;
  /** Latest request's seq_no, if any — a resubmit after a return says "ยื่นใหม่". */
  isResubmit: boolean;
  onClose: () => void;
}

/** A failed readiness check, as the RPC reports it. */
interface ReadyError {
  code: string;
  field?: string | null;
  detail?: unknown;
}

export function PartnerCaseSubmitModal({
  open, contractId, contractCode, isResubmit, onClose,
}: PartnerCaseSubmitModalProps) {
  const { t } = useTranslation();
  const invalidate = usePartnerCaseInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readyErrors, setReadyErrors] = useState<ReadyError[]>([]);
  const [result, setResult] = useState<PartnerCaseSubmitResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setNote('');
    setSaving(false);
    setError(null);
    setReadyErrors([]);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (note.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleSubmit = async () => {
    if (contractId == null) return;
    setSaving(true);
    setError(null);
    setReadyErrors([]);
    try {
      const res = await apiClient.rpc<PartnerCaseSubmitResult>('fn_partner_case_submit', {
        p_contract_id: contractId,
        p_note: note.trim() || null,
      });
      setResult(res);
      setView('done');
      invalidate(contractId);
    } catch (err) {
      if (err instanceof ApiError) {
        // NOT_READY carries the full checklist — show the individual items so
        // the shop knows which card to go back to, not just "not ready".
        const params = err.messageParams as { errors?: ReadyError[] } | undefined;
        if (Array.isArray(params?.errors)) setReadyErrors(params.errors);
        setError(translateApiError(err, t));
      } else {
        setError(String(err));
      }
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
        ariaLabel={t('partnerCase.submit')}
      >
        <div className="modal-header">
          <h2 className="modal-title">
            {isResubmit ? t('partnerCase.resubmit') : t('partnerCase.submit')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{contractCode}</div>
              </div>

              <p className="text-sm text-subtle mt-3">{t('partnerCase.submitHint')}</p>

              {readyErrors.length > 0 && (
                <div className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2.5">
                  <div className="text-sm font-medium text-danger-fg">
                    {t('partnerCase.notReadyTitle')}
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {readyErrors.map((e, i) => (
                      <li key={i} className="text-sm text-danger-fg">
                        {t(e.code.toLowerCase(), { ns: 'apiErrors', defaultValue: e.code })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerCase.submitNote')}</label>
                  <TextArea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={3}
                    placeholder={t('partnerCase.submitNotePlaceholder')}
                  />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button color="primary" onClick={handleSubmit} disabled={saving || contractId == null}>
                {isResubmit ? t('partnerCase.resubmit') : t('partnerCase.submit')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerCase.submitDone')}
            contractCode={contractCode}
            stateTransition={{ from: t('contract.state_DRAFT'), to: t('contract.state_PENDING_APPROVAL'), toColor: 'warning' }}
            detailRows={[
              { label: t('partnerCase.seqNo'), value: `#${result.seq_no}` },
              ...(result.pool
                ? [{ label: t('partnerCase.pool'), value: result.pool.name },
                   { label: t('partnerCase.reviewerCount'), value: result.pool.reviewer_count }]
                : []),
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
