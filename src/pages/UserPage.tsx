import { useState, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightFromLine, Eye, EyeOff, KeyRound, CheckCircle, XCircle, Camera, Upload, User as UserIcon } from 'lucide-react';
import { Button, Input, FormErrorMessage, Modal, ImageCropper, Slider, MobileHeader, useSnackbarContext } from 'tsp-form';
import type { ImageCropperRef } from 'tsp-form';
import { useAuth } from '../contexts/AuthContext';
import { DateTime } from '../components/DateTime';
import type { MeProfileResponse } from '../lib/auth';
import { apiClient, ApiError } from '../lib/api';
import { uploadImage } from '../lib/upload';
import { publicMediaUrl } from '../lib/mediaPath';
import { useUploadSpec } from '../hooks/useMediaUrl';
import { formatTel } from '../lib/format';
import { getRoleLabel } from '../lib/roleLabel';

function profileImageUrl(profileImage: Record<string, string> | null | undefined): string | null {
  if (!profileImage) return null;
  const path = profileImage.sm ?? profileImage.md ?? profileImage.original ?? Object.values(profileImage)[0];
  if (!path) return null;
  return publicMediaUrl(path);
}

// ── Profile Card (image + info) ──────────────────────────────────────

function ProfileCard() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const queryClient = useQueryClient();
  const { spec } = useUploadSpec('user_profile');

  // Avatar crop modal
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropperRef = useRef<ImageCropperRef>(null);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropSourceSize, setCropSourceSize] = useState<{ w: number; h: number } | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [uploading, setUploading] = useState(false);

  const { data: meRes, isLoading } = useQuery({
    queryKey: ['me', 'profile'],
    queryFn: () => apiClient.rpc<MeProfileResponse>('me_profile_get'),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  const profile = meRes?.profile ?? null;
  const currentImage = profileImageUrl(profile?.profile_image);

  const closeAvatarModal = () => {
    setAvatarModalOpen(false);
    setCropFile(null);
    setCropSourceSize(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setCropFile(f);
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      setCropSourceSize({ w: img.width, h: img.height });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const handleCropAndUpload = useCallback(() => {
    if (!spec || !user) return;
    cropperRef.current?.crop(async (_blob, file) => {
      setUploading(true);
      try {
        const result = await uploadImage({
          type: 'user_profile',
          file,
          params: { user_id: user.user_id },
          size: spec.sizes[0].label,
        });

        await apiClient.rpc('me_profile_image_set', {
          p_profile_image: { [spec.sizes[0].label]: `/${result.key}` },
        });

        // Refresh both the page query and the AuthContext so the sidenav
        // avatar updates without a reload.
        await queryClient.invalidateQueries({ queryKey: ['me', 'profile'] });
        await refreshUser();
        closeAvatarModal();

        addSnackbar({
          message: (
            <div className="alert alert-success">
              <CheckCircle size={18} />
              <div><div className="alert-title">{t('profile.uploadSuccess')}</div></div>
            </div>
          ),
          type: 'success',
          duration: 3000,
        });
      } catch (err) {
        const msg = err instanceof ApiError
          ? (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || err.message
          : err instanceof Error ? err.message : t('profile.uploadFailed');

        addSnackbar({
          message: (
            <div className="alert alert-danger">
              <XCircle size={18} />
              <div><div className="alert-title">{msg}</div></div>
            </div>
          ),
          type: 'error',
          duration: 5000,
        });
      } finally {
        setUploading(false);
      }
    });
  }, [spec, user, addSnackbar, t, queryClient, refreshUser]);

  // Cap output width so we never upscale past the source's smaller dimension.
  const specWidth = spec?.sizes[0]?.width ?? 320;
  const outputWidth = cropSourceSize
    ? Math.min(specWidth, Math.min(cropSourceSize.w, cropSourceSize.h))
    : specWidth;

  const displayName = profile
    ? [profile.firstname, profile.lastname].filter(Boolean).join(' ') || profile.nickname || profile.username
    : user?.username;

  const personalFields: Array<{ label: string; value: string | null | undefined }> = [
    { label: t('profile.firstname'), value: profile?.firstname },
    { label: t('profile.lastname'), value: profile?.lastname },
    { label: t('profile.nickname'), value: profile?.nickname },
    { label: t('profile.tel'), value: profile?.tel ? formatTel(profile.tel) : null },
  ];

  const orgFields: Array<{ label: string; value: string | number | null | undefined }> = [
    { label: t('user.username'), value: profile?.username ?? user?.username },
    { label: t('user.role'), value: getRoleLabel(t, profile?.role_code ?? user?.role_code) },
    { label: t('user.branch', { defaultValue: 'Branch' }), value: user?.branch_name ?? profile?.branch_id },
    { label: t('user.company', { defaultValue: 'Company' }), value: user?.company_name ?? profile?.company_id },
    { label: t('user.holdingId'), value: profile?.holding_id ?? user?.holding_id },
  ];

  return (
    <div className="border border-line bg-surface p-6 rounded-lg">
      {/* Avatar + name */}
      <div className="flex flex-col items-center gap-3 mb-5">
        <button
          type="button"
          className="relative w-28 h-28 rounded-full overflow-hidden bg-surface-shallow border-2 border-line flex items-center justify-center shrink-0 cursor-pointer group p-0"
          onClick={() => { setCropFile(null); setAvatarModalOpen(true); }}
          disabled={!spec}
          aria-label={t('profile.avatar')}
        >
          {isLoading ? (
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : currentImage ? (
            <img src={currentImage} alt="" className="w-full h-full object-cover" />
          ) : (
            <UserIcon size={44} className="text-subtle" />
          )}
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Camera size={20} className="text-white" />
          </div>
        </button>
        <div className="text-center min-w-0 w-full">
          <div className="font-semibold text-lg truncate">{isLoading ? '—' : displayName}</div>
          {profile?.role_code && (
            <div className="text-sm text-subtle">{getRoleLabel(t, profile.role_code)}</div>
          )}
        </div>
      </div>

      <hr className="border-line mb-5" />

      {/* Personal info */}
      <div className="space-y-3 mb-5">
        {personalFields.map(({ label, value }) => (
          <div key={label} className="flex justify-between items-baseline gap-3">
            <div className="text-sm text-subtle shrink-0">{label}</div>
            <div className="text-sm text-right min-w-0 truncate">{value || '—'}</div>
          </div>
        ))}
      </div>

      <hr className="border-line mb-5" />

      {/* Org / system info */}
      <div className="space-y-3">
        {orgFields.map(({ label, value }) => (
          <div key={label} className="flex justify-between items-baseline gap-3">
            <div className="text-sm text-subtle shrink-0">{label}</div>
            <div className="text-sm text-right min-w-0 truncate">{value ?? '—'}</div>
          </div>
        ))}
        {profile?.updated_at && (
          <div className="flex justify-between items-baseline gap-3 pt-2 border-t border-line">
            <div className="text-xs text-subtle shrink-0">{t('profile.updatedAt', { defaultValue: 'Last updated' })}</div>
            <div className="text-xs text-subtle text-right min-w-0 truncate">
              <DateTime value={profile.updated_at} showTime />
            </div>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Avatar crop modal */}
      <Modal open={avatarModalOpen} onClose={closeAvatarModal} maxWidth="400px">
        <div className="modal-header">
          <h2 className="modal-title">{t('profile.avatar')}</h2>
          <button type="button" className="modal-close-btn" onClick={closeAvatarModal} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          {!cropFile ? (
            <div className="flex flex-col items-center gap-4">
              {currentImage ? (
                <img src={currentImage} alt="" className="w-32 h-32 rounded-full object-cover" />
              ) : (
                <div className="w-32 h-32 rounded-full bg-surface-shallow flex items-center justify-center">
                  <UserIcon size={48} className="text-subtle" />
                </div>
              )}
              <Button variant="outline" startIcon={<Upload size={16} />} onClick={() => fileInputRef.current?.click()}>
                {t('profile.changeAvatar', { defaultValue: 'Change avatar' })}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <ImageCropper
                ref={cropperRef}
                src={cropFile}
                aspectRatio={1}
                maxZoom={1.5}
                viewportWidth={280}
                outputType={spec?.content_type ?? 'image/webp'}
                outputQuality={spec?.quality ?? 0.85}
                outputWidth={outputWidth}
                onZoomChange={setCropZoom}
                className="[&_.image-cropper-viewport]:rounded-full"
              />
              <div className="w-full max-w-[280px]">
                <Slider
                  min={Math.round((cropperRef.current?.minZoom ?? 0.1) * 1000)}
                  max={Math.round((cropperRef.current?.maxZoom ?? 1.5) * 1000)}
                  step={1}
                  value={Math.round(cropZoom * 1000)}
                  onChange={(v) => cropperRef.current?.setZoom(Number(v) / 1000)}
                />
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {!cropFile ? (
            <Button variant="ghost" onClick={closeAvatarModal}>{t('common.cancel')}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setCropFile(null)}>{t('common.back', { defaultValue: 'Back' })}</Button>
              <Button color="primary" onClick={handleCropAndUpload} disabled={uploading || !spec}>
                {uploading ? t('common.loading') : t('common.save')}
              </Button>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

// ── Change Password ──────────────────────────────────────────────────

interface ChangePasswordFormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

function ChangePasswordForm() {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormData>({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword');

  const onSubmit = async (data: ChangePasswordFormData) => {
    setApiError(null);
    try {
      await apiClient.rpc('user_change_password', {
        p_current_password: data.currentPassword,
        p_new_password: data.newPassword,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('profile.passwordChanged')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      reset();
      setShowCurrent(false);
      setShowNew(false);
      setShowConfirm(false);
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setApiError(translated || err.message);
      } else {
        setApiError(t('common.error'));
      }
    }
  };

  return (
    <div className="border border-line bg-surface p-6 rounded-lg">
      <div className="flex items-center gap-2 mb-4">
        <KeyRound size={20} />
        <h2 className="text-lg font-semibold">{t('profile.changePassword')}</h2>
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="form-grid">
          {apiError && (
            <div className="alert alert-danger">
              <XCircle size={18} />
              <div><div className="alert-description">{apiError}</div></div>
            </div>
          )}
          <div className="flex flex-col">
            <label className="form-label" htmlFor="currentPassword">
              {t('profile.currentPassword')}
            </label>
            <Input
              id="currentPassword"
              type={showCurrent ? 'text' : 'password'}
              placeholder={t('profile.enterCurrentPassword')}
              error={!!errors.currentPassword}
              endIcon={showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
              onEndIconClick={() => setShowCurrent(!showCurrent)}
              {...register('currentPassword', { required: t('profile.currentPasswordRequired') })}
            />
            <FormErrorMessage error={errors.currentPassword} />
          </div>

          <div className="flex flex-col">
            <label className="form-label" htmlFor="newPassword">
              {t('profile.newPassword')}
            </label>
            <Input
              id="newPassword"
              type={showNew ? 'text' : 'password'}
              placeholder={t('profile.enterNewPassword')}
              error={!!errors.newPassword}
              endIcon={showNew ? <EyeOff size={18} /> : <Eye size={18} />}
              onEndIconClick={() => setShowNew(!showNew)}
              {...register('newPassword', {
                required: t('profile.newPasswordRequired'),
                minLength: { value: 6, message: t('profile.passwordMinLength') },
              })}
            />
            <FormErrorMessage error={errors.newPassword} />
          </div>

          <div className="flex flex-col">
            <label className="form-label" htmlFor="confirmPassword">
              {t('profile.confirmPassword')}
            </label>
            <Input
              id="confirmPassword"
              type={showConfirm ? 'text' : 'password'}
              placeholder={t('profile.enterConfirmPassword')}
              error={!!errors.confirmPassword}
              endIcon={showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
              onEndIconClick={() => setShowConfirm(!showConfirm)}
              {...register('confirmPassword', {
                required: t('profile.confirmPasswordRequired'),
                validate: (value) => value === newPassword || t('profile.passwordMismatch'),
              })}
            />
            <FormErrorMessage error={errors.confirmPassword} />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" color="primary" disabled={isSubmitting}>
            {isSubmitting ? t('profile.changingPassword') : t('profile.changePassword')}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export function UserPage() {
  const { t } = useTranslation();

  return (
    <>
      <MobileHeader className="mobile-header-scrolled-shadow md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('nav.profile')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content">
        <h1 className="heading-2 mb-6 max-md:hidden">{t('nav.profile')}</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
          <ProfileCard />
          <div className="self-start">
            <ChangePasswordForm />
          </div>
        </div>
      </div>
    </>
  );
}
