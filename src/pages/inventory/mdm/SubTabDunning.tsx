// ============================================================================
// Sub-tab 3 — การทวงถาม (dunning). The heart of this round (131 §5).
//
//   บังคับใช้  = wallpaper → dunning image  +  LOCK (customer can't revert)
//   ปลดการบังคับใช้ = unlock  (+ neutral wallpaper, may be skipped)
//
// Both are async, no preview (§11.5) → a confirm dialog stands in, showing the
// branch DEFAULT image that enforce will send. Each press = TWO intent_ids →
// both handed to the queue. release() may report neutral_skipped=true: unlocked
// for real, image just not changed — say exactly that, not "failed" (§5.3).
//
// Disabled when: paused (§3), no branch default image (§12 empty-state), or the
// user lacks may_dunning. Enrollment gate handled by the shell.
// ============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal } from 'tsp-form';
import { ShieldAlert, Unlock, ImageOff, ArrowRight } from 'lucide-react';
import {
  enforceDunning, releaseDunning, fetchBranchWallpapers,
  type AssetMdmStatus,
} from './mdmApi';
import { useMdmCommand } from './useMdmCommand';
import { MdmErrorAlert, CommandAckNote } from './MdmSharedBits';

export function SubTabDunning({
  status,
  onAck,
  onNotEnrolled,
  onGoToWallpaperSettings,
}: {
  status: AssetMdmStatus;
  onAck: (intentIds: number[]) => void;
  onNotEnrolled: () => void;
  onGoToWallpaperSettings?: () => void;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState<null | 'enforce' | 'release'>(null);

  const cmd = useMdmCommand({ onAck, onNotEnrolled });

  // Branch wallpaper library — to show WHICH image enforce will push, and to
  // disable enforce when the branch has no default set (§12: link to settings).
  const { data: wallpapers = [], isLoading: wpLoading } = useQuery({
    queryKey: ['branch-mdm-wallpapers', status.branch_id],
    queryFn: () => fetchBranchWallpapers(status.branch_id),
  });
  const defaultWp = wallpapers.find((w) => w.is_default) ?? null;
  const hasDefault = !!defaultWp;

  const paused = status.is_enforcement_paused;
  const enforceDisabled = cmd.pending || paused || !hasDefault;
  const releaseDisabled = cmd.pending || paused;

  // release() outcome that needs its own explanation (unlocked but image kept).
  const [neutralSkip, setNeutralSkip] = useState<string | null>(null);

  const doEnforce = async () => {
    setConfirm(null);
    setNeutralSkip(null);
    await cmd.run(
      () => enforceDunning({ p_asset_id: status.asset_id }),
      (r) => [r.wallpaper_intent_id, r.lock_intent_id],
    );
  };

  const doRelease = async () => {
    setConfirm(null);
    setNeutralSkip(null);
    const r = await cmd.run(
      () => releaseDunning({ p_asset_id: status.asset_id }),
      (res) => [res.unlock_intent_id, res.neutral_wallpaper_intent_id].filter((n): n is number => n != null),
    );
    if (r && r.neutral_skipped) {
      setNeutralSkip(r.neutral_skip_reason ?? 'unknown');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-subtle">{t('asset.mdm.dunning.intro')}</p>

      <MdmErrorAlert error={cmd.error} onGoToEnroll={onNotEnrolled} />
      <CommandAckNote show={cmd.acked && !cmd.error} />

      {/* Unlocked-but-image-kept — a success-with-caveat, not a failure (§5.3). */}
      {neutralSkip && (
        <div className="alert alert-warning animate-pop-in">
          <ImageOff size={16} />
          <div>
            <div className="alert-title">{t('asset.mdm.dunning.neutralSkip.title')}</div>
            <div className="alert-description">
              {t(`asset.mdm.dunning.neutralSkip.${neutralSkip}`, {
                defaultValue: t('asset.mdm.dunning.neutralSkip.unknown'),
              })}
            </div>
          </div>
        </div>
      )}

      {/* No branch default image → enforce can't run; point to settings (§12). */}
      {!wpLoading && !hasDefault && (
        <div className="alert alert-info">
          <ImageOff size={16} />
          <div>
            <div className="alert-title">{t('asset.mdm.dunning.noDefault.title')}</div>
            <div className="alert-description">{t('asset.mdm.dunning.noDefault.desc')}</div>
            {onGoToWallpaperSettings && (
              <button
                className="text-sm underline mt-1 cursor-pointer bg-transparent border-none text-current inline-flex items-center gap-1"
                onClick={onGoToWallpaperSettings}
              >
                {t('asset.mdm.dunning.noDefault.goSettings')} <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 @md:grid-cols-2 gap-3">
        {/* Enforce */}
        <div className="border border-line rounded-md p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-danger" />
            <span className="text-sm font-semibold">{t('asset.mdm.dunning.enforce.title')}</span>
          </div>
          <p className="text-xs text-subtle flex-1">{t('asset.mdm.dunning.enforce.desc')}</p>
          <Button
            color="danger"
            size="sm"
            startIcon={<ShieldAlert size={15} />}
            disabled={enforceDisabled}
            onClick={() => setConfirm('enforce')}
          >
            {t('asset.mdm.dunning.enforce.button')}
          </Button>
        </div>

        {/* Release */}
        <div className="border border-line rounded-md p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Unlock size={16} className="text-success" />
            <span className="text-sm font-semibold">{t('asset.mdm.dunning.release.title')}</span>
          </div>
          <p className="text-xs text-subtle flex-1">{t('asset.mdm.dunning.release.desc')}</p>
          <Button
            variant="outline"
            size="sm"
            startIcon={<Unlock size={15} />}
            disabled={releaseDisabled}
            onClick={() => setConfirm('release')}
          >
            {t('asset.mdm.dunning.release.button')}
          </Button>
        </div>
      </div>

      {/* Confirm dialog — stands in for the missing preview (§5.2). Shows the
          image that WILL be sent (enforce) + names the device. */}
      <Modal open={confirm !== null} onClose={() => setConfirm(null)} maxWidth="26rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {confirm === 'enforce' ? t('asset.mdm.dunning.enforce.confirmTitle') : t('asset.mdm.dunning.release.confirmTitle')}
          </h2>
        </div>
        <div className="modal-content">
          <p className="text-sm text-subtle">
            {confirm === 'enforce' ? t('asset.mdm.dunning.enforce.confirmBody') : t('asset.mdm.dunning.release.confirmBody')}
          </p>
          {status.serial_number && (
            <p className="text-sm mt-2">
              <span className="text-subtle">{t('asset.mdm.dunning.deviceLabel')}:</span>{' '}
              <span className="font-mono">{status.serial_number}</span>
            </p>
          )}
          {confirm === 'enforce' && defaultWp?.thumb_b64 && (
            <div className="mt-3">
              <div className="text-xs text-subtle mb-1">{t('asset.mdm.dunning.imageToSend')}</div>
              <img
                src={`data:image/png;base64,${defaultWp.thumb_b64}`}
                alt={defaultWp.label}
                className="max-h-40 rounded-md border border-line mx-auto"
              />
              <div className="text-xs text-subtler text-center mt-1">{defaultWp.label}</div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
          <Button
            color={confirm === 'enforce' ? 'danger' : 'primary'}
            onClick={confirm === 'enforce' ? doEnforce : doRelease}
          >
            {confirm === 'enforce' ? t('asset.mdm.dunning.enforce.confirmButton') : t('asset.mdm.dunning.release.confirmButton')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
