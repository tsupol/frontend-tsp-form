// Submit / withdraw the close-out — UI_SUMMARY/140 §4.
//
// Both verbs are the same dialog with a different word on the button: one RPC,
// one optional note, no PIN, unlimited rounds. Submitting locks the handover
// photos and the contract's cancel buttons; withdrawing unlocks both, which is
// why the withdraw copy says so.
//
// A refused submit (422 NOT_READY) lists what the backend found missing. That
// list is shown verbatim — the checklist on the card can be a few seconds old,
// and inventing our own list is how the two end up disagreeing.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { AlertTriangle, Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { usePartnerSettlementInvalidate } from './usePartnerSettlement';
import type { SettlementCloseResult } from './partnerSettlementTypes';

export type CloseAction = 'CLOSE_SUBMIT' | 'CLOSE_WITHDRAW';

const RPC_NAME: Record<CloseAction, string> = {
  CLOSE_SUBMIT: 'fn_partner_settlement_close_submit',
  CLOSE_WITHDRAW: 'fn_partner_settlement_close_withdraw',
};

interface SettlementCloseModalProps {
  open: boolean;
  action: CloseAction;
  contractId: number | null;
  settlementCode: string;
  /** Group codes → labels, for a refusal that names missing photo groups. */
  checkLabel: (code: string) => string;
  onClose: () => void;
}

export function SettlementCloseModal({
  open, action, contractId, settlementCode, checkLabel, onClose,
}: SettlementCloseModalProps) {
  const { t } = useTranslation();
  const invalidate = usePartnerSettlementInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [result, setResult] = useState<SettlementCloseResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setNote('');
    setSaving(false);
    setError(null);
    setMissing([]);
    setResult(null);
    setConfirmClose(false);
  }, [open, action]);

  const isSubmit = action === 'CLOSE_SUBMIT';
  const title = isSubmit ? t('settlement.submitClose') : t('settlement.withdrawClose');

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (note.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleRun = async () => {
    if (contractId == null) return;
    setSaving(true);
    setError(null);
    setMissing([]);
    try {
      const res = await apiClient.rpc<SettlementCloseResult>(RPC_NAME[action], {
        p_contract_id: contractId,
        p_note: note.trim() || null,
      });
      setResult(res);
      setView('done');
      invalidate(contractId);
    } catch (err) {
      if (err instanceof ApiError) {
        // The backend's own list of what is still missing — shown as it came.
        const params = err.messageParams as { missing?: unknown } | undefined;
        if (Array.isArray(params?.missing)) {
          setMissing(params.missing.filter((m): m is string => typeof m === 'string'));
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
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%" ariaLabel={title}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{settlementCode}</div>
              </div>

              <div className={`alert ${isSubmit ? 'alert-info' : 'alert-warning'} mt-3`}>
                {isSubmit
                  ? <Info size={16} className="shrink-0" />
                  : <AlertTriangle size={16} className="shrink-0" />}
                <span>{isSubmit ? t('settlement.submitHint') : t('settlement.withdrawHint')}</span>
              </div>

              {missing.length > 0 && (
                <div className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2.5">
                  <div className="text-sm font-medium text-danger-fg">
                    {t('settlement.stillMissing')}
                  </div>
                  <ul className="mt-1 pl-4 list-disc text-sm text-danger-fg">
                    {missing.map(code => <li key={code}>{checkLabel(code)}</li>)}
                  </ul>
                </div>
              )}

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('settlement.note')}</label>
                  <TextArea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={3}
                    placeholder={t('settlement.notePlaceholder')}
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
                color={isSubmit ? 'primary' : 'danger'}
                onClick={handleRun}
                disabled={saving || contractId == null}
                data-action={action}
                data-blocked-reason={saving ? 'in_flight' : undefined}
              >
                {title}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={isSubmit ? t('settlement.submitDone') : t('settlement.withdrawDone')}
            contractCode={result.settlement_code}
            tone={isSubmit ? 'success' : 'neutral'}
            stateTransition={{
              from: t(`settlement.status_${result.previous_status}`, { defaultValue: result.previous_status }),
              to: t(`settlement.status_${result.status}`, { defaultValue: result.status }),
              toColor: isSubmit ? 'info' : 'warning',
            }}
            detailRows={[
              { label: t('settlement.submitCount'), value: result.close_submit_count },
            ]}
            extras={
              <div className="alert alert-info">
                <Info size={16} className="shrink-0" />
                <span>{isSubmit ? t('settlement.submitDoneHint') : t('settlement.withdrawDoneHint')}</span>
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
