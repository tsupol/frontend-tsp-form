// "บัญชีรับเงินจากกองทุน" — the tab under Company → บัญชีธนาคาร where a fund sets,
// per deal-partner shop, the SHOP's bank account the fund transfers to
// (device money + commission on a fund bill). IMPLEMENT 2026-10-31
// partner_payout_account_tab: the owner could not find the field because it
// lived under ราคา → เงื่อนไข Deal Partner; it now has one home here, and the
// terms window only points at this tab.
//
// This is the third kind of account on the page and must not be confused with
// the other two: a branch's customer-facing accounts (tab 1) and the fund's own
// company accounts that shops remit INTO (tab 2). This one is money going the
// other way, fund → shop, stored on `sale.deal_partner_branch_config.payout_*`
// (mig 1217), not in core.bank_accounts.
//
// Without it the shop's bill cannot enter a payout round:
// fn_fund_bill_pay answers PARTNER.VALIDATION.PAYOUT_ACCOUNT_MISSING.
//
// Reads: v_deal_partner_branch_configs (the DB nulls the number/name for a
// viewer without CONFIG.DEAL_PARTNER_RATE / PARTNER.PAYOUT_APPROVE, so
// `has_payout_account` is the only honest "set / not set").
// Writes: fn_deal_partner_branch_config_set with the three p_payout_* params
// only (every other param left out = keep), or p_clear_payout_account: true.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, DataTable, DataTableColumnHeader, Input, Modal, Select, type ColumnDef } from 'tsp-form';
import { History, Landmark, Trash2, Undo2 } from 'lucide-react';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { PartnerPayoutHistoryModal } from './PartnerPayoutHistoryModal';
import { FundPaymentSetDestModal, type FundPaymentDestTarget } from '../fund-cash/FundPaymentSetDestModal';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { BankLogo } from '../../components/BankLogo';
import { BankAccountInline } from '../../components/BankAccountLine';
import {
  useRefBanks, validatePayoutAccount, payoutAccountDigits, EMPTY_PAYOUT_VALUE,
  type DealPartnerPayoutValue, type RefBank,
} from '../../components/DealPartnerPayoutAccountField';

/** The payout slice of one `v_deal_partner_branch_configs` row. */
export interface PartnerPayoutRow {
  branch_id: number;
  branch_name: string;
  company_id: number;
  company_name: string | null;
  payout_bank_code: string | null;
  payout_bank_name: string | null;
  payout_account_no: string | null;
  payout_account_name: string | null;
  has_payout_account: boolean;
  updated_at: string;
}

export const PARTNER_PAYOUT_QUERY_KEY = ['deal-partner-branch-configs', 'payout'] as const;

function usePartnerPayoutRows() {
  return useQuery({
    queryKey: PARTNER_PAYOUT_QUERY_KEY,
    queryFn: () => apiClient.get<PartnerPayoutRow[]>(
      '/v_deal_partner_branch_configs?is_active=eq.true&select=branch_id,branch_name,company_id,company_name,payout_bank_code,payout_bank_name,payout_account_no,payout_account_name,has_payout_account,updated_at&order=branch_name',
    ),
  });
}

/** "Set" vs "not set" — from the flag, never from the (possibly hidden) number. */
function PayoutStatusBadge({ row }: { row: PartnerPayoutRow }) {
  const { t } = useTranslation();
  return row.has_payout_account
    ? <Badge color="success" size="sm">{t('partnerPayout.statusSet')}</Badge>
    : <Badge color="warning" size="sm">{t('partnerPayout.statusMissing')}</Badge>;
}

// ── Edit / remove modal ───────────────────────────────────────────────────────

function PartnerPayoutAccountModal({ open, row, onClose, onHistory }: {
  open: boolean;
  row: PartnerPayoutRow | null;
  onClose: () => void;
  /** Opens the shop's transfer + account-change history (§③) in place of this window. */
  onHistory: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: banks = [] } = useRefBanks();

  // Keep the shop through the close transition (the host nulls it on close).
  const [shown, setShown] = useState<PartnerPayoutRow | null>(row);
  if (row && row !== shown) setShown(row);

  const [value, setValue] = useState<DealPartnerPayoutValue>(EMPTY_PAYOUT_VALUE);
  const [seed, setSeed] = useState<DealPartnerPayoutValue>(EMPTY_PAYOUT_VALUE);
  const [view, setView] = useState<'form' | 'confirmRemove' | 'done'>('form');
  const [doneKind, setDoneKind] = useState<'saved' | 'removed'>('saved');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // Reset when the window opens (or switches shop) — never on a refetch: the
  // save itself refetches the row, which would wipe the done view.
  const rowRef = useRef(row);
  rowRef.current = row;
  useEffect(() => {
    if (!open) return;
    const r = rowRef.current;
    const v = {
      bank_code: r?.payout_bank_code ?? '',
      account_no: r?.payout_account_no ?? '',
      account_name: r?.payout_account_name ?? '',
    };
    setValue(v);
    setSeed(v);
    setView('form');
    setError(null);
    setSaving(false);
    setConfirmClose(false);
  }, [open, row?.branch_id]);

  const isDirty = value.bank_code !== seed.bank_code
    || value.account_no !== seed.account_no
    || value.account_name !== seed.account_name;
  const problem = validatePayoutAccount(value, banks);
  const complete = value.bank_code !== '' && payoutAccountDigits(value.account_no) !== '' && value.account_name.trim() !== '';
  // Stored but hidden from this viewer: the fields come up empty although the
  // shop has an account. Saving then overwrites it, which is what an admin who
  // opens the window means; the hint says so.
  const hidden = !!row?.has_payout_account && seed.bank_code === '' && seed.account_no === '' && seed.account_name === '';

  const bankLabel = (b: RefBank) => (i18n.language === 'en' && b.name_en) || b.name_th;
  const bankOptions = useMemo(
    () => banks.map(b => ({ value: b.code, label: bankLabel(b), icon: <BankLogo code={b.code} size={20} /> })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [banks, i18n.language],
  );
  const selectedBank = banks.find(b => b.code === value.bank_code) ?? null;
  const digits = payoutAccountDigits(value.account_no);
  const lengthHint = selectedBank?.enforces_length && selectedBank.digits_min != null
    ? selectedBank.digits_min === selectedBank.digits_max
      ? t('dealPartnerRate.payoutDigitsExact', { digits: selectedBank.digits_min })
      : t('dealPartnerRate.payoutDigitsRange', { min: selectedBank.digits_min, max: selectedBank.digits_max })
    : null;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const afterWrite = () => {
    // The terms page and this tab read the same view under one key prefix.
    queryClient.invalidateQueries({ queryKey: ['deal-partner-branch-configs'] });
  };

  const save = async () => {
    if (!row) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient.rpc('fn_deal_partner_branch_config_set', {
        p_branch_id: row.branch_id,
        p_payout_bank_code: value.bank_code,
        p_payout_account_no: value.account_no,
        p_payout_account_name: value.account_name.trim(),
      });
      afterWrite();
      setDoneKind('saved');
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t) || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!row) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient.rpc('fn_deal_partner_branch_config_set', {
        p_branch_id: row.branch_id,
        p_clear_payout_account: true,
      });
      afterWrite();
      setDoneKind('removed');
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t) || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const bankName = selectedBank ? bankLabel(selectedBank) : value.bank_code;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%" ariaLabel={t('partnerPayout.editTitle')}>
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerPayout.editTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'done' ? (
          <ActionDoneView
            headline={doneKind === 'removed' ? t('partnerPayout.removed') : t('partnerPayout.saved')}
            contractCode={shown?.branch_name ?? ''}
            tone={doneKind === 'removed' ? 'warning' : 'success'}
            detailRows={doneKind === 'removed' ? [] : [
              { label: t('dealPartnerRate.payoutBank'), value: bankName },
              { label: t('dealPartnerRate.payoutAccountNo'), value: value.account_no },
              { label: t('dealPartnerRate.payoutAccountName'), value: value.account_name.trim() },
            ]}
            extras={doneKind === 'removed'
              ? <div className="alert alert-warning"><span>{t('partnerPayout.removedHint')}</span></div>
              : undefined}
            onClose={forceClose}
          />
        ) : view === 'confirmRemove' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-3">
                <div className="font-medium text-sm">{shown?.branch_name}</div>
              </div>
              <p className="text-sm">{t('partnerPayout.removeConfirm')}</p>
              <p className="text-xs text-subtle mt-2">{t('partnerPayout.removedHint')}</p>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={() => setView('form')} disabled={saving} startIcon={<Undo2 size={16} />}>
                {t('common.back')}
              </Button>
              <Button variant="danger" onClick={remove} disabled={saving} startIcon={<Trash2 size={16} />}>
                {t('dealPartnerRate.payoutRemove')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
                <div className="font-medium text-sm">{shown?.branch_name}</div>
                <div className="text-xs text-subtle">{t('partnerPayout.targetHint')}</div>
              </div>
              {hidden && (
                <div className="alert alert-info mb-4"><span>{t('partnerPayout.hiddenHint')}</span></div>
              )}
              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('dealPartnerRate.payoutBank')}</label>
                  <Select
                    options={bankOptions}
                    value={value.bank_code || null}
                    onChange={val => setValue(v => ({ ...v, bank_code: (val as string) ?? '' }))}
                    placeholder={t('dealPartnerRate.payoutBankPlaceholder')}
                    disabled={saving}
                    searchable
                    showChevron
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('dealPartnerRate.payoutAccountNo')}</label>
                  <Input
                    className="w-full"
                    value={value.account_no}
                    onChange={e => setValue(v => ({ ...v, account_no: e.target.value }))}
                    placeholder={t('dealPartnerRate.payoutAccountNoPlaceholder')}
                    disabled={saving}
                    inputMode="numeric"
                    autoComplete="off"
                    error={problem === 'dealPartnerRate.payoutDigitsLength'}
                  />
                  <p className={`text-xs mt-1 ${problem === 'dealPartnerRate.payoutDigitsLength' ? 'text-danger-fg' : 'text-subtle'}`}>
                    {lengthHint
                      ? t('dealPartnerRate.payoutDigitsCounted', { count: digits.length, hint: lengthHint })
                      : t('dealPartnerRate.payoutAccountNoHint')}
                  </p>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('dealPartnerRate.payoutAccountName')}</label>
                  <Input
                    className="w-full"
                    value={value.account_name}
                    onChange={e => setValue(v => ({ ...v, account_name: e.target.value }))}
                    placeholder={t('dealPartnerRate.payoutAccountNamePlaceholder')}
                    disabled={saving}
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <div className="mr-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  onClick={onHistory}
                  disabled={saving || isDirty}
                  startIcon={<History size={16} />}
                >
                  {t('partnerPayout.historyAction')}
                </Button>
                {row?.has_payout_account && (
                  <Button
                    variant="ghost"
                    onClick={() => setView('confirmRemove')}
                    disabled={saving}
                    startIcon={<Trash2 size={16} className="text-danger-fg" />}
                  >
                    {t('dealPartnerRate.payoutRemove')}
                  </Button>
                )}
              </div>
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={save} disabled={saving || !complete || problem !== null || !isDirty}>
                {t('common.save')}
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
          <Button variant="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export function PartnerPayoutAccountsTab({ showCompany }: { showCompany: boolean }) {
  const { t } = useTranslation();
  const { data: rows = [], isLoading, isFetching } = usePartnerPayoutRows();
  const [editId, setEditId] = useState<number | null>(null);
  // Resolved from the live rows so the window shows what was just saved.
  const editRow = useMemo(() => rows.find(r => r.branch_id === editId) ?? null, [rows, editId]);
  // History (§③) and the fix-destination window (§④) — one at a time; the
  // history window hands its shop to the fix window and comes back after.
  const [historyId, setHistoryId] = useState<number | null>(null);
  const historyRow = useMemo(() => rows.find(r => r.branch_id === historyId) ?? null, [rows, historyId]);
  const [fixDest, setFixDest] = useState<FundPaymentDestTarget | null>(null);
  const { hasPermission } = useMyPermissions();
  const canFixDest = hasPermission('FUND.PAYMENT_ACCOUNT_FIX');

  const accountCell = (r: PartnerPayoutRow) => {
    if (!r.has_payout_account) return <span className="text-subtler">—</span>;
    if (!r.payout_bank_code && !r.payout_account_no) {
      // Set, but the DB hid the details from this viewer.
      return <span className="text-subtle text-sm">{t('dealPartnerRate.payoutHidden')}</span>;
    }
    return (
      <BankAccountInline
        account={{ bank_code: r.payout_bank_code, bank_name: r.payout_bank_name, account_number: r.payout_account_no }}
        size={20}
      />
    );
  };

  const columns: ColumnDef<PartnerPayoutRow>[] = [
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('partnerPayout.colShop')} />,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{row.original.branch_name}</div>
          {showCompany && <div className="text-xs text-subtle truncate">{row.original.company_name ?? '—'}</div>}
        </div>
      ),
    },
    {
      id: 'account',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('partnerPayout.colAccount')} />,
      cell: ({ row }) => accountCell(row.original),
      enableSorting: false,
    },
    {
      accessorKey: 'payout_account_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.payoutAccountName')} />,
      enableSorting: false,
      cell: ({ row }) => row.original.payout_account_name
        ? <span className="text-sm">{row.original.payout_account_name}</span>
        : <span className="text-subtler">—</span>,
    },
    {
      accessorKey: 'has_payout_account',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('common.status')} />,
      enableSorting: false,
      cell: ({ row }) => <PayoutStatusBadge row={row.original} />,
    },
  ];

  const empty = (
    <div className="p-8 text-center text-subtle">
      {isLoading ? t('common.loading') : t('partnerPayout.empty')}
    </div>
  );

  return (
    <>
      <p className="text-xs text-subtle mb-3 flex-none">{t('partnerPayout.tabHint')}</p>

      {/* Desktop: a row opens the window (list-row rule: no edit icon). The
          column-mode DataTable has no row-click prop, so the click is read off
          the wrapper and mapped by row index — safe because sorting is off and
          the list is unpaginated, so the body order is `rows`' order. */}
      <div
        className="flex-1 min-h-0 hidden md:flex flex-col"
        onClick={e => {
          const tr = (e.target as HTMLElement).closest('tbody tr');
          if (!tr || !tr.parentElement) return;
          const idx = Array.prototype.indexOf.call(tr.parentElement.children, tr);
          const r = rows[idx];
          if (r) setEditId(r.branch_id);
        }}
      >
        <DataTable<PartnerPayoutRow>
          outlined
          data={rows}
          columns={columns}
          tableClassName="[&_tbody_tr]:cursor-pointer"
          className={`flex-1 min-h-0 ${isFetching ? 'opacity-60' : ''} transition-opacity`}
          noResults={empty}
        />
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden flex-1 overflow-auto better-scroll pb-8">
        {rows.length === 0 ? empty : (
          <div className="divide-y divide-line border-b border-line">
            {rows.map(r => (
              <button
                key={r.branch_id}
                type="button"
                onClick={() => setEditId(r.branch_id)}
                className="w-full text-left px-3 py-2.5 flex items-center gap-3 bg-transparent border-none cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{r.branch_name}</span>
                    <PayoutStatusBadge row={r} />
                  </div>
                  <div className="text-xs text-subtle mt-0.5 flex items-center gap-1.5 min-w-0">
                    {r.has_payout_account ? accountCell(r) : <><Landmark size={12} />{t('dealPartnerRate.payoutMissing')}</>}
                  </div>
                  {r.payout_account_name && <div className="text-xs text-subtle truncate">{r.payout_account_name}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <PartnerPayoutAccountModal
        open={editId != null}
        row={editRow}
        onClose={() => setEditId(null)}
        onHistory={() => { setHistoryId(editId); setEditId(null); }}
      />
      <PartnerPayoutHistoryModal
        open={historyId != null && fixDest == null}
        branchId={historyId}
        branchName={historyRow?.branch_name ?? null}
        canFixDest={canFixDest}
        onFixDest={setFixDest}
        onClose={() => setHistoryId(null)}
      />
      <FundPaymentSetDestModal open={fixDest != null} payment={fixDest} onClose={() => setFixDest(null)} />
    </>
  );
}
