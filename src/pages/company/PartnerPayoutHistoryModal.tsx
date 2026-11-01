// "ประวัติ" of one shop's payout account — opened from the shop's row on the
// บัญชีรับเงินจากกองทุน tab (IMPLEMENT 2026-11-01 partner_payout_account §③).
//
// Two lists, both from the DB, newest first, 20 each:
//   transfers — every bank transfer the fund made to this shop and the
//               account it went to (`v_fund_bill_payments`, BRANCH · TRANSFER);
//               a row that may still be corrected carries "แก้บัญชีปลายทาง".
//   changes   — every time the shop's MAIN account was set, changed or removed
//               (`v_deal_partner_payout_account_log`): old → new; no old means
//               the first set, no new means the account was removed.
//
// A viewer without the permission gets empty lists, not an error.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Modal } from 'tsp-form';
import { ArrowRight, History, Landmark, Paperclip } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { EntityCodeLink } from '../../components/EntityCodeLink';
import { BankAccountInline } from '../../components/BankAccountLine';
import { destAsAccount, destFromPrefixed } from '../../components/ShopPayoutDestField';
import type { FundPaymentDestTarget } from '../fund-cash/FundPaymentSetDestModal';

export const PARTNER_PAYOUT_HISTORY_KEY = ['partner-payout-history'] as const;

interface TransferRow extends FundPaymentDestTarget {
  bill_id: number;
  bank_account_id: number | null;
  reference: string | null;
  evidence_count: number;
  is_reversal: boolean;
  voided_at: string | null;
}

interface ChangeRow {
  log_id: number;
  old_bank_code: string | null;
  old_bank_name: string | null;
  old_bank_name_en: string | null;
  old_account_no: string | null;
  old_account_number_display: string | null;
  old_account_name: string | null;
  new_bank_code: string | null;
  new_bank_name: string | null;
  new_bank_name_en: string | null;
  new_account_no: string | null;
  new_account_number_display: string | null;
  new_account_name: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

const PAGE = 20;

function useShopTransfers(branchId: number | null) {
  return useQuery({
    queryKey: [...PARTNER_PAYOUT_HISTORY_KEY, 'transfers', branchId],
    queryFn: () => apiClient.get<TransferRow[]>(
      `/v_fund_bill_payments?party_type=eq.BRANCH&party_id=eq.${branchId}&method=eq.TRANSFER`
      + `&order=paid_date.desc,payment_id.desc&limit=${PAGE}&offset=0`
      + '&select=payment_id,bill_id,bill_code,paid_date,amount,flow,dest_bank_code,dest_bank_name,dest_bank_name_en,'
      + 'dest_account_no,dest_account_number_display,dest_account_name,bank_account_id,reference,evidence_count,is_reversal,voided_at',
    ).then(rows => rows.map(r => ({ ...r, branch_id: branchId as number }))),
    enabled: branchId != null,
    staleTime: 10 * 1000,
  });
}

function useShopAccountChanges(branchId: number | null) {
  return useQuery({
    queryKey: [...PARTNER_PAYOUT_HISTORY_KEY, 'changes', branchId],
    queryFn: () => apiClient.get<ChangeRow[]>(
      `/v_deal_partner_payout_account_log?branch_id=eq.${branchId}&order=changed_at.desc&limit=${PAGE}`,
    ),
    enabled: branchId != null,
    staleTime: 10 * 1000,
  });
}

function AccountOrNone({ row, prefix }: { row: ChangeRow; prefix: 'old_' | 'new_' }) {
  const { t } = useTranslation();
  const d = destFromPrefixed(row as unknown as Record<string, unknown>, prefix);
  if (!d) {
    return (
      <span className="text-subtle">
        {prefix === 'old_' ? t('partnerPayout.historyFirstSet') : t('partnerPayout.historyRemoved')}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col min-w-0">
      <BankAccountInline account={destAsAccount(d)} />
      {d.account_name && <span className="text-xs text-subtle truncate">{d.account_name}</span>}
    </span>
  );
}

export function PartnerPayoutHistoryModal({ open, branchId, branchName, canFixDest, onFixDest, onClose }: {
  open: boolean;
  branchId: number | null;
  branchName: string | null;
  /** Holds FUND.PAYMENT_ACCOUNT_FIX — shows "แก้บัญชีปลายทาง" on a correctable row. */
  canFixDest: boolean;
  onFixDest: (payment: FundPaymentDestTarget) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const transfers = useShopTransfers(open ? branchId : null);
  const changes = useShopAccountChanges(open ? branchId : null);

  const fixable = (r: TransferRow) => canFixDest && !r.is_reversal && !r.voided_at;

  return (
    <Modal open={open} onClose={onClose} maxWidth="36rem" width="100%" ariaLabel={t('partnerPayout.historyTitle')}>
      <div className="modal-header">
        <h2 className="modal-title">{t('partnerPayout.historyTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="modal-content">
        <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
          <div className="font-medium text-sm">{branchName ?? ''}</div>
        </div>

        {/* Transfers */}
        <div className="rounded-md border border-line overflow-hidden">
          <div className="px-3 py-2 bg-surface text-sm font-medium flex items-center gap-2">
            <Landmark size={14} className="text-subtle" />
            {t('partnerPayout.historyTransfers')}
          </div>
          {transfers.isLoading ? (
            <div className="px-3 py-3 text-sm text-subtle">{t('common.loading')}</div>
          ) : (transfers.data ?? []).length === 0 ? (
            <div className="px-3 py-3 text-sm text-subtle">{t('partnerPayout.historyTransfersNone')}</div>
          ) : (transfers.data ?? []).map(r => {
            const d = destFromPrefixed(r as unknown as Record<string, unknown>, 'dest_');
            return (
              <div key={r.payment_id} className={`px-3 py-2.5 border-t border-line ${r.voided_at ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <EntityCodeLink to={`/admin/fund-bills/${r.bill_id}`} code={r.bill_code} className="text-sm font-medium" />
                  <span className="text-xs text-subtle"><DateTime value={r.paid_date} showTime={false} /></span>
                  {r.is_reversal && <Badge color="warning" size="sm">{t('fundBill.reversalRow')}</Badge>}
                  {r.voided_at && <Badge color="default" size="sm">{t('fundBill.paymentVoided')}</Badge>}
                  <span className={`ml-auto text-sm tabular-nums ${r.is_reversal ? 'text-danger-fg' : ''}`}>
                    {fmtCurrency(r.amount)}
                  </span>
                </div>
                <div className="text-xs text-subtle mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap">
                  {d ? <BankAccountInline account={destAsAccount(d)} /> : <span>—</span>}
                  {d?.account_name && <span>{d.account_name}</span>}
                  {r.reference && <span>{r.reference}</span>}
                  {r.evidence_count > 0 && (
                    <span className="inline-flex items-center gap-0.5"><Paperclip size={11} />{r.evidence_count}</span>
                  )}
                  {fixable(r) && (
                    <button
                      type="button"
                      className="text-xs text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer"
                      onClick={() => onFixDest(r)}
                    >
                      {t('fundPaymentDest.action')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {(transfers.data ?? []).length >= PAGE && (
            <div className="px-3 py-2 border-t border-line text-xs text-subtle">{t('partnerPayout.historyLatestN', { count: PAGE })}</div>
          )}
        </div>

        {/* Main-account changes */}
        <div className="rounded-md border border-line overflow-hidden mt-4">
          <div className="px-3 py-2 bg-surface text-sm font-medium flex items-center gap-2">
            <History size={14} className="text-subtle" />
            {t('partnerPayout.historyChanges')}
          </div>
          {changes.isLoading ? (
            <div className="px-3 py-3 text-sm text-subtle">{t('common.loading')}</div>
          ) : (changes.data ?? []).length === 0 ? (
            <div className="px-3 py-3 text-sm text-subtle">{t('partnerPayout.historyChangesNone')}</div>
          ) : (changes.data ?? []).map(r => (
            <div key={r.log_id} className="px-3 py-2.5 border-t border-line">
              <div className="text-xs text-subtle flex items-center gap-2 flex-wrap">
                <DateTime value={r.changed_at} showTime />
                {r.changed_by_name && <span>· {r.changed_by_name}</span>}
              </div>
              <div className="mt-1 text-sm flex items-center gap-2 flex-wrap">
                <AccountOrNone row={r} prefix="old_" />
                <ArrowRight size={14} className="text-subtle shrink-0" />
                <AccountOrNone row={r} prefix="new_" />
              </div>
            </div>
          ))}
          {(changes.data ?? []).length >= PAGE && (
            <div className="px-3 py-2 border-t border-line text-xs text-subtle">{t('partnerPayout.historyLatestN', { count: PAGE })}</div>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
