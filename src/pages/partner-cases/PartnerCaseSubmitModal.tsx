// Shop-side "ask for credit approval" dialog.
//
// The note is optional, so the form is a single TextArea. The real work is on
// the failure side: `fn_partner_case_submit` rejects with the same checklist
// the wizard shows (PARTNER.VALIDATION.NOT_READY carries `params.errors`), and
// that list is what tells the shop what to go and fix.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Button, TextArea } from 'tsp-form';
import { ArrowRight } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError, translateErrorCode } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { usePartnerCaseInvalidate, useAssetEvidence, assetAlbumPath } from './usePartnerCases';
import type { PartnerCaseSubmitResult } from './partnerCaseTypes';

interface PartnerCaseSubmitModalProps {
  open: boolean;
  contractId: number | null;
  contractCode: string;
  /** Latest request's seq_no, if any — a resubmit after a return says "ยื่นใหม่". */
  isResubmit: boolean;
  onClose: () => void;
  /** Where to send the shop to fix a "not ready" reason, by its code: the link
   *  label naming the action, and what it does. Null for a reason this screen
   *  can't take them to. The modal closes first. */
  fixReason?: (code: string) => ReasonFix | null;
}

export interface ReasonFix {
  label: string;
  run: () => void;
}

/** Submit refused because required device photos are missing (mig 1523). */
interface EvidenceGap {
  assetId: number;
  missing: string[];
}

/** A failed readiness check, as the RPC reports it. */
interface ReadyError {
  code: string;
  field?: string | null;
  detail?: unknown;
}

export function PartnerCaseSubmitModal({
  open, contractId, contractCode, isResubmit, onClose, fixReason,
}: PartnerCaseSubmitModalProps) {
  const { t } = useTranslation();
  const invalidate = usePartnerCaseInvalidate();
  const queryClient = useQueryClient();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readyErrors, setReadyErrors] = useState<ReadyError[]>([]);
  const [evidenceGap, setEvidenceGap] = useState<EvidenceGap | null>(null);
  const [result, setResult] = useState<PartnerCaseSubmitResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  // Read once per opening: sending creates the request this flag is derived
  // from, so a live read would retitle a first send "send again" on its done view.
  const [resubmit, setResubmit] = useState(isResubmit);

  useEffect(() => {
    if (!open) return;
    setResubmit(isResubmit);
    setView('form');
    setNote('');
    setSaving(false);
    setError(null);
    setReadyErrors([]);
    setEvidenceGap(null);
    setResult(null);
    setConfirmClose(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- isResubmit is sampled on open only
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
    setEvidenceGap(null);
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
        // Missing photos come as slot codes; their names are read from the
        // album (the owner renames slots), and the band links to it.
        const gap = err.messageParams as { asset_id?: number; missing?: string[] } | undefined;
        if (err.code === 'PARTNER.VALIDATION.ASSET_EVIDENCE_INCOMPLETE' && gap?.asset_id != null) {
          setEvidenceGap({ assetId: gap.asset_id, missing: gap.missing ?? [] });
          queryClient.invalidateQueries({ queryKey: ['asset-evidence', gap.asset_id] });
        }
        setError(translateApiError(err, t));
      } else {
        setError(String(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const { data: gapSlots } = useAssetEvidence(evidenceGap?.assetId ?? null);
  // Until the album's names load, the band says the plain "photos incomplete".
  const gapMessage = evidenceGap && gapSlots
    ? t('partner.validation.asset_evidence_incomplete', {
        ns: 'apiErrors',
        labels: evidenceGap.missing
          .map(code => gapSlots?.find(s => s.slot === code)?.label_th ?? code)
          .join(', '),
      })
    : null;

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
            {resubmit ? t('partnerCase.resubmit') : t('partnerCase.submit')}
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

            {/* The reasons live in the band beside the button that failed — one
                place, in view, each with its way out where the screen has one. */}
            <ModalErrorBand
              message={readyErrors.length > 0 ? t('partnerCase.notReadyTitle') : (gapMessage ?? error)}
              onDismiss={() => { setError(null); setReadyErrors([]); setEvidenceGap(null); }}
              action={evidenceGap ? (
                <Link
                  to={assetAlbumPath(evidenceGap.assetId)}
                  // A ctrl/cmd-click opens the album in a new tab — keep the window here.
                  onClick={(e) => { if (!e.ctrlKey && !e.metaKey) forceClose(); }}
                  className="font-medium text-primary-fg hover:underline inline-flex items-center gap-0.5"
                >
                  {t('partnerCase.goToAlbum')}
                  <ArrowRight size={14} />
                </Link>
              ) : readyErrors.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {readyErrors.map((e, i) => {
                    const fix = fixReason?.(e.code) ?? null;
                    return (
                      <li key={i} className="flex flex-wrap items-center gap-x-2">
                        <span>
                          {translateErrorCode(e.code, {}, t)
                            || translateErrorCode(e.code.toLowerCase(), {}, t)
                            || e.code}
                        </span>
                        {fix && (
                          <button
                            type="button"
                            className="font-medium text-primary-fg hover:underline inline-flex items-center gap-0.5 bg-transparent border-none p-0 cursor-pointer"
                            onClick={() => { forceClose(); fix.run(); }}
                          >
                            {fix.label}
                            <ArrowRight size={14} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : undefined}
            />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button color="primary" onClick={handleSubmit} disabled={saving || contractId == null}>
                {resubmit ? t('partnerCase.resubmit') : t('partnerCase.submit')}
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
