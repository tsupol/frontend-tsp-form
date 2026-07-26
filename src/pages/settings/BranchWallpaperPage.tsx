// ============================================================================
// Branch MDM wallpaper settings (131 §10). A branch's dunning-image library:
// up to 3 images, exactly one default (the one enforce/dunning sends). Company/
// holding users pick a branch; branch users are scoped to their own.
//
// The FE owns the image work (§10): resize to full + thumb, PNG/JPEG only, burn
// the dunning message + phone onto the image, base64 (raw). See wallpaperImage.
// ============================================================================

import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Select, Modal, Input, TextArea } from 'tsp-form';
import {
  Image as ImageIcon, Star, Trash2, RefreshCw, Plus, Upload, XCircle, Loader2, Info,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  fetchBranchWallpapers, createBranchWallpaper, replaceBranchWallpaperImage,
  setBranchWallpaperDefault, retireBranchWallpaper, parseMdmError,
  type BranchWallpaper, type ParsedMdmError,
} from '../inventory/mdm/mdmApi';
import { decodeWallpaper, renderWallpaper, isAcceptedImage, type ProcessedWallpaper, type DecodedWallpaper } from '../inventory/mdm/wallpaperImage';

interface BranchRow { id: number; name: string; is_active: boolean }

const MAX_WALLPAPERS = 3;

export function BranchWallpaperPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<BranchRow[]>('/v_branches?is_active=is.true&order=name'),
    enabled: !isBranchUser,
  });

  const [branchId, setBranchId] = useState<number | null>(
    isBranchUser && user?.branch_id ? user.branch_id : null,
  );
  const effectiveBranchId = branchId ?? (isBranchUser ? user?.branch_id ?? null : null);

  const { data: wallpapers = [], isLoading } = useQuery({
    queryKey: ['branch-mdm-wallpapers', effectiveBranchId],
    queryFn: () => fetchBranchWallpapers(effectiveBranchId!),
    enabled: effectiveBranchId != null,
  });

  const [uploadOpen, setUploadOpen] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<BranchWallpaper | null>(null);
  const [error, setError] = useState<ParsedMdmError | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const atLimit = wallpapers.length >= MAX_WALLPAPERS;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['branch-mdm-wallpapers', effectiveBranchId] });

  const onSetDefault = async (w: BranchWallpaper) => {
    setBusyId(w.id); setError(null);
    try { await setBranchWallpaperDefault(w.id); await invalidate(); }
    catch (e) { setError(parseMdmError(e, t)); }
    finally { setBusyId(null); }
  };
  const onRetire = async (w: BranchWallpaper) => {
    setBusyId(w.id); setError(null);
    try { await retireBranchWallpaper(w.id); await invalidate(); }
    catch (e) { setError(parseMdmError(e, t)); }
    finally { setBusyId(null); }
  };

  const slots = useMemo(() => {
    const arr: (BranchWallpaper | null)[] = [...wallpapers];
    while (arr.length < MAX_WALLPAPERS) arr.push(null);
    return arr;
  }, [wallpapers]);

  return (
    <div className="page-content max-w-3xl">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="heading-2">{t('branchWallpaper.title')}</h1>
      </div>
      <p className="text-sm text-subtle mb-4">{t('branchWallpaper.intro')}</p>

      {/* Branch picker for company/holding users */}
      {!isBranchUser && (
        <div className="mb-4" style={{ maxWidth: '20rem' }}>
          <label className="form-label">{t('branchWallpaper.branch')}</label>
          <Select
            value={effectiveBranchId != null ? String(effectiveBranchId) : null}
            onChange={(v) => setBranchId(v ? Number(v) : null)}
            options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            placeholder={t('branchWallpaper.branchPlaceholder')}
            size="sm"
            searchable
            showChevron
          />
        </div>
      )}

      {error && (
        <div className="alert alert-danger mb-4">
          <XCircle size={16} />
          <span>{error.message}</span>
        </div>
      )}

      {effectiveBranchId == null ? (
        <div className="text-sm text-subtler py-8 text-center">{t('branchWallpaper.pickBranch')}</div>
      ) : isLoading ? (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-subtler" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 @sm:grid-cols-3 sm:grid-cols-3 gap-4">
            {slots.map((w, i) => w ? (
              <WallpaperCard
                key={w.id}
                wallpaper={w}
                busy={busyId === w.id}
                onSetDefault={() => onSetDefault(w)}
                onReplace={() => { setReplaceTarget(w); setError(null); }}
                onRetire={() => onRetire(w)}
              />
            ) : (
              <button
                key={`empty-${i}`}
                onClick={() => { setUploadOpen(true); setError(null); }}
                className="aspect-[9/16] rounded-md border-2 border-dashed border-line flex flex-col items-center justify-center gap-2 text-subtler hover:border-subtle hover:text-subtle transition-colors cursor-pointer"
              >
                <Plus size={22} />
                <span className="text-xs">{t('branchWallpaper.addImage')}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 text-xs text-subtler flex items-center gap-1.5">
            <Info size={13} />
            {atLimit ? t('branchWallpaper.atLimit') : t('branchWallpaper.slotHint', { used: wallpapers.length, max: MAX_WALLPAPERS })}
          </div>
        </>
      )}

      {/* Add modal */}
      <WallpaperUploadModal
        open={uploadOpen}
        mode="create"
        onClose={() => setUploadOpen(false)}
        onSubmit={async ({ label, where, processed }) => {
          await createBranchWallpaper({
            p_branch_id: effectiveBranchId!,
            p_label: label,
            p_image_b64: processed.imageB64,
            p_thumb_b64: processed.thumbB64,
            p_where: where,
          });
          await invalidate();
        }}
      />

      {/* Replace modal — swap the image in an existing slot, keep label/default */}
      <WallpaperUploadModal
        open={replaceTarget != null}
        mode="replace"
        existingLabel={replaceTarget?.label}
        onClose={() => setReplaceTarget(null)}
        onSubmit={async ({ processed }) => {
          await replaceBranchWallpaperImage({
            p_wallpaper_asset_id: replaceTarget!.id,
            p_image_b64: processed.imageB64,
            p_thumb_b64: processed.thumbB64,
          });
          await invalidate();
        }}
      />
    </div>
  );
}

function WallpaperCard({ wallpaper, busy, onSetDefault, onReplace, onRetire }: {
  wallpaper: BranchWallpaper;
  busy: boolean;
  onSetDefault: () => void;
  onReplace: () => void;
  onRetire: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`relative rounded-md border overflow-hidden flex flex-col ${wallpaper.is_default ? 'border-primary' : 'border-line'}`}>
      <div className="relative aspect-[9/16] bg-surface">
        {wallpaper.thumb_b64 ? (
          <img src={`data:image/png;base64,${wallpaper.thumb_b64}`} alt={wallpaper.label} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><ImageIcon size={26} className="text-subtler" /></div>
        )}
        {wallpaper.is_default && (
          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary text-primary-contrast text-[10px] font-medium">
            <Star size={10} className="fill-current" />{t('branchWallpaper.default')}
          </span>
        )}
        {busy && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Loader2 size={18} className="animate-spin text-white" /></div>}
      </div>
      <div className="p-2 flex flex-col gap-1.5">
        <div className="text-xs font-medium truncate">{wallpaper.label}</div>
        <div className="flex items-center gap-1">
          {!wallpaper.is_default && (
            <Button size="sm" variant="ghost" className="btn-icon-sm" startIcon={<Star size={14} />} onClick={onSetDefault} disabled={busy} aria-label={t('branchWallpaper.setDefault')} />
          )}
          <Button size="sm" variant="ghost" className="btn-icon-sm" startIcon={<RefreshCw size={14} />} onClick={onReplace} disabled={busy} aria-label={t('branchWallpaper.replace')} />
          <Button size="sm" variant="ghost" className="btn-icon-sm text-danger" startIcon={<Trash2 size={14} />} onClick={onRetire} disabled={busy} aria-label={t('branchWallpaper.retire')} />
        </div>
      </div>
    </div>
  );
}

function WallpaperUploadModal({ open, mode, existingLabel, onClose, onSubmit }: {
  open: boolean;
  mode: 'create' | 'replace';
  existingLabel?: string;
  onClose: () => void;
  onSubmit: (v: { label: string; where: number; processed: ProcessedWallpaper }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [where, setWhere] = useState('3'); // both by default
  const [processed, setProcessed] = useState<ProcessedWallpaper | null>(null);
  const [decoding, setDecoding] = useState(false); // ONLY while decoding a new file
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const decodedRef = useRef<DecodedWallpaper | null>(null);
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setLabel(existingLabel ?? ''); setMessage(''); setPhone(''); setWhere('3');
      setProcessed(null); setDecoding(false); setSaving(false); setError(''); setFileName('');
      decodedRef.current = null;
    }
    return () => { if (overlayTimer.current) clearTimeout(overlayTimer.current); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render the overlay from the already-decoded image. Cheap + synchronous,
  // so NO spinner — the preview just updates in place.
  const renderNow = (msg: string, ph: string) => {
    if (!decodedRef.current) return;
    try {
      setProcessed(renderWallpaper(decodedRef.current, { message: msg, phone: ph }));
    } catch (e) {
      setError(t(`branchWallpaper.err.${(e as Error).message}`, { defaultValue: t('branchWallpaper.err.generic') }));
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!isAcceptedImage(file)) { setError(t('branchWallpaper.err.image_not_png_or_jpeg')); return; }
    setFileName(file.name);
    setDecoding(true); setError('');
    try {
      decodedRef.current = await decodeWallpaper(file); // the only slow step
      renderNow(message, phone);
    } catch (e) {
      setError(t(`branchWallpaper.err.${(e as Error).message}`, { defaultValue: t('branchWallpaper.err.generic') }));
      setProcessed(null); decodedRef.current = null;
    } finally {
      setDecoding(false);
    }
  };

  // Debounce the overlay re-render so typing doesn't redraw on every keystroke.
  const onOverlayChange = (nextMsg: string, nextPhone: string) => {
    setMessage(nextMsg); setPhone(nextPhone);
    if (!decodedRef.current) return;
    if (overlayTimer.current) clearTimeout(overlayTimer.current);
    overlayTimer.current = setTimeout(() => renderNow(nextMsg, nextPhone), 250);
  };

  const canSubmit = !saving && !decoding && !!processed && (mode === 'replace' || label.trim().length > 0);

  const submit = async () => {
    if (!processed) return;
    setSaving(true); setError('');
    try {
      await onSubmit({ label: label.trim(), where: Number(where), processed });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        const mdm = parseMdmError(e, t);
        setError(mdm.message);
      } else {
        setError(t('common.error'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="40rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{mode === 'create' ? t('branchWallpaper.addTitle') : t('branchWallpaper.replaceTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4"><XCircle size={16} /><span>{error}</span></div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Left: inputs */}
          <div className="flex flex-col gap-3">
            {mode === 'create' && (
              <div className="flex flex-col">
                <label className="form-label">{t('branchWallpaper.label')} *</label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} size="sm" className="w-full" placeholder={t('branchWallpaper.labelPlaceholder')} />
              </div>
            )}
            <div className="flex flex-col">
              <label className="form-label">{t('branchWallpaper.file')} *</label>
              <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-line cursor-pointer hover:bg-surface-hover text-sm">
                <Upload size={15} className="text-subtle" />
                <span className="truncate">{fileName || t('branchWallpaper.choose')}</span>
                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
              <span className="text-xs text-subtler mt-1">{t('branchWallpaper.fileHint')}</span>
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('branchWallpaper.overlayMessage')}</label>
              <TextArea value={message} onChange={(e) => onOverlayChange(e.target.value, phone)} rows={2} className="w-full" placeholder={t('branchWallpaper.overlayMessagePlaceholder')} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('branchWallpaper.overlayPhone')}</label>
              <Input value={phone} onChange={(e) => onOverlayChange(message, e.target.value)} size="sm" className="w-full" placeholder={t('branchWallpaper.overlayPhonePlaceholder')} />
            </div>
            {mode === 'create' && (
              <div className="flex flex-col">
                <label className="form-label">{t('branchWallpaper.where')}</label>
                <Select
                  value={where}
                  onChange={(v) => setWhere(v as string)}
                  options={[
                    { value: '1', label: t('branchWallpaper.whereLock') },
                    { value: '2', label: t('branchWallpaper.whereHome') },
                    { value: '3', label: t('branchWallpaper.whereBoth') },
                  ]}
                  size="sm"
                  showChevron
                />
              </div>
            )}
          </div>

          {/* Right: live preview */}
          <div className="flex flex-col">
            <label className="form-label">{t('branchWallpaper.preview')}</label>
            <div className="relative aspect-[9/16] rounded-md border border-line bg-surface overflow-hidden flex items-center justify-center">
              {processed ? (
                <img src={processed.previewUrl} alt="preview" className="w-full h-full object-cover" />
              ) : !decoding ? (
                <div className="text-xs text-subtler text-center px-4">{t('branchWallpaper.previewEmpty')}</div>
              ) : null}
              {/* Spinner only while decoding a NEW file — overlays the current
                  preview instead of replacing it, so text edits never flicker. */}
              {decoding && (
                <div className="absolute inset-0 flex items-center justify-center bg-surface/60">
                  <Loader2 size={20} className="animate-spin text-subtler" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={submit} disabled={!canSubmit}>
          {saving ? t('common.saving') : mode === 'create' ? t('branchWallpaper.save') : t('branchWallpaper.replaceSave')}
        </Button>
      </div>
    </Modal>
  );
}
