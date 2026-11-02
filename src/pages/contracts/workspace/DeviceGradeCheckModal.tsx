import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Modal, RadioGroup } from 'tsp-form';
import { AlertTriangle } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { blockingReasonText, translateApiError } from '../../../lib/apiErrors';
import { CONDITION_VALUES, getConditionLabel } from '../../inventory/inventoryUtils';
import { ActionDoneView } from '../ActionDoneView';
import { ModalErrorBand } from '../../../components/ModalErrorBand';

// ============================================================================
// The last look at a device's grade before a shop's contract points at it.
//
// The grade is a fact about the device and decides the contract's new or used
// path. While a contract holds the device the backend refuses a grade change
// (INV.STATE.ASSET_IN_CREDIT_USE, mig 1484), so this is the last moment a shop
// can correct a device it registered wrong.
//
// It asks instead of confirming: a shop that doesn't know it made a mistake
// would press through "is this right?". So nothing is selected, the shop says
// what the device is, and only an answer that differs from the registration
// raises the warning. A correction goes through the same revalue the asset page
// uses; an answer that matches writes nothing.
// ============================================================================

export interface GradeCheckDevice {
  asset_id: number;
  asset_code_display: string;
  product_display_name: string | null;
  condition_grade: string;
  serial_no: string | null;
  imei: string | null;
  battery_health: number | null;
  has_box: boolean | null;
}

interface RevalueActionsResponse {
  actions: {
    action_code: string;
    is_available: boolean;
    blocking_reason: string | null;
    blocking_params?: Record<string, unknown> | null;
  }[];
}

interface Props {
  open: boolean;
  /** Stays set after closing, so the body doesn't blank during the fade-out. */
  device: GradeCheckDevice | null;
  /** Label of the done step's button: what happens next differs per caller. */
  continueLabel: string;
  onClose: () => void;
  /** The grade was saved. Runs at save time, even if the window is then closed with ×. */
  onGradeChanged: (grade: string) => void;
  /** The shop's answer matched, or it pressed on from the done step. */
  onContinue: () => void;
}

export function DeviceGradeCheckModal({ open, device, continueLabel, onClose, onGradeChanged, onContinue }: Props) {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState('');
  const [view, setView] = useState<'form' | 'done'>('form');
  const [saved, setSaved] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const assetId = device?.asset_id;
  const registered = device?.condition_grade ?? '';

  useEffect(() => {
    if (!open) return;
    setAnswer('');
    setView('form');
    setSaved(null);
    setError(null);
    setConfirmClose(false);
  }, [open, assetId]);

  // Same query key as the asset page, so both read one answer.
  const { data: actions, error: actionsError } = useQuery({
    queryKey: ['asset-actions', assetId],
    queryFn: () => apiClient.rpc<RevalueActionsResponse>('fn_asset_available_actions', { p_asset_id: assetId }),
    enabled: open && assetId != null,
    staleTime: 30 * 1000,
  });
  const revalue = actions?.actions.find(a => a.action_code === 'ASSET_REVALUE');

  // Real grades only: 'USED' is a filter value, not a grade a device can have.
  const gradeOptions = useMemo(
    () => CONDITION_VALUES.filter(v => v !== 'USED').map(v => ({ value: v, label: getConditionLabel(v, t) })),
    [t],
  );

  const mismatch = view === 'form' && answer !== '' && answer !== registered;

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_inv_asset_revalue', {
      p_asset_id: assetId,
      p_new_cost_basis: null, // null keeps the cost as it is
      p_reason: 'DATA_CORRECTION',
      p_condition_grade: answer,
      p_dedupe_key: `GRADE_CHECK-${assetId}-${Date.now()}`,
    }),
    onSuccess: () => {
      setSaved({ from: registered, to: answer });
      setView('done');
      onGradeChanged(answer);
    },
    onError: (err) => setError(translateApiError(err, t)),
  });

  const handleClose = () => {
    if (mutation.isPending) return;
    if (mismatch) { setConfirmClose(true); return; }
    onClose();
  };

  const facts = device ? [
    device.battery_health != null
      ? t('gradeCheck.batteryValue', { value: device.battery_health })
      : t('gradeCheck.batteryNone'),
    ...(device.has_box == null ? [] : [t(device.has_box ? 'gradeCheck.hasBox' : 'gradeCheck.noBox')]),
  ] : [];

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('gradeCheck.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>
        {view === 'done' && saved ? (
          <ActionDoneView
            headline={t('gradeCheck.doneHeadline')}
            contractCode={device?.asset_code_display ?? ''}
            stateTransition={{
              from: getConditionLabel(saved.from, t),
              to: getConditionLabel(saved.to, t),
              toColor: 'success',
            }}
            doneLabel={continueLabel}
            onClose={onContinue}
          />
        ) : (
          <>
            <div className="modal-content flex flex-col gap-4">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{device?.asset_code_display}</div>
                {device?.product_display_name && <div className="text-xs text-subtle">{device.product_display_name}</div>}
                {(device?.serial_no || device?.imei) && (
                  <div className="text-xs text-subtle">{device.serial_no ?? device.imei}</div>
                )}
                <div className="text-xs text-subtle">{facts.join(' · ')}</div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="form-label">{t('gradeCheck.question')}</div>
                <RadioGroup
                  name="device-grade-check"
                  value={answer}
                  onChange={(v) => { setAnswer(v as string); setError(null); }}
                  className="flex flex-col gap-2"
                  options={gradeOptions}
                />
              </div>

              {mismatch && (
                <div className="alert alert-warning">
                  <AlertTriangle size={18} />
                  <div>
                    <div className="alert-title">
                      {t('gradeCheck.mismatch', {
                        registered: getConditionLabel(registered, t),
                        picked: getConditionLabel(answer, t),
                      })}
                    </div>
                    {revalue?.is_available && <div className="text-sm">{t('gradeCheck.lockWarning')}</div>}
                    {revalue && !revalue.is_available && revalue.blocking_reason && (
                      <div className="text-sm">{blockingReasonText(revalue, t)}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <ModalErrorBand message={error ?? (mismatch && actionsError ? translateApiError(actionsError, t) : null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={mutation.isPending}>{t('common.cancel')}</Button>
              {mismatch ? (
                <Button
                  color="primary"
                  onClick={() => mutation.mutate()}
                  disabled={mutation.isPending || !revalue?.is_available}
                >
                  {mutation.isPending ? t('common.saving') : t('gradeCheck.changeTo', { grade: getConditionLabel(answer, t) })}
                </Button>
              ) : (
                <Button color="primary" onClick={onContinue} disabled={answer === ''}>{t('gradeCheck.useDevice')}</Button>
              )}
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={() => { setConfirmClose(false); onClose(); }}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
