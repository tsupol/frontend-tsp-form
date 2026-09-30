// "My signature" on the profile page (mig 1357).
//
// The repo authority letter prints the agent's own signature, and a NEW letter
// can't be issued without one — so a repo agent who can't print lands here.
// Any user may set it; nothing else in the app reads it yet.
//
// Flow: draw / photo → be-media `user_signature` (a fresh key every time — an
// issued letter keeps its old file, so overwriting is refused) →
// me_signature_set(key), which registers the media itself.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { PenLine, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiClient, ApiError } from '../lib/api';
import type { MeProfileResponse } from '../lib/auth';
import { uploadUserSignature, BeMediaError } from '../lib/beMedia';
import { translateApiError } from '../lib/apiErrors';
import { useMediaUrl } from '../hooks/useMediaUrl';
import { SignatureCapture } from './contracts/workspace/SignatureCapture';
import { ActionDoneView } from './contracts/ActionDoneView';
import { ModalErrorBand } from '../components/ModalErrorBand';

function SignatureImage({ path }: { path: string | null | undefined }) {
  const { url } = useMediaUrl(path ?? null);
  return (
    <div className="border border-line rounded-lg bg-white aspect-[3/1] w-full flex items-center justify-center overflow-hidden">
      {url
        ? <img src={url} alt="" className="max-w-full max-h-full object-contain" />
        : <div className="w-full h-full bg-surface-shallow animate-pulse" />}
    </div>
  );
}

export function MySignatureCard() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Same query the profile card uses — one request for both.
  const { data: meRes, isLoading } = useQuery({
    queryKey: ['me', 'profile'],
    queryFn: () => apiClient.rpc<MeProfileResponse>('me_profile_get'),
    staleTime: 30_000,
  });
  const profile = meRes?.profile ?? null;
  const hasSignature = !!profile?.has_signature && !!profile?.signature_path;

  return (
    <div className="border border-line bg-surface p-6 rounded-lg" id="my-signature">
      <div className="flex items-center gap-2 mb-2">
        <PenLine size={20} />
        <h2 className="text-lg font-semibold">{t('profile.signature.title')}</h2>
      </div>
      <p className="text-sm text-subtle mb-4">{t('profile.signature.hint')}</p>

      {isLoading ? (
        <div className="aspect-[3/1] w-full rounded-lg bg-surface-shallow animate-pulse" />
      ) : hasSignature ? (
        <SignatureImage path={profile?.signature_path} />
      ) : (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          <span>{t('profile.signature.notSet')}</span>
        </div>
      )}

      <div className="flex justify-end mt-4">
        <Button
          variant="outline"
          size="sm"
          startIcon={<PenLine size={14} />}
          disabled={isLoading}
          onClick={() => setOpen(true)}
        >
          {hasSignature ? t('profile.signature.replace') : t('profile.signature.set')}
        </Button>
      </div>

      <MySignatureModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function MySignatureModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [padDirty, setPadDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setSavedPath(null);
    setError(null);
    setPadDirty(false);
    setConfirmClose(false);
  }, [open]);

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (uploading) return;
    if (view === 'form' && padDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleUpload = async (imgs: UploadedImage[]) => {
    const img = imgs[0];
    const file = img?.variants?.sm?.file ?? img?.file;
    if (!file || !user) return;
    setUploading(true);
    setError(null);
    try {
      const up = await uploadUserSignature(user.user_id, file);
      const res = await apiClient.rpc<{ has_signature: boolean; signature_path: string | null }>(
        'me_signature_set',
        { p_r2_key: up.key },
      );
      await queryClient.invalidateQueries({ queryKey: ['me', 'profile'] });
      setSavedPath(res.signature_path ?? up.key);
      setPadDirty(false);
      setView('done');
    } catch (err) {
      if (err instanceof ApiError) setError(translateApiError(err, t));
      else if (err instanceof BeMediaError) setError(t(err.code, { ns: 'apiErrors', defaultValue: err.message }));
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('profile.signature.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>&times;</button>
        </div>

        {view === 'done' ? (
          <ActionDoneView
            headline={t('profile.signature.saved')}
            contractCode={user?.username ?? ''}
            extras={<SignatureImage path={savedPath} />}
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content">
              <p className="text-sm text-subtle mb-4">{t('profile.signature.modalHint')}</p>
              <SignatureCapture
                fileUrl={null}
                uploading={uploading}
                startInEditing
                onUpload={handleUpload}
                onPadEmptyChange={(empty) => setPadDirty(!empty)}
              />
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button onClick={handleClose} disabled={uploading}>{t('common.cancel')}</Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
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
