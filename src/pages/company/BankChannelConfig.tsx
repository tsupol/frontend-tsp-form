import { useState, useMemo, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Badge } from 'tsp-form';
import { Pencil, Landmark, Clock, ExternalLink } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { BankAccountLine } from '../../components/BankAccountLine';
import { BankAccountSelect } from '../../components/BankAccountSelect';

// One row per (branch × channel) in the caller's company — v_bank_account_channel_config.
//
// The account level depends on the channel (mig 1531, doc 116 §2e):
//   STORE_FRONT / INSTALLMENT  — customers pay in, so a branch account.
//   PARTNER_REMIT ("กองทุน", renamed from "ร้านนำส่ง" in mig 1539) — the shop pays the fund back, so one of the
//                                  fund's own company accounts.
// The wrong level is refused (CHANNEL_ACCOUNT_LEVEL_MISMATCH), so the picker
// only ever offers the right one.
type Channel = 'STORE_FRONT' | 'INSTALLMENT' | 'PARTNER_REMIT';

interface ChannelConfigRow {
  branch_id: number;
  branch_code: string;
  branch_name: string;
  company_id: number;
  channel: Channel;
  channel_name_th: string;
  configured_account_id: number | null;
  effective_account_id: number | null;
  effective_bank_code: string | null;
  effective_bank_name: string | null;
  /** false for a QR-only account — its line shows "QR" instead of a number. */
  effective_has_account_number: boolean | null;
  effective_account_number_display: string | null;
  effective_account_name: string | null;
  effective_source: 'PRIMARY' | 'OVERRIDE';
  override_from: string | null;
  override_to: string | null;
}

// Account picker source — v_bank_accounts, filtered to the branch being edited.
interface PickableAccount {
  id: number;
  bank_code: string | null;
  bank_name: string;
  bank_name_en?: string | null;
  account_number_display: string | null;
  account_number: string | null;
  account_name: string;
  is_active: boolean;
}

function channelLabel(t: ReturnType<typeof useTranslation>['t'], channel: string): string {
  return t(`bankChannel.channel_${channel}`, { defaultValue: channel });
}

export function BankChannelConfig() {
  const { t } = useTranslation();
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
                      <Badge size="sm" color={c.channel === 'INSTALLMENT' ? 'info' : c.channel === 'PARTNER_REMIT' ? 'warning' : 'default'}>
                        {channelLabel(t, c.channel)}
                      </Badge>
                    </div>
                    <div className="flex-1 min-w-0">
                      {c.effective_account_id ? (
                        // under its branch's heading — no "where"
                        <BankAccountLine
                          showWhere={false}
                          account={{
                            bank_code: c.effective_bank_code,
                            bank_name: c.effective_bank_name,
                            account_name: c.effective_account_name,
                            // QR-only → null number, shown as "QR". The view has no raw number,
                            // so an account without a dashed display keeps the old "—".
                            account_number_display: c.effective_account_number_display
                              ?? (c.effective_has_account_number === false ? null : '—'),
                            account_number: c.effective_has_account_number === false ? null : undefined,
                          }}
                        />
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
      />
    </div>
  );
}

function SetChannelAccountModal({
  open, row: rowProp, onClose,
}: {
  open: boolean;
  row: ChannelConfigRow | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // Hold the last row through the close transition.
  const lastRow = useRef(rowProp);
  if (rowProp) lastRow.current = rowProp;
  const row = rowProp ?? lastRow.current;

  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'form' | 'done'>('form');
  const [confirmClose, setConfirmClose] = useState(false);

  const isRemit = row?.channel === 'PARTNER_REMIT';
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['bank-accounts-for-channel', isRemit ? `company-${row?.company_id}` : `branch-${row?.branch_id}`],
    queryFn: () => apiClient.get<PickableAccount[]>(isRemit
      ? `/v_bank_accounts?company_id=eq.${row!.company_id}&branch_id=is.null&is_active=eq.true&order=is_default.desc,id`
      : `/v_bank_accounts?branch_id=eq.${row!.branch_id}&is_active=eq.true&order=bank_name`),
    enabled: open && !!row,
  });

  const initial = rowProp?.configured_account_id != null ? String(rowProp.configured_account_id) : null;
  // Reset the picker to the row's configured account whenever reopened.
  useEffect(() => {
    if (!open) return;
    setAccountId(initial);
    setError('');
    setView('form');
    setConfirmClose(false);
  }, [open, initial]);

  const picked = accounts.find(a => String(a.id) === accountId) ?? null;

  const dirty = accountId !== initial;
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (saving) return;
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

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
      queryClient.invalidateQueries({ queryKey: ['bank-channel-config'] });
      setView('done');
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
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('bankChannel.editTitle', { defaultValue: 'Set channel account' })}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
        </div>
        {view === 'done' ? (
          <ActionDoneView
            headline={t('bankChannel.saved', { defaultValue: 'Channel account updated' })}
            contractCode={row ? `${row.branch_name} · ${channelLabel(t, row.channel)}` : ''}
            detailRows={picked ? [
              { label: t('bankChannel.account', { defaultValue: 'Account' }), value: `${picked.bank_name} · ${picked.account_number_display ?? picked.account_number}`, emphasis: true },
              { label: t('settings.bankAccounts.accountName'), value: picked.account_name },
            ] : []}
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content">
              {row && (
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4 flex items-center gap-2">
                  <Landmark size={16} className="text-subtle shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{row.branch_name}</div>
                    <div className="text-xs text-subtle">{channelLabel(t, row.channel)}</div>
                  </div>
                </div>
              )}
              {isRemit && (
                <div className="alert alert-info mb-4"><span>{t('bankChannel.remitHint')}</span></div>
              )}
              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('bankChannel.account', { defaultValue: 'Account' })} *</label>
                  {isRemit && !isLoading && accounts.length === 0 ? (
                    <div className="alert alert-warning">
                      <div className="flex flex-col gap-1">
                        <span>{t('fundAccount.noneYet')}</span>
                        <Link
                          to="/admin/company/bank-accounts?tab=company"
                          onClick={forceClose}
                          className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
                        >
                          {t('fundAccount.createLink')}
                          <ExternalLink size={12} />
                        </Link>
                      </div>
                    </div>
                  ) : (
                    // one branch's accounts, or the fund's own — no "where"
                    <BankAccountSelect
                      accounts={accounts}
                      valueOf={a => String(a.id)}
                      value={accountId}
                      onChange={(v) => setAccountId(v || null)}
                      showWhere={false}
                      placeholder={t('bankChannel.accountPlaceholder', { defaultValue: 'Pick an account' })}
                      searchable
                    />
                  )}
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleSave} disabled={!accountId || saving}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </>
        )}
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
