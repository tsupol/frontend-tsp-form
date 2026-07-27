// ============================================================================
// Sub-tab 4 — ภาพพื้นหลัง (single wallpaper push, NO lock; 131 §6).
// For plain wallpaper changes (e.g. testing). Real dunning uses sub-tab 3 —
// this one doesn't lock. Pick from the branch library; omit selection = branch
// default. Async, no preview (confirm dialog stands in).
// ============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal } from 'tsp-form';
import { Image as ImageIcon, ImageOff, ArrowRight, Send } from 'lucide-react';
import { setWallpaperFromLibrary, fetchBranchWallpapers, type AssetMdmStatus } from './mdmApi';
import { useMdmCommand } from './useMdmCommand';
import { MDM_NO_CACHE } from './useMdmStatus';
import { MdmErrorAlert, CommandAckNote } from './MdmSharedBits';

export function SubTabWallpaper({
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
  const [selected, setSelected] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cmd = useMdmCommand({ onAck, onNotEnrolled });

  const { data: wallpapers = [], isLoading } = useQuery({
    queryKey: ['branch-mdm-wallpapers', status.branch_id],
    queryFn: () => fetchBranchWallpapers(status.branch_id),
    ...MDM_NO_CACHE,
  });

  const chosen = wallpapers.find((w) => w.id === selected)
    ?? wallpapers.find((w) => w.is_default)
    ?? null;

  const send = async () => {
    setConfirmOpen(false);
    await cmd.run(
      () => setWallpaperFromLibrary({
        p_asset_id: status.asset_id,
        p_wallpaper_asset_id: selected ?? undefined,
      }),
      (r) => [r.intent_id],
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-subtle">{t('asset.mdm.wallpaper.intro')}</p>

      <MdmErrorAlert error={cmd.error} onGoToEnroll={onNotEnrolled} />
      <CommandAckNote show={cmd.acked && !cmd.error} />

      {!isLoading && wallpapers.length === 0 ? (
        <div className="alert alert-info">
          <ImageOff size={16} />
          <div>
            <div className="alert-title">{t('asset.mdm.wallpaper.emptyTitle')}</div>
            <div className="alert-description">{t('asset.mdm.wallpaper.emptyDesc')}</div>
            {onGoToWallpaperSettings && (
              <button
                className="text-sm underline mt-1 cursor-pointer bg-transparent border-none text-current inline-flex items-center gap-1"
                onClick={onGoToWallpaperSettings}
              >
                {t('asset.mdm.wallpaper.goSettings')} <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 @md:grid-cols-3 gap-3">
            {wallpapers.map((w) => {
              const isSel = (selected ?? wallpapers.find((x) => x.is_default)?.id) === w.id;
              return (
                <button
                  key={w.id}
                  onClick={() => setSelected(w.id)}
                  className={`relative rounded-md border-2 overflow-hidden transition-colors cursor-pointer ${
                    isSel ? 'border-primary' : 'border-line hover:border-subtle'
                  }`}
                >
                  {w.thumb_b64 ? (
                    <img src={`data:image/png;base64,${w.thumb_b64}`} alt={w.label} className="w-full aspect-[9/16] object-cover" />
                  ) : (
                    <div className="w-full aspect-[9/16] flex items-center justify-center bg-surface">
                      <ImageIcon size={24} className="text-subtler" />
                    </div>
                  )}
                  <div className="px-2 py-1 text-xs truncate text-left flex items-center gap-1">
                    {w.is_default && <span className="text-primary-fg">★</span>}
                    {w.label}
                  </div>
                </button>
              );
            })}
          </div>

          <div>
            <Button
              color="primary"
              size="sm"
              startIcon={<Send size={15} />}
              disabled={cmd.pending || !chosen}
              onClick={() => setConfirmOpen(true)}
            >
              {t('asset.mdm.wallpaper.send')}
            </Button>
          </div>
        </>
      )}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="24rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('asset.mdm.wallpaper.confirmTitle')}</h2>
        </div>
        <div className="modal-content">
          <p className="text-sm text-subtle">{t('asset.mdm.wallpaper.confirmBody')}</p>
          {chosen?.thumb_b64 && (
            <img
              src={`data:image/png;base64,${chosen.thumb_b64}`}
              alt={chosen.label}
              className="max-h-40 rounded-md border border-line mx-auto mt-3"
            />
          )}
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button color="primary" onClick={send}>{t('asset.mdm.wallpaper.send')}</Button>
        </div>
      </Modal>
    </div>
  );
}
