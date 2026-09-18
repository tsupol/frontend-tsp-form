// "ปิดใบ (สัญญาจบ)" — the one irreversible step.
//
// Closing does three things at once: the return is finished, the contract
// becomes TERMINATED, and the device goes to whoever the resolution says owns
// it. There is no undo, so the form states all three before the button, and the
// success view reports what actually happened rather than just "saved".
//
// If the backend still refuses, the reason is shown with a way to go fix it:
// money left on the contract (a wallet balance, a late fee, an open bill) is
// cleared on other screens, and `hint_code` names which one.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Modal, Button, TextArea } from 'tsp-form';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { usePartnerReturnInvalidate } from './usePartnerReturns';
import type {
  PartnerReturnCloseBlock,
  PartnerReturnDetail,
  PartnerReturnStatus,
  ReturnCloseResult,
} from './partnerReturnTypes';

/**
 * Where the user goes to clear each kind of leftover money. The backend names
 * the fix with `hint_code`; this maps that name to the screen that does it.
 * Anything unmapped simply shows the reason without a link.
 */
function fixScreenFor(hintCode: string | undefined, contractId: number): string | null {
  if (!hintCode) return null;
  switch (hintCode) {
    case 'USE_WALLET_CASHOUT':
    case 'USE_LATE_FEE_COLLECT':
    case 'USE_HOLDING_REFUND':
      return `/admin/contracts/${contractId}`;
    default:
      return null;
  }
}

interface Props {
  open: boolean;
  detail: PartnerReturnDetail | null;
  /** The live block from the capability RPC, if the close is still refused. */
  closeBlock: PartnerReturnCloseBlock | null;
  onClose: () => void;
}

export function ReturnCloseModal({ open, detail, closeBlock, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const invalidate = usePartnerReturnInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnCloseResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // The status the document had before this close. Captured on open, because
  // succeeding refetches the document as CLOSED — reading it live would make the
  // success badge say "closed → closed" instead of naming what it came from.
  const [fromStatus, setFromStatus] = useState<PartnerReturnStatus>('RECEIVED');
  const statusNow = detail?.status ?? 'RECEIVED';

  useEffect(() => {
    if (!open) return;
    setView('form');
    setFromStatus(statusNow);
    setNote('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
    // `statusNow` is read once at open on purpose — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (note.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const blocked = !!closeBlock?.reason;
  const hintCode = typeof closeBlock?.hint_code === 'string' ? closeBlock.hint_code : undefined;
  const fixPath = detail ? fixScreenFor(hintCode, detail.contract_id) : null;

  const handleCloseDoc = async () => {
    if (!detail) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<ReturnCloseResult>('fn_partner_return_close', {
        p_return_id: detail.return_id,
        p_note: note.trim() || null,
      });
      setResult(res);
      setView('done');
      invalidate(detail.return_id);
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
        ariaLabel={t('partnerReturn.action_CLOSE')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerReturn.action_CLOSE')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{detail?.return_code ?? ''}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {detail?.contract_code}
                  {detail?.customer_name && <> · {detail.customer_name}</>}
                </div>
                {detail?.resolution && (
                  <div className="text-xs text-subtle mt-0.5">
                    {t('partnerReturn.resolutionLabel')}:{' '}
                    {t(`partnerReturn.resolution_${detail.resolution}`)}
                  </div>
                )}
              </div>

              {blocked ? (
                <div className="alert alert-warning mt-3">
                  <AlertTriangle size={16} className="shrink-0" />
                  <div className="flex flex-col gap-1 min-w-0">
                    <span>
                      {t(`partnerReturn.closeBlock_${closeBlock?.reason}`, {
                        defaultValue: t('partnerReturn.closeBlockGeneric'),
                      })}
                    </span>
                    {hintCode && (
                      <span className="text-sm">
                        {t(`partnerReturn.closeHint_${hintCode}`, { defaultValue: hintCode })}
                      </span>
                    )}
                    {fixPath && (
                      <button
                        type="button"
                        onClick={() => { forceClose(); navigate(fixPath); }}
                        className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer self-start"
                      >
                        {t('partnerReturn.goFixIt')}
                        <ExternalLink size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="alert alert-warning mt-3">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{t('partnerReturn.closeWarning')}</span>
                </div>
              )}

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerReturn.note')}</label>
                  <TextArea value={note} onChange={e => setNote(e.target.value)} rows={2} />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleCloseDoc} disabled={saving || blocked}>
                {t('partnerReturn.action_CLOSE')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerReturn.closedHeadline')}
            contractCode={result.return_code}
            stateTransition={{
              from: t(`partnerReturn.status_${fromStatus}`),
              to: t('partnerReturn.status_CLOSED'),
              toColor: 'success',
            }}
            detailRows={[
              {
                label: t('partnerReturn.contract'),
                value: `${detail?.contract_code ?? ''} · ${t(
                  `contract.state_${result.contract_state}`,
                  { defaultValue: result.contract_state },
                )}`,
                emphasis: true,
              },
              ...(result.close_reason
                ? [{
                    label: t('partnerReturn.closeReason'),
                    value: t(`partnerReturn.closeReason_${result.close_reason}`, {
                      defaultValue: result.close_reason,
                    }),
                  }]
                : []),
              ...(result.device_owner_type
                ? [{
                    label: t('partnerReturn.deviceOwner'),
                    value: t(`partnerReturn.owner_${result.device_owner_type}`, {
                      defaultValue: result.device_owner_type,
                    }),
                  }]
                : []),
              ...(result.device_bucket
                ? [{
                    label: t('partnerReturn.deviceBucket'),
                    value: t(`partnerReturn.bucket_${result.device_bucket}`, {
                      defaultValue: result.device_bucket,
                    }),
                  }]
                : []),
              ...(result.installments_terminated != null
                ? [{
                    label: t('partnerReturn.installmentsTerminated'),
                    value: String(result.installments_terminated),
                  }]
                : []),
            ]}
            extras={result.device_bucket === 'QUARANTINED' ? (
              <div className="alert alert-info">
                <AlertTriangle size={16} className="shrink-0" />
                <span>{t('partnerReturn.quarantineHint')}</span>
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
