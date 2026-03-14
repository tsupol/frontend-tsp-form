import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, KeyRound, CheckCircle, XCircle, Camera } from 'lucide-react';
import { Button, Switch, Input, FormErrorMessage, ImageUploader, useSnackbarContext } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { useAuth } from '../contexts/AuthContext';
import { DateTime } from '../components/DateTime';
import { authService } from '../lib/auth';
import type { UserProfile, MeProfileResponse } from '../lib/auth';
import { apiClient, ApiError } from '../lib/api';
import { config, imageConfig } from '../config/config';

const EXPIRED_GRACE_PERIOD_MS = 5000;

// ── helpers ──────────────────────────────────────────────────────────

function profileImageUrl(profileImage: Record<string, string> | null | undefined): string | null {
  if (!profileImage) return null;
  const path = profileImage.sm ?? profileImage.md ?? profileImage.original ?? Object.values(profileImage)[0];
  if (!path) return null;
  return `${config.s3BaseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function uploadToS3(file: File, key: string): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('key', key);

  const res = await fetch(`${config.uploadUrl}/upload/s3`, { method: 'POST', body: form });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message ?? 'Upload failed');
  return json.data.key;
}

// ── Profile Card (image + info) ──────────────────────────────────────

function ProfileCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.rpc<MeProfileResponse>('me_profile_get');
        if (!cancelled) {
          setProfile(res.profile);
          setCurrentImage(profileImageUrl(res.profile?.profile_image));
        }
      } catch {
        // fallback to auth context data
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleUpload = async (images: UploadedImage[]) => {
    if (!images.length || !user) return;
    const img = images[0];

    setUploading(true);
    try {
      const s3Key = imageConfig.userProfile.path(user.user_id);
      await uploadToS3(img.file, s3Key);

      const dbPath = `/${s3Key}`;
      await apiClient.rpc('me_profile_image_set', {
        p_profile_image: { [imageConfig.userProfile.dbKey]: dbPath },
      });

      setCurrentImage(img.preview);

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
  };

  const displayName = profile
    ? [profile.firstname, profile.lastname].filter(Boolean).join(' ') || profile.nickname || profile.username
    : user?.user_id;

  const infoFields = [
    { label: t('user.username'), value: profile?.username },
    { label: t('user.role'), value: profile?.role_code ?? user?.role_code },
    { label: t('user.holdingId'), value: profile?.holding_id ?? user?.holding_id },
    { label: t('user.companyId'), value: profile?.company_id ?? user?.company_id },
    { label: t('user.branchId'), value: profile?.branch_id ?? user?.branch_id },
  ];

  // Only show personal fields if they have data
  const personalFields = profile ? [
    { label: t('profile.firstname'), value: profile.firstname },
    { label: t('profile.lastname'), value: profile.lastname },
    { label: t('profile.nickname'), value: profile.nickname },
    { label: t('profile.tel'), value: profile.tel },
  ].filter(f => f.value) : [];

  return (
    <div className="border border-line bg-surface p-6 rounded-lg">
      {/* Avatar + name */}
      <div className="flex flex-col items-center gap-3 mb-5">
        <div className="relative w-28 h-28 rounded-full overflow-hidden bg-surface-shallow border-2 border-line flex items-center justify-center shrink-0">
          {loading ? (
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : currentImage ? (
            <img src={currentImage} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            <Camera size={32} className="text-fg-muted" />
          )}
        </div>
        <div className="text-center">
          <div className="font-semibold text-lg">{loading ? '-' : displayName}</div>
          {profile?.role_code && (
            <div className="text-sm text-control-label">{profile.role_code}</div>
          )}
        </div>
      </div>

      {/* Upload */}
      <div className="mb-5">
        <ImageUploader
          onUpload={handleUpload}
          resizeOptions={imageConfig.userProfile.resize}
          disabled={uploading}
        />
      </div>

      <hr className="border-line mb-5" />

      {/* Personal info */}
      {personalFields.length > 0 && (
        <div className="space-y-3 mb-5">
          {personalFields.map(({ label, value }) => (
            <div key={label}>
              <div className="text-sm text-control-label">{label}</div>
              <div className="mt-0.5">{value}</div>
            </div>
          ))}
          <hr className="border-line" />
        </div>
      )}

      {/* System info */}
      <div className="space-y-3">
        {infoFields.map(({ label, value }) => (
          <div key={label}>
            <div className="text-sm text-control-label">{label}</div>
            <div className="mt-0.5 text-base">{value ?? '-'}</div>
          </div>
        ))}

      </div>
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
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
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
          <Button type="submit" variant="solid" disabled={isSubmitting}>
            {isSubmitting ? t('profile.changingPassword') : t('profile.changePassword')}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Token Debug ──────────────────────────────────────────────────────

function TokenDebugPanel() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const refreshingRef = useRef(false);
  const expiredSinceRef = useRef<number | null>(null);

  const [tokenInfo, setTokenInfo] = useState<{
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: Date | null;
    expiresAtRaw: string | null;
    timeRemaining: string;
    isExpired: boolean;
  }>({
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    expiresAtRaw: null,
    timeRemaining: '-',
    isExpired: false,
  });

  const [refreshStatus, setRefreshStatus] = useState<string>('');

  useEffect(() => {
    const update = async () => {
      const accessToken = authService.getAccessToken();
      const refreshToken = authService.getRefreshToken();
      const expiresAt = authService.getExpiresAt();
      const expiresAtRaw = localStorage.getItem('expires_at');

      let timeRemaining = '-';
      let isExpired = false;

      if (expiresAt && !isNaN(expiresAt.getTime())) {
        const diff = expiresAt.getTime() - Date.now();
        if (diff <= 0) {
          timeRemaining = 'EXPIRED';
          isExpired = true;
        } else {
          const seconds = Math.floor(diff / 1000);
          const minutes = Math.floor(seconds / 60);
          const secs = seconds % 60;
          timeRemaining = `${minutes}m ${secs}s`;
        }
      }

      setTokenInfo({ accessToken, refreshToken, expiresAt, expiresAtRaw, timeRemaining, isExpired });

      if (isExpired && !refreshingRef.current) {
        if (autoRefresh) {
          refreshingRef.current = true;
          setRefreshError(null);
          try {
            await authService.refresh();
            setLastRefreshTime(new Date());
            setRefreshError(null);
            expiredSinceRef.current = null;
          } catch (err) {
            setRefreshError(err instanceof Error ? err.message : 'Refresh failed');
            if (expiredSinceRef.current === null) expiredSinceRef.current = Date.now();
            const expiredDuration = Date.now() - expiredSinceRef.current;
            if (expiredDuration >= EXPIRED_GRACE_PERIOD_MS) {
              await logout();
              navigate('/login');
            }
          } finally {
            refreshingRef.current = false;
          }
        } else {
          if (expiredSinceRef.current === null) expiredSinceRef.current = Date.now();
          const expiredDuration = Date.now() - expiredSinceRef.current;
          if (expiredDuration >= EXPIRED_GRACE_PERIOD_MS) {
            await logout();
            navigate('/login');
          }
        }
      } else if (!isExpired) {
        expiredSinceRef.current = null;
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, logout, navigate]);

  const handleManualRefresh = async () => {
    setRefreshStatus('Refreshing...');
    setRefreshError(null);
    try {
      await authService.refresh();
      setRefreshStatus('Refreshed!');
      setLastRefreshTime(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setRefreshStatus(`Failed: ${msg}`);
      setRefreshError(msg);
    }
    setTimeout(() => setRefreshStatus(''), 3000);
  };

  const truncate = (str: string | null, len: number) => {
    if (!str) return '-';
    if (str.length <= len) return str;
    return str.slice(0, len / 2) + '...' + str.slice(-len / 2);
  };

  const isNearExpiry = tokenInfo.expiresAt &&
    (tokenInfo.expiresAt.getTime() - Date.now()) <= 60000 &&
    !tokenInfo.isExpired;

  return (
    <div className="border border-line bg-surface p-6 rounded-lg">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Token Debug</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-control-label">Auto Refresh</span>
          <Switch checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
        </div>
      </div>

      {refreshError && (
        <div className="mb-4 alert alert-danger">
          <XCircle size={18} />
          <div><div className="alert-description">Refresh Error: {refreshError}</div></div>
        </div>
      )}

      <div className="space-y-4 font-mono text-sm">
        <div>
          <div className="text-control-label">Access Token</div>
          <div className="mt-1 break-all bg-surface-shallow p-2 rounded">
            {truncate(tokenInfo.accessToken, 60)}
          </div>
        </div>

        <div>
          <div className="text-control-label">Refresh Token</div>
          <div className="mt-1 break-all bg-surface-shallow p-2 rounded">
            {truncate(tokenInfo.refreshToken, 60)}
          </div>
        </div>

        <div>
          <div className="text-control-label">Expires At (raw)</div>
          <div className="mt-1 text-xs bg-surface-shallow p-2 rounded">
            {tokenInfo.expiresAtRaw ?? '-'}
          </div>
        </div>

        <div>
          <div className="text-control-label">Expires At (parsed)</div>
          <div className="mt-1">
            {tokenInfo.expiresAt && !isNaN(tokenInfo.expiresAt.getTime())
              ? <DateTime value={tokenInfo.expiresAt.toISOString()} />
              : 'Invalid'}
          </div>
        </div>

        <div>
          <div className="text-control-label">Time Remaining</div>
          <div className={`mt-1 text-lg font-bold ${
            tokenInfo.isExpired ? 'text-danger' :
            isNearExpiry ? 'text-warning' :
            'text-success'
          }`}>
            {tokenInfo.timeRemaining}
          </div>
        </div>

        {lastRefreshTime && (
          <div>
            <div className="text-control-label">Last Refresh</div>
            <div className="mt-1 text-success">
              {lastRefreshTime.toLocaleTimeString()}
            </div>
          </div>
        )}

        <div className="flex gap-2 items-center pt-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleManualRefresh}>
            Manual Refresh
          </Button>
          {refreshStatus && (
            <span className={refreshStatus.includes('Failed') ? 'text-danger' : 'text-success'}>
              {refreshStatus}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export function UserPage() {
  const { t } = useTranslation();

  return (
    <div className="page-content p-6">
      <h1 className="heading-2 mb-6">{t('nav.userDetails')}</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
        {/* Left: profile card */}
        <ProfileCard />

        {/* Right: change password */}
        <div className="self-start">
          <ChangePasswordForm />
        </div>

        {/* Full width: token debug */}
        <div className="md:col-span-2">
          <TokenDebugPanel />
        </div>
      </div>
    </div>
  );
}
