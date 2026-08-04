import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Select, Badge, useSnackbarContext } from 'tsp-form';
import { Pencil, Landmark, CheckCircle, XCircle, Clock } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { translateApiError } from '../../lib/apiErrors';

// One row per (branch × channel) in the caller's company — v_bank_account_channel_config.
interface ChannelConfigRow {
  branch_id: number;
  branch_code: string;
  branch_name: string;
  channel: 'STORE_FRONT' | 'INSTALLMENT';
  channel_name_th: string;
  configured_account_id: number | null;
  effective_account_id: number | null;
  effective_bank_name: string | null;
  effective_account_number_display: string | null;
  effective_account_name: string | null;
  effective_source: 'PRIMARY' | 'OVERRIDE';
  override_from: string | null;
  override_to: string | null;
}

// Account picker source — v_bank_accounts, filtered to the branch being edited.
interface PickableAccount {
  id: number;
  bank_name: string;
  account_number_display: string | null;
  account_number: string;
  account_name: string;
  is_active: boolean;
}

function channelLabel(t: ReturnType<typeof useTranslation>['t'], channel: string): string {
  return t(`bankChannel.channel_${channel}`, { defaultValue: channel });
}

export function BankChannelConfig() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [editRow, setEditRow] = useState<ChannelConfigRow | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['bank-channel-config'],
    queryFn: () => apiClient.get<ChannelConfigRow[]>('/v_bank_account_channel_config?order=branch_name,channel'),
  });

  // Group by branch for a tidy two-channel-per-branch layout.
  const byBranch = useMemo(() => {
    const m = new Map<number, { branch_name: string; branch_code: string; channels: ChannelConfigRow[] }>();
    for (const r of rows) {
      if (!m.has(r.branch_id)) m.set(r.branch_id, { branch_name: r.branch_name, branch_code: r.branch_code, channels: [] });
      m.get(r.branch_id)!.channels.push(r);
    }
    return Array.from(m.values());
  }, [rows]);

  return (
    <div className="flex-1 min-h-0 overflow-auto better-scroll pb-8">
      {isLoading ? (
        <div className="p-8 text-center text-subtle">{t('common.loading')}</div>
      ) : byBranch.length === 0 ? (
        <div className="p-8 text-center text-subtle">{t('bankChannel.empty', { defaultValue: 'No branches' })}</div>
      ) : (
        <div className="flex flex-col gap-4">
          {byBranch.map((b) => (
            <div key={b.branch_code} className="rounded-lg border border-line overflow-hidden">
              <div className="px-4 py-2.5 bg-surface border-b border-line">
                <div className="font-semibold text-sm">{b.branch_name}</div>
                <div className="text-xs text-subtle">{b.branch_code}</div>
              </div>
              <div className="divide-y divide-line">
                {b.channels.map((c) => (
                  <div key={c.channel} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-24 shrink-0">
                      <Badge size="sm" color={c.channel === 'INSTALLMENT' ? 'info' : 'default'}>
                        {channelLabel(t, c.channel)}
                      </Badge>
                    </div>
                    <div className="flex-1 min-w-0">
                      {c.effective_account_id ? (
                        <>
                          <div className="text-sm font-medium truncate">{c.effective_bank_name}</div>
                          <div className="text-xs text-subtle truncate">
                            <span className="tabular-nums">{c.effective_account_number_display ?? '—'}</span>
                            <span> · {c.effective_account_name}</span>
                          </div>
                        </>
                      ) : (
                        <span className="text-sm text-subtler italic">{t('bankChannel.unset', { defaultValue: 'Not configured' })}</span>
                      )}
                    </div>
                    {c.effective_source === 'OVERRIDE' && (
                      <Badge size="sm" color="warning" startIcon={<Clock size={11} />}>
                        {t('bankChannel.override', { defaultValue: 'Override' })}
                        {c.override_to && <> · <DateTime value={c.override_to} /></>}
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="btn-icon-sm shrink-0"
                      startIcon={<Pencil size={14} />}
                      onClick={() => setEditRow(c)}
                      aria-label={t('common.edit', { defaultValue: 'Edit' })}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <SetChannelAccountModal
        open={!!editRow}
        row={editRow}
        onClose={() => setEditRow(null)}
        onSaved={() => {
          setEditRow(null);
          queryClient.invalidateQueries({ queryKey: ['bank-channel-config'] });
          addSnackbar({
            message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('bankChannel.saved', { defaultValue: 'Channel account updated' })}</span></div>,
          });
        }}
      />
    </div>
  );
}

function SetChannelAccountModal({
  open, row, onClose, onSaved,
}: {
  open: boolean;
  row: ChannelConfigRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ['bank-accounts-for-branch', row?.branch_id],
    queryFn: () => apiClient.get<PickableAccount[]>(`/v_bank_accounts?branch_id=eq.${row!.branch_id}&is_active=eq.true&order=bank_name`),
    enabled: open && !!row,
  });

  // Reset the picker to the row's configured account whenever reopened.
  useEffect(() => {
    if (open && row) {
      setAccountId(row.configured_account_id != null ? String(row.configured_account_id) : null);
      setError('');
    }
  }, [open, row]);

  const options = accounts.map(a => ({
    value: String(a.id),
    label: `${a.bank_name} · ${a.account_number_display ?? a.account_number} · ${a.account_name}`,
  }));

  const handleSave = async () => {
    if (!row || !accountId) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_bank_account_set_channel_default', {
        p_branch_id: row.branch_id,
        p_channel: row.channel,
        p_account_id: Number(accountId),
      });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = translateApiError(err, t);
        setError(tr || err.message);
      } else {
        setError(String(err));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('bankChannel.editTitle', { defaultValue: 'Set channel account' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4 animate-pop-in"><XCircle size={16} /><span>{error}</span></div>
        )}
        {row && (
          <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4 flex items-center gap-2">
            <Landmark size={16} className="text-subtle shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium">{row.branch_name}</div>
              <div className="text-xs text-subtle">{t(`bankChannel.channel_${row.channel}`, { defaultValue: row.channel })}</div>
            </div>
          </div>
        )}
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('bankChannel.account', { defaultValue: 'Account' })} *</label>
            <Select
              options={options}
              value={accountId}
              onChange={(v) => setAccountId((v as string) || null)}
              placeholder={t('bankChannel.accountPlaceholder', { defaultValue: 'Pick an account' })}
              size="sm"
              searchable
              showChevron
            />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={handleSave} disabled={!accountId || saving}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}
