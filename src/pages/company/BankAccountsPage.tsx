import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, Button, Input, Select,
  PopOver, MenuItem, MenuSeparator, Badge, Modal, Switch, MobileHeader, Tooltip,
  useSnackbarContext, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import {
  Plus, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, Star,
  XCircle, CheckCircle, ArrowRightFromLine, QrCode, Upload, Trash2, RefreshCw,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BeMediaError, uploadBankAccountQr } from '../../lib/beMedia';
import { publicMediaUrl } from '../../lib/mediaPath';
import { useAuth } from '../../contexts/AuthContext';
import { MediaLightbox } from '../../components/MediaLightbox';
import { BankChannelConfig } from './BankChannelConfig';

// ── Types ────────────────────────────────────────────────────────────────────

// Payment QR bound to an account (mig 704). `paths.original` is the public-bucket
// key; compose the URL with publicMediaUrl (no presign). null = no QR yet.
interface QrMedia {
  media_id: number;
  usage_type: string;
  access_level: string;
  sort_order: number;
  paths: { original: string };
}

interface BankAccount {
  id: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_promptpay: boolean;
  promptpay_id: string | null;
  is_active: boolean;
  is_default: boolean;
  note: string | null;
  qr_media: QrMedia | null;
}

interface Branch {
  id: number;
  name: string;
  company_id: number;
}

interface AccountForm {
  branch_id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  promptpay_id: string;
  is_default: boolean;
  note: string;
}

// ── Row Actions ──────────────────────────────────────────────────────────────

function RowActions({ account, onEdit, onToggle, onSetDefault }: {
  account: BankAccount;
  onEdit: (a: BankAccount) => void;
  onToggle: (a: BankAccount) => void;
  onSetDefault: (a: BankAccount) => void;
}) {
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
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); setOpen(!open); }}
          aria-label="Actions"
        >
          <MoreHorizontal size={16} className="opacity-50" />
        </button>
      }
    >
      <div className="py-1 min-w-[160px]">
        <MenuItem icon={<Pencil size={14} />} label={t('common.edit')} onClick={() => { setOpen(false); onEdit(account); }} />
        {!account.is_default && account.is_active && (
          <MenuItem icon={<Star size={14} />} label={t('settings.bankAccounts.setFallback')} onClick={() => { setOpen(false); onSetDefault(account); }} />
        )}
        <MenuSeparator />
        <MenuItem
          icon={account.is_active ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
          label={account.is_active ? t('settings.bankAccounts.deactivate') : t('settings.bankAccounts.activate')}
          onClick={() => { setOpen(false); onToggle(account); }}
        />
      </div>
    </PopOver>
  );
}

// ── Create / Edit Modal ──────────────────────────────────────────────────────

function AccountModal({ open, onClose, account, branches, canManageQr }: {
  open: boolean;
  onClose: () => void;
  account: BankAccount | null;
  branches: Branch[];
  canManageQr: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [isPending, setIsPending] = useState(false);
  const isEdit = !!account;

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<AccountForm>({
    defaultValues: {
      branch_id: '',
      bank_name: '',
      account_number: '',
      account_name: '',
      promptpay_id: '',
      is_default: false,
      note: '',
    },
  });

  // Reset the form only when the modal opens or switches to a different account
  // — NOT on every refetch. `account` is re-resolved from the live query on each
  // refetch (so QR changes show), which would otherwise clobber in-progress edits.
  const accountRef = useRef(account);
  accountRef.current = account;
  const accountId = account?.id ?? null;
  useEffect(() => {
    if (!open) return;
    const acc = accountRef.current;
    if (acc) {
      reset({
        branch_id: String(acc.branch_id),
        bank_name: acc.bank_name,
        account_number: acc.account_number,
        account_name: acc.account_name,
        promptpay_id: acc.promptpay_id ?? '',
        is_default: acc.is_default,
        note: acc.note ?? '',
      });
    } else {
      reset({
        branch_id: '',
        bank_name: '',
        account_number: '',
        account_name: '',
        promptpay_id: '',
        is_default: false,
        note: '',
      });
    }
    setErrorMessage('');
    setQrBusy(false);
    setConfirmRemoveQr(false);
  }, [open, accountId, reset]);

  // ── Payment QR (edit-only) ─────────────────────────────────────────────
  const qrFileRef = useRef<HTMLInputElement>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [confirmRemoveQr, setConfirmRemoveQr] = useState(false);
  const [qrLightbox, setQrLightbox] = useState(false);
  const qrKey = account?.qr_media?.paths.original ?? null;
  const qrUrl = qrKey ? publicMediaUrl(qrKey) : null;

  const translateErr = (err: unknown): string => {
    if (err instanceof ApiError || err instanceof BeMediaError) {
      const messageKey = err instanceof ApiError ? err.messageKey : undefined;
      const params = err instanceof ApiError ? err.messageParams : undefined;
      const opts = { ns: 'apiErrors', defaultValue: '', ...params };
      const translated = (messageKey ? t(messageKey, opts) : '')
        || (err.code ? t(err.code, opts) : '');
      return translated || err.message;
    }
    return t('common.error');
  };

  const handleQrPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file || !account) return;
    setQrBusy(true);
    setErrorMessage('');
    try {
      // Step 1 — upload the original bytes to be-media (no resize; PNG allowed).
      const uploaded = await uploadBankAccountQr(account.id, file);
      // Step 2 — bind the key to the account. Skipping this orphans the file.
      const res = await apiClient.rpc<{ media_id: number; replaced_media_id: number | null }>(
        'fn_bank_account_qr_set',
        {
          p_account_id: account.id,
          p_storage_path: uploaded.key,
          p_mime_type: uploaded.content_type || file.type,
          p_file_size_bytes: file.size,
          p_original_filename: file.name,
        },
      );
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span className="alert-description">
              {res.replaced_media_id != null
                ? t('settings.bankAccounts.qr.replaced')
                : t('settings.bankAccounts.qr.uploaded')}
            </span>
          </div>
        ),
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    } catch (err) {
      setErrorMessage(translateErr(err));
      setErrorKey(k => k + 1);
    } finally {
      setQrBusy(false);
    }
  };

  const handleQrRemove = async () => {
    if (!account) return;
    setConfirmRemoveQr(false);
    setQrBusy(true);
    setErrorMessage('');
    try {
      await apiClient.rpc('fn_bank_account_qr_remove', { p_account_id: account.id });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.bankAccounts.qr.removed')}</span></div>,
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    } catch (err) {
      setErrorMessage(translateErr(err));
      setErrorKey(k => k + 1);
    } finally {
      setQrBusy(false);
    }
  };

  const onSubmit = async (data: AccountForm) => {
    if (!user) return;
    setIsPending(true);
    setErrorMessage('');

    const start = Date.now();
    try {
      if (isEdit) {
        await apiClient.rpc('fn_bank_account_update', {
          p_account_id: account!.id,
          p_bank_name: data.bank_name,
          p_account_number: null, // immutable — never sent on update (409 ACCOUNT_NUMBER_IMMUTABLE); null keeps existing
          p_account_name: data.account_name,
          p_account_number_display: null,
          p_promptpay_id: data.promptpay_id || null,
          p_note: data.note || null,
          p_updated_by: user.user_id,
        });
        addSnackbar({
          message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.bankAccounts.updated')}</span></div>,
          type: 'success',
        });
      } else {
        await apiClient.rpc('fn_bank_account_create', {
          p_branch_id: Number(data.branch_id),
          p_bank_name: data.bank_name,
          p_account_number: data.account_number,
          p_account_name: data.account_name,
          p_promptpay_id: data.promptpay_id || null,
          p_is_default: data.is_default,
          p_note: data.note || null,
          p_created_by: user.user_id,
        });
        addSnackbar({
          message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.bankAccounts.created')}</span></div>,
          type: 'success',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      onClose();
    } catch (err) {
      setErrorMessage(translateErr(err));
      setErrorKey(k => k + 1);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? t('settings.bankAccounts.editAccount') : t('settings.bankAccounts.addAccount')}</h2>
        </div>
        <div className="modal-content">
          {errorMessage && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={18} />
              <div><div className="alert-description">{errorMessage}</div></div>
            </div>
          )}
          <div className="form-grid">
            {!isEdit && (
              <div className="flex flex-col">
                <label className="form-label">{t('settings.bankAccounts.branch')}</label>
                <Controller
                  name="branch_id"
                  control={control}
                  rules={{ required: t('common.required') }}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onChange={(val) => field.onChange(val as string)}
                      placeholder={t('settings.bankAccounts.branch')}
                      options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
                    />
                  )}
                />
                <FormErrorMessage error={errors.branch_id} />
              </div>
            )}
            <div className="flex flex-col">
              <label className="form-label">{t('settings.bankAccounts.bankName')}</label>
              <Input {...register('bank_name', { required: t('common.required') })} className="w-full" />
              <FormErrorMessage error={errors.bank_name} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.bankAccounts.accountNumber')}</label>
              <Input
                {...register('account_number', isEdit ? {} : { required: t('common.required') })}
                className="w-full"
                disabled={isEdit}
              />
              {isEdit ? (
                <p className="text-xs text-subtle mt-1.5">{t('settings.bankAccounts.accountNumberImmutable')}</p>
              ) : (
                <FormErrorMessage error={errors.account_number} />
              )}
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.bankAccounts.accountName')}</label>
              <Input {...register('account_name', { required: t('common.required') })} className="w-full" />
              <FormErrorMessage error={errors.account_name} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.bankAccounts.promptpayId')}</label>
              <Input {...register('promptpay_id')} className="w-full" />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.bankAccounts.note')}</label>
              <Input {...register('note')} className="w-full" />
            </div>
            {isEdit && (
              <div className="flex flex-col">
                <label className="form-label">{t('settings.bankAccounts.qr.label')}</label>
                <div className="flex items-center gap-3 rounded-md border border-line bg-surface p-3">
                  {qrUrl ? (
                    <button
                      type="button"
                      onClick={() => setQrLightbox(true)}
                      className="w-20 h-20 shrink-0 rounded-md border border-line bg-surface-soft overflow-hidden cursor-zoom-in hover:opacity-80 transition-opacity"
                      aria-label={t('settings.bankAccounts.qr.viewLarger')}
                    >
                      <img src={qrUrl} alt={t('settings.bankAccounts.qr.label')} className="w-full h-full object-contain" />
                    </button>
                  ) : (
                    <div className="w-20 h-20 shrink-0 rounded-md border border-line bg-surface-soft flex items-center justify-center overflow-hidden">
                      <QrCode size={28} className="text-subtler" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    {canManageQr ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            startIcon={qrUrl ? <RefreshCw size={14} /> : <Upload size={14} />}
                            disabled={qrBusy}
                            onClick={() => qrFileRef.current?.click()}
                          >
                            {qrBusy
                              ? t('common.saving')
                              : qrUrl
                                ? t('settings.bankAccounts.qr.change')
                                : t('settings.bankAccounts.qr.upload')}
                          </Button>
                          {qrUrl && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              startIcon={<Trash2 size={14} className="text-danger" />}
                              disabled={qrBusy}
                              onClick={() => setConfirmRemoveQr(true)}
                            >
                              {t('common.remove')}
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-subtle mt-1.5">{t('settings.bankAccounts.qr.hint')}</p>
                      </>
                    ) : (
                      <p className="text-xs text-subtle">
                        {qrUrl ? t('settings.bankAccounts.qr.readOnly') : t('settings.bankAccounts.qr.none')}
                      </p>
                    )}
                  </div>
                  <input
                    ref={qrFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleQrPick}
                  />
                </div>
              </div>
            )}
            {!isEdit && (
              <div className="flex flex-col">
                <label className="form-label">{t('settings.bankAccounts.isFallback')}</label>
                <Controller
                  name="is_default"
                  control={control}
                  render={({ field }) => (
                    <Switch checked={field.value} onChange={(e) => field.onChange((e.target as HTMLInputElement).checked)} />
                  )}
                />
                <p className="text-xs text-subtle mt-1">{t('settings.bankAccounts.fallbackHint')}</p>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" color="primary" disabled={isPending}>
            {isPending ? t('common.saving') : isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </form>

      <Modal open={confirmRemoveQr} onClose={() => setConfirmRemoveQr(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('settings.bankAccounts.qr.removeTitle')}</h2></div>
        <div className="modal-content"><p>{t('settings.bankAccounts.qr.removeConfirm')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmRemoveQr(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={handleQrRemove}>{t('common.remove')}</Button>
        </div>
      </Modal>

      <MediaLightbox
        open={qrLightbox}
        onClose={() => setQrLightbox(false)}
        mediaKey={qrKey}
        alt={t('settings.bankAccounts.qr.label')}
      />
    </Modal>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function BankAccountsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [createOpen, setCreateOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<BankAccount | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(null);

  // Channel config (STORE_FRONT / INSTALLMENT slot accounts) is a company-level
  // act — COMPANY_ADMIN / COMPANY_ACCOUNTANT only (PAYMENT_CHANNEL.MANAGE).
  const canManageChannels = user?.role_code === 'COMPANY_ADMIN'
    || user?.role_code === 'COMPANY_ACCOUNTANT'
    || user?.role_code === 'HOLDING_ADMIN'
    || user?.role_code === 'SYSTEM_DEV';
  const [tab, setTab] = useState<'accounts' | 'channels'>('accounts');

  const { data: accounts = [], isFetching, isLoading } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => apiClient.get<BankAccount[]>('/v_bank_accounts?order=branch_name,bank_name'),
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  // Resolve the edited account from the live query rows (not the frozen state
  // snapshot) so a QR set/remove — which invalidates ['bank-accounts'] — is
  // reflected in the open modal.
  const liveEditAccount = editAccount
    ? accounts.find(a => a.id === editAccount.id) ?? editAccount
    : null;

  const filtered = search.trim()
    ? accounts.filter(a => {
        const term = search.trim().toLowerCase();
        return a.branch_name.toLowerCase().includes(term)
          || a.bank_name.toLowerCase().includes(term)
          || a.account_number.includes(term)
          || a.account_name.toLowerCase().includes(term);
      })
    : accounts;

  const totalCount = filtered.length;
  const paginated = filtered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPageIndex(0);
    }, 300);
  };

  const handleToggle = async (account: BankAccount) => {
    if (!user) return;
    try {
      await apiClient.rpc('fn_bank_account_set_active', {
        p_account_id: account.id,
        p_is_active: !account.is_active,
        p_updated_by: user.user_id,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span className="alert-description">
              {account.is_active ? t('settings.bankAccounts.deactivated') : t('settings.bankAccounts.activated')}
            </span>
          </div>
        ),
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    } catch (err) {
      const msg = err instanceof ApiError
        ? (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '') || err.message
        : t('common.error');
      addSnackbar({
        message: <div className="alert alert-danger"><XCircle size={16} /><span className="alert-description">{msg}</span></div>,
        type: 'error',
        duration: 5000,
      });
    }
  };

  const handleSetDefault = async (account: BankAccount) => {
    if (!user) return;
    try {
      await apiClient.rpc('fn_bank_account_set_default', {
        p_account_id: account.id,
        p_updated_by: user.user_id,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span className="alert-description">{t('settings.bankAccounts.fallbackSet')}</span>
          </div>
        ),
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    } catch (err) {
      const msg = err instanceof ApiError
        ? (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '') || err.message
        : t('common.error');
      addSnackbar({
        message: <div className="alert alert-danger"><XCircle size={16} /><span className="alert-description">{msg}</span></div>,
        type: 'error',
        duration: 5000,
      });
    }
  };

  const columns: ColumnDef<BankAccount>[] = [
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.bankAccounts.colBranch')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.branch_name}</span>,
    },
    {
      id: 'bank',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.bankAccounts.colBank')} />,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.bank_name}</div>
          <div className="text-xs text-subtle tabular-nums">{row.original.account_number} · {row.original.account_name}</div>
        </div>
      ),
    },
    {
      id: 'promptpay',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.bankAccounts.colPromptpay')} />,
      cell: ({ row }) => row.original.promptpay_id
        ? <span className="tabular-nums text-sm">{row.original.promptpay_id}</span>
        : <span className="opacity-30">—</span>,
    },
    {
      id: 'qr',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.bankAccounts.colQr')} />,
      cell: ({ row }) => row.original.qr_media
        ? (
          <Tooltip content={t('settings.bankAccounts.qr.viewLarger')} placement="top">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setQrPreview(row.original.qr_media!.paths.original); }}
              className="w-8 h-8 rounded border border-line overflow-hidden bg-surface-soft cursor-zoom-in hover:opacity-80 transition-opacity"
              aria-label={t('settings.bankAccounts.qr.viewLarger')}
            >
              <img
                src={publicMediaUrl(row.original.qr_media.paths.original)}
                alt={t('settings.bankAccounts.qr.label')}
                className="w-full h-full object-contain"
              />
            </button>
          </Tooltip>
        )
        : <span className="opacity-30">—</span>,
      enableSorting: false,
    },
    {
      id: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.bankAccounts.colStatus')} />,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          {row.original.is_default && (
            <Tooltip content={t('settings.bankAccounts.fallbackHint')} placement="top">
              <Badge color="default" size="sm">{t('settings.bankAccounts.fallbackBadge')}</Badge>
            </Tooltip>
          )}
          <Badge color={row.original.is_active ? 'success' : 'default'} size="sm">
            {row.original.is_active ? t('common.active') : t('common.inactive')}
          </Badge>
        </div>
      ),
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <RowActions
          account={row.original}
          onEdit={setEditAccount}
          onToggle={handleToggle}
          onSetDefault={handleSetDefault}
        />
      ),
      enableSorting: false,
      className: 'w-10',
    },
  ];

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
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
          {t('settings.bankAccounts.title')}
        </div>
        <div className="mobile-header-end">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-primary-fg"
            onClick={() => setCreateOpen(true)}
            aria-label={t('settings.bankAccounts.addAccount')}
          >
            <Plus size={20} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('settings.bankAccounts.title')}</h1>
            <p className="text-sm text-subtle mt-1">{t('settings.bankAccounts.description')}</p>
          </div>
          {tab === 'accounts' && (
            <Button color="primary" startIcon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              {t('settings.bankAccounts.addAccount')}
            </Button>
          )}
        </div>

        {/* Tabs — only when the user can manage channels */}
        {canManageChannels && (
          <div className="flex-none flex items-center gap-1 border-b border-line mb-4">
            {(['accounts', 'channels'] as const).map((tk) => (
              <button
                key={tk}
                type="button"
                onClick={() => setTab(tk)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer bg-transparent ${
                  tab === tk ? 'border-primary text-primary-fg' : 'border-transparent text-subtle hover:text-fg'
                }`}
              >
                {tk === 'accounts'
                  ? t('settings.bankAccounts.tabAccounts', { defaultValue: 'Accounts' })
                  : t('settings.bankAccounts.tabChannels', { defaultValue: 'Channel accounts' })}
              </button>
            ))}
          </div>
        )}

        {tab === 'channels' ? (
          <BankChannelConfig />
        ) : (
        <>
        {/* Filter bar */}
        <div className="flex-none pb-4">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 md:max-w-56">
              <Input
                placeholder={t('common.search')}
                value={searchInput}
                onChange={(e) => handleSearch(e.target.value)}
                size="sm"
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Desktop: DataTable */}
        <DataTable<BankAccount>
          data={paginated}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setPageIndex(pi);
            setPageSize(ps);
          }}
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-subtle">
              {isLoading ? t('common.loading') : t('settings.bankAccounts.empty')}
            </div>
          }
        />

        {/* Mobile: Card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-subtle">
                {isLoading ? t('common.loading') : t('settings.bankAccounts.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {paginated.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{account.bank_name}</span>
                        {account.qr_media && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setQrPreview(account.qr_media!.paths.original); }}
                            className="shrink-0 bg-transparent border-none p-0 cursor-pointer text-subtle"
                            aria-label={t('settings.bankAccounts.qr.viewLarger')}
                          >
                            <QrCode size={14} />
                          </button>
                        )}
                        {account.is_default && <Badge color="default" size="sm">{t('settings.bankAccounts.fallbackBadge')}</Badge>}
                        {!account.is_active && <Badge color="default" size="sm">{t('common.inactive')}</Badge>}
                      </div>
                      <div className="text-xs text-subtle tabular-nums mt-0.5">{account.account_number} · {account.account_name}</div>
                      <div className="text-xs text-fg/40 mt-0.5">{account.branch_name}</div>
                    </div>
                    <RowActions
                      account={account}
                      onEdit={setEditAccount}
                      onToggle={handleToggle}
                      onSetDefault={handleSetDefault}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          {totalCount > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(totalCount / pageSize)}
              onPageChange={(p) => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[25, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
        </>
        )}
      </div>

      {/* Modals */}
      <AccountModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        account={null}
        branches={branches}
        canManageQr={canManageChannels}
      />
      <AccountModal
        open={!!editAccount}
        onClose={() => setEditAccount(null)}
        account={liveEditAccount}
        branches={branches}
        canManageQr={canManageChannels}
      />

      <MediaLightbox
        open={!!qrPreview}
        onClose={() => setQrPreview(null)}
        mediaKey={qrPreview}
        alt={t('settings.bankAccounts.qr.label')}
      />
    </>
  );
}
