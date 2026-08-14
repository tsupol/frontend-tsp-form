// ============================================================================
// Sub-tab 5 — ควบคุมแอป (131 §7). Everything about this device's apps, in the
// order a person needs it:
//
//  GATE   — "ให้ลูกค้าลบแอปเอง" at the very top, because while it's open that is
//           live state and must not be buried under sixty app rows (IMPLEMENT
//           2026-08-13 mdm_app_removal_gate §1).
//  LIST   — the installed apps the device reported, each with a remove button
//           behind the OTP ritual (IMPLEMENT 2026-08-13 remove_app_staff_ritual).
//           This list used to sit in sub-tab 2; it moved here so apps are one
//           subject on one screen.
//  APPLY  — pick a preset → preview (p_preview:true) → confirm → apply. The
//           preview shows the resolved app_count + bundle list (with icons, §7.1).
//           Only apply returns an intent_id (tracked in the queue).
//  REMOVE — §7.0: the missing counterpart. "Remove app restriction" via
//           fn_mdm_remove_app_whitelist (preview→confirm), gated on
//           app_whitelist_active. Same permission as apply by design.
//
// The two removal features are different acts, not duplicates: the GATE lets the
// customer remove their own apps and carry the responsibility; the LIST's button
// has staff remove one on their behalf. Seeing both at once is how the operator
// picks the right one.
//
// ⚠️ app_count > the preset's list is expected — the system always adds the
// baseline apps (phone/messages/settings/NNF) so the device stays usable (§7).
// ⚠️ will_be_a_no_op → warn before removing: pulling a profile the device
// doesn't have makes Apple error (12075), which reads as "failed" (§7.0).
// ============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Select, Modal } from 'tsp-form';
import { Eye, Send, PackageCheck, Unlock, AlertTriangle, XCircle, Loader2, CheckCircle } from 'lucide-react';
import {
  fetchWhitelistPresets, applyAppWhitelist, removeAppWhitelist, parseMdmError,
  type AssetMdmStatus, type ApplyPresetResult, type ParsedMdmError, type RemoveWhitelistResult,
} from './mdmApi';
import { useMdmCommand } from './useMdmCommand';
import { MdmErrorAlert, CommandAckNote, AppIcon } from './MdmSharedBits';
import { RelativeDateTime } from './RelativeDateTime';
import { MdmAppGatePanel } from './MdmAppGatePanel';
import { MdmDeviceAppsSection } from './MdmDeviceAppsSection';

export function SubTabAppControl({
  status,
  onAck,
  onNotEnrolled,
  onChanged,
}: {
  status: AssetMdmStatus;
  onAck: (intentIds: number[]) => void;
  onNotEnrolled: () => void;
  /** Re-read the status row — the gate changes the device's lock level. */
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<ApplyPresetResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<ParsedMdmError | null>(null);
  const cmd = useMdmCommand({ onAck, onNotEnrolled });

  const { data: presets = [] } = useQuery({
    queryKey: ['mdm-whitelist-presets'],
    queryFn: fetchWhitelistPresets,
  });

  const runPreview = async () => {
    if (!presetKey) return;
    setPreviewing(true);
    setPreviewError(null);
    cmd.reset();
    try {
      const r = await applyAppWhitelist(status.asset_id, presetKey, true);
      setPreview(r);
    } catch (err) {
      setPreview(null);
      setPreviewError(parseMdmError(err, t));
    } finally {
      setPreviewing(false);
    }
  };

  const applyReal = async () => {
    if (!presetKey) return;
    // p_preview MUST be false here (§7 gotcha).
    await cmd.run(
      () => applyAppWhitelist(status.asset_id, presetKey, false),
      (r) => (r.intent_id != null ? [r.intent_id] : []),
    );
    setPreview(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Live state first — see the file header on why this is at the top. */}
      <MdmAppGatePanel serial={status.serial_number} onChanged={onChanged} />

      {/* What's actually on the device, with the per-app remove button. */}
      <MdmDeviceAppsSection
        assetId={status.asset_id}
        serial={status.serial_number}
        onNotEnrolled={onNotEnrolled}
      />

      <p className="text-sm text-subtle">{t('asset.mdm.appControl.intro')}</p>

      <MdmErrorAlert error={cmd.error ?? previewError} onGoToEnroll={onNotEnrolled} />
      <CommandAckNote show={cmd.acked && !cmd.error} />

      <div className="flex items-end gap-2">
        <div className="flex flex-col flex-1 min-w-0">
          <label className="form-label">{t('asset.mdm.appControl.presetLabel')}</label>
          <Select
            value={presetKey}
            onChange={(v) => { setPresetKey(v as string); setPreview(null); }}
            options={presets.map((p) => ({ value: p.preset_key, label: p.display_name }))}
            placeholder={t('asset.mdm.appControl.presetPlaceholder')}
            size="sm"
            showChevron
          />
        </div>
        <Button variant="outline" size="sm" startIcon={<Eye size={15} />} disabled={!presetKey || previewing} onClick={runPreview}>
          {t('asset.mdm.appControl.preview')}
        </Button>
      </div>

      {preview && (
        <div className="border border-line rounded-md p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <PackageCheck size={16} className="text-info-fg" />
            <span className="text-sm font-semibold">{t('asset.mdm.appControl.previewTitle')}</span>
          </div>
          <div className="text-sm text-subtle">
            {t('asset.mdm.appControl.appCount', { count: preview.app_count })}
          </div>
          <div className="text-xs text-subtler">{t('asset.mdm.appControl.baselineNote')}</div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-60 overflow-auto better-scroll">
            {preview.bundle_ids.map((b) => (
              <li key={b} className="flex items-center gap-2 min-w-0">
                <AppIcon bundleId={b} size={26} />
                <span className="text-xs font-mono text-subtle truncate">{b}</span>
              </li>
            ))}
          </ul>
          <div>
            <Button color="primary" size="sm" startIcon={<Send size={15} />} disabled={cmd.pending} onClick={applyReal}>
              {t('asset.mdm.appControl.apply')}
            </Button>
          </div>
        </div>
      )}

      {/* §7.0 — remove app restriction. */}
      <RemoveRestrictionSection status={status} onAck={onAck} onNotEnrolled={onNotEnrolled} />
    </div>
  );
}

// ── Remove app restriction (§7.0) ────────────────────────────────────────────

function RemoveRestrictionSection({
  status,
  onAck,
  onNotEnrolled,
}: {
  status: AssetMdmStatus;
  onAck: (intentIds: number[]) => void;
  onNotEnrolled: () => void;
}) {
  const { t } = useTranslation();
  const active = status.app_whitelist_active; // true / false / null
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<RemoveWhitelistResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cmd = useMdmCommand({ onAck, onNotEnrolled });

  // false = device confirmed no whitelist → button off. true/null → allow (null
  // = never pulled the profile list; allow but say "status unknown").
  const canRemove = active !== false;

  const openConfirm = async () => {
    setErr(null);
    setPreview(null);
    setConfirmOpen(true);
    setBusy(true);
    try {
      setPreview(await removeAppWhitelist(status.asset_id, true));
    } catch (e) {
      setErr(parseMdmError(e, t).message);
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async () => {
    setConfirmOpen(false);
    await cmd.run(
      () => removeAppWhitelist(status.asset_id, false),
      (r) => (r.intent_id != null ? [r.intent_id] : []),
    );
  };

  return (
    <div className="border border-line rounded-md p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Unlock size={16} className="text-subtle" />
        <span className="text-sm font-semibold">{t('asset.mdm.appControl.remove.title')}</span>
      </div>

      {active === false ? (
        <p className="text-xs text-subtle inline-flex items-center gap-1">
          <CheckCircle size={13} className="text-success-fg" />{t('asset.mdm.appControl.remove.none')}
        </p>
      ) : active === null ? (
        <p className="text-xs text-subtler">{t('asset.mdm.appControl.remove.unknown')}</p>
      ) : (
        <p className="text-xs text-subtle">
          {t('asset.mdm.appControl.remove.active')}
          {status.app_whitelist_checked_at && (
            <> · <RelativeDateTime value={status.app_whitelist_checked_at} /></>
          )}
        </p>
      )}

      <MdmErrorAlert error={cmd.error} onGoToEnroll={onNotEnrolled} />
      <CommandAckNote show={cmd.acked && !cmd.error} />

      {/* Only offer the button when there's something to remove (or unknown).
          When nothing is active, the status line above already says so — a
          disabled "Remove restriction" would just repeat it. */}
      {canRemove && (
        <div>
          <Button
            variant="outline"
            size="sm"
            startIcon={<Unlock size={15} />}
            disabled={cmd.pending}
            onClick={openConfirm}
          >
            {t('asset.mdm.appControl.remove.button')}
          </Button>
        </div>
      )}

      <Modal open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} maxWidth="26rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('asset.mdm.appControl.remove.confirmTitle')}</h2>
        </div>
        <div className="modal-content">
          {busy && !preview ? (
            <div className="flex items-center gap-2 text-sm text-subtle py-2">
              <Loader2 size={16} className="animate-spin" />{t('common.loading')}
            </div>
          ) : err ? (
            <div className="alert alert-danger"><XCircle size={16} /><span>{err}</span></div>
          ) : preview ? (
            <>
              <p className="text-sm text-subtle">{t('asset.mdm.appControl.remove.confirmBody')}</p>
              {status.serial_number && (
                <p className="text-sm mt-2">
                  <span className="text-subtle">{t('asset.mdm.dunning.deviceLabel')}:</span>{' '}
                  <span className="font-mono">{status.serial_number}</span>
                </p>
              )}
              {preview.will_be_a_no_op && (
                <div className="alert alert-warning mt-3">
                  <AlertTriangle size={16} />
                  <div className="alert-description">{t('asset.mdm.appControl.remove.noOpWarn')}</div>
                </div>
              )}
            </>
          ) : null}
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>{t('common.cancel')}</Button>
          <Button color="primary" onClick={doRemove} disabled={busy || !preview} startIcon={<Unlock size={15} />}>
            {t('asset.mdm.appControl.remove.confirmButton')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
