// Clear the customer's (LESSEE) signature on ONE document so they can sign it
// again — a wrong signer, a smudged or blank signature, wrong handover ticks.
//
// RPC: api.fn_contract_signing_clear_lessee(p_signing_id, p_reason_code, p_note,
//   p_pin, p_preview) — mig 1726, UI_FEEDBACK 2026-11-19_IMPLEMENT_signing_clear_lessee_1726.
//   - preview (p_preview=true) decides whether the button shows at all
//     (`allowed`) and feeds this modal: reason_codes, note_required_for,
//     pin_required. The screen never works out "same day / day closed / shop
//     submitted" itself.
//   - Permission CONTRACT.SIGNING.CLEAR_LESSEE (branch manager) + the shop PIN.
//   - The old signature is kept by the backend, a contract note is written and
//     the customer is told in chat — nothing for the screen to do.
//
// Write-modal checklist: view form/done, ActionDoneView, one guarded close,
// always mounted, the submit error in ModalErrorBand.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, RadioGroup, TextArea } from 'tsp-form';
import { Eraser, Smartphone } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { BranchPinInput } from '../../components/BranchPinInput';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { DateTime } from '../../components/DateTime';
import { ActionDoneView } from './ActionDoneView';

/** `data` of fn_contract_signing_clear_lessee with p_preview=true. */
export interface ClearLesseePreview {
  allowed: boolean;
  block_code: string | null;
  block_params: Record<string, unknown> | null;
  signing_id: number;
  signing_code_display: string | null;
  signing_type: string;
  change_reason: 'CONTRACT_OPEN' | 'BIND' | string;
  status: string;
  reopens_document: boolean;
  contract_id: number;
  contract_code_display: string | null;
  lessee: { party_id: number; customer_id: number | null; full_name: string | null; signed_at: string | null } | null;
  times_cleared: number;
  pin_required: boolean;
  reason_codes: string[];
  note_required_for: string[];
}

interface ClearResult {
  signing_id: number;
  signing_code_display: string | null;
  change_reason: string;
  status: string;
  reopened_document: boolean;
  contract_id: number;
  contract_code_display: string | null;
  next: { party_role: string; party_index: number } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  contractId: number;
  preview: ClearLesseePreview | null;
  /** The document's name exactly as its card header shows it ("v1 เปิดสัญญาใหม่"). */
  docLabel: string | null;
  /** Opens the usual signing flow (the QR for the iPad) for the customer to sign again. */
  onResign: () => void;
}

export function SigningClearLesseeModal({ open, onClose, contractId, preview: previewProp, docLabel: docLabelProp, onResign }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // The parent drops the preview once the cleared document no longer allows a
  // clear — keep showing the last one through the done view and the close.
  const lastPreview = useRef(previewProp);
  if (previewProp) lastPreview.current = previewProp;
  const preview = previewProp ?? lastPreview.current;
  const lastDocLabel = useRef(docLabelProp);
  if (docLabelProp) lastDocLabel.current = docLabelProp;
  const docLabel = docLabelProp ?? lastDocLabel.current;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClearResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) {
      setView('form');
      setReason('');
      setNote('');
      setPin('');
      setError(null);
      setResult(null);
      setConfirmClose(false);
    }
  }, [open]);

  const noteRequired = !!reason && (preview?.note_required_for ?? []).includes(reason);
  const pinRequired = preview?.pin_required ?? true;

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<ClearResult>('fn_contract_signing_clear_lessee', {
      p_signing_id: preview!.signing_id,
      p_reason_code: reason,
      p_note: note.trim() || null,
      p_pin: pinRequired ? pin : null,
    }),
    onSuccess: (res) => {
      setResult(res);
      setView('done');
      setPin('');
      queryClient.invalidateQueries({ queryKey: ['contract-signings', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-signing-parties', contractId] });
      queryClient.invalidateQueries({ queryKey: ['signing-clear-lessee-preview'] });
      queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-actions', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-search'] });
    },
    onError: (err) => setError(translateApiError(err, t)),
  });

  const isDirty = view === 'form' && (!!reason || note.trim().length > 0 || pin.length > 0);
  const handleClose = () => {
    if (view === 'done') { onClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    onClose();
  };
  const forceClose = () => { setConfirmClose(false); onClose(); };

  const canSubmit = !!preview && !!reason
    && (!noteRequired || note.trim().length > 0)
    && (!pinRequired || pin.length === 6)
    && !mutation.isPending;

  const docName = docLabel ?? (preview ? t(`signing.reason_${preview.change_reason}`, { defaultValue: preview.change_reason }) : '');
  const reasonLabel = (code: string) => t(`signing.clearLessee.reason_${code}`, { defaultValue: code });

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('signing.clearLessee.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              <div className="flex flex-col gap-4">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{docName}</div>
                  <div className="text-xs text-subtle">
                    {preview?.lessee?.full_name ?? '—'}
                    {preview?.lessee?.signed_at && <> · {t('signing.clearLessee.signedAt')} <DateTime value={preview.lessee.signed_at} showTime /></>}
                  </div>
                </div>

                <div className="text-sm text-subtle">
                  {preview?.reopens_document ? t('signing.clearLessee.hintReopens') : t('signing.clearLessee.hintCollecting')}
                </div>

                <div className="form-grid">
                  <div className="flex flex-col">
                    <label className="form-label">{t('signing.clearLessee.reasonLabel')} *</label>
                    <RadioGroup
                      name="clear-lessee-reason"
                      value={reason}
                      onChange={(v) => setReason(v)}
                      className="flex flex-col gap-2"
                      options={(preview?.reason_codes ?? []).map(code => ({ value: code, label: reasonLabel(code) }))}
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="form-label">
                      {t('signing.clearLessee.noteLabel')}{noteRequired ? ' *' : ''}
                    </label>
                    <TextArea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t('signing.clearLessee.notePlaceholder')}
                      rows={2}
                    />
                  </div>
                  {pinRequired && <BranchPinInput value={pin} onChange={setPin} required />}
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
              <Button
                color="danger"
                startIcon={<Eraser size={16} />}
                onClick={() => { setError(null); mutation.mutate(); }}
                disabled={!canSubmit}
                data-testid="clear-lessee-submit"
              >
                {mutation.isPending ? t('common.loading') : t('signing.clearLessee.submit')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            headline={t('signing.clearLessee.doneHeadline')}
            contractCode={docName}
            tone="warning"
            stateTransition={preview && preview.status !== result.status ? {
              fromColor: preview.status === 'SEALED' ? 'success' : 'warning',
              toColor: 'warning',
              from: t(`signing.status_${preview.status}`, { defaultValue: preview.status }),
              to: t(`signing.status_${result.status}`, { defaultValue: result.status }),
            } : undefined}
            detailRows={[
              { label: t('signing.clearLessee.customer'), value: preview?.lessee?.full_name ?? '—' },
              { label: t('signing.clearLessee.reasonLabel'), value: reasonLabel(reason) },
              ...(note.trim() ? [{ label: t('signing.clearLessee.noteLabel'), value: note.trim() }] : []),
              { label: t('signing.clearLessee.next'), value: t('signing.clearLessee.nextValue'), emphasis: true },
            ]}
            secondaryAction={{
              label: t('signing.clearLessee.resign'),
              startIcon: <Smartphone size={16} />,
              isNextStep: true,
              onClick: () => { onClose(); onResign(); },
            }}
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
