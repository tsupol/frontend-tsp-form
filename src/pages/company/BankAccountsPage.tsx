// Bank accounts, at two levels.
//
//   branch   — the accounts a branch takes customer money into (doc 116). Which
//              one customers see is set per channel, on the channels tab.
//   company  — a fund company's own accounts (mig 1531, doc 116 §2e): what it
//              pays shops from, takes capital in and out through, spends from,
//              and what a shop pays the fund back into. Not tied to a branch,
//              never offered to customers. One of them is the usual account the
//              fund money screens pick in advance.
//
// The two are rows of the same view told apart by `branch_id` (null = company),
// so each tab filters on it: unfiltered, a company row would land in the branch
// list with no branch name.

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
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
  XCircle, CheckCircle, ArrowRightFromLine, QrCode, Upload, Trash2, RefreshCw, History,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BeMediaError, uploadBankAccountQr } from '../../lib/beMedia';
import { publicMediaUrl } from '../../lib/mediaPath';
import { useAuth } from '../../contexts/AuthContext';
import { MediaLightbox } from '../../components/MediaLightbox';
import { BankChannelConfig } from './BankChannelConfig';
import { translateApiError } from '../../lib/apiErrors';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { DateTime } from '../../components/DateTime';
import { ActionDoneView } from '../contracts/ActionDoneView';

type AccountLevel = 'branch' | 'company';

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
  company_name: string | null;
  /** null = a company-level account (mig 1531). */
  branch_id: number | null;
  branch_name: string | null;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_promptpay: boolean;
  promptpay_id: string | null;
  is_active: boolean;
  is_default: boolean;
  note: string | null;
  qr_media: QrMedia | null;
  account_number_display: string | null;
  is_company_account: boolean;
}

interface Branch {
  id: number;
  name: string;
  company_id: number;
}

interface FundCompany {
  id: number;
  name: string;
}

interface AccountForm {
  branch_id: string;
  company_id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  promptpay_id: string;
  is_default: boolean;
  note: string;
}

// ── Row Actions ──────────────────────────────────────────────────────────────

function RowActions({ account, onEdit, onToggle, onSetDefault, onHistory }: {
  account: BankAccount;
  onEdit: (a: BankAccount) => void;
  onToggle: (a: BankAccount) => void;
  onSetDefault: (a: BankAccount) => void;
  onHistory: (a: BankAccount) => void;
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
          <MenuItem
            icon={<Star size={14} />}
            label={account.is_company_account ? t('companyBankAccount.setUsual') : t('settings.bankAccounts.setFallback')}
            onClick={() => { setOpen(false); onSetDefault(account); }}
          />
        )}
        <MenuItem icon={<History size={14} />} label={t('companyBankAccount.history')} onClick={() => { setOpen(false); onHistory(account); }} />
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

function AccountModal({ open, onClose, account, level, branches, companies, canManageQr }: {
  open: boolean;
  onClose: () => void;
  account: BankAccount | null;
  /** Which kind a new account is; an edited one keeps its own. */
  level: AccountLevel;
  branches: Branch[];
  /** Fund companies a holding-level user may pick from; a company user has one. */
  companies: FundCompany[];
  canManageQr: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [errorMessage, setErrorMessage] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [view, setView] = useState<'form' | 'done'>('form');
  const [saved, setSaved] = useState<{ form: AccountForm; isDefault: boolean } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const isEdit = !!account;
  const isCompany = isEdit ? !!account?.is_company_account : level === 'company';
  // A company user creates for their own company; only a holding-level user picks.
  const ownCompanyId = user?.company_id ?? null;

  const { register, handleSubmit, reset, control, formState: { errors, isDirty } } = useForm<AccountForm>({
    defaultValues: {
      branch_id: '',
      company_id: '',
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
        branch_id: acc.branch_id != null ? String(acc.branch_id) : '',
        company_id: String(acc.company_id),
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
        company_id: ownCompanyId != null ? String(ownCompanyId) : '',
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
    setView('form');
    setSaved(null);
    setConfirmClose(false);
  }, [open, accountId, reset, ownCompanyId]);

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

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
      } else if (isCompany) {
        // Company accounts have their own create call and permission
        // (BANK_ACCOUNT.COMPANY_MANAGE); the branch call still needs a branch.
        await apiClient.rpc('fn_company_bank_account_create', {
          p_company_id: Number(data.company_id),
          p_bank_name: data.bank_name,
          p_account_number: data.account_number,
          p_account_name: data.account_name,
          p_promptpay_id: data.promptpay_id || null,
          p_is_default: data.is_default,
          p_note: data.note || null,
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
      }
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      // The fund money screens' account picker reads the same rows.
      queryClient.invalidateQueries({ queryKey: ['fund-bills', 'source-accounts'] });
      setSaved({ form: data, isDefault: isEdit ? !!account?.is_default : data.is_default });
      setView('done');
    } catch (err) {
      setErrorMessage(translateErr(err));
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsPending(false);
    }
  };

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {isEdit
            ? t('settings.bankAccounts.editAccount')
            : isCompany ? t('companyBankAccount.add') : t('settings.bankAccounts.addAccount')}
        </h2>
        <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
      </div>
      {view === 'done' && saved ? (
        <ActionDoneView
          headline={isEdit
            ? t('settings.bankAccounts.updated')
            : isCompany ? t('companyBankAccount.created') : t('settings.bankAccounts.created')}
          contractCode={saved.form.account_name}
          detailRows={[
            { label: t('settings.bankAccounts.bankName'), value: saved.form.bank_name },
            { label: t('settings.bankAccounts.accountNumber'), value: isEdit ? (account?.account_number ?? '') : saved.form.account_number, emphasis: true },
            ...(isCompany
              ? [{ label: t('companyBankAccount.usual'), value: saved.isDefault ? t('common.yes') : t('common.no') }]
              : []),
          ]}
          extras={isCompany && !isEdit ? (
            <div className="alert alert-info"><span>{t('companyBankAccount.createdHint')}</span></div>
          ) : undefined}
          onClose={forceClose}
        />
      ) : (
      <form className="flex flex-col flex-1 min-h-0 overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-content">
          {isCompany && !isEdit && (
            <div className="alert alert-info mb-4"><span>{t('companyBankAccount.formHint')}</span></div>
          )}
          <div className="form-grid">
            {!isEdit && isCompany && ownCompanyId == null && (
              <div className="flex flex-col">
                <label className="form-label">{t('companyBankAccount.company')}</label>
                <Controller
                  name="company_id"
                  control={control}
                  rules={{ required: t('common.required') }}
                  render={({ field }) => (
                    <Select
                      value={field.value || null}
                      onChange={(val) => field.onChange((val as string) ?? '')}
                      placeholder={t('companyBankAccount.company')}
                      options={companies.map(c => ({ label: c.name, value: String(c.id) }))}
                    />
                  )}
                />
                <FormErrorMessage error={errors.company_id} />
              </div>
            )}
            {!isEdit && !isCompany && (
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
            {/* The payment QR is for customers; a fund account is never shown to one. */}
            {isEdit && !isCompany && (
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
                <label className="form-label">
                  {isCompany ? t('companyBankAccount.usual') : t('settings.bankAccounts.isFallback')}
                </label>
                <Controller
                  name="is_default"
                  control={control}
                  render={({ field }) => (
                    <Switch checked={field.value} onChange={(e) => field.onChange((e.target as HTMLInputElement).checked)} />
                  )}
                />
                <p className="text-xs text-subtle mt-1">
                  {isCompany ? t('companyBankAccount.usualHint') : t('settings.bankAccounts.fallbackHint')}
                </p>
              </div>
            )}
          </div>
        </div>
        <ModalErrorBand message={errorMessage} onDismiss={() => setErrorMessage('')} />
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
          <Button type="submit" color="primary" disabled={isPending}>
            {isPending ? t('common.saving') : isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </form>
      )}

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

    <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%" ariaLabel={t('common.unsavedChanges')}>
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

// ── History ──────────────────────────────────────────────────────────────────

interface BankAccountLogRow {
  id: number;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
  created_by_username: string | null;
}

/** Bookkeeping keys the log carries that say nothing to the person reading it. */
const LOG_HIDDEN_KEYS = new Set(['mig', 'copied_from', 'level', 'company_id', 'branch_id', 'account_kind', 'updated_at', 'updated_by', 'created_by', 'holding_id']);

function logValue(v: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no');
  return String(v);
}

function AccountHistoryModal({ account, onClose }: { account: BankAccount | null; onClose: () => void }) {
  const { t } = useTranslation();
  // Hold the last account through the close transition.
  const last = useRef(account);
  if (account) last.current = account;
  const shown = account ?? last.current;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['bank-accounts', 'log', shown?.id],
    queryFn: () => apiClient.get<BankAccountLogRow[]>(`/v_bank_account_log?bank_account_id=eq.${shown!.id}&order=id.desc`),
    enabled: !!account,
  });

  return (
    <Modal open={!!account} onClose={onClose} maxWidth="32rem" width="100%" ariaLabel={t('companyBankAccount.history')}>
      <div className="modal-header">
        <h2 className="modal-title">{t('companyBankAccount.history')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="modal-content">
        {shown && (
          <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-3">
            <div className="font-medium text-sm">{shown.account_name}</div>
            <div className="text-xs text-subtle tabular-nums">{shown.bank_name} · {shown.account_number_display ?? shown.account_number}</div>
          </div>
        )}
        {isLoading ? (
          <div className="py-6 text-center text-subtle text-sm">{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-subtle text-sm">{t('companyBankAccount.historyEmpty')}</div>
        ) : (
          <div className="flex flex-col divide-y divide-line border-y border-line">
            {rows.map(r => {
              const keys = Object.keys({ ...(r.old_values ?? {}), ...(r.new_values ?? {}) })
                .filter(k => !LOG_HIDDEN_KEYS.has(k))
                // A new account lists what it was made with (blanks left out); a
                // change lists only what differs. Missing and null are the same.
                .filter(k => r.action === 'CREATE'
                  ? r.new_values?.[k] != null
                  : JSON.stringify(r.old_values?.[k] ?? null) !== JSON.stringify(r.new_values?.[k] ?? null));
              return (
                <div key={r.id} className="py-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge size="sm" color={r.action === 'CREATE' ? 'success' : 'default'}>
                      {t(`companyBankAccount.logAction_${r.action}`, { defaultValue: r.action })}
                    </Badge>
                    <span className="text-xs text-subtle">{r.created_by_username ?? ''}</span>
                    <span className="flex-1" />
                    <span className="text-xs text-subtle"><DateTime value={r.created_at} showTime /></span>
                  </div>
                  {keys.length > 0 && (
                    <div className="mt-1 flex flex-col gap-0.5">
                      {keys.map(k => (
                        <div key={k} className="text-xs">
                          <span className="text-subtle">{t(`companyBankAccount.logField_${k}`, { defaultValue: k })}: </span>
                          {r.action === 'CREATE'
                            ? logValue(r.new_values?.[k], t)
                            : <>{logValue(r.old_values?.[k], t)} → {logValue(r.new_values?.[k], t)}</>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button color="primary" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}


// ── Company accounts tab ─────────────────────────────────────────────────────

function CompanyAccountsTab({ accounts, isLoading, isFetching, showCompany, onEdit, onToggle, onSetDefault, onHistory }: {
  accounts: BankAccount[];
  isLoading: boolean;
  isFetching: boolean;
  /** A holding-level user sees every fund company's accounts, so name the company. */
  showCompany: boolean;
  onEdit: (a: BankAccount) => void;
  onToggle: (a: BankAccount) => void;
  onSetDefault: (a: BankAccount) => void;
  onHistory: (a: BankAccount) => void;
}) {
  const { t } = useTranslation();

  const columns: ColumnDef<BankAccount>[] = [
    ...(showCompany ? [{
      id: 'company',
      header: () => t('companyBankAccount.company'),
      cell: ({ row }: { row: { original: BankAccount } }) => <span className="font-medium">{row.original.company_name}</span>,
    } as ColumnDef<BankAccount>] : []),
    {
      id: 'bank',
      header: () => t('settings.bankAccounts.colBank'),
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.bank_name}</div>
          <div className="text-xs text-subtle tabular-nums">
            {row.original.account_number_display ?? row.original.account_number} · {row.original.account_name}
          </div>
        </div>
      ),
    },
    {
      id: 'note',
      header: () => t('settings.bankAccounts.note'),
      cell: ({ row }) => row.original.note
        ? <span className="text-sm text-subtle line-clamp-2">{row.original.note}</span>
        : <span className="text-subtler">—</span>,
    },
    {
      id: 'status',
      header: () => t('settings.bankAccounts.colStatus'),
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          {row.original.is_default && (
            <Tooltip content={t('companyBankAccount.usualHint')} placement="top">
              <Badge color="primary" size="sm">{t('companyBankAccount.usual')}</Badge>
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
        <RowActions account={row.original} onEdit={onEdit} onToggle={onToggle} onSetDefault={onSetDefault} onHistory={onHistory} />
      ),
      className: 'w-10',
    },
  ];

  return (
    <>
      <p className="flex-none text-sm text-subtle pb-4">{t('companyBankAccount.tabHint')}</p>
      <DataTable<BankAccount>
        outlined
        data={accounts}
        columns={columns}
        className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60' : ''} transition-opacity`}
        noResults={
          <div className="p-8 text-center text-subtle">
            {isLoading ? t('common.loading') : t('companyBankAccount.empty')}
          </div>
        }
      />
      <div className={`flex-1 min-h-0 overflow-auto better-scroll pb-8 md:hidden ${isFetching ? 'opacity-60' : ''} transition-opacity`}>
        {accounts.length === 0 ? (
          <div className="p-8 text-center text-subtle">
            {isLoading ? t('common.loading') : t('companyBankAccount.empty')}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-line border-b border-line">
            {accounts.map(account => (
              <div key={account.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{account.bank_name}</span>
                    {account.is_default && <Badge color="primary" size="sm">{t('companyBankAccount.usual')}</Badge>}
                    {!account.is_active && <Badge color="default" size="sm">{t('common.inactive')}</Badge>}
                  </div>
                  <div className="text-xs text-subtle tabular-nums mt-0.5">
                    {account.account_number_display ?? account.account_number} · {account.account_name}
                  </div>
                  {showCompany && <div className="text-xs text-subtler mt-0.5">{account.company_name}</div>}
                </div>
                <RowActions account={account} onEdit={onEdit} onToggle={onToggle} onSetDefault={onSetDefault} onHistory={onHistory} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

type PageTab = 'accounts' | 'company' | 'channels';

export function BankAccountsPage() {
  const { t } = useTranslation();
  const { user, isFundCompany } = useAuth();
  const { hasPermission } = useMyPermissions();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState<string>('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [createLevel, setCreateLevel] = useState<AccountLevel | null>(null);
  // Keep the kind being created through the close transition.
  const lastCreateLevel = useRef<AccountLevel>('branch');
  if (createLevel) lastCreateLevel.current = createLevel;
  const [editAccount, setEditAccount] = useState<BankAccount | null>(null);
  const [historyAccount, setHistoryAccount] = useState<BankAccount | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(null);

  // Channel config (STORE_FRONT / INSTALLMENT slot accounts) is a company-level
  // act — COMPANY_ADMIN / COMPANY_ACCOUNTANT only (PAYMENT_CHANNEL.MANAGE).
  const canManageChannels = user?.role_code === 'COMPANY_ADMIN'
    || user?.role_code === 'COMPANY_ACCOUNTANT'
    || user?.role_code === 'HOLDING_ADMIN'
    || user?.role_code === 'SYSTEM_DEV';
  // Company accounts exist only for a fund company (an operating one is refused
  // with COMPANY_ACCOUNT_NOT_ALLOWED), and only BANK_ACCOUNT.COMPANY_MANAGE may
  // keep them. A holding-level user has no company of its own and picks one.
  const canCompanyAccounts = hasPermission('BANK_ACCOUNT.COMPANY_MANAGE')
    && (isFundCompany || user?.company_id == null);

  // The tab lives in the address so the fund money screens can link straight
  // to the company accounts ("no account yet — create one").
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab') as PageTab | null;
  const tab: PageTab = requestedTab === 'company' && canCompanyAccounts
    ? 'company'
    : requestedTab === 'channels' && canManageChannels ? 'channels' : 'accounts';
  const setTab = (next: PageTab) => {
    const p = new URLSearchParams(params);
    if (next === 'accounts') p.delete('tab'); else p.set('tab', next);
    setParams(p);
  };
  const tabs: PageTab[] = [
    'accounts',
    ...(canCompanyAccounts ? ['company' as const] : []),
    ...(canManageChannels ? ['channels' as const] : []),
  ];

  // Branch rows only: a company row has no branch and belongs on its own tab.
  const { data: accounts = [], isFetching, isLoading } = useQuery({
    queryKey: ['bank-accounts', 'branch'],
    queryFn: () => apiClient.get<BankAccount[]>('/v_bank_accounts?branch_id=not.is.null&order=branch_name,bank_name'),
  });

  const companyQuery = useQuery({
    queryKey: ['bank-accounts', 'company'],
    queryFn: () => apiClient.get<BankAccount[]>('/v_bank_accounts?branch_id=is.null&order=company_name,is_default.desc,id'),
    enabled: canCompanyAccounts,
  });
  const companyAccounts = companyQuery.data ?? [];

  const { data: fundCompanies = [] } = useQuery({
    queryKey: ['fund-companies'],
    queryFn: () => apiClient.get<FundCompany[]>('/v_companies?company_type=eq.FINANCIER&select=id,name&order=name'),
    enabled: canCompanyAccounts && user?.company_id == null,
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  // Resolve the edited account from the live query rows (not the frozen state
  // snapshot) so a QR set/remove — which invalidates ['bank-accounts'] — is
  // reflected in the open modal.
  const liveEditAccount = editAccount
    ? [...accounts, ...companyAccounts].find(a => a.id === editAccount.id) ?? editAccount
    : null;

  // Branch options come from the account rows themselves (not v_branches) so
  // branches that hold accounts but are now inactive still appear in the filter.
  const branchOptions = [...new Map(accounts.map(a => [a.branch_id, a.branch_name ?? '']))]
    .map(([id, name]) => ({ value: String(id), label: name }));

  const filtered = accounts.filter(a => {
    if (filterBranch && String(a.branch_id) !== filterBranch) return false;
    if (!search.trim()) return true;
    const term = search.trim().toLowerCase();
    return (a.branch_name ?? '').toLowerCase().includes(term)
      || a.bank_name.toLowerCase().includes(term)
      || a.account_number.includes(term)
      || a.account_name.toLowerCase().includes(term);
  });

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

  const invalidateAccounts = () => {
    queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    queryClient.invalidateQueries({ queryKey: ['fund-bills', 'source-accounts'] });
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
      invalidateAccounts();
    } catch (err) {
      const msg = err instanceof ApiError
        ? translateApiError(err, t) || err.message
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
            <span className="alert-description">
              {account.is_company_account ? t('companyBankAccount.usualSet') : t('settings.bankAccounts.fallbackSet')}
            </span>
          </div>
        ),
        type: 'success',
      });
      invalidateAccounts();
    } catch (err) {
      const msg = err instanceof ApiError
        ? translateApiError(err, t) || err.message
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
        : <span className="text-subtler">—</span>,
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
        : <span className="text-subtler">—</span>,
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
          onHistory={setHistoryAccount}
        />
      ),
      enableSorting: false,
      className: 'w-10',
    },
  ];

  const addLabel = tab === 'company' ? t('companyBankAccount.add') : t('settings.bankAccounts.addAccount');
  const openCreate = () => setCreateLevel(tab === 'company' ? 'company' : 'branch');

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
        <div className="mobile-header-end w-nav">
          {tab !== 'channels' && (
            <button
              className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-primary-fg"
              onClick={openCreate}
              aria-label={addLabel}
            >
              <Plus size={20} />
            </button>
          )}
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('settings.bankAccounts.title')}</h1>
            <p className="text-sm text-subtle mt-1">
              {tab === 'company' ? t('companyBankAccount.description') : t('settings.bankAccounts.description')}
            </p>
          </div>
          {tab !== 'channels' && (
            <Button color="primary" startIcon={<Plus size={16} />} onClick={openCreate}>
              {addLabel}
            </Button>
          )}
        </div>

        {tabs.length > 1 && (
          <div className="flex-none flex items-center gap-1 border-b border-line mb-4">
            {tabs.map((tk) => (
              <button
                key={tk}
                type="button"
                onClick={() => setTab(tk)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer bg-transparent ${
                  tab === tk ? 'border-primary text-primary-fg' : 'border-transparent text-subtle hover:text-fg'
                }`}
              >
                {tk === 'accounts'
                  ? t('settings.bankAccounts.tabAccounts')
                  : tk === 'company' ? t('companyBankAccount.tab') : t('settings.bankAccounts.tabChannels')}
              </button>
            ))}
          </div>
        )}

        {tab === 'channels' ? (
          <BankChannelConfig />
        ) : tab === 'company' ? (
          <CompanyAccountsTab
            accounts={companyAccounts}
            isLoading={companyQuery.isLoading}
            isFetching={companyQuery.isFetching}
            showCompany={user?.company_id == null}
            onEdit={setEditAccount}
            onToggle={handleToggle}
            onSetDefault={handleSetDefault}
            onHistory={setHistoryAccount}
          />
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
            <div className="w-44 shrink-0">
              <Select
                options={branchOptions}
                value={filterBranch || null}
                onChange={(val) => { setFilterBranch((val as string) ?? ''); setPageIndex(0); }}
                placeholder={t('settings.bankAccounts.allBranches')}
                size="sm"
                showChevron
                clearable
              />
            </div>
          </div>
        </div>

        {/* Desktop: DataTable */}
        <DataTable<BankAccount>
          outlined
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
              <div className="flex flex-col divide-y divide-line border-b border-line">
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
                      <div className="text-xs text-subtler mt-0.5">{account.branch_name}</div>
                    </div>
                    <RowActions
                      account={account}
                      onEdit={setEditAccount}
                      onToggle={handleToggle}
                      onSetDefault={handleSetDefault}
                      onHistory={setHistoryAccount}
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
        open={createLevel != null}
        onClose={() => setCreateLevel(null)}
        account={null}
        level={createLevel ?? lastCreateLevel.current}
        branches={branches}
        companies={fundCompanies}
        canManageQr={canManageChannels}
      />
      <AccountModal
        open={!!editAccount}
        onClose={() => setEditAccount(null)}
        account={liveEditAccount}
        level={liveEditAccount?.is_company_account ? 'company' : 'branch'}
        branches={branches}
        companies={fundCompanies}
        canManageQr={canManageChannels}
      />
      <AccountHistoryModal account={historyAccount} onClose={() => setHistoryAccount(null)} />

      <MediaLightbox
        open={!!qrPreview}
        onClose={() => setQrPreview(null)}
        mediaKey={qrPreview}
        alt={t('settings.bankAccounts.qr.label')}
      />
    </>
  );
}
