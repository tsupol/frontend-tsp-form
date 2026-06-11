// Void a COLLECTING signing.
//
// RPC: api.fn_contract_signing_void(p_signing_id, p_void_reason)
// Permission: CONTRACT.SIGNING.VOID (BS/BM) for COLLECTING; SEALED requires
// CONTRACT.SIGNING.VOID_SEALED (HOLDING_ADMIN only) — UI exposes the button
// only for COLLECTING here.
//
// Follows the tsp-form modal pattern: success step inside the modal (no
// auto-close); dirty-form close guard.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, TextArea } from 'tsp-form';
import { XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { ActionDoneView } from './ActionDoneView';

interface Props {
  open: boolean;
  onClose: () => void;
  contractId: number;
  signingId: number;
}

interface VoidResult {
  signing_id: number;
  state: string;
}

function describeApiError(
  err: unknown,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  if (err instanceof ApiError) {
    const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
    return translated || err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function SigningVoidModal({ open, onClose, contractId, signingId }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<VoidResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) {
      setView('form');
      setReason('');
      setError('');
      setResult(null);
      setConfirmClose(false);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<VoidResult>('fn_contract_signing_void', {
      p_signing_id: signingId,
      p_void_reason: reason.trim(),
    }),
    onSuccess: (res) => {
      setResult(res);
      setView('done');
      queryClient.invalidateQueries({ queryKey: ['contract-signings', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-signing-parties', contractId] });
    },
    onError: (err) => setError(describeApiError(err, t)),
  });

  const isDirty = view === 'form' && reason.trim().length > 0;

  const handleClose = () => {
    if (view === 'done') { onClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    onClose();
  };

  const forceClose = () => {
    setConfirmClose(false);
    onClose();
  };

  const canSubmit = reason.trim().length > 0 && !mutation.isPending;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done' ? t('signing.voidDoneTitle') : t('signing.voidTitle')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              {error && (
                <div className="alert alert-danger mb-4 animate-pop-in">
                  <XCircle size={16} />
                  <span>{error}</span>
                </div>
              )}
              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('signing.voidReason')} *</label>
                  <TextArea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('signing.voidReasonPlaceholder')}
                    rows={3}
                  />
                </div>
              </div>
              <div className="text-xs text-subtle mt-3">{t('signing.voidHint')}</div>
            </div>
            <div className="modal-footer">
              <Button onClick={handleClose}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={() => mutation.mutate()} disabled={!canSubmit}>
                {mutation.isPending ? t('common.loading') : t('signing.voidConfirm')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            headline={t('signing.voidDoneHeadline')}
            contractCode={`SGN-${result.signing_id}`}
            tone="warning"
            stateTransition={{ from: 'COLLECTING', to: result.state }}
            detailRows={[
              { label: t('signing.voidReason'), value: reason.trim() },
            ]}
            onClose={onClose}
          />
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
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
