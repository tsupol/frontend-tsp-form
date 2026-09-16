// Shop-side "withdraw the request" dialog.
//
// Works on a waiting request and on an approved one alike — withdrawing an
// approved request gives up the approval and sends the contract back to draft
// so the shop can edit. The one blocker is an open contract bill: the backend
// answers OPEN_BILL_MUST_BE_VOIDED with the bill ids, and the shop must void
// those first (voiding returns the contract to APPROVED, not DRAFT).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea, Badge } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { usePartnerCaseInvalidate } from './usePartnerCases';
import type { PartnerCaseWithdrawResult } from './partnerCaseTypes';

interface PartnerCaseWithdrawModalProps {
  open: boolean;
  contractId: number | null;
  contractCode: string;
  /** Approved requests warn that withdrawing gives the approval up. */
  wasApproved: boolean;
  onClose: () => void;
}

export function PartnerCaseWithdrawModal({
  open, contractId, contractCode, wasApproved, onClose,
}: PartnerCaseWithdrawModalProps) {
  const { t } = useTranslation();
  const invalidate = usePartnerCaseInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockingBillIds, setBlockingBillIds] = useState<number[]>([]);
  const [result, setResult] = useState<PartnerCaseWithdrawResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setReason('');
    setSaving(false);
    setError(null);
    setBlockingBillIds([]);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (reason.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleWithdraw = async () => {
    if (contractId == null) return;
    setSaving(true);
    setError(null);
    setBlockingBillIds([]);
    try {
      const res = await apiClient.rpc<PartnerCaseWithdrawResult>('fn_partner_case_withdraw', {
        p_contract_id: contractId,
        p_reason: reason.trim() || null,
      });
      setResult(res);
      setView('done');
      invalidate(contractId);
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
        ariaLabel={t('partnerCase.withdraw')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerCase.withdraw')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{contractCode}</div>
              </div>

              <div className={`alert ${wasApproved ? 'alert-warning' : 'alert-info'} mt-3`}>
                <span>
                  {wasApproved ? t('partnerCase.withdrawApprovedWarning') : t('partnerCase.withdrawHint')}
                </span>
              </div>

              {blockingBillIds.length > 0 && (
                <div className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2.5">
                  <div className="text-sm font-medium text-danger-fg">
                    {t('partnerCase.voidBillFirst')}
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
                  <label className="form-label">{t('partnerCase.withdrawReason')}</label>
                  <TextArea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={3}
                    placeholder={t('partnerCase.withdrawReasonPlaceholder')}
                  />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button color="danger" onClick={handleWithdraw} disabled={saving || contractId == null}>
                {t('partnerCase.withdraw')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerCase.withdrawDone')}
            contractCode={contractCode}
            tone="neutral"
            stateTransition={{
              from: t(result.was_approved ? 'contract.state_APPROVED' : 'contract.state_PENDING_APPROVAL'),
              to: t('contract.state_DRAFT'),
              toColor: 'info',
            }}
            detailRows={[
              { label: t('partnerCase.seqNo'), value: `#${result.seq_no}` },
            ]}
            extras={
              <div className="alert alert-info">
                <span>{t('partnerCase.withdrawDoneHint')}</span>
              </div>
            }
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
