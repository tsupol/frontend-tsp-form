import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Select, TextArea } from 'tsp-form';
import { XCircle, Eye, EyeOff, Copy, Check } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';

interface ICloudAccountRow {
  id: number;
  apple_id: string;
  registration_email: string | null;
  branch_id: number;
  branch_name: string;
  is_active: boolean;
  c_device_count: number;
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
    const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
    setError(translated || err.message);
  } else {
    setError(err instanceof Error ? err.message : String(err));
  }
}

// Inline credential row for a pool account's iCloud password. Only rendered
// when the view returned a non-null password (caller already checked) — i.e.
// the user holds ICLOUD.ACCOUNT_REVEAL_PASSWORD. Masked by default with a
// reveal toggle + copy, since it's a credential.
function IcloudPasswordRow({ password }: { password: string }) {
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

  const { data: accounts = [] } = useQuery({
    queryKey: ['icloud-accounts-available', branchId],
    queryFn: () => apiClient.get<ICloudAccountRow[]>(
      `/v_icloud_accounts?branch_id=eq.${branchId}&is_active=is.true&order=apple_id&select=id,apple_id,registration_email,branch_id,branch_name,is_active,c_device_count,password`,
    ),
    staleTime: 30 * 1000,
    enabled: open,
  });

  const options = useMemo(
    () => accounts
      .filter(a => a.id !== currentAccountId) // hide the currently-bound one
      .map(a => ({
        value: String(a.id),
        label: `${a.apple_id} · ${a.c_device_count} devices`,
      })),
    [accounts, currentAccountId],
  );

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
    onError: (err) => setApiError(err, t, setError),
  });

  const canSubmit = !!accountId && !mutation.isPending;

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
