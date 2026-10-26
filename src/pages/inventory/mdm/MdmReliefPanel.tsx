// ============================================================================
// "ผ่อนปรน 24 ชั่วโมง" — IMPLEMENT 2026-10-26 mdm_relief_24h (nnf mig 1527 ·
// nnf-mdm migs 383-386).
//
// A customer more than ten days late is at `hard`: the bank apps are blocked,
// so they can't transfer the money they've called to pay. The button steps the
// device down to `medium` for 24 hours (bank apps back, dunning image stays).
// It reverts by itself if unpaid; anything lighter (promise, slip, payment)
// still wins. Pressing again restarts the 24 hours.
//
// Everything shown comes from fn_mdm_relief_24h_status: whether to show the
// button (`can_grant`), its label, the top-of-tab banner, the "device silent"
// warning — the `*_th` fields are printed as they come, never composed here.
// Pressing is a queued command like every MDM action: the reply says it was
// SENT, and the device follows when it next checks in.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal, TextArea } from 'tsp-form';
import { Hourglass, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { ModalErrorBand } from '../../../components/ModalErrorBand';
import { ActionDoneView } from '../../contracts/ActionDoneView';
import {
  fetchReliefStatus, grantRelief, parseMdmError,
  type MdmReliefStatus, type MdmReliefGrantResult,
} from './mdmApi';
import { MDM_NO_CACHE } from './useMdmStatus';

/** The relief state of one device. Starts with `mdm-` so the tab's manual
 *  refresh reloads it with everything else. */
export function useMdmRelief(serial: string | null, enabled: boolean) {
  return useQuery<MdmReliefStatus>({
    queryKey: ['mdm-relief', serial],
    queryFn: () => fetchReliefStatus(serial!),
    enabled: enabled && !!serial,
    ...MDM_NO_CACHE,
    // The relief ends by itself after 24 hours; a slow poll keeps the banner honest.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/** Top-of-tab banner while a relief is running — on every sub-tab, like the pause bar. */
export function MdmReliefBar({ relief }: { relief: MdmReliefStatus | null | undefined }) {
  if (!relief?.active || !relief.banner_th) return null;
  return (
    <div className="alert alert-warning">
      <Hourglass size={18} />
      <div className="alert-description">{relief.banner_th}</div>
    </div>
  );
}

/** Sub-tab 3's relief card: the button, with what the staffer should know first. */
export function MdmReliefPanel({ serial, relief, onGranted }: {
  serial: string | null;
  relief: MdmReliefStatus | null | undefined;
  onGranted: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The window stays mounted while open even if the next status read drops
  // the button (the device left hard meanwhile) — it keeps the last state.
  const lastRelief = useRef(relief);
  if (relief) lastRelief.current = relief;
  const shown = relief ?? lastRelief.current;
  return (
    <>
      {relief?.can_grant && serial && (
    <div className="border border-line rounded-md p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Hourglass size={16} className="text-warning-fg" />
        <span className="text-sm font-semibold">{relief.label_th}</span>
      </div>
      <p className="text-xs text-subtle">{t('asset.mdm.relief.desc')}</p>
      {relief.overdue_days != null && relief.hard_from_days != null && (
        <p className="text-xs text-subtle tabular-nums">
          {t('asset.mdm.relief.overdue', { days: relief.overdue_days, from: relief.hard_from_days })}
        </p>
      )}
      {relief.warning_th && (
        <p className="text-xs text-warning-fg inline-flex items-start gap-1.5">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          {relief.warning_th}
        </p>
      )}
      <div>
        <Button size="sm" color="primary" startIcon={<Hourglass size={14} />} onClick={() => setOpen(true)}>
          {relief.label_th}
        </Button>
      </div>
    </div>
      )}
      {shown && serial && (
        <MdmReliefDialog
          open={open}
          serial={serial}
          relief={shown}
          onClose={() => setOpen(false)}
          onGranted={onGranted}
        />
      )}
    </>
  );
}

function MdmReliefDialog({ open, serial, relief, onClose, onGranted }: {
  open: boolean;
  serial: string;
  relief: MdmReliefStatus;
  onClose: () => void;
  onGranted: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const actorId = user?.user_id ?? null;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MdmReliefGrantResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setReason('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (reason.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleSubmit = async () => {
    if (actorId == null || !reason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await grantRelief(serial, actorId, reason.trim());
      setResult(res);
      setView('done');
      onGranted();
    } catch (err) {
      setError(parseMdmError(err, t).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%" ariaLabel={relief.label_th ?? ''}>
        <div className="modal-header">
          <h2 className="modal-title">{relief.label_th}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>
        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm font-mono">{serial}</div>
                {relief.overdue_days != null && relief.hard_from_days != null && (
                  <div className="text-xs text-subtle">
                    {t('asset.mdm.relief.overdue', { days: relief.overdue_days, from: relief.hard_from_days })}
                  </div>
                )}
              </div>
              <p className="text-sm text-subtle mt-3">{t('asset.mdm.relief.desc')}</p>
              {relief.warning_th && (
                <div className="alert alert-warning mt-3">
                  <AlertTriangle size={16} />
                  <div className="alert-description">{relief.warning_th}</div>
                </div>
              )}
              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('asset.mdm.relief.reasonLabel')} *</label>
                  <TextArea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={3}
                    placeholder={t('asset.mdm.relief.reasonPlaceholder')}
                  />
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleSubmit} disabled={saving || !reason.trim() || actorId == null}>
                {relief.label_th}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('asset.mdm.relief.doneHeadline')}
            contractCode={serial}
            extras={
              <div className="flex flex-col gap-2">
                <p className="text-sm">{result.message_th}</p>
                {result.warning_th && (
                  <div className="alert alert-warning">
                    <AlertTriangle size={16} />
                    <div className="alert-description">{result.warning_th}</div>
                  </div>
                )}
              </div>
            }
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%" ariaLabel={t('common.unsavedChanges')}>
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
