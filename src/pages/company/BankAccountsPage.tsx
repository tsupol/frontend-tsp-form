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
  DataTable, DataTableColumnHeader, DataTableFooter, Button, Input, Select, RadioGroup,
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
import { BankLogo } from '../../components/BankLogo';
import { BankAccountLine } from '../../components/BankAccountLine';
import { accountNumberText } from '../../lib/bankAccount';
import { useRefBanks } from '../../components/DealPartnerPayoutAccountField';
import { PartnerPayoutAccountsTab } from './PartnerPayoutAccountsTab';

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
  /** Thai name; from v_ref_banks once the bank has a code (BE response 10-30). */
  bank_name: string;
  /** Coming with BE's bank-code change; English screens use it when present. */
  bank_name_en?: string | null;
  /** null = typed in before the bank had to be picked from the list — "ข้อมูลไม่ครบ". */
  bank_code: string | null;
  account_kind: string;
  /** null for a QR-only account: it has no number to pay to. */
  account_number: string | null;
  account_name: string;
  /** The kind wants a QR picture; with no qr_media the account shows "ยังไม่มีรูป QR". */
  requires_qr_image: boolean;
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

interface RefBankKind {
  code: string;
  name_th: string;
  requires_account_number: boolean;
  requires_qr_image: boolean;
  sort_order: number;
}

// The owner's two kinds (mig 1553): a number the customer can pay to, or a QR
// to scan and nothing else. PromptPay is not a kind any more but a destination
// (`bank_code = PROMPTPAY` in v_ref_banks) with the PromptPay number in the
// number field; BeMerchant is BBL + QR_ONLY. The old kinds are off in the view;
// the filter stays as a belt for a stale cache.
const RETIRING_KINDS = new Set(['PROMPTPAY', 'BEMERCHANT']);

function useRefBankKinds() {
  return useQuery({
    queryKey: ['ref-bank-kinds'],
    queryFn: () => apiClient.get<RefBankKind[]>('/v_ref_bank_account_kinds?order=sort_order'),
    staleTime: 30 * 60 * 1000,
  });
}

/** The shared account line, plus the two warnings only this page shows:
 *  "ข้อมูลไม่ครบ" (no bank code) and "ยังไม่มีรูป QR". The desktop tables have a
 *  branch column and the fund tab is all fund accounts, so "where" is off unless asked. */
function AccountBankLine({ account, badges, showWhere = false }: {
  account: BankAccount;
  badges?: React.ReactNode;
  showWhere?: boolean;
}) {
  const { t } = useTranslation();
  const qrMissing = account.requires_qr_image && !account.qr_media;
  return (
    <BankAccountLine
      account={account}
      showWhere={showWhere}
      badges={<>
        {!account.bank_code && (
          <Tooltip content={t('bankAccountForm.incompleteHint')} placement="top">
            <Badge color="warning" size="sm">{t('bankAccountForm.incomplete')}</Badge>
          </Tooltip>
        )}
        {qrMissing && <Badge color="warning" size="sm">{t('bankAccountForm.qrMissing')}</Badge>}
        {badges}
      </>}
    />
  );
}

interface AccountForm {
  branch_id: string;
  company_id: string;
  bank_code: string;
  account_kind: string;
  account_number: string;
  account_name: string;
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

function AccountModal({ open, onClose, account, level, branches, companies, canManageQr, onOpenAccount }: {
  open: boolean;
  onClose: () => void;
  account: BankAccount | null;
  /** From the done view of a new QR-only account: open it to attach the picture. */
  onOpenAccount?: (id: number) => void;
  /** Which kind a new account is; an edited one keeps its own. */
  level: AccountLevel;
  branches: Branch[];
  /** Fund companies a holding-level user may pick from; a company user has one. */
  companies: FundCompany[];
  canManageQr: boolean;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const [errorMessage, setErrorMessage] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [view, setView] = useState<'form' | 'done'>('form');
  const [saved, setSaved] = useState<{ form: AccountForm; isDefault: boolean; id: number | null; isQrOnly: boolean } | null>(null);
  const { data: banks = [] } = useRefBanks();
  const { data: kinds = [] } = useRefBankKinds();
  const bankLabel = (b: { name_th: string; name_en?: string | null }) =>
    (i18n.language === 'en' && b.name_en) || b.name_th;
  const [confirmClose, setConfirmClose] = useState(false);
  const isEdit = !!account;
  const isCompany = isEdit ? !!account?.is_company_account : level === 'company';
  // A company user creates for their own company; only a holding-level user picks.
  const ownCompanyId = user?.company_id ?? null;

  const { register, handleSubmit, reset, control, watch, formState: { errors, isDirty } } = useForm<AccountForm>({
    defaultValues: {
      branch_id: '',
      company_id: '',
      bank_code: '',
      account_kind: 'BANK_ACCOUNT',
      account_number: '',
      account_name: '',
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
        bank_code: acc.bank_code ?? '',
        account_kind: acc.account_kind,
        account_number: acc.account_number ?? '',
        account_name: acc.account_name,
        is_default: acc.is_default,
        note: acc.note ?? '',
      });
    } else {
      reset({
        branch_id: '',
        company_id: ownCompanyId != null ? String(ownCompanyId) : '',
        bank_code: '',
        account_kind: 'BANK_ACCOUNT',
        account_number: '',
        account_name: '',
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

  const bankCode = watch('bank_code');
  const kindCode = watch('account_kind');
  const numberInput = watch('account_number');
  const bank = banks.find(b => b.code === bankCode) ?? null;
  const kind = kinds.find(k => k.code === kindCode) ?? null;
  // A fund account is never shown to a customer, so it is always a numbered one.
  // An existing numbered branch account may still become QR-only (BE clears the
  // number itself — the one exception to the immutable number); the other way
  // round would need a number, which cannot be added, so a QR-only account stays.
  const chooseKind = !isCompany && (!isEdit || account?.account_kind === 'BANK_ACCOUNT');
  const kindOptions = kinds.filter(k => !RETIRING_KINDS.has(k.code));
  const isQrOnly = kind ? !kind.requires_account_number : false;
  const switchingToQr = isEdit && isQrOnly && account?.account_kind !== kindCode;
  // A fund company's account must be a real bank (mig 1553) — PromptPay is for
  // customers paying a branch. Everyone else picks from the whole list.
  const bankOptions = isCompany ? banks.filter(b => b.is_bank !== false) : banks;
  // Spaces and dashes are typed freely; only the digits are sent.
  const digits = numberInput.replace(/\D/g, '');
  // A warning, never a block (owner 10-30): some real numbers are longer than the
  // bank list expects, and the server stops checking length once BE's change lands.
  const lengthHint = bank?.enforces_length && bank.digits_min != null
    ? bank.digits_min === bank.digits_max
      ? t('bankAccountForm.digitsExact', { n: bank.digits_min })
      : t('bankAccountForm.digitsRange', { min: bank.digits_min, max: bank.digits_max })
    : null;
  const lengthOff = !!lengthHint && digits.length > 0
    && (digits.length < (bank?.digits_min ?? 0) || digits.length > (bank?.digits_max ?? Infinity));
  const legacyNoBank = isEdit && !account?.bank_code;

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

    // The bank is always picked from v_ref_banks and sent as its code; the name
    // sent alongside is the list's own (BE writes it from the code anyway once
    // its change lands). No dashed number is sent — BE builds it from the bank.
    const chosenBank = banks.find(b => b.code === data.bank_code) ?? null;
    const kindToSend = isCompany ? 'BANK_ACCOUNT' : data.account_kind;
    const qrOnly = !isCompany && isQrOnly;
    const start = Date.now();
    try {
      let newId: number | null = null;
      if (isEdit) {
        // Only a bank actually picked is sent: an old account with no code keeps
        // what it has until someone chooses its bank here.
        const bankChanged = !!chosenBank && chosenBank.code !== account!.bank_code;
        await apiClient.rpc('fn_bank_account_update', {
          p_account_id: account!.id,
          p_bank_name: bankChanged ? chosenBank.name_th : null,
          p_bank_code: bankChanged ? chosenBank.code : null,
          p_account_number: null, // immutable — never sent on update (409 ACCOUNT_NUMBER_IMMUTABLE); null keeps existing
          p_account_name: data.account_name,
          p_account_number_display: null,
          // Only a real change is sent; "QR_ONLY" makes BE clear the number.
          p_account_kind: data.account_kind !== account!.account_kind ? data.account_kind : null,
          p_note: data.note || null,
          p_updated_by: user.user_id,
        });
      } else if (isCompany) {
        // Company accounts have their own create call and permission
        // (BANK_ACCOUNT.COMPANY_MANAGE); the branch call still needs a branch.
        const res = await apiClient.rpc<{ id: number }>('fn_company_bank_account_create', {
          p_company_id: Number(data.company_id),
          p_bank_name: chosenBank?.name_th ?? '',
          p_bank_code: data.bank_code,
          p_account_kind: kindToSend,
          p_account_number: digits,
          p_account_name: data.account_name,
          p_is_default: data.is_default,
          p_note: data.note || null,
        });
        newId = res?.id ?? null;
      } else {
        const res = await apiClient.rpc<{ id: number }>('fn_bank_account_create', {
          p_branch_id: Number(data.branch_id),
          p_bank_name: chosenBank?.name_th ?? '',
          p_bank_code: data.bank_code,
          p_account_kind: kindToSend,
          // A QR-only account has no number to pay to; its shop number goes in the note.
          p_account_number: qrOnly ? null : digits,
          p_account_name: data.account_name,
          p_is_default: data.is_default,
          p_note: data.note || null,
          p_created_by: user.user_id,
        });
        newId = res?.id ?? null;
      }
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      // The fund money screens' account picker reads the same rows.
      queryClient.invalidateQueries({ queryKey: ['fund-bills', 'source-accounts'] });
      setSaved({ form: data, isDefault: isEdit ? !!account?.is_default : data.is_default, id: newId, isQrOnly: qrOnly });
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
            {
              label: t('settings.bankAccounts.bankName'),
              value: (() => {
                const b = banks.find(x => x.code === saved.form.bank_code);
                return b
                  ? <span className="inline-flex items-center gap-1.5"><BankLogo code={b.code} size={18} />{bankLabel(b)}</span>
                  : (account?.bank_name ?? '');
              })(),
            },
            {
              label: t('settings.bankAccounts.accountNumber'),
              value: saved.isQrOnly
                ? t('bankAccountForm.qrOnlyShort')
                : isEdit ? (account ? accountNumberText(account, t) : '') : saved.form.account_number.replace(/\D/g, ''),
              emphasis: true,
            },
            ...(isCompany
              ? [{ label: t('companyBankAccount.usual'), value: saved.isDefault ? t('common.yes') : t('common.no') }]
              : []),
          ]}
          extras={saved.isQrOnly ? (
            // The picture is attached to an existing account, so it comes after saving.
            <div className="alert alert-warning">
              <div className="flex flex-col gap-2">
                <span>{t('bankAccountForm.qrNextStep')}</span>
                {saved.id != null && onOpenAccount && canManageQr && (
                  <div>
                    <Button size="sm" variant="outline" startIcon={<Upload size={14} />} onClick={() => onOpenAccount(saved.id!)}>
                      {t('settings.bankAccounts.qr.upload')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : isCompany && !isEdit ? (
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
              {legacyNoBank && (
                <div className="alert alert-warning mb-2">
                  <span>{t('bankAccountForm.legacyNoBank', { typed: account?.bank_name ?? '' })}</span>
                </div>
              )}
              <Controller
                name="bank_code"
                control={control}
                rules={isEdit ? {} : { required: t('common.required') }}
                render={({ field }) => (
                  <Select
                    value={field.value || null}
                    onChange={(val) => field.onChange((val as string) ?? '')}
                    placeholder={t('bankAccountForm.bankPlaceholder')}
                    options={bankOptions.map(b => ({ value: b.code, label: bankLabel(b), icon: <BankLogo code={b.code} size={20} /> }))}
                    searchable
                    showChevron
                  />
                )}
              />
              <FormErrorMessage error={errors.bank_code} />
            </div>
            {chooseKind && (
              <div className="flex flex-col gap-1.5">
                <label className="form-label">{t('bankAccountForm.kind')}</label>
                <Controller
                  name="account_kind"
                  control={control}
                  render={({ field }) => (
                    <RadioGroup
                      name="account-kind"
                      value={field.value}
                      onChange={(v) => field.onChange(v as string)}
                      className="flex flex-col gap-2"
                      options={kindOptions.map(k => ({
                        value: k.code,
                        label: (
                          <span className="min-w-0">
                            <span className="text-sm">{t(`bankAccountForm.kind_${k.code}`, { defaultValue: k.name_th })}</span>
                            <span className="block text-xs text-subtler">{t(`bankAccountForm.kindHint_${k.code}`, { defaultValue: '' })}</span>
                          </span>
                        ),
                      }))}
                    />
                  )}
                />
              </div>
            )}
            {isEdit && !isCompany && !chooseKind && account && (
              <div className="flex flex-col">
                <label className="form-label">{t('bankAccountForm.kind')}</label>
                <div className="text-sm">
                  {t(`bankAccountForm.kind_${account.account_kind}`, {
                    defaultValue: kinds.find(k => k.code === account.account_kind)?.name_th ?? account.account_kind,
                  })}
                </div>
              </div>
            )}
            {/* A QR-only account has no number; an edited one shows its number locked. */}
            {isEdit ? account?.account_number != null && (
              <div className="flex flex-col">
                <label className="form-label">{t('settings.bankAccounts.accountNumber')}</label>
                <Input value={accountNumberText(account, t)} className="w-full" disabled readOnly />
                <p className={`text-xs mt-1.5 ${switchingToQr ? 'text-warning-fg' : 'text-subtle'}`}>
                  {switchingToQr ? t('bankAccountForm.switchToQrClearsNumber') : t('settings.bankAccounts.accountNumberImmutable')}
                </p>
              </div>
            ) : !isQrOnly && (
              <div className="flex flex-col">
                <label className="form-label">{t('settings.bankAccounts.accountNumber')}</label>
                <Input
                  {...register('account_number', {
                    validate: v => v.replace(/\D/g, '') !== '' || t('common.required'),
                  })}
                  className="w-full"
                  inputMode="numeric"
                  autoComplete="off"
                />
                {errors.account_number ? (
                  <FormErrorMessage error={errors.account_number} />
                ) : (
                  <p className={`text-xs mt-1.5 ${lengthOff ? 'text-warning-fg' : 'text-subtle'}`}>
                    {lengthHint
                      ? t('bankAccountForm.digitsCounted', { hint: lengthHint, count: digits.length })
                      : t('bankAccountForm.digitsOnly')}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-col">
              <label className="form-label">{t('settings.bankAccounts.accountName')}</label>
              <Input {...register('account_name', { required: t('common.required') })} className="w-full" />
              <FormErrorMessage error={errors.account_name} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('settings.bankAccounts.note')}</label>
              <Input {...register('note')} className="w-full" />
              {isQrOnly && (
                <p className="text-xs text-subtle mt-1.5">{t('bankAccountForm.qrOnlyNoteHint')}</p>
              )}
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
                        <p className={`text-xs mt-1.5 ${account?.requires_qr_image && !qrUrl ? 'text-warning-fg' : 'text-subtle'}`}>
                          {account?.requires_qr_image && !qrUrl ? t('bankAccountForm.qrMissingHint') : t('settings.bankAccounts.qr.hint')}
                        </p>
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
          {/* An edit with nothing changed has nothing to save. */}
          <Button type="submit" color="primary" disabled={isPending || (isEdit && !isDirty)}>
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
            <AccountBankLine account={shown} />
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
      cell: ({ row }) => <AccountBankLine account={row.original} />,
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
                  <AccountBankLine
                    account={account}
                    badges={<>
                      {account.is_default && <Badge color="primary" size="sm">{t('companyBankAccount.usual')}</Badge>}
                      {!account.is_active && <Badge color="default" size="sm">{t('common.inactive')}</Badge>}
                    </>}
                  />
                  {showCompany && <div className="text-xs text-subtler mt-0.5 pl-[38px]">{account.company_name}</div>}
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

type PageTab = 'accounts' | 'company' | 'partner-payout' | 'channels';

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
  // By id, so the done view of a new account can open it before the list has it.
  const [editId, setEditId] = useState<number | null>(null);
  const setEditAccount = (a: BankAccount | null) => setEditId(a?.id ?? null);
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
  // The shops' own accounts the fund pays INTO (IMPLEMENT 2026-10-31
  // partner_payout_account_tab) — a fund-side setting, same gate as the
  // deal-partner terms menu. The RPC decides who may write.
  const canPartnerPayout = isFundCompany;

  // The tab lives in the address so the fund money screens can link straight
  // to the company accounts ("no account yet — create one").
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab') as PageTab | null;
  const tab: PageTab = requestedTab === 'company' && canCompanyAccounts
    ? 'company'
    : requestedTab === 'partner-payout' && canPartnerPayout ? 'partner-payout'
    : requestedTab === 'channels' && canManageChannels ? 'channels' : 'accounts';
  const setTab = (next: PageTab) => {
    const p = new URLSearchParams(params);
    if (next === 'accounts') p.delete('tab'); else p.set('tab', next);
    setParams(p);
  };
  const tabs: PageTab[] = [
    'accounts',
    ...(canCompanyAccounts ? ['company' as const] : []),
    ...(canPartnerPayout ? ['partner-payout' as const] : []),
    ...(canManageChannels ? ['channels' as const] : []),
  ];
  // Tabs whose rows are made elsewhere: no "add" button.
  const noAdd = tab === 'channels' || tab === 'partner-payout';

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

  // Resolve the edited account from the live query rows so a QR set/remove —
  // which invalidates ['bank-accounts'] — is reflected in the open modal. A
  // just-created account opens as soon as the refetched list holds it.
  const liveEditAccount = editId != null
    ? [...accounts, ...companyAccounts].find(a => a.id === editId) ?? null
    : null;
  // Hold the last one through the close transition.
  const lastEditAccount = useRef<BankAccount | null>(null);
  if (liveEditAccount) lastEditAccount.current = liveEditAccount;

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
      || (a.bank_code ?? '').toLowerCase().includes(term)
      || (a.account_number ?? '').includes(term)
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
      cell: ({ row }) => <AccountBankLine account={row.original} />,
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
          {!noAdd && (
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
              {tab === 'company' ? t('companyBankAccount.description')
                : tab === 'partner-payout' ? t('partnerPayout.description')
                : t('settings.bankAccounts.description')}
            </p>
          </div>
          {!noAdd && (
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
                  : tk === 'company' ? t('companyBankAccount.tab')
                  : tk === 'partner-payout' ? t('partnerPayout.tab')
                  : t('settings.bankAccounts.tabChannels')}
              </button>
            ))}
          </div>
        )}

        {tab === 'channels' ? (
          <BankChannelConfig />
        ) : tab === 'partner-payout' ? (
          <PartnerPayoutAccountsTab showCompany={user?.company_id == null} />
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
                      <AccountBankLine
                        account={account}
                        badges={<>
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
                        </>}
                        showWhere
                      />
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
        onOpenAccount={(id) => { setCreateLevel(null); setEditId(id); }}
      />
      <AccountModal
        open={!!liveEditAccount}
        onClose={() => setEditId(null)}
        account={liveEditAccount ?? lastEditAccount.current}
        level={(liveEditAccount ?? lastEditAccount.current)?.is_company_account ? 'company' : 'branch'}
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
