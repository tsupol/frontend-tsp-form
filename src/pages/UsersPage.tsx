import { useState, useEffect, useRef, useCallback, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { DataTable, DataTableColumnHeader, Button, Input, Select, PopOver, MenuItem, MenuSeparator, Badge, Modal, Switch, createSelectColumn, useSnackbarContext } from 'tsp-form';
import { type ColumnDef, type RowSelectionState, type SortingState } from '@tanstack/react-table';
import { Plus, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, KeyRound, Trash2, Ban, XCircle, CheckCircle, Eye, EyeOff, Copy } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { FormErrorMessage } from 'tsp-form';

interface VUser {
  id: number;
  username: string;
  role_code: string;
  role_scope: string;
  holding_id: number | null;
  holding_code: string | null;
  holding_name: string | null;
  company_id: number | null;
  company_code: string | null;
  company_name: string | null;
  branch_id: number | null;
  branch_code: string | null;
  branch_name: string | null;
  is_active: boolean;
  must_change_password: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

interface VRole {
  code: string;
  name: string;
  description: string;
  scope: string;
}

interface VCompany {
  id: number;
  holding_id: number;
  code: string;
  name: string;
  is_active: boolean;
}

interface VHolding {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
}

interface VBranch {
  id: number;
  holding_id: number;
  company_id: number;
  code: string;
  name: string;
  is_active: boolean;
}

function useHoldings() {
  return useQuery({
    queryKey: ['holdings'],
    queryFn: () => apiClient.get<VHolding[]>('/v_holdings?is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
  });
}

function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => apiClient.get<VRole[]>('/v_roles?order=code'),
    staleTime: 5 * 60 * 1000,
  });
}

function useCompanies(holdingId?: string) {
  const filter = holdingId ? `&holding_id=eq.${holdingId}` : '';
  return useQuery({
    queryKey: ['companies', holdingId ?? 'all'],
    queryFn: () => apiClient.get<VCompany[]>(`/v_companies?is_active=is.true${filter}&order=name`),
    staleTime: 5 * 60 * 1000,
  });
}

function useBranches(companyId: string | null) {
  return useQuery({
    queryKey: ['branches', companyId],
    queryFn: () => apiClient.get<VBranch[]>(`/v_branches?is_active=is.true&company_id=eq.${companyId}&order=name`),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

// Row actions menu
function RowActions({ user, onEdit, onPasswordManage, onToggleActive, onDelete }: { user: VUser; onEdit: (user: VUser) => void; onPasswordManage: (user: VUser) => void; onToggleActive: (user: VUser) => void; onDelete: (user: VUser) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <PopOver
      isOpen={open}
      onClose={() => setOpen(false)}
      placement="bottom"
      align="end"
      offset={4}
      openDelay={0}
      trigger={
        <button
          className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer"
          onClick={(e: MouseEvent) => { e.stopPropagation(); setOpen(!open); }}
        >
          <MoreHorizontal size={16} className="opacity-50" />
        </button>
      }
    >
      <div className="py-1 min-w-[160px]">
        <MenuItem
          icon={<Pencil size={14} />}
          label={t('common.edit')}
          onClick={() => { setOpen(false); onEdit(user); }}
        />
        <MenuItem
          icon={<KeyRound size={14} />}
          label={t('users.passwordManage')}
          onClick={() => { setOpen(false); onPasswordManage(user); }}
        />
        <MenuSeparator />
        <MenuItem
          icon={user.is_active ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
          label={user.is_active ? t('users.deactivate') : t('users.activate')}
          onClick={() => { setOpen(false); onToggleActive(user); }}
        />
        <MenuItem
          icon={<Trash2 size={14} />}
          label={t('common.delete')}
          onClick={() => { setOpen(false); onDelete(user); }}
          danger
        />
      </div>
    </PopOver>
  );
}

// Toggle active confirmation modal
function ToggleActiveModal({ user, open, onClose }: { user: VUser | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const isDeactivating = user?.is_active ?? true;

  const handleConfirm = async () => {
    if (!user) return;
    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('user_set_active', {
        p_user_id: user.id,
        p_is_active: !user.is_active,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t(isDeactivating ? 'users.deactivateSuccess' : 'users.activateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  const handleClose = () => {
    setErrorMessage('');
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth="24rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t(isDeactivating ? 'users.deactivateUser' : 'users.activateUser')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          {errorMessage && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={18} />
              <div>
                <div className="alert-description">{errorMessage}</div>
              </div>
            </div>
          )}
          <p
            className="text-sm"
            dangerouslySetInnerHTML={{
              __html: t(isDeactivating ? 'users.confirmDeactivate' : 'users.confirmActivate', { username: user?.username ?? '' }),
            }}
          />
        </div>
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            color={isDeactivating ? 'danger' : 'primary'}
            disabled={isPending}
            onClick={handleConfirm}
          >
            {isPending ? t('common.loading') : t(isDeactivating ? 'users.deactivate' : 'users.activate')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Delete user placeholder modal
function DeleteUserModal({ open, onClose }: { user: VUser | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();

  return (
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('users.deleteUser')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          <div className="alert alert-warning">
            <XCircle size={18} />
            <div>
              <div className="alert-description">{t('users.deleteNotImplemented')}</div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Bulk action confirmation modal
function BulkActionModal({ action, users, open, onClose }: { action: 'deactivate' | 'activate'; users: VUser[]; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const isDeactivating = action === 'deactivate';
  const count = users.length;

  const handleConfirm = async () => {
    setIsPending(true);
    const start = Date.now();
    try {
      const results = await Promise.allSettled(
        users.map((u) =>
          apiClient.rpc('user_set_active', { p_user_id: u.id, p_is_active: !isDeactivating })
        )
      );
      const success = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      if (failed === 0) {
        addSnackbar({
          message: (
            <div className="alert alert-success">
              <CheckCircle size={18} />
              <div><div className="alert-title">{t(isDeactivating ? 'users.bulkDeactivateSuccess' : 'users.bulkActivateSuccess', { success, total: count })}</div></div>
            </div>
          ),
          type: 'success',
          duration: 3000,
        });
      } else {
        addSnackbar({
          message: (
            <div className="alert alert-warning">
              <XCircle size={18} />
              <div><div className="alert-title">{t('users.bulkPartialError', { success, total: count, failed })}</div></div>
            </div>
          ),
          type: 'warning',
          duration: 5000,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  const handleClose = () => {
    setErrorMessage('');
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth="24rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t(isDeactivating ? 'users.bulkDeactivate' : 'users.bulkActivate', { count })}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          {errorMessage && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={18} />
              <div>
                <div className="alert-description">{errorMessage}</div>
              </div>
            </div>
          )}
          <p
            className="text-sm"
            dangerouslySetInnerHTML={{
              __html: t(isDeactivating ? 'users.confirmBulkDeactivate' : 'users.confirmBulkActivate', { count }),
            }}
          />
        </div>
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            color={isDeactivating ? 'danger' : 'primary'}
            disabled={isPending}
            onClick={handleConfirm}
          >
            {isPending ? t('common.loading') : t(isDeactivating ? 'users.deactivate' : 'users.activate')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Create user form
interface CreateUserFormData {
  username: string;
  password: string;
  role_code: string;
  company_id: string;
  branch_id: string;
}

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<CreateUserFormData>({
    defaultValues: { username: '', password: '', role_code: '', company_id: '', branch_id: '' },
  });

  const roleCode = watch('role_code');
  const companyId = watch('company_id');

  const { data: roles = [], isLoading: rolesLoading } = useRoles();
  const roleOptions = roles.map((r) => ({ value: r.code, label: r.name, scope: r.scope }));
  const selectedRole = roles.find((r) => r.code === roleCode);
  const needsCompany = selectedRole ? ['COMPANY', 'BRANCH'].includes(selectedRole.scope) : false;
  const needsBranch = selectedRole?.scope === 'BRANCH';

  const { data: companies = [], isLoading: companiesLoading } = useCompanies();
  const { data: branches = [], isLoading: branchesLoading } = useBranches(needsBranch && companyId ? companyId : null);

  const companyOptions = companies.map((c) => ({ value: String(c.id), label: c.name }));
  const branchOptions = branches.map((b) => ({ value: String(b.id), label: b.name }));

  const onSubmit = async (data: CreateUserFormData) => {
    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('user_create', {
        p_username: data.username,
        p_password: data.password,
        p_role_code: data.role_code,
        p_company_id: needsCompany ? Number(data.company_id) : null,
        p_branch_id: needsBranch ? Number(data.branch_id) : null,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('users.createSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      reset();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  const handleClose = () => {
    reset();
    setErrorMessage('');
    setShowPassword(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{t('users.createUser')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          {errorMessage && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={18} />
              <div>
                <div className="alert-description">{errorMessage}</div>
              </div>
            </div>
          )}

          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label" htmlFor="cu-username">{t('users.username')}</label>
              <Input
                id="cu-username"
                placeholder={t('auth.enterUsername')}
                error={!!errors.username}
                {...register('username', { required: t('auth.usernameRequired') })}
              />
              <FormErrorMessage error={errors.username} />
            </div>

            <div className="flex flex-col">
              <label className="form-label" htmlFor="cu-password">{t('auth.password')}</label>
              <Input
                id="cu-password"
                type={showPassword ? 'text' : 'password'}
                placeholder={t('auth.passwordHint')}
                error={!!errors.password}
                endIcon={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                onEndIconClick={() => setShowPassword(!showPassword)}
                {...register('password', {
                  required: t('auth.passwordRequired'),
                  minLength: { value: 8, message: t('auth.passwordMinLength') },
                  validate: (v) => {
                    if (!/[A-Za-z]/.test(v)) return t('auth.passwordNeedLetter');
                    if (!/[0-9]/.test(v)) return t('auth.passwordNeedNumber');
                    return true;
                  },
                })}
              />
              <FormErrorMessage error={errors.password} />
            </div>

            <div className="flex flex-col">
              <label className="form-label">{t('users.roleCode')}</label>
              <Select
                options={roleOptions}
                value={roleCode}
                onChange={(val) => {
                  setValue('role_code', val as string, { shouldValidate: true });
                  setValue('company_id', '');
                  setValue('branch_id', '');
                }}
                placeholder={t('users.selectRole')}
                searchable={false}
                showChevron
                loading={rolesLoading}
                error={!!errors.role_code}
              />
              <input type="hidden" {...register('role_code', { required: t('users.selectRole') })} />
              <FormErrorMessage error={errors.role_code} />
            </div>

            {needsCompany && (
              <div className="flex flex-col">
                <label className="form-label">{t('users.companyId')}</label>
                <Select
                  options={companyOptions}
                  value={companyId}
                  onChange={(val) => {
                    setValue('company_id', val as string);
                    setValue('branch_id', '');
                  }}
                  placeholder={t('users.selectCompany')}
                  showChevron
                  loading={companiesLoading}
                />
              </div>
            )}

            {needsBranch && (
              <div className="flex flex-col">
                <label className="form-label">{t('users.branchId')}</label>
                <Select
                  options={branchOptions}
                  value={watch('branch_id')}
                  onChange={(val) => setValue('branch_id', val as string)}
                  placeholder={t('users.selectBranch')}
                  showChevron
                  loading={branchesLoading}
                  disabled={!companyId}
                />
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" color="primary" disabled={isPending}>
            {isPending ? t('common.loading') : t('common.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Edit user form
interface EditUserFormData {
  username: string;
  role_code: string;
  company_id: string;
  branch_id: string;
  is_active: boolean;
}

function EditUserModal({ user, open, onClose }: { user: VUser | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<EditUserFormData>({
    defaultValues: { username: '', role_code: '', company_id: '', branch_id: '', is_active: true },
  });

  useEffect(() => {
    if (user && open) {
      reset({
        username: user.username,
        role_code: user.role_code,
        company_id: user.company_id ? String(user.company_id) : '',
        branch_id: user.branch_id ? String(user.branch_id) : '',
        is_active: user.is_active,
      });
      setErrorMessage('');
    }
  }, [user, open, reset]);

  const roleCode = watch('role_code');
  const companyId = watch('company_id');

  const { data: roles = [], isLoading: rolesLoading } = useRoles();
  const roleOptions = roles.map((r) => ({ value: r.code, label: r.name, scope: r.scope }));
  const selectedRole = roles.find((r) => r.code === roleCode);
  const needsCompany = selectedRole ? ['COMPANY', 'BRANCH'].includes(selectedRole.scope) : false;
  const needsBranch = selectedRole?.scope === 'BRANCH';

  const { data: companies = [], isLoading: companiesLoading } = useCompanies();
  const { data: branches = [], isLoading: branchesLoading } = useBranches(needsBranch && companyId ? companyId : null);

  const companyOptions = companies.map((c) => ({ value: String(c.id), label: c.name }));
  const branchOptions = branches.map((b) => ({ value: String(b.id), label: b.name }));

  const onSubmit = async (data: EditUserFormData) => {
    if (!user) return;
    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('user_update', {
        p_user_id: user.id,
        p_username: data.username,
        p_company_id: needsCompany ? Number(data.company_id) : null,
        p_branch_id: needsBranch ? Number(data.branch_id) : null,
        p_role_code: data.role_code,
        p_is_active: data.is_active,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('users.updateSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  const handleClose = () => {
    setErrorMessage('');
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{t('users.editUser')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          {errorMessage && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={18} />
              <div>
                <div className="alert-description">{errorMessage}</div>
              </div>
            </div>
          )}

          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label" htmlFor="eu-username">{t('users.username')}</label>
              <Input
                id="eu-username"
                placeholder={t('auth.enterUsername')}
                error={!!errors.username}
                {...register('username', { required: t('auth.usernameRequired') })}
              />
              <FormErrorMessage error={errors.username} />
            </div>

            <div className="flex flex-col">
              <label className="form-label">{t('users.roleCode')}</label>
              <Select
                options={roleOptions}
                value={roleCode}
                onChange={(val) => {
                  setValue('role_code', val as string, { shouldValidate: true });
                  setValue('company_id', '');
                  setValue('branch_id', '');
                }}
                placeholder={t('users.selectRole')}
                searchable={false}
                showChevron
                loading={rolesLoading}
                error={!!errors.role_code}
              />
              <input type="hidden" {...register('role_code', { required: t('users.selectRole') })} />
              <FormErrorMessage error={errors.role_code} />
            </div>

            {needsCompany && (
              <div className="flex flex-col">
                <label className="form-label">{t('users.companyId')}</label>
                <Select
                  options={companyOptions}
                  value={companyId}
                  onChange={(val) => {
                    setValue('company_id', val as string);
                    setValue('branch_id', '');
                  }}
                  placeholder={t('users.selectCompany')}
                  showChevron
                  loading={companiesLoading}
                />
              </div>
            )}

            {needsBranch && (
              <div className="flex flex-col">
                <label className="form-label">{t('users.branchId')}</label>
                <Select
                  options={branchOptions}
                  value={watch('branch_id')}
                  onChange={(val) => setValue('branch_id', val as string)}
                  placeholder={t('users.selectBranch')}
                  showChevron
                  loading={branchesLoading}
                  disabled={!companyId}
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <label className="form-label mb-0" htmlFor="eu-is-active">{t('users.isActive')}</label>
              <Controller
                name="is_active"
                control={control}
                render={({ field: { onChange, value, ref } }) => (
                  <Switch
                    ref={ref}
                    id="eu-is-active"
                    checked={value}
                    onChange={(e) => onChange(e.target.checked)}
                  />
                )}
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" color="primary" disabled={isPending}>
            {isPending ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Password management modal (set password / reset password)
interface SetPasswordFormData {
  password: string;
  confirmPassword: string;
}

function PasswordModal({ user, open, onClose }: { user: VUser | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [mode, setMode] = useState<'set' | 'reset'>('set');
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    reset: resetForm,
    formState: { errors },
  } = useForm<SetPasswordFormData>({
    defaultValues: { password: '', confirmPassword: '' },
  });

  const switchMode = (newMode: 'set' | 'reset') => {
    setMode(newMode);
    resetForm();
    setErrorMessage('');
    setShowPassword(false);
    setShowConfirm(false);
  };

  const handleClose = () => {
    setMode('set');
    resetForm();
    setErrorMessage('');
    setShowPassword(false);
    setShowConfirm(false);
    setTempPassword(null);
    onClose();
  };

  const onSetPassword = async (data: SetPasswordFormData) => {
    if (!user) return;
    setIsPending(true);
    const start = Date.now();
    try {
      await apiClient.rpc('user_set_password', {
        p_user_id: user.id,
        p_new_password: data.password,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('users.setPasswordSuccess', { username: user.username })}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      handleClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  const onResetPassword = async () => {
    if (!user) return;
    setIsPending(true);
    const start = Date.now();
    try {
      const result = await apiClient.rpc<{ temp_password: string }>('user_reset_password', {
        p_user_id: user.id,
      });
      setTempPassword(result.temp_password);
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('users.resetPasswordSuccess', { username: user.username })}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  const copyTempPassword = async () => {
    if (!tempPassword) return;
    await navigator.clipboard.writeText(tempPassword);
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <div><div className="alert-title">{t('users.tempPasswordCopied')}</div></div>
        </div>
      ),
      type: 'success',
      duration: 2000,
    });
  };

  // After reset success: show temp password
  if (tempPassword) {
    return (
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        <div className="flex flex-col overflow-hidden">
          <div className="modal-header">
            <h2 className="modal-title">{t('users.resetPassword')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>
          <div className="modal-content">
            <div className="alert alert-success mb-4">
              <CheckCircle size={18} />
              <div><div className="alert-description">{t('users.resetPasswordSuccess', { username: user?.username })}</div></div>
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('users.tempPasswordLabel')}</label>
              <div className="flex gap-2">
                <Input value={tempPassword} readOnly className="flex-1 font-mono" />
                <Button type="button" variant="outline" onClick={copyTempPassword}>
                  <Copy size={16} />
                </Button>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <Button type="button" variant="ghost" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  const modeButtonClass = (active: boolean) =>
    `flex-1 py-1.5 text-sm font-medium rounded transition-colors cursor-pointer ${
      active
        ? 'bg-primary text-on-primary'
        : 'text-control-label hover:bg-surface-hover'
    }`;

  return (
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('users.passwordManage')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          {/* Mode toggle */}
          <div className="flex gap-1 p-1 bg-surface-sunken rounded mb-4">
            <button type="button" className={modeButtonClass(mode === 'set')} onClick={() => switchMode('set')}>
              {t('users.setPassword')}
            </button>
            <button type="button" className={modeButtonClass(mode === 'reset')} onClick={() => switchMode('reset')}>
              {t('users.resetPassword')}
            </button>
          </div>

          {errorMessage && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={18} />
              <div><div className="alert-description">{errorMessage}</div></div>
            </div>
          )}

          {mode === 'set' ? (
            <form id="set-password-form" onSubmit={handleSubmit(onSetPassword)}>
              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label" htmlFor="pm-password">{t('users.newPassword')}</label>
                  <Input
                    id="pm-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('users.enterNewPassword')}
                    error={!!errors.password}
                    endIcon={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    onEndIconClick={() => setShowPassword(!showPassword)}
                    {...register('password', {
                      required: t('users.passwordRequired'),
                      minLength: { value: 6, message: t('users.passwordMinLength') },
                    })}
                  />
                  <FormErrorMessage error={errors.password} />
                </div>
                <div className="flex flex-col">
                  <label className="form-label" htmlFor="pm-confirm">{t('users.confirmPassword')}</label>
                  <Input
                    id="pm-confirm"
                    type={showConfirm ? 'text' : 'password'}
                    placeholder={t('users.enterConfirmPassword')}
                    error={!!errors.confirmPassword}
                    endIcon={showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                    onEndIconClick={() => setShowConfirm(!showConfirm)}
                    {...register('confirmPassword', {
                      required: t('users.passwordRequired'),
                      validate: (v) => v === watch('password') || t('users.passwordMismatch'),
                    })}
                  />
                  <FormErrorMessage error={errors.confirmPassword} />
                </div>
              </div>
            </form>
          ) : (
            <p
              className="text-sm"
              dangerouslySetInnerHTML={{
                __html: t('users.confirmResetPassword', { username: user?.username ?? '' }),
              }}
            />
          )}
        </div>
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          {mode === 'set' ? (
            <Button type="submit" form="set-password-form" color="primary" disabled={isPending}>
              {isPending ? t('common.loading') : t('users.setPassword')}
            </Button>
          ) : (
            <Button type="button" color="primary" disabled={isPending} onClick={onResetPassword}>
              {isPending ? t('common.loading') : t('users.resetPassword')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [filterHolding, setFilterHolding] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<VUser | null>(null);
  const [toggleActiveUser, setToggleActiveUser] = useState<VUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<VUser | null>(null);
  const [passwordUser, setPasswordUser] = useState<VUser | null>(null);
  const [bulkAction, setBulkAction] = useState<{ action: 'deactivate' | 'activate'; users: VUser[] } | null>(null);

  // Filter dropdown data
  const { data: holdings = [], isLoading: holdingsLoading } = useHoldings();
  const { data: roles = [], isLoading: rolesLoading } = useRoles();
  const { data: filterCompanies = [], isLoading: filterCompaniesLoading } = useCompanies(filterHolding || undefined);
  const { data: filterBranches = [], isLoading: filterBranchesLoading } = useBranches(filterCompany || null);

  const holdingOptions = holdings.map((h) => ({ value: String(h.id), label: h.name }));
  const roleFilterOptions = roles.map((r) => ({ value: r.code, label: r.name }));
  const companyFilterOptions = filterCompanies.map((c) => ({ value: String(c.id), label: c.name }));
  const branchFilterOptions = filterBranches.map((b) => ({ value: String(b.id), label: b.name }));

  const buildEndpoint = useCallback(() => {
    const params: string[] = [];
    if (search.trim()) {
      params.push(`username=ilike.*${encodeURIComponent(search.trim())}*`);
    }
    if (filterHolding) params.push(`holding_id=eq.${filterHolding}`);
    if (filterCompany) params.push(`company_id=eq.${filterCompany}`);
    if (filterBranch) params.push(`branch_id=eq.${filterBranch}`);
    if (filterRole) params.push(`role_code=eq.${filterRole}`);
    // Sorting
    if (sorting.length > 0) {
      const order = sorting.map((s) => `${s.id}.${s.desc ? 'desc' : 'asc'}`).join(',');
      params.push(`order=${order}`);
    }
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    return `/v_users${qs}`;
  }, [search, filterHolding, filterCompany, filterBranch, filterRole, sorting]);

  const { data, isError, error, isFetching } = useQuery({
    queryKey: ['users', pageIndex, pageSize, search, filterHolding, filterCompany, filterBranch, filterRole, sorting],
    queryFn: () => apiClient.getPaginated<VUser>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const users = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;
  const selectedCount = Object.keys(rowSelection).length;
  const getSelectedUsers = () => Object.keys(rowSelection).map((i) => users[Number(i)]).filter(Boolean);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPageIndex(0);
      setRowSelection({});
    }, 300);
  };

  const resetFilters = () => {
    setPageIndex(0);
    setRowSelection({});
  };

  const columns: ColumnDef<VUser, any>[] = [
    createSelectColumn<VUser>(),
    {
      accessorKey: 'username',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.username')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-xs font-medium">{row.getValue('username')}</div>
          <div className="text-[11px] opacity-50 capitalize">{row.original.role_code}</div>
        </div>
      ),
    },
    {
      accessorKey: 'role_scope',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.scope')} />,
      cell: ({ row }) => (
        <Badge size="sm" className="capitalize">
          {row.getValue('role_scope')}
        </Badge>
      ),
    },
    {
      accessorKey: 'company_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.company')} />,
      cell: ({ row }) => {
        const company = row.getValue('company_name') as string | null;
        const branch = row.original.branch_name;
        if (!company) return <span className="opacity-30">—</span>;
        return (
          <div>
            <div className="text-xs">{company}</div>
            {branch && <div className="text-[11px] opacity-50">{branch}</div>}
          </div>
        );
      },
    },
    {
      accessorKey: 'is_active',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('users.status')} />,
      cell: ({ row }) => {
        const active = row.getValue('is_active') as boolean;
        return (
          <Badge size="sm" color={active ? 'success' : 'danger'}>
            {active ? t('users.active') : t('users.inactive')}
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => <RowActions user={row.original} onEdit={setEditUser} onPasswordManage={setPasswordUser} onToggleActive={setToggleActiveUser} onDelete={setDeleteUser} />,
      enableSorting: false,
    },
  ];

  return (
    <div className="page-content h-dvh max-h-dvh max-w-[64rem] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-none pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="heading-2">{t('users.title')}</h1>
          <Button color="primary" onClick={() => setCreateOpen(true)}>
            <Plus  />
            {t('common.create')}
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Input
            placeholder={t('common.search')}
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            size="sm"
            className="shrink-0"
            style={{ width: '14rem' }}
          />
          <Select
            options={roleFilterOptions}
            value={filterRole || null}
            onChange={(val) => {
              setFilterRole((val as string) ?? '');
              resetFilters();
            }}
            placeholder={t('users.allRoles')}
            size="sm"
            showChevron
            clearable
            searchable={false}
            loading={rolesLoading}
            className="flex-1 min-w-0"
          />
          <Select
            options={holdingOptions}
            value={filterHolding || null}
            onChange={(val) => {
              setFilterHolding((val as string) ?? '');
              setFilterCompany('');
              setFilterBranch('');
              resetFilters();
            }}
            placeholder={t('users.allHoldings')}
            size="sm"
            showChevron
            clearable
            loading={holdingsLoading}
            className="flex-1 min-w-0"
          />
          <Select
            options={companyFilterOptions}
            value={filterCompany || null}
            onChange={(val) => {
              setFilterCompany((val as string) ?? '');
              setFilterBranch('');
              resetFilters();
            }}
            placeholder={t('users.allCompanies')}
            size="sm"
            showChevron
            clearable
            loading={filterCompaniesLoading}
            className="flex-1 min-w-0"
          />
          <Select
            options={branchFilterOptions}
            value={filterBranch || null}
            onChange={(val) => {
              setFilterBranch((val as string) ?? '');
              resetFilters();
            }}
            placeholder={t('users.allBranches')}
            size="sm"
            showChevron
            clearable
            loading={filterBranchesLoading}
            disabled={!filterCompany}
            className="flex-1 min-w-0"
          />
        </div>
        {selectedCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-control-label">
              {t('users.selectedCount', { count: selectedCount })}
            </span>
            <Button variant="outline" size="sm" onClick={() => setBulkAction({ action: 'deactivate', users: getSelectedUsers() })}>
              <Ban size={14} />
              {t('users.deactivate')}
            </Button>
            <Button variant="outline" size="sm" color="danger" onClick={() => setBulkAction({ action: 'activate', users: getSelectedUsers() })}>
              <ShieldCheck size={14} />
              {t('users.activate')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRowSelection({})}>
              {t('users.clearSelection')}
            </Button>
          </div>
        )}
      </div>

      {isError && (
        <div className="px-6">
          <div className="border border-line bg-surface p-6 rounded-lg text-center">
            <div className="text-danger mb-4">{error instanceof Error ? error.message : t('common.error')}</div>
          </div>
        </div>
      )}

      {!isError && (
        <DataTable
          data={users}
          columns={columns}
          enableSorting
          manualSorting
          sorting={sorting}
          onSortingChange={(updater) => {
            const next = typeof updater === 'function' ? updater(sorting) : updater;
            setSorting(next);
            setPageIndex(0);
          }}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[10, 25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setPageIndex(pi);
            setPageSize(ps);
            setRowSelection({});
          }}
          enableRowSelection
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          className={`flex-1 min-h-0 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-control-label">
              {t('users.empty')}
            </div>
          }
        />
      )}

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <EditUserModal user={editUser} open={!!editUser} onClose={() => setEditUser(null)} />
      <ToggleActiveModal user={toggleActiveUser} open={!!toggleActiveUser} onClose={() => setToggleActiveUser(null)} />
      <DeleteUserModal user={deleteUser} open={!!deleteUser} onClose={() => setDeleteUser(null)} />
      <PasswordModal user={passwordUser} open={!!passwordUser} onClose={() => setPasswordUser(null)} />
      <BulkActionModal
        action={bulkAction?.action ?? 'deactivate'}
        users={bulkAction?.users ?? []}
        open={!!bulkAction}
        onClose={() => { setBulkAction(null); setRowSelection({}); }}
      />
    </div>
  );
}
