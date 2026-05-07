import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, DataTable, Button, Input, Select, Modal,
  MobileHeader, PopOver, Badge, Tooltip, TextArea,
  useSnackbarContext, FormErrorMessage,
} from 'tsp-form';
import {
  Plus, XCircle, CheckCircle, Eye, EyeOff, AlertTriangle,
  ArrowRightFromLine, ArrowLeft, SlidersHorizontal, Pencil,
  ShieldCheck, ShieldOff, History, KeyRound,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';

// ── Types ────────────────────────────────────────────────────────────────────

interface ICloudAccount {
  id: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  apple_id: string;
  registration_email: string | null;
  is_active: boolean;
  note: string | null;
  c_device_count: number;
  created_by: number;
  created_at: string;
  updated_at: string;
}

interface DeviceLogRow {
  id: number;
  asset_id: number;
  old_account_id: number | null;
  new_account_id: number | null;
  action: 'ASSIGN' | 'RELEASE' | 'CROSS_BRANCH_RELEASE';
  reason: string | null;
  created_by: number;
  created_at: string;
  old_apple_id: string | null;
  new_apple_id: string | null;
  old_branch_name: string | null;
  new_branch_name: string | null;
}

interface Branch {
  id: number;
  name: string;
  company_id: number;
}

interface CreateForm {
  branch_id: string;
  apple_id: string;
  password: string;
  registration_email: string;
  note: string;
}

interface EditForm {
  password: string;
  registration_email: string;
  note: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function translateApiError(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    const fromKey = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
    const fromCode = err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '';
    return fromKey || fromCode || err.message;
  }
  return t('common.error');
}

function statusFilterToParam(filter: 'active' | 'inactive' | null): string | null {
  if (filter === 'active') return 'is_active=is.true';
  if (filter === 'inactive') return 'is_active=is.false';
  return null;
}

// ── Create Modal ─────────────────────────────────────────────────────────────

function CreateModal({ open, onClose, branches, defaultCompanyId }: {
  open: boolean;
  onClose: () => void;
  branches: Branch[];
  defaultCompanyId: number | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const { register, handleSubmit, reset, control, formState: { errors, isDirty } } = useForm<CreateForm>({
    defaultValues: { branch_id: '', apple_id: '', password: '', registration_email: '', note: '' },
  });

  useEffect(() => {
    if (open) {
      reset({ branch_id: '', apple_id: '', password: '', registration_email: '', note: '' });
      setErrorMessage('');
      setShowPassword(false);
    }
  }, [open, reset]);

  const handleClose = () => {
    if (isDirty) { setConfirmCloseOpen(true); return; }
    forceClose();
  };

  const forceClose = () => {
    reset();
    setConfirmCloseOpen(false);
    onClose();
  };

  const onSubmit = async (data: CreateForm) => {
    if (!user || !defaultCompanyId) return;
    setIsPending(true);
    setErrorMessage('');

    const start = Date.now();
    try {
      await apiClient.rpc('fn_icloud_account_create', {
        p_company_id: defaultCompanyId,
        p_branch_id: Number(data.branch_id),
        p_apple_id: data.apple_id,
        p_password: data.password,
        p_registration_email: data.registration_email || null,
        p_note: data.note || null,
        p_created_by: user.user_id,
      });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.icloud.created')}</span></div>,
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['icloud-accounts'] });
      forceClose();
    } catch (err) {
      setErrorMessage(translateApiError(err, t));
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
          <div className="modal-header">
            <h2 className="modal-title">{t('settings.icloud.addAccount')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
          </div>
          <div className="modal-content">
            {errorMessage && (
              <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
                <XCircle size={18} />
                <div><div className="alert-description">{errorMessage}</div></div>
              </div>
            )}
            <div className="form-grid">
              <div className="flex flex-col">
                <label className="form-label">{t('settings.icloud.branch')}</label>
                <Controller
                  name="branch_id"
                  control={control}
                  rules={{ required: t('common.required') }}
                  render={({ field }) => (
                    <Select
                      value={field.value || null}
                      onChange={(val) => field.onChange((val as string) ?? '')}
                      placeholder={t('settings.icloud.branch')}
                      options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
                      error={!!errors.branch_id}
                    />
                  )}
                />
                <FormErrorMessage error={errors.branch_id} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('settings.icloud.appleId')}</label>
                <Input
                  {...register('apple_id', { required: t('common.required') })}
                  className="w-full"
                  error={!!errors.apple_id}
                />
                <FormErrorMessage error={errors.apple_id} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('settings.icloud.password')}</label>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  {...register('password', { required: t('common.required'), minLength: { value: 8, message: t('settings.icloud.passwordMinLength') } })}
                  className="w-full"
                  endIcon={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  onEndIconClick={() => setShowPassword(!showPassword)}
                  error={!!errors.password}
                />
                <FormErrorMessage error={errors.password} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('settings.icloud.registrationEmail')}</label>
                <Input
                  {...register('registration_email', { pattern: { value: /^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: t('settings.icloud.invalidEmail') } })}
                  className="w-full"
                />
                <FormErrorMessage error={errors.registration_email} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('settings.icloud.note')}</label>
                <TextArea {...register('note')} className="w-full" rows={3} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <Button type="button" variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
            <Button type="submit" color="primary" disabled={isPending}>
              {isPending ? t('common.saving') : t('common.create')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={confirmCloseOpen} onClose={() => setConfirmCloseOpen(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={() => setConfirmCloseOpen(false)}>{t('common.cancel')}</Button>
          <Button type="button" color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}

// ── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ open, onClose, account }: {
  open: boolean;
  onClose: () => void;
  account: ICloudAccount | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<EditForm>({
    defaultValues: { password: '', registration_email: '', note: '' },
  });

  useEffect(() => {
    if (open && account) {
      reset({
        password: '',
        registration_email: account.registration_email ?? '',
        note: account.note ?? '',
      });
      setErrorMessage('');
      setShowPassword(false);
    }
  }, [open, account, reset]);

  const handleClose = () => {
    if (isDirty) { setConfirmCloseOpen(true); return; }
    forceClose();
  };

  const forceClose = () => {
    reset();
    setConfirmCloseOpen(false);
    onClose();
  };

  const onSubmit = async (data: EditForm) => {
    if (!user || !account) return;
    setIsPending(true);
    setErrorMessage('');

    const start = Date.now();
    try {
      await apiClient.rpc('fn_icloud_account_update', {
        p_account_id: account.id,
        p_password: data.password || null,
        p_registration_email: data.registration_email || null,
        p_is_active: account.is_active,
        p_note: data.note || null,
        p_updated_by: user.user_id,
      });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.icloud.updated')}</span></div>,
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['icloud-accounts'] });
      forceClose();
    } catch (err) {
      setErrorMessage(translateApiError(err, t));
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
          <div className="modal-header">
            <h2 className="modal-title">{t('settings.icloud.editAccount')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
          </div>
          <div className="modal-content">
            {errorMessage && (
              <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
                <XCircle size={18} />
                <div><div className="alert-description">{errorMessage}</div></div>
              </div>
            )}
            <div className="form-grid">
              <div className="flex flex-col">
                <label className="form-label">{t('settings.icloud.password')}</label>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  {...register('password', { minLength: { value: 8, message: t('settings.icloud.passwordMinLength') } })}
                  className="w-full"
                  placeholder={t('settings.icloud.passwordPlaceholder')}
                  endIcon={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  onEndIconClick={() => setShowPassword(!showPassword)}
                  error={!!errors.password}
                />
                <FormErrorMessage error={errors.password} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('settings.icloud.registrationEmail')}</label>
                <Input
                  {...register('registration_email', { pattern: { value: /^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: t('settings.icloud.invalidEmail') } })}
                  className="w-full"
                />
                <FormErrorMessage error={errors.registration_email} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('settings.icloud.note')}</label>
                <TextArea {...register('note')} className="w-full" rows={3} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <Button type="button" variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
            <Button type="submit" color="primary" disabled={isPending}>
              {isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={confirmCloseOpen} onClose={() => setConfirmCloseOpen(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={() => setConfirmCloseOpen(false)}>{t('common.cancel')}</Button>
          <Button type="button" color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}

// ── Toggle (activate / deactivate) Modal ─────────────────────────────────────

function ToggleModal({ open, onClose, account }: {
  open: boolean;
  onClose: () => void;
  account: ICloudAccount | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => { if (open) { setErrorMessage(''); } }, [open]);

  if (!account) return <Modal open={false} onClose={onClose}><div /></Modal>;

  const isDeactivating = account.is_active;
  const hasBoundDevices = isDeactivating && account.c_device_count > 0;

  const submit = async () => {
    if (!user) return;
    setIsPending(true);
    setErrorMessage('');
    const start = Date.now();
    try {
      await apiClient.rpc('fn_icloud_account_update', {
        p_account_id: account.id,
        p_password: null,
        p_registration_email: account.registration_email,
        p_is_active: !account.is_active,
        p_note: account.note,
        p_updated_by: user.user_id,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span className="alert-description">
              {isDeactivating ? t('settings.icloud.deactivated') : t('settings.icloud.activated')}
            </span>
          </div>
        ),
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['icloud-accounts'] });
      onClose();
    } catch (err) {
      setErrorMessage(translateApiError(err, t));
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {isDeactivating ? t('settings.icloud.deactivateConfirmTitle') : t('settings.icloud.activateConfirmTitle')}
        </h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {errorMessage && (
          <div key={errorKey} className="alert alert-danger mb-3 animate-pop-in">
            <XCircle size={18} />
            <div><div className="alert-description">{errorMessage}</div></div>
          </div>
        )}
        <div className="text-sm text-control-label mb-2 font-mono">{account.apple_id}</div>
        {hasBoundDevices && (
          <div className="alert alert-warning mb-3">
            <AlertTriangle size={18} />
            <div>
              <div className="alert-description">
                {t('settings.icloud.deactivateBoundDevicesWarning', { count: account.c_device_count })}
              </div>
            </div>
          </div>
        )}
        <p className="text-sm">
          {isDeactivating ? t('settings.icloud.deactivateConfirmBody') : t('settings.icloud.activateConfirmBody')}
        </p>
      </div>
      <div className="modal-footer">
        <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          color={isDeactivating ? 'danger' : 'primary'}
          onClick={submit}
          disabled={isPending}
        >
          {isPending
            ? t('common.saving')
            : isDeactivating
              ? (hasBoundDevices ? t('settings.icloud.deactivateAnyway') : t('settings.icloud.deactivate'))
              : t('settings.icloud.activate')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Password placeholder ─────────────────────────────────────────────────────
// The password is intentionally omitted from `v_icloud_accounts` and there is
// no reveal RPC yet. Filed backend feedback at
// D:/dev/nnf/UI_FEEDBACK/2026-05-07_icloud_password_reveal.md asking for a
// `fn_icloud_account_reveal_password` RPC. Until then, "Edit" is the only
// way to set/rotate the value.

function PasswordPlaceholder() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0 font-mono text-sm px-2 py-1.5 rounded bg-fg/5 truncate">
        ••••••••
      </div>
      <Tooltip content={t('settings.icloud.passwordNotReadable')}>
        <span className="text-subtle text-xs cursor-help">ⓘ</span>
      </Tooltip>
    </div>
  );
}

// ── Detail Panel ─────────────────────────────────────────────────────────────

function AccountDetailPanel({ account, onEdit, onToggle }: {
  account: ICloudAccount;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'overview' | 'history'>('overview');

  const { data: logRows = [], isLoading: logLoading, isError: logError } = useQuery({
    queryKey: ['icloud-device-log', account.id],
    queryFn: () => apiClient.get<DeviceLogRow[]>(
      `/v_icloud_device_log?or=(old_account_id.eq.${account.id},new_account_id.eq.${account.id})&order=created_at.desc&limit=200`,
    ),
    enabled: tab === 'history',
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-none px-4 py-3 border-b border-line">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium truncate">{account.apple_id}</span>
          <Badge color={account.is_active ? 'success' : 'default'} size="sm">
            {account.is_active ? t('common.active') : t('common.inactive')}
          </Badge>
        </div>
        <div className="text-[11px] text-subtle mt-0.5 truncate">
          {account.branch_name}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-none flex border-b border-line">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} icon={<KeyRound size={14} />}>
          {t('settings.icloud.tabOverview')}
        </TabButton>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')} icon={<History size={14} />}>
          {t('settings.icloud.tabHistory')}
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-auto better-scroll">
        {tab === 'overview' && (
          <div className="p-4 flex flex-col gap-4">
            <Field label={t('settings.icloud.appleId')}>
              <span className="font-mono">{account.apple_id}</span>
            </Field>
            <Field label={t('settings.icloud.password')}>
              <PasswordPlaceholder />
            </Field>
            <Field label={t('settings.icloud.registrationEmail')}>
              {account.registration_email
                ? <span>{account.registration_email}</span>
                : <span className="opacity-40">—</span>}
            </Field>
            <Field label={t('settings.icloud.branch')}>
              {account.branch_name}
            </Field>
            <Field label={t('settings.icloud.deviceCount')}>
              <div className="flex items-center gap-2">
                <span className="tabular-nums font-medium">{account.c_device_count}</span>
                <Tooltip content={t('settings.icloud.deviceCountAdvisoryHint')}>
                  <span className="text-subtle text-xs cursor-help">ⓘ</span>
                </Tooltip>
              </div>
            </Field>
            <Field label={t('settings.icloud.note')}>
              {account.note
                ? <span className="whitespace-pre-wrap">{account.note}</span>
                : <span className="opacity-40">—</span>}
            </Field>
            <div className="flex gap-6 text-xs text-subtle pt-2 border-t border-line">
              <div>
                <div className="opacity-70">{t('settings.icloud.createdAt')}</div>
                <DateTime value={account.created_at} showTime />
              </div>
              <div>
                <div className="opacity-70">{t('settings.icloud.updatedAt')}</div>
                <DateTime value={account.updated_at} showTime />
              </div>
            </div>
          </div>
        )}

        {tab === 'history' && (
          <HistoryTab
            account={account}
            rows={logRows}
            loading={logLoading}
            error={logError}
          />
        )}
      </div>

      {/* Sticky action footer */}
      <div className="flex-none border-t border-line p-3 flex items-center gap-2">
        <Button size="sm" variant="outline" startIcon={<Pencil size={14} />} onClick={onEdit}>
          {t('common.edit')}
        </Button>
        <div className="flex-1" />
        {account.is_active ? (
          <Button size="sm" variant="outline" startIcon={<ShieldOff size={14} />} onClick={onToggle}>
            {t('settings.icloud.deactivate')}
          </Button>
        ) : (
          <Button size="sm" color="primary" startIcon={<ShieldCheck size={14} />} onClick={onToggle}>
            {t('settings.icloud.activate')}
          </Button>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer transition-colors border-b-2 ${
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-control-label hover:text-fg hover:bg-surface-hover'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-wide text-control-label">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function HistoryTab({ account, rows, loading, error }: {
  account: ICloudAccount;
  rows: DeviceLogRow[];
  loading: boolean;
  error: boolean;
}) {
  const { t } = useTranslation();

  if (loading) {
    return <div className="p-8 text-center text-control-label text-sm">{t('common.loading')}</div>;
  }
  if (error) {
    return <div className="p-8 text-center text-danger text-sm">{t('common.error')}</div>;
  }
  if (rows.length === 0) {
    return <div className="p-8 text-center text-control-label text-sm">{t('settings.icloud.noHistory')}</div>;
  }

  return (
    <div className="flex flex-col divide-y divide-line">
      {rows.map(row => {
        const isAssign = row.action === 'ASSIGN';
        const isCrossBranch = row.action === 'CROSS_BRANCH_RELEASE';
        const actionLabel = isAssign
          ? t('settings.icloud.actionAssign')
          : isCrossBranch
            ? t('settings.icloud.actionCrossBranchRelease')
            : t('settings.icloud.actionRelease');
        const actionColor: 'success' | 'warning' | 'default' = isAssign
          ? 'success'
          : isCrossBranch
            ? 'warning'
            : 'default';

        // From-account perspective of THIS account: when action is ASSIGN and
        // new_account_id == this account, it received the device. When old_account_id
        // matches, it lost the device (re-assign).
        const wasReceiver = row.new_account_id === account.id;
        const wasGiver = row.old_account_id === account.id;

        return (
          <div key={row.id} className="flex items-start gap-3 px-4 py-3">
            <div className="shrink-0 mt-0.5">
              <Badge color={actionColor} size="sm">{actionLabel}</Badge>
            </div>
            <div className="flex-1 min-w-0 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-control-label text-xs">{t('settings.icloud.asset')}</span>
                <span className="font-mono text-xs">#{row.asset_id}</span>
              </div>
              {isAssign && wasReceiver && row.old_apple_id && (
                <div className="text-xs text-control-label mt-0.5">
                  {t('settings.icloud.fromAccount')} <span className="font-mono">{row.old_apple_id}</span>
                </div>
              )}
              {isAssign && wasGiver && row.new_apple_id && (
                <div className="text-xs text-control-label mt-0.5">
                  {t('settings.icloud.toAccount')} <span className="font-mono">{row.new_apple_id}</span>
                </div>
              )}
              {row.reason && (
                <div className="text-xs mt-0.5">
                  <span className="text-control-label">{t('settings.icloud.reason')}: </span>{row.reason}
                </div>
              )}
              <div className="text-[11px] text-subtle mt-1 flex items-center gap-2">
                <DateTime value={row.created_at} showTime />
                <span>·</span>
                <span>{t('settings.icloud.by')} #{row.created_by}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function ICloudPoolPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const companyId = user?.company_id ?? null;

  // List state
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  // Selection
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [toggleOpen, setToggleOpen] = useState(false);

  // Branches lookup
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
  });

  const branchOptions = branches.map(b => ({ value: String(b.id), label: b.name }));
  const statusOptions = [
    { value: 'active', label: t('settings.icloud.filterStatusActive') },
    { value: 'inactive', label: t('settings.icloud.filterStatusInactive') },
  ];
  const activeFilterCount = (branchFilter ? 1 : 0) + (statusFilter ? 1 : 0);

  const buildEndpoint = () => {
    const params: string[] = [];
    if (search.trim()) {
      const term = encodeURIComponent(search.trim());
      params.push(`or=(branch_name.ilike.*${term}*,apple_id.ilike.*${term}*,registration_email.ilike.*${term}*)`);
    }
    if (branchFilter) params.push(`branch_id=eq.${branchFilter}`);
    const statusParam = statusFilterToParam(statusFilter);
    if (statusParam) params.push(statusParam);
    params.push('order=is_active.desc,updated_at.desc');
    return `/v_icloud_accounts?${params.join('&')}`;
  };

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ['icloud-accounts', pageIndex, pageSize, search, branchFilter, statusFilter],
    queryFn: () => apiClient.getPaginated<ICloudAccount>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const accounts = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  useEffect(() => { setPageIndex(0); }, [search, branchFilter, statusFilter]);

  // Clear stale selection if account no longer in current page
  useEffect(() => {
    if (isFetching) return;
    if (selectedId && accounts.length > 0 && !accounts.find(a => a.id === selectedId)) {
      setSelectedId(null);
    }
  }, [accounts, selectedId, isFetching]);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value), 300);
  };

  const selectedAccount = selectedId ? accounts.find(a => a.id === selectedId) ?? null : null;

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => {
        const handleRowSelect = (id: number) => {
          setSelectedId(id);
          if (isMobile) goTo('detail');
        };

        return (
          <>
            {/* ── Mobile Header ── */}
            {isMobile && (
              <MobileHeader className="mobile-header-bordered">
                <div className="mobile-header-start">
                  {isRoot ? (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      aria-label="Open menu"
                      onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                    >
                      <ArrowRightFromLine size={18} />
                    </button>
                  ) : (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      onClick={goBack}
                    >
                      <ArrowLeft size={20} />
                    </button>
                  )}
                </div>
                <div className="mobile-header-title mobile-header-title-truncate">
                  {isRoot ? t('settings.icloud.title') : (selectedAccount?.apple_id ?? '')}
                </div>
                <div className="mobile-header-end px-2">
                  {isRoot ? (
                    <button
                      className="flex items-center justify-center w-8 h-8 rounded hover:bg-surface-hover cursor-pointer text-current"
                      aria-label={t('settings.icloud.addAccount')}
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus size={18} />
                    </button>
                  ) : (
                    <div className="w-8" />
                  )}
                </div>
              </MobileHeader>
            )}

            {/* ── Desktop Header ── */}
            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="heading-2">{t('settings.icloud.title')}</h1>
                </div>
                <Button color="primary" size="sm" startIcon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
                  {t('settings.icloud.addAccount')}
                </Button>
              </div>
            )}

            {/* ── Filter bar (above panels; list-only on mobile) ── */}
            {(isRoot || !isMobile) && (
              <div className="flex-none p-2 border-b border-line">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Input
                      placeholder={t('settings.icloud.searchPlaceholder')}
                      value={searchInput}
                      onChange={(e) => handleSearch(e.target.value)}
                      size="sm"
                      className="w-full"
                    />
                  </div>
                  <div className="flex-1 min-w-0 hidden sm:block">
                    <Select
                      options={branchOptions}
                      value={branchFilter !== null ? String(branchFilter) : null}
                      onChange={(val) => setBranchFilter(val ? Number(val) : null)}
                      placeholder={t('settings.icloud.filterAllBranches')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                  <div className="flex-1 min-w-0 hidden md:block">
                    <Select
                      options={statusOptions}
                      value={statusFilter}
                      onChange={(val) => setStatusFilter((val as 'active' | 'inactive') || null)}
                      placeholder={t('settings.icloud.filterAllStatuses')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                  <div className="md:hidden shrink-0">
                    <PopOver
                      isOpen={filterOpen}
                      onClose={() => setFilterOpen(false)}
                      placement="bottom"
                      align="end"
                      maxWidth="300px"
                      maxHeight="400px"
                      trigger={
                        <Button variant="outline" size="sm" className="relative btn-icon-sm" onClick={() => setFilterOpen(!filterOpen)}>
                          <SlidersHorizontal size={16} />
                          {activeFilterCount > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                              {activeFilterCount}
                            </span>
                          )}
                        </Button>
                      }
                    >
                      <div className="flex flex-col gap-3 p-3">
                        <div className="text-xs font-medium text-muted uppercase tracking-wide">{t('common.filters')}</div>
                        <Select
                          options={branchOptions}
                          value={branchFilter !== null ? String(branchFilter) : null}
                          onChange={(val) => setBranchFilter(val ? Number(val) : null)}
                          placeholder={t('settings.icloud.filterAllBranches')}
                          size="sm"
                          showChevron
                          clearable
                        />
                        <Select
                          options={statusOptions}
                          value={statusFilter}
                          onChange={(val) => setStatusFilter((val as 'active' | 'inactive') || null)}
                          placeholder={t('settings.icloud.filterAllStatuses')}
                          size="sm"
                          showChevron
                          clearable
                        />
                      </div>
                    </PopOver>
                  </div>
                </div>
              </div>
            )}

            {/* ── Panels ── */}
            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              <PageNavPanel
                id="list"
                className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}
                mobileClassName="flex flex-col overflow-hidden"
              >
                <DataTable<ICloudAccount>
                  data={accounts}
                  renderRow={(row) => {
                    const a = row.original;
                    const isSelected = a.id === selectedId;
                    return (
                      <button
                        key={a.id}
                        className={`w-full text-left px-4 py-2.5 border-b border-line flex items-start gap-3 cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                        }`}
                        onClick={() => handleRowSelect(a.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono font-medium text-sm truncate">{a.apple_id}</span>
                            {!a.is_active && (
                              <Badge color="default" size="sm">{t('common.inactive')}</Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-subtle truncate mt-0.5">
                            {a.branch_name}
                            {a.registration_email ? ` · ${a.registration_email}` : ''}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-xs tabular-nums font-medium">{a.c_device_count}</div>
                          <div className="text-[10px] text-subtle uppercase tracking-wide">
                            {t('settings.icloud.devices')}
                          </div>
                        </div>
                      </button>
                    );
                  }}
                  enablePagination
                  pageIndex={pageIndex}
                  pageSize={pageSize}
                  pageSizeOptions={[25, 50]}
                  rowCount={totalCount}
                  onPageChange={({ pageIndex: pi, pageSize: ps }) => {
                    setPageIndex(pi);
                    setPageSize(ps);
                  }}
                  className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                  noResults={
                    <div className="p-8 text-center text-control-label">
                      {isLoading ? t('common.loading') : t('settings.icloud.empty')}
                    </div>
                  }
                />
              </PageNavPanel>

              <PageNavPanel
                id="detail"
                className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}
                mobileClassName="flex flex-col overflow-hidden"
              >
                {selectedAccount ? (
                  <AccountDetailPanel
                    account={selectedAccount}
                    onEdit={() => setEditOpen(true)}
                    onToggle={() => setToggleOpen(true)}
                  />
                ) : (
                  <div className="flex-1 h-full flex items-center justify-center text-control-label p-8 text-center">
                    {t('settings.icloud.selectToView')}
                  </div>
                )}
              </PageNavPanel>
            </div>

            {/* Modals */}
            <CreateModal
              open={createOpen}
              onClose={() => setCreateOpen(false)}
              branches={branches}
              defaultCompanyId={companyId}
            />
            <EditModal
              open={editOpen}
              onClose={() => setEditOpen(false)}
              account={selectedAccount}
            />
            <ToggleModal
              open={toggleOpen}
              onClose={() => setToggleOpen(false)}
              account={selectedAccount}
            />
          </>
        );
      }}
    </PageNav>
  );
}
