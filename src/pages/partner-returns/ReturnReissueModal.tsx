// "ออกใบรับคืนใหม่" — issue the customer a fresh return receipt.
//
// The receipt the customer signs expires after seven days. When it lapses (or
// was voided) the shop cannot collect a signature any more, and the document is
// stuck at OPEN. Reissuing voids the old unsigned receipt and makes a new one;
// nothing else about the return changes, which is why this is a confirmation.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { usePartnerReturnInvalidate } from './usePartnerReturns';
import type { PartnerReturnDetail, ReturnSigningReissueResult } from './partnerReturnTypes';

interface Props {
  open: boolean;
  detail: PartnerReturnDetail | null;
  onClose: () => void;
}

export function ReturnReissueModal({ open, detail, onClose }: Props) {
  const { t } = useTranslation();
  const invalidate = usePartnerReturnInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnSigningReissueResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setSaving(false);
    setError(null);
    setResult(null);
  }, [open]);

  // Nothing is typed here, so there is no dirty state to guard.
  const handleClose = () => onClose();

  const handleReissue = async () => {
    if (!detail) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<ReturnSigningReissueResult>('fn_partner_return_signing_reissue', {
        p_return_id: detail.return_id,
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
    <Modal
      open={open}
      onClose={handleClose}
      maxWidth="30rem"
      width="100%"
      ariaLabel={t('partnerReturn.action_SIGNING_REISSUE')}
    >
      <div className="modal-header">
        <h2 className="modal-title">{t('partnerReturn.action_SIGNING_REISSUE')}</h2>
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
            </div>

            <div className="alert alert-info mt-3">
              <Info size={16} className="shrink-0" />
              <span>{t('partnerReturn.reissueHint')}</span>
            </div>
          </div>

          <ModalErrorBand message={error} onDismiss={() => setError(null)} />

          <div className="modal-footer">
            <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
            <Button color="primary" onClick={handleReissue} disabled={saving}>
              {t('partnerReturn.action_SIGNING_REISSUE')}
            </Button>
          </div>
        </>
      ) : result && (
        <ActionDoneView
          headline={t('partnerReturn.reissuedHeadline')}
          contractCode={result.return_code}
          detailRows={[
            { label: t('partnerReturn.signingDocument'), value: `#${result.signing_id ?? '—'}` },
          ]}
          onClose={handleClose}
        />
      )}
    </Modal>
  );
}
