// "คลังรับเครื่อง" — the fund's warehouse confirms the device arrived.
//
// Pressed by warehouse staff of the destination branch, or by finance on their
// behalf. The device lands in quarantine at the warehouse: it is not sellable
// stock until the warehouse clears it through the quarantine flow (doc 44), so
// the success view says so rather than implying the device is back in play.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { usePartnerReturnInvalidate } from './usePartnerReturns';
import type { PartnerReturnDetail, ReturnWarehouseReceiveResult } from './partnerReturnTypes';

interface Props {
  open: boolean;
  detail: PartnerReturnDetail | null;
  warehouseName?: string | null;
  onClose: () => void;
}

export function ReturnWarehouseReceiveModal({ open, detail, warehouseName, onClose }: Props) {
  const { t } = useTranslation();
  const invalidate = usePartnerReturnInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnWarehouseReceiveResult | null>(null);
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

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (note.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleReceive = async () => {
    if (!detail) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<ReturnWarehouseReceiveResult>('fn_partner_return_warehouse_receive', {
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
        maxWidth="30rem"
        width="100%"
        ariaLabel={t('partnerReturn.action_WAREHOUSE_RECEIVE')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerReturn.action_WAREHOUSE_RECEIVE')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{detail?.return_code ?? ''}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {detail?.branch_name}
                  {detail?.device_code && <> · {detail.device_code}</>}
                </div>
              </div>

              <div className="alert alert-info mt-3">
                <Info size={16} className="shrink-0" />
                <span>
                  {warehouseName
                    ? t('partnerReturn.warehouseReceiveHintNamed', { warehouse: warehouseName })
                    : t('partnerReturn.warehouseReceiveHint')}
                </span>
              </div>

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
              <Button color="primary" onClick={handleReceive} disabled={saving}>
                {t('partnerReturn.action_WAREHOUSE_RECEIVE')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerReturn.warehouseReceivedHeadline')}
            contractCode={result.return_code}
            detailRows={[
              ...(warehouseName
                ? [{ label: t('partnerReturn.warehouse'), value: warehouseName }]
                : []),
              { label: t('partnerReturn.deviceBucket'), value: t('partnerReturn.bucket_QUARANTINED') },
            ]}
            extras={(
              <div className="alert alert-info">
                <Info size={16} className="shrink-0" />
                <span>{t('partnerReturn.quarantineHint')}</span>
              </div>
            )}
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
