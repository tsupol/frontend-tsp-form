// ============================================================================
// The device's installed-app list, with a per-row remove button.
// IMPLEMENT 2026-08-13 mdm_remove_app_staff_ritual.
//
// The list itself is the §3.4 section that used to sit in sub-tab 2; it lives
// here now because everything about apps belongs on one screen (the doc's §0).
// Same collapsible header: count, staleness, Pull.
//
// What's new is the last column. Removing an app destroys its on-device data
// with no way back, so it wears the same ritual as erase: preview mints a
// server-side challenge, five seconds pass with the button dead, the server's
// four digits appear, the operator retypes them, and only then does the commit
// go out. MdmChallengeDialog does all of that; we just feed it.
//
// Two rules the column obeys:
//   • The button only exists for MDM.APP_REMOVE holders (company_admin /
//     branch_manager). MDM.APP_CONTROL — which branch_staff has, and which
//     covers the whitelist section above — does NOT cover this. A button that
//     only ever 403s is a support call, so the whole column is hidden instead.
//   • Rows the DB marks is_protected (the NNF app) get a lock, not a button.
//     The bundle id is never tested here: the DB owns that list, and hardcoding
//     it means the next protected app ships with a working delete button.
//
// After the command executes, the app does NOT disappear at once — the system
// re-queries the device ~15s later (mig 236 verify_delay, cron jitter can push
// it to ~75s), and the row goes when that observation lands. So the ack note
// says "sent", and the operator pulls again to confirm. Never imply it's gone.
// ============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { ShieldCheck, Lock, Trash2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { MdmSectionHeader } from './MdmSectionHeader';
import { newestObserved, usePullPoll } from './mdmSectionBits';
import { AppIcon, MdmErrorAlert } from './MdmSharedBits';
import { MdmChallengeDialog } from './MdmChallengeDialog';
import { MDM_NO_CACHE } from './useMdmStatus';
import { useMdmCommand } from './useMdmCommand';
import {
  fetchDeviceApps, queryApps,
  removeDeviceAppPreview, removeDeviceAppCommit, parseMdmError,
  type MdmDeviceApp, type MdmChallenge, type MdmRemoveAppPreview,
} from './mdmApi';

/** The app the challenge dialog is currently about. */
interface RemoveTarget {
  app: MdmDeviceApp;
  preview: MdmRemoveAppPreview;
  challenge: MdmChallenge;
}

export function MdmDeviceAppsSection({
  assetId,
  serial,
  onNotEnrolled,
}: {
  assetId: number;
  serial: string | null;
  onNotEnrolled: () => void;
}) {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const actorId = user?.user_id ?? null;
  const mayRemove = can('MDM.APP_REMOVE');

  const [open, setOpen] = useState(true); // this sub-tab is about apps — start open
  const qc = useQueryClient();
  const queryKey = ['mdm-device-apps', assetId];

  const q = useQuery<MdmDeviceApp[]>({
    queryKey,
    queryFn: () => fetchDeviceApps(assetId),
    enabled: open,
    ...MDM_NO_CACHE,
  });

  const observedAt = q.data ? newestObserved(q.data) : null;
  const cmd = useMdmCommand({ onNotEnrolled });
  const pulling = usePullPoll({
    enabled: open, observedAt, refetch: () => qc.invalidateQueries({ queryKey }),
  });

  const pull = () => {
    if (actorId == null) return;
    if (!open) setOpen(true);
    pulling.start();
    cmd.run(() => queryApps(assetId, actorId));
  };

  // ── remove-one-app ritual ─────────────────────────────────────────────────
  const [target, setTarget] = useState<RemoveTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const startRemove = async (app: MdmDeviceApp) => {
    if (actorId == null || !serial) return;
    setBusy(true); setPageError(null); setNotice(null); setDialogError(null);
    try {
      const res = await removeDeviceAppPreview(serial, actorId, app.bundle_id);
      if (!res.challenge) {
        setPageError(t('asset.mdm.appRemove.noChallenge'));
        return;
      }
      setTarget({ app, preview: res, challenge: res.challenge });
    } catch (e) {
      setPageError(parseMdmError(e, t).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async (code: string) => {
    if (actorId == null || !serial || !target) return;
    setBusy(true); setDialogError(null);
    try {
      await removeDeviceAppCommit(
        serial, actorId, target.app.bundle_id, target.challenge.challenge_id, code,
      );
      setNotice(t('asset.mdm.appRemove.queued', {
        app: target.app.app_name || target.app.bundle_id,
      }));
      setTarget(null);
    } catch (e) {
      // Stay in the dialog — CHALLENGE_INVALID / _TOO_SOON are recoverable by
      // retyping or waiting, and closing throws the challenge away.
      setDialogError(parseMdmError(e, t).message);
    } finally {
      setBusy(false);
    }
  };

  const canAct = mayRemove && actorId != null && !!serial;
  const rows = q.data ?? [];

  return (
    <div className="border border-line rounded-md">
      <MdmSectionHeader
        open={open}
        onToggle={() => setOpen((v) => !v)}
        title={t('asset.mdm.devInfo.apps')}
        count={q.data?.length ?? null}
        observedAt={observedAt}
        onPull={pull}
        pulling={pulling.active}
        canPull={actorId != null}
      />

      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          {cmd.error && <MdmErrorAlert error={cmd.error} onGoToEnroll={onNotEnrolled} />}
          {pageError && <div className="alert alert-danger"><span>{pageError}</span></div>}
          {notice && (
            <div className="alert alert-success">
              <CheckCircle2 size={16} className="shrink-0" />
              <div className="alert-description">
                <div>{notice}</div>
                {/* The row lingers until the next observation lands (mig 236). */}
                <div className="text-xs mt-0.5">{t('asset.mdm.appRemove.refreshNote')}</div>
              </div>
            </div>
          )}

          {q.isLoading ? (
            <div className="text-xs text-subtle py-2">{t('common.loading')}</div>
          ) : rows.length === 0 ? (
            <div className="text-xs text-subtle py-2">{t('asset.mdm.devInfo.noApps')}</div>
          ) : (
            <ul className="flex flex-col divide-y divide-line-subtle">
              {rows.map((a) => (
                <AppRow
                  key={a.bundle_id}
                  app={a}
                  showRemove={mayRemove}
                  canAct={canAct && !busy}
                  onRemove={() => startRemove(a)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      <MdmChallengeDialog
        challenge={target?.challenge ?? null}
        serial={serial ?? '—'}
        title={t('asset.mdm.appRemove.title')}
        body={t('asset.mdm.appRemove.body', {
          app: target?.app.app_name || target?.app.bundle_id || '',
        })}
        confirmLabel={t('asset.mdm.appRemove.confirm')}
        tone="danger"
        note={removeNote(target, (k) => t(k))}
        busy={busy}
        error={dialogError}
        onDismissError={() => setDialogError(null)}
        onConfirm={confirmRemove}
        onClose={() => { setTarget(null); setDialogError(null); }}
      />
    </div>
  );
}

/** The two conditional caveats the doc asks for, joined into the dialog's note
 *  line: an app the customer installed themselves, and a list that may be stale
 *  (the app could already be gone). Both come from booleans in the preview. */
function removeNote(
  target: RemoveTarget | null,
  t: (k: string) => string,
): string | null {
  if (!target) return null;
  const parts: string[] = [];
  // is_managed=false means "not managed by MDM", which is equally true of an app
  // Apple shipped with the phone — our fleet has almost no managed apps at all.
  // Saying "the customer installed this themselves" over Safari is simply wrong,
  // so Apple's own bundles don't get the line (BE ruling 2026-08-14: the boolean
  // is correct and stays, the screen filters).
  //
  // ⛔ Not is_user_app — that flag only hides display noise (posters, proxy
  // apps) and is not a "customer installed it" signal.
  const isApple = target.app.bundle_id.startsWith('com.apple.');
  if (target.preview.is_managed === false && !isApple) {
    parts.push(t('asset.mdm.appRemove.unmanagedWarn'));
  }
  if (target.preview.observed_on_device === false) parts.push(t('asset.mdm.appRemove.staleWarn'));
  return parts.length ? parts.join(' ') : null;
}

function AppRow({
  app, showRemove, canAct, onRemove,
}: {
  app: MdmDeviceApp;
  showRemove: boolean;
  canAct: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const protectedApp = app.is_protected === true;
  return (
    <li className="flex items-center gap-2 min-w-0 py-2">
      <AppIcon bundleId={app.bundle_id} appName={app.app_name} size={30} />
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate flex items-center gap-1.5">
          {app.app_name || app.bundle_id}
          {app.is_managed && (
            <ShieldCheck size={12} className="text-info-fg shrink-0" aria-label={t('asset.mdm.devInfo.managed')} />
          )}
        </div>
        <div className="text-xs text-subtler truncate">
          {app.bundle_id}{(app.short_version || app.version) && <> · {app.short_version || app.version}</>}
        </div>
      </div>

      {/* Whole column hidden without MDM.APP_REMOVE — see the file header. */}
      {showRemove && (
        <div className="shrink-0">
          {protectedApp ? (
            <span
              className="inline-flex items-center justify-center w-8 h-8 text-subtler"
              title={t('asset.mdm.appRemove.protectedHint')}
              aria-label={t('asset.mdm.appRemove.protectedHint')}
            >
              <Lock size={15} />
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              color="danger"
              startIcon={<Trash2 size={15} />}
              disabled={!canAct}
              onClick={onRemove}
              aria-label={t('asset.mdm.appRemove.button')}
            />
          )}
        </div>
      )}
    </li>
  );
}
