// Small shared presentational pieces used across MDM sub-tabs.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PauseCircle, XCircle, ArrowRight } from 'lucide-react';
import { DateTime } from '../../../components/DateTime';
import type { AssetMdmStatus, ParsedMdmError } from './mdmApi';

// §7.1 — app icon from be-media (302 → Apple CDN, 404 = no fetchable icon). No
// token, aggressively cached; safe to fire per-row. On 404 (App Store and any
// future icon-less app) draw a MONOGRAM of the app name, not a broken tile — per
// BE 2026-07-28: don't chase the icon, there isn't one. App NAME always comes
// from the view (app_name), never Apple.
const APP_ICON_BASE = 'https://be-media.czynet.dev/api/v1/mdm/app-icon?bundle_id=';

// Deterministic tint per app so the monograms aren't a wall of identical tiles.
const MONO_TINTS = [
  'bg-info-soft text-info-fg', 'bg-success-soft text-success-fg',
  'bg-warning-soft text-warning-fg', 'bg-danger-soft text-danger-fg',
  'bg-surface-hover text-subtle',
];
function monoTint(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return MONO_TINTS[Math.abs(h) % MONO_TINTS.length];
}

export function AppIcon({ bundleId, appName, size = 32 }: { bundleId: string; appName?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed || !bundleId) {
    const letter = (appName || bundleId || '?').trim().charAt(0).toUpperCase() || '?';
    return (
      <span
        className={`inline-flex items-center justify-center rounded-md shrink-0 font-semibold ${monoTint(appName || bundleId || '')}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
        aria-hidden
      >
        {letter}
      </span>
    );
  }
  return (
    <img
      src={`${APP_ICON_BASE}${encodeURIComponent(bundleId)}`}
      width={size}
      height={size}
      loading="lazy"
      alt=""
      className="rounded-md shrink-0"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

/** Warning bar shown at the top of the MDM tab when enforcement is paused (§3). */
export function EnforcementPausedBar({ status, onGoToPause }: {
  status: AssetMdmStatus;
  onGoToPause?: () => void;
}) {
  const { t } = useTranslation();
  if (!status.is_enforcement_paused) return null;
  return (
    <div className="alert alert-warning">
      <PauseCircle size={18} />
      <div className="min-w-0">
        <div className="alert-title">{t('asset.mdm.pausedBar.title')}</div>
        <div className="alert-description">
          {status.pause_indefinite
            ? t('asset.mdm.pausedBar.indefinite')
            : status.pause_until
              ? <>{t('asset.mdm.pausedBar.until')} <DateTime value={status.pause_until} showTime /></>
              : t('asset.mdm.pausedBar.generic')}
        </div>
        {onGoToPause && (
          <button
            className="text-sm underline mt-1 cursor-pointer bg-transparent border-none text-current inline-flex items-center gap-1"
            onClick={onGoToPause}
          >
            {t('asset.mdm.pausedBar.manage')} <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Parsed-MDM-error alert. ASSET_NOT_ENROLLED is handled by the tab shell, so
 *  this only renders the "real" errors a sub-tab surfaces after an action. */
export function MdmErrorAlert({ error, onGoToEnroll }: {
  error: ParsedMdmError | null;
  onGoToEnroll?: () => void;
}) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <div className="alert alert-danger animate-pop-in">
      <XCircle size={16} />
      <div className="min-w-0">
        <div className="alert-description">{error.message}</div>
        {error.isNotEnrolled && onGoToEnroll && (
          <button
            className="text-sm underline mt-1 cursor-pointer bg-transparent border-none text-current"
            onClick={onGoToEnroll}
          >
            {t('asset.mdm.goToEnroll')}
          </button>
        )}
      </div>
    </div>
  );
}

/** The "acknowledged, not done" line every command shows post-fire (§0.3). */
export function CommandAckNote({ show }: { show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <div className="alert alert-info animate-pop-in">
      <div className="min-w-0">
        <div className="alert-title">{t('asset.mdm.ack.title')}</div>
        <div className="alert-description">{t('asset.mdm.ack.desc')}</div>
      </div>
    </div>
  );
}
