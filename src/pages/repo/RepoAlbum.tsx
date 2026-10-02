// Repo photo album (CONTRACT / REPO_ATTACHMENT) on the repo job panel.
//
// The field record of a repossession: the door, the device, the signed paper
// when there was no signal. Separate from the photos taken when the contract
// was opened. Two ways in, both landing in the same album:
//   · this screen — pick files; each goes up in two sizes and is attached here
//   · a phone     — QR (bridge entity CONTRACT_REPO); photos attach themselves
//
// Every staff member in the holding can see it; adding and removing needs the
// repo/legal grant. The database enforces both — `canEdit` only decides
// whether to offer the controls.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, resizeToVariants } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import { Image as ImageIcon, Smartphone, XCircle, Loader2, ImageOff } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { translateApiError } from '../../lib/apiErrors';
import { toStoragePath, normalizeKey } from '../../lib/mediaPath';
import { privateMediaUrl } from '../../lib/upload';
import {
  beMediaUpload, beMediaDelete, CONTRACT_REPO_EVIDENCE_TYPE, CONTRACT_REPO_EVIDENCE_RESIZE,
} from '../../lib/beMedia';
import { MultiImageUploader, type MultiImageItem } from '../../components/MultiImageUploader';
import { MediaLightboxKeyGallery } from '../../components/MediaLightbox';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { useMobileCaptureSession } from '../contracts/workspace/useMobileCaptureSession';
import { fetchRepoAlbum, type RepoAlbumPhoto } from './repoApi';

// No album cap on the backend for web uploads; this only bounds one screen.
const ALBUM_MAX = 60;

// The viewer wants the large copy; bridge photos have one size only.
const fullKey = (p: RepoAlbumPhoto) => normalizeKey(p.variants_json?.lg ?? p.storage_path);

function errText(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) return translateApiError(err, t) || err.message;
  return err instanceof Error ? err.message : String(err);
}

export function RepoAlbum({ contractId, contractCode, canEdit }: {
  contractId: number;
  contractCode: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [qrOpen, setQrOpen] = useState(false);
  // While a phone session lives, photos keep arriving after the QR closes.
  const [captureUntil, setCaptureUntil] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<RepoAlbumPhoto | null>(null);
  const [removing, setRemoving] = useState(false);
  const [viewIndex, setViewIndex] = useState<number | null>(null);

  const albumKey = ['repo', 'album', contractId];
  const { data: photos = [], refetch } = useQuery({
    queryKey: albumKey,
    queryFn: () => fetchRepoAlbum(contractId),
    staleTime: 15_000,
    refetchInterval: captureUntil && captureUntil > Date.now() ? 3000 : false,
  });

  const urlQueries = useQueries({
    queries: photos.map((p) => ({
      queryKey: ['media-url', fullKey(p)],
      queryFn: () => privateMediaUrl(fullKey(p)),
      staleTime: 40 * 60_000,
    })),
  });

  const upload = async (files: File[]) => {
    if (!user?.holding_id) return;
    setUploading(true);
    setError(null);
    let sort = photos.reduce((m, p) => Math.max(m, p.sort_order), -1) + 1;
    try {
      for (const file of files) {
        const idx = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
        const variants = await resizeToVariants(file, CONTRACT_REPO_EVIDENCE_RESIZE);
        const keys: Record<string, string> = {};
        try {
          for (const size of ['sm', 'lg'] as const) {
            const f = variants[size]?.file;
            if (!f) continue;
            const r = await beMediaUpload({
              type: CONTRACT_REPO_EVIDENCE_TYPE, file: f, size, params: { contract_id: contractId, idx },
            });
            keys[size] = r.key;
          }
          const primary = keys.lg ?? keys.sm;
          if (!primary) throw new Error('Upload returned no key');
          await apiClient.rpc('fn_media_attach', {
            p_holding_id: user.holding_id,
            p_storage_path: toStoragePath(primary),
            p_variants_json: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, toStoragePath(v)])),
            p_media_type: 'IMAGE',
            p_access_level: 'CONFIDENTIAL',
            p_mime_type: variants.lg?.file.type ?? file.type,
            p_file_size_bytes: variants.lg?.file.size ?? file.size,
            p_original_filename: file.name || null,
            p_entity_type: 'CONTRACT',
            p_entity_id: contractId,
            p_usage_type: 'REPO_ATTACHMENT',
            p_sort_order: sort++,
            p_caption: null,
          });
        } catch (err) {
          // Don't leave this file's objects behind when the attach failed.
          if (Object.keys(keys).length) beMediaDelete(Object.values(keys)).catch(() => {});
          throw err;
        }
      }
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setUploading(false);
      refetch();
    }
  };

  const remove = async () => {
    if (!toRemove) return;
    setRemoving(true);
    try {
      await apiClient.rpc('fn_media_detach', { p_entity_media_id: toRemove.entity_media_id });
      setToRemove(null);
      queryClient.invalidateQueries({ queryKey: albumKey });
    } catch (err) {
      setToRemove(null);
      setError(errText(err, t));
    } finally {
      setRemoving(false);
    }
  };

  const items: MultiImageItem[] = photos.map((p, i) => ({
    kind: 'persisted',
    id: String(p.entity_media_id),
    url: urlQueries[i]?.data ?? null,
  }));

  return (
    <div className="rounded-md border border-line px-3 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 min-h-7">
        <ImageIcon size={14} className="text-subtle shrink-0" />
        <h3 className="text-sm font-medium">{t('repo.album.title')}</h3>
        {photos.length > 0 && <span className="text-xs text-subtler">{photos.length}</span>}
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            startIcon={<Smartphone size={14} />}
            onClick={() => setQrOpen(true)}
          >
            {t('repo.album.fromPhone')}
          </Button>
        )}
      </div>

      {canEdit ? (
        <MultiImageUploader
          items={items}
          max={ALBUM_MAX}
          disabled={uploading}
          busyLabel={uploading ? t('repo.album.uploading') : undefined}
          onAdd={(files) => { void upload(files); }}
          onRemove={(item) => setToRemove(photos.find((p) => String(p.entity_media_id) === item.id) ?? null)}
          onError={setError}
        />
      ) : photos.length === 0 ? (
        <div className="text-xs text-subtler">{t('repo.album.empty')}</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <button
              key={p.entity_media_id}
              type="button"
              onClick={() => setViewIndex(i)}
              className="w-16 h-16 rounded-md border border-line overflow-hidden bg-surface flex items-center justify-center cursor-zoom-in p-0"
            >
              {urlQueries[i]?.data
                ? <img src={urlQueries[i].data} alt="" className="w-full h-full object-cover" />
                : <ImageOff size={16} className="text-subtler" />}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="alert alert-danger">
          <XCircle size={16} />
          <span className="alert-description">{error}</span>
        </div>
      )}

      <MediaLightboxKeyGallery
        open={viewIndex !== null}
        onClose={() => setViewIndex(null)}
        mediaKeys={photos.map(fullKey)}
        index={viewIndex ?? 0}
        onIndexChange={setViewIndex}
        alt={t('repo.album.title')}
      />

      <RepoAlbumQrModal
        open={qrOpen}
        contractId={contractId}
        contractCode={contractCode}
        onClose={() => { setQrOpen(false); refetch(); }}
        onUploaded={() => refetch()}
        onSessionActive={(expiresAt) => setCaptureUntil(new Date(expiresAt).getTime())}
      />

      <Modal open={!!toRemove} onClose={() => { if (!removing) setToRemove(null); }} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('repo.album.removeTitle')}</h2></div>
        <div className="modal-content"><p className="text-sm">{t('repo.album.removeBody')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" disabled={removing} onClick={() => setToRemove(null)}>{t('common.cancel')}</Button>
          <Button
            color="danger"
            disabled={removing}
            startIcon={removing ? <Loader2 size={16} className="animate-spin" /> : undefined}
            onClick={remove}
          >
            {t('common.remove')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// The phone camera: a QR that opens the capture page. Photos attach to the
// album on their own; this only shows the code and a running count.
function RepoAlbumQrModal({ open, contractId, contractCode, onClose, onUploaded, onSessionActive }: {
  open: boolean;
  contractId: number;
  contractCode: string;
  onClose: () => void;
  onUploaded: () => void;
  onSessionActive: (expiresAt: string) => void;
}) {
  const { t } = useTranslation();
  const { phase, session, status, error, uploadCount, start, stop } = useMobileCaptureSession(
    contractId,
    contractCode,
    { entityType: 'CONTRACT_REPO', meta: { source: 'repo-album' } },
  );
  // Mint on open. Closing only stops watching — the phone may still be
  // uploading, and the backend expires the session on its own.
  useEffect(() => {
    if (open) start(); else stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (uploadCount > 0) onUploaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadCount]);
  useEffect(() => {
    if (session?.expires_at) onSessionActive(session.expires_at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.expires_at]);

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%" ariaLabel={t('repo.album.fromPhone')}>
      <div className="modal-header">
        <h2 className="modal-title">{t('repo.album.fromPhone')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>×</button>
      </div>
      <div className="modal-content">
        <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
          <div className="font-medium text-sm">{contractCode}</div>
        </div>
        {phase === 'error' ? null : !session ? (
          <div className="flex items-center justify-center py-10 text-subtle">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-lg border border-line bg-white p-4">
              <QRCodeSVG value={session.qr_payload} size={200} />
            </div>
            <p className="text-sm text-subtle text-center">{t('repo.album.qrHint')}</p>
            <p className="text-sm font-medium">
              {t('repo.album.qrCount', { count: uploadCount, max: status?.max_uploads ?? session.max_uploads })}
            </p>
          </div>
        )}
      </div>
      <ModalErrorBand message={phase === 'error' ? (t(error ?? '', { ns: 'apiErrors', defaultValue: '' }) || error) : null} />
      <div className="modal-footer">
        <Button onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
