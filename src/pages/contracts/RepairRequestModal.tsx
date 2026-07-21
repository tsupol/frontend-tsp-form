import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button, Modal, TextArea } from 'tsp-form';
import { XCircle, Wrench, ExternalLink } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { ActionDoneView } from './ActionDoneView';
import { useContractInvalidate } from './useContractInvalidate';

// Send a contract device to repair. The repair flow is now DRAFT-based (repair
// flow v5, UI_SUMMARY/128_REPAIR_FLOW.md): this modal only CREATES the draft
// repair order (fn_inv_repair_draft_create). The intake receipt + customer
// signature that actually moves the device to IN_REPAIR happen in the Repairs
// Hub — a repair-doc signature (fn_repair_signature_register / fn_inv_repair_intake),
// NOT the contract Signing tab. So on success we show a done view whose link
// button jumps to that repair order in the Repairs page.
//
// Loaner is separate (fn_contract_loan_assign) once the primary is IN_REPAIR.

interface RepairDraftResult {
  repair_order_id: number;
  repair_no: string;
  code_display: string | null;
  status: string;
}

export function RepairRequestModal({
  open, onClose, onSuccess,
  assetId, contractId,
  assetCode, deviceIdentifier,
  onNavigateRepair,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
  assetId: number;
  contractId?: number;
  assetCode?: string | null;
  deviceIdentifier?: string | null;
  /** Jump to the created draft in the Repairs Hub (where intake + signature happen). */
  onNavigateRepair?: (repairOrderId: number) => void;
}) {
  const { t } = useTranslation();
  const invalidate = useContractInvalidate(contractId ?? 0);

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<RepairDraftResult | null>(null);

  useEffect(() => {
    if (open) {
      setView('form');
      setNote('');
      setError('');
      setResult(null);
    }
  }, [open]);

  const mutation = useMutation({
    // Send EVERY param (null for blanks) — PostgREST can't resolve the RPC from a
    // partial named-param set. p_repair_note (the fault symptom) is required.
    mutationFn: () =>
      apiClient.rpc<RepairDraftResult>('fn_inv_repair_draft_create', {
        p_asset_id: assetId,
        p_contract_id: contractId ?? null,
        p_repair_note: note.trim(),
        p_condition_note: null,
        p_intake_terms: null,
        p_ext_customer_name: null,
        p_ext_customer_phone: null,
        p_ext_serial: null,
        p_ext_imei: null,
        p_ext_model: null,
        p_promised_date: null,
        p_branch_id: null,
      }),
    onSuccess: (res) => {
      setResult(res);
      setView('done');
      invalidate();
      onSuccess('contract.action_device_repair_request_success');
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
  });

  const canSubmit = note.trim().length > 0 && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.action_device_repair_request')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
        </div>

        {view === 'done' && result ? (
          <ActionDoneView
            headline={t('repairRequest.done_headline')}
            contractCode={result.code_display ?? result.repair_no}
            tone="neutral"
            extras={
              <div className="alert alert-info">
                <Wrench size={16} />
                <span>{t('repairRequest.done_nextIntake')}</span>
              </div>
            }
            secondaryAction={onNavigateRepair ? {
              label: t('repairRequest.goToRepair'),
              startIcon: <ExternalLink size={14} />,
              onClick: () => { onNavigateRepair(result.repair_order_id); onClose(); },
            } : undefined}
            onClose={onClose}
          />
        ) : (
          <>
            <div className="modal-content">
              {error && (
                <div className="alert alert-danger mb-4 animate-pop-in">
                  <XCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {(assetCode || deviceIdentifier) && (
                <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
                  {assetCode && <div className="font-medium text-sm">{assetCode}</div>}
                  {deviceIdentifier && <div className="text-xs font-mono text-subtle">{deviceIdentifier}</div>}
                </div>
              )}

              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.repairRequest_symptom')}</label>
                  <TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('contract.repairRequest_symptomPlaceholder')}
                    rows={3}
                  />
                </div>
              </div>

              <div className="text-xs text-subtle mt-3">
                {t('repairRequest.createHint')}
              </div>
            </div>
            <div className="modal-footer">
              <Button onClick={onClose}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                onClick={() => mutation.mutate()}
                disabled={!canSubmit}
              >
                {mutation.isPending ? t('common.loading') : t('repairRequest.createDraft')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
