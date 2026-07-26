// Small shared presentational pieces used across MDM sub-tabs.

import { useTranslation } from 'react-i18next';
import { PauseCircle, XCircle, ArrowRight } from 'lucide-react';
import { DateTime } from '../../../components/DateTime';
import type { AssetMdmStatus, ParsedMdmError } from './mdmApi';

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
