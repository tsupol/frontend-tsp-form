// Finance ticks (or un-ticks) "checked" on a close-out — mig 1270, 140 §6.
//
// The tick is not a status: the settlement stays CLOSE_SUBMITTED. It is the
// gate on issuing a payout document, so it is worth a confirm step with an
// optional note that lands in the history.
//
// `changed: false` means the flag was already in that state — the call is a
// no-op, not a failure, so it still shows as done and still refetches (someone
// else may have moved it).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { usePartnerSettlementInvalidate } from './usePartnerSettlements';
import type {
  PartnerSettlementDetail,
  PartnerSettlementFinanceCheckResult,
} from './partnerSettlementTypes';

interface PartnerSettlementCheckModalProps {
  open: boolean;
  detail: PartnerSettlementDetail | null;
  /** True = ticking it on, false = taking the tick back. */
  checked: boolean;
  onClose: () => void;
}

export function PartnerSettlementCheckModal({
  open, detail, checked, onClose,
}: PartnerSettlementCheckModalProps) {
  const { t } = useTranslation();
  const invalidate = usePartnerSettlementInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PartnerSettlementFinanceCheckResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setNote('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  const settlementCode = detail?.settlement_code ?? '';
  const title = checked
    ? t('partnerSettlement.checkTitle')
    : t('partnerSettlement.uncheckTitle');

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (note.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (!detail) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<PartnerSettlementFinanceCheckResult>(
        'fn_partner_settlement_finance_check',
        {
          p_settlement_id: detail.settlement_id,
          p_checked: checked,
          p_note: note.trim() || null,
        },
      );
      setResult(res);
      setView('done');
      invalidate();
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
        maxWidth="28rem"
        width="100%"
        ariaLabel={title}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{settlementCode}</div>
                <div className="text-xs text-subtle mt-0.5">{detail?.branch_name}</div>
              </div>

              <div className="alert alert-info mt-3">
                <Info size={16} className="shrink-0" />
                <span>
                  {checked
                    ? t('partnerSettlement.checkHint')
                    : t('partnerSettlement.uncheckHint')}
                </span>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerSettlement.checkNote')}</label>
                  <TextArea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={2}
                    placeholder={t('partnerSettlement.checkNotePlaceholder')}
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
                color={checked ? 'primary' : 'danger'}
                onClick={submit}
                disabled={saving}
              >
                {title}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={checked
              ? t('partnerSettlement.checkDone')
              : t('partnerSettlement.uncheckDone')}
            contractCode={settlementCode}
            tone={checked ? 'success' : 'warning'}
            detailRows={[
              {
                label: t('partnerSettlement.checkedFlag'),
                value: result.checked
                  ? t('partnerSettlement.checkedYes')
                  : t('partnerSettlement.checkedNo'),
                emphasis: true,
              },
            ]}
            extras={!result.changed ? (
              <div className="alert alert-info">
                <Info size={16} className="shrink-0" />
                <span>{t('partnerSettlement.checkNoChange')}</span>
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
