import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Select, TextArea } from 'tsp-form';
import { XCircle, Eye, EyeOff, Copy, Check } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';
import { translateApiError } from '../../lib/apiErrors';

interface ICloudAccountRow {
  id: number;
  apple_id: string;
  registration_email: string | null;
  branch_id: number;
  branch_name: string;
  is_active: boolean;
  c_device_count: number;
  // Per-company cap on devices bindable to one Apple ID (default 20). is_full =
  // c_device_count >= device_cap → the option must be disabled. RPC enforces the
  // cap regardless (MDM.VALIDATION.ACCOUNT_FULL); this is UX only.
  device_cap: number;
  remaining_slots: number;
  is_full: boolean;
  // Masked by permission in the view (ICLOUD.ACCOUNT_REVEAL_PASSWORD): the real
  // password for those who may see it, null otherwise. No FE role check needed.
  password: string | null;
}

function setApiError(
  err: unknown,
  t: ReturnType<typeof useTranslation>['t'],
  setError: (s: string) => void,
) {
  if (err instanceof ApiError) {
    const translated = translateApiError(err, t);
    setError(translated || err.message);
  } else {
    setError(err instanceof Error ? err.message : String(err));
  }
}

// Inline credential row for a pool account's iCloud password. Only rendered
// when the view returned a non-null password (caller already checked) — i.e.
// the user holds ICLOUD.ACCOUNT_REVEAL_PASSWORD. Masked by default with a
// reveal toggle + copy, since it's a credential.
export function IcloudPasswordRow({ password }: { password: string }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(password).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => {},
    );
  };

  return (
    <div className="mt-2 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-surface border border-line">
      <span className="text-xs text-subtle shrink-0">{t('contract.icloud_password', { defaultValue: 'Password' })}</span>
      <span className="text-sm font-mono flex-1 min-w-0 truncate select-all">
        {shown ? password : '•'.repeat(Math.min(password.length, 12))}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="btn-icon-xs"
        startIcon={shown ? <EyeOff size={14} /> : <Eye size={14} />}
        onClick={() => setShown(s => !s)}
        aria-label={shown ? t('common.hide', { defaultValue: 'Hide' }) : t('common.show', { defaultValue: 'Show' })}
      />
      <Button
        variant="ghost"
        size="sm"
        className="btn-icon-xs"
        startIcon={copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
        onClick={copy}
        aria-label={t('common.copy', { defaultValue: 'Copy' })}
      />
    </div>
  );
}

// ── Assign iCloud ──────────────────────────────────────────────────────────
//
// Backend: fn_icloud_device_assign(p_asset_id, p_account_id, p_reason?)
// Auto-releases the previous account if different.

export function AssignIcloudModal({
  open, onClose, onSuccess,
  assetId, branchId, currentAccountId,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  assetId: number;
  branchId: number;
  currentAccountId: number | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setAccountId(null);
      setReason('');
      setError('');
    }
  }, [open]);

  const { data: accounts = [], refetch: refetchAccounts } = useQuery({
    queryKey: ['icloud-accounts-available', branchId],
    // Emptiest-first + only the top 5: staff use ~2 accounts per session, so the
    // freest few are all that's needed — don't pull the whole pool. Capacity
    // (count/cap) shown per option; full accounts render disabled. (IMPLEMENT
    // 2026-07-24)
    queryFn: () => apiClient.get<ICloudAccountRow[]>(
      `/v_icloud_accounts?branch_id=eq.${branchId}&is_active=is.true&order=c_device_count.asc&limit=5&select=id,apple_id,registration_email,branch_id,branch_name,is_active,c_device_count,device_cap,remaining_slots,is_full,password`,
    ),
    staleTime: 30 * 1000,
    enabled: open,
  });

  const options = useMemo(
    () => accounts
      .filter(a => a.id !== currentAccountId) // hide the currently-bound one
      .map(a => ({
        value: String(a.id),
        // Flat label — used for the collapsed trigger display and search
        // matching. The dropdown rows get the richer 2-line renderOption below.
        label: a.is_full
          ? `${a.apple_id} · ${a.c_device_count}/${a.device_cap} · ${t('contract.icloud_full')}`
          : `${a.apple_id} · ${a.c_device_count}/${a.device_cap}`,
        disabled: a.is_full,
      })),
    [accounts, currentAccountId, t],
  );

  // Two-line dropdown row: Apple ID on top, capacity + slots-left (or "full")
  // beneath. Option only carries {value,label}, so look the account back up by id.
  const renderAccountOption = (opt: { value: string }) => {
    const a = accounts.find(acc => String(acc.id) === opt.value);
    if (!a) return null;
    return (
      <div className="flex flex-col gap-0.5 min-w-0 py-0.5">
        <span className="text-sm truncate">{a.apple_id}</span>
        <span className="text-xs text-subtle inline-flex items-center gap-1.5">
          <span className="tabular-nums">{a.c_device_count}/{a.device_cap}</span>
          <span className="text-subtler">·</span>
          {a.is_full
            ? <span className="text-danger-fg">{t('contract.icloud_full')}</span>
            : <span>{t('contract.icloud_slotsLeft', { count: a.remaining_slots })}</span>}
        </span>
      </div>
    );
  };

  const selectedAccount = useMemo(
    () => accounts.find(a => String(a.id) === accountId) ?? null,
    [accounts, accountId],
  );

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_icloud_device_assign', {
      p_asset_id: assetId,
      p_account_id: Number(accountId),
      p_reason: reason.trim() || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-summary', assetId] });
      queryClient.invalidateQueries({ queryKey: ['contract-asset-icloud', assetId] });
      queryClient.invalidateQueries({ queryKey: ['contract-print-asset', assetId] });
      onSuccess();
    },
    onError: (err) => {
      setApiError(err, t, setError);
      // The RPC is the hard cap. If the account filled up (race) or was
      // deactivated between fetch and submit, the stale count is disproven —
      // refetch so the picker shows current capacity + disables the full one.
      if (err instanceof ApiError && (
        err.code === 'MDM.VALIDATION.ACCOUNT_FULL'
        || err.code === 'MDM.VALIDATION.ACCOUNT_NOT_FOUND_OR_INACTIVE'
      )) {
        setAccountId(null);
        refetchAccounts();
      }
    },
  });

  const canSubmit = !!accountId && !selectedAccount?.is_full && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.icloud_assign')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-grid">
            <div className="flex flex-col min-w-0">
              <label className="form-label">{t('contract.icloud_account')} *</label>
              <Select
                options={options}
                value={accountId}
                onChange={(v) => setAccountId((v as string) || null)}
                placeholder={t('contract.icloud_pickAccount')}
                renderOption={renderAccountOption}
                showChevron
                searchable
              />
              <div className="text-xs text-subtle mt-1">{t('contract.icloud_assignHint')}</div>
              {selectedAccount?.password && (
                <IcloudPasswordRow password={selectedAccount.password} />
              )}
            </div>

            <div className="flex flex-col">
              <label className="form-label">{t('contract.note')}</label>
              <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button color="primary" onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending ? t('common.loading') : t('contract.icloud_assign')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Release iCloud ─────────────────────────────────────────────────────────
//
// Backend: fn_icloud_device_release(p_asset_id, p_reason?, p_pin?)
// PIN required (branch authorization).

export function ReleaseIcloudModal({
  open, onClose, onSuccess,
  assetId,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  assetId: number;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setPin('');
      setError('');
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_icloud_device_release', {
      p_asset_id: assetId,
      p_reason: reason.trim() || null,
      p_pin: pin,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-summary', assetId] });
      queryClient.invalidateQueries({ queryKey: ['contract-asset-icloud', assetId] });
      queryClient.invalidateQueries({ queryKey: ['contract-print-asset', assetId] });
      onSuccess();
    },
    onError: (err) => setApiError(err, t, setError),
  });

  const canSubmit = pin.length === 6 && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.icloud_release')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('contract.icloud_reason')}</label>
              <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </div>
            <div className="flex flex-col">
              <BranchPinInput value={pin} onChange={setPin} required />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending ? t('common.loading') : t('contract.icloud_release')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
