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
// Everything shown comes from fn_mdm_relief_24h_status: whether the button can
// be pressed (`can_grant`), its label, the top-of-tab banner, the "device silent"
// warning — the `*_th` fields are printed as they come, never composed here.
// The button itself is shown to everyone holding MDM.RELIEF_24H (IMPLEMENT
// 2026-11-12 relief_24h_for_collectors §3.2b), greyed with a reason otherwise.
// Pressing is a queued command like every MDM action: the reply says it was
// SENT, and the device follows when it next checks in.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { Button, Modal, TextArea } from 'tsp-form';
import { Hourglass, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { ModalErrorBand } from '../../../components/ModalErrorBand';
import { ActionDoneView } from '../../contracts/ActionDoneView';
import {
  fetchReliefStatus, grantRelief, parseMdmError,
  type MdmReliefStatus, type MdmReliefGrantResult,
} from './mdmApi';
import { MDM_NO_CACHE } from './useMdmStatus';
import { useMyPermissions } from '../../../hooks/useMyPermissions';

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

/** Which line goes under the button, and whether it can be pressed — work order
 *  2026-11-12 relief_24h_for_collectors §3.2b, first match wins. Every value comes
 *  from the status read; the screen only picks the sentence. */
function reliefState(t: TFunction, r: MdmReliefStatus): { enabled: boolean; note: string | null; noteTone: 'warning' | 'subtle' } {
  if (r.can_grant && !r.active) return { enabled: true, note: r.warning_th, noteTone: 'warning' };
  if (r.can_grant && r.active) {
    return { enabled: true, note: [r.banner_th, t('asset.mdm.relief.againNote')].filter(Boolean).join(' · '), noteTone: 'subtle' };
  }
  // Row 3 (NOTICE 469): not in dunning — the backend says why in its own words.
  if (r.ladder_reason === 'NOT_CARE') return { enabled: false, note: r.ladder_reason_th, noteTone: 'subtle' };
  if (r.ladder_days == null) return { enabled: false, note: t('asset.mdm.relief.notInDunning'), noteTone: 'subtle' };
  if (!r.on_hard && r.active) return { enabled: false, note: r.banner_th, noteTone: 'subtle' };
  if (!r.on_hard) {
    const days = r.contract_overdue_days;
    // Row 5 (NOTICE 469): the ladder counts fewer days than the contract (a promise,
    // GRACE, a holiday) — print the backend's reason and the real count beside it.
    // Never work the reason out from the two numbers.
    if (r.ladder_reason) {
      return {
        enabled: false, noteTone: 'subtle',
        note: [r.ladder_reason_th, days != null ? t('asset.mdm.relief.realOverdue', { days }) : null].filter(Boolean).join(' · '),
      };
    }
    if (days == null || days === 0) {
      return { enabled: false, noteTone: 'subtle', note: t('asset.mdm.relief.notHardZero', { from: r.hard_from_days ?? '—' }) };
    }
    return {
      enabled: false, noteTone: 'subtle',
      note: r.hard_from_days != null
        ? t('asset.mdm.relief.notHard', { from: r.hard_from_days, days })
        : t('asset.mdm.relief.notHardNoFrom', { days }),
    };
  }
  return { enabled: false, note: t('asset.mdm.relief.outsideScope'), noteTone: 'subtle' };
}

/** The 24-hour relief button, in the same place every time (owner 11-12: collectors
 *  kept asking where it went). Shown to anyone holding MDM.RELIEF_24H for a device
 *  bound to MDM; pressable only when the DB says `can_grant`, otherwise greyed with
 *  the reason written under it (no tooltip — iPads have no hover). Used in the MDM
 *  sub-tab, the collector detail and the dunning-queue panel.
 *  `bare` drops the title + description, for the collector panels. */
export function MdmReliefPanel({ serial, onGranted, bare = false }: {
  /** The serial the customer holds (loaner first). null = not bound to MDM → nothing shown. */
  serial: string | null;
  onGranted?: () => void;
  bare?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { hasPermission } = useMyPermissions();
  const mayPress = hasPermission('MDM.RELIEF_24H');
  const { data: relief, isLoading, error, refetch, isFetching } = useMdmRelief(serial, mayPress);
  const [open, setOpen] = useState(false);
  // The window stays mounted while open even if the next status read greys the
  // button (the device left hard meanwhile) — it keeps the last state.
  const lastRelief = useRef(relief);
  if (relief) lastRelief.current = relief;
  const shown = relief ?? lastRelief.current;

  if (!mayPress || !serial) return null;
  const parsed = error ? parseMdmError(error, t) : null;
  // The device is not in the MDM at all — nothing to relieve, nothing to say.
  if (parsed?.code === 'MDM.NOT_FOUND.ASSET_FOR_SERIAL') return null;

  const label = relief?.label_th || t('asset.mdm.relief.button');
  const state = relief ? reliefState(t, relief) : null;
  const granted = () => {
    refetch();
    // The person gets the relief mark in the queue and the book (relief_until).
    queryClient.invalidateQueries({ queryKey: ['cc', 'book'] });
    onGranted?.();
  };

  return (
    <>
      <div className="border border-line rounded-md p-3 flex flex-col gap-2" data-relief-box>
        {!bare && (
          <>
            <div className="flex items-center gap-2">
              <Hourglass size={16} className="text-warning-fg" />
              <span className="text-sm font-semibold">{label}</span>
            </div>
            <p className="text-xs text-subtle">{t('asset.mdm.relief.desc')}</p>
          </>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            color={state?.enabled ? 'primary' : undefined}
            variant={state?.enabled ? undefined : 'outline'}
            startIcon={isLoading ? <Loader2 size={14} className="animate-spin" /> : <Hourglass size={14} />}
            disabled={!state?.enabled}
            data-action="RELIEF_24H"
            data-blocked-reason={state && !state.enabled ? (state.note ?? '') : undefined}
            onClick={() => setOpen(true)}
          >
            {label}
          </Button>
          {state?.enabled && relief?.contract_overdue_days != null && relief.hard_from_days != null && (
            <span className="text-xs text-subtle tabular-nums">
              {t('asset.mdm.relief.overdue', { days: relief.contract_overdue_days, from: relief.hard_from_days })}
            </span>
          )}
          {parsed && (
            <Button size="sm" variant="ghost" startIcon={<RefreshCw size={14} />} disabled={isFetching} onClick={() => refetch()}>
              {t('common.retry')}
            </Button>
          )}
        </div>
        {parsed ? (
          <p className="text-xs text-danger-fg">{t('asset.mdm.relief.loadFailed')}</p>
        ) : state?.note ? (
          <p className={`text-xs inline-flex items-start gap-1.5 ${state.noteTone === 'warning' ? 'text-warning-fg' : 'text-subtle'}`}>
            {state.noteTone === 'warning' && <AlertTriangle size={13} className="shrink-0 mt-0.5" />}
            {state.note}
          </p>
        ) : null}
      </div>
      {shown && (
        <MdmReliefDialog
          open={open}
          serial={serial}
          relief={shown}
          onClose={() => setOpen(false)}
          onGranted={granted}
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
                {relief.contract_overdue_days != null && relief.hard_from_days != null && (
                  <div className="text-xs text-subtle">
                    {t('asset.mdm.relief.overdue', { days: relief.contract_overdue_days, from: relief.hard_from_days })}
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
