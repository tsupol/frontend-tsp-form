// "ตั้งให้เป็นผู้เช่าหลัก" — make a co-lessee the primary lessee (mig 1546,
// UI_FEEDBACK/2026-10-31_IMPLEMENT_set_primary_lessee_1546.md).
//
// Owner 10-31: primary and co-lessee carry the same liability (the ADD_CO_LESSEE
// addendum they already signed says so), so swapping who is "primary" needs no
// new document — reason (optional) + branch PIN, and it applies at once. That is
// the difference from the old "เปลี่ยนผู้เช่า" (SWAP_PRIMARY_CUSTOMER), which
// opened a document and waited for every party to sign; that button is hidden
// now. The backend refuses while the co-lessee's addendum is still collecting
// signatures (SALE.STATE.CO_LESSEE_NOT_SIGNED) — the band then offers the
// signing tab.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input } from 'tsp-form';
import { Loader2, PenLine } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { BranchPinInput } from '../../components/BranchPinInput';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from './ActionDoneView';

interface SetPrimaryResult {
  contract_id: number;
  from_customer_id: number;
  to_customer_id: number;
  former_primary_role: string;
  applied: boolean;
  voided_primary_swap_count: number;
}

export interface SetPrimaryTarget {
  customer_id: number;
  customer_name: string;
}

export function SetPrimaryCustomerModal({
  target: targetProp,
  onClose,
  contractId,
  contractCode,
  currentPrimaryName,
  onGoToSigning,
}: {
  /** The co-lessee to promote; null = closed. */
  target: SetPrimaryTarget | null;
  onClose: () => void;
  contractId: number;
  contractCode: string;
  currentPrimaryName: string | null;
  /** Jump the detail panel to the Signing tab when the addendum is not signed yet. */
  onGoToSigning?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // Keep the last target through the close transition.
  const last = useRef(targetProp);
  if (targetProp) last.current = targetProp;
  const target = targetProp ?? last.current;
  const open = targetProp !== null;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notSigned, setNotSigned] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setView('form'); setPin(''); setReason(''); setError(''); setNotSigned(false); setSubmitting(false); }
  }, [open]);

  const dirty = pin.length > 0 || reason.trim().length > 0;
  const [confirmClose, setConfirmClose] = useState(false);
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (submitting) return;
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (!target) return;
    setSubmitting(true); setError(''); setNotSigned(false);
    try {
      await apiClient.rpc<SetPrimaryResult>('fn_contract_set_primary_customer', {
        p_contract_id: contractId,
        p_customer_id: target.customer_id,
        p_reason: reason.trim() || null,
        p_note: null,
        p_pin: pin,
      });
      // Applies at once: the primary, the header and the action list all change.
      queryClient.invalidateQueries({ queryKey: ['contract-customers', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-actions', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-signings', contractId] });
      setView('done');
    } catch (err) {
      if (err instanceof ApiError) {
        setNotSigned(err.code === 'SALE.STATE.CO_LESSEE_NOT_SIGNED');
        const tr = translateApiError(err, t);
        setError(tr || err.code || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const name = target?.customer_name ?? '';
  const former = currentPrimaryName ?? '';

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.setPrimary.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>&times;</button>
        </div>
        {view === 'done' ? (
          <ActionDoneView
            headline={t('contract.setPrimary.done', { name })}
            contractCode={contractCode}
            detailRows={[
              { label: t('contract.primaryCustomer'), value: name, emphasis: true },
              { label: t('contract.coLessees'), value: former },
            ]}
            extras={<p className="text-xs text-subtle">{t('contract.setPrimary.documentsUnchanged')}</p>}
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{contractCode}</div>
              </div>
              <p className="text-sm mt-3 mb-1">
                {t('contract.setPrimary.confirm', { name, former })}
              </p>
              <p className="text-xs text-subtle mb-4">{t('contract.setPrimary.hint')}</p>
              <div className="form-grid gap-3">
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.reason', { defaultValue: 'Reason (optional)' })}</label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" />
                </div>
                <BranchPinInput value={pin} onChange={setPin} required />
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              {notSigned && onGoToSigning && (
                <Button size="sm" variant="outline" startIcon={<PenLine size={14} />} onClick={() => { forceClose(); onGoToSigning(); }}>
                  {t('contract.goToSigning')}
                </Button>
              )}
              <span className="flex-1" />
              <Button onClick={handleClose} disabled={submitting}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                onClick={submit}
                disabled={submitting || pin.length !== 6}
                startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : undefined}
              >
                {submitting ? t('common.saving') : t('contract.setPrimary.submit')}
              </Button>
            </div>
          </>
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
