// Which accounts this shop uses — shown to the shop itself.
//
// Two of them, and they are not interchangeable:
//
//   instalment  — the account the shop tells CUSTOMERS to pay into.
//   remittance  — the account the shop pays the fund back through, when it buys
//                 a device back, owes a buyback fee, or has commission clawed
//                 back. A different account from the one customers use; the
//                 owner confirmed that explicitly.
//
// Until this existed the shop had to phone and ask, so the panel is repeated on
// every screen where the shop owes money, not kept on one settings page.
//
// ⛔ The shop's own front-counter account is deliberately left out: it is not an
// account anyone pays INTO here, and showing three would blur the two that
// matter.
//
// A channel with no account set simply has no row, which is not an error — it
// means nobody has configured it yet, so the panel says to ask the fund rather
// than rendering a blank line.

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button } from 'tsp-form';
import { Check, Copy, Landmark } from 'lucide-react';
import { apiClient } from '../lib/api';

/** One account the shop is told to use, per channel. */
interface PartnerBankAccount {
  branch_id: number;
  channel: string;
  channel_name: string | null;
  channel_sort: number;
  bank_code: string | null;
  /** May be empty when the account stores its bank as free text — fall back. */
  bank_name: string | null;
  account_no: string | null;
  account_name: string | null;
}

/** The only two channels the shop is shown. Order follows the backend's sort. */
const SHOWN_CHANNELS = ['INSTALLMENT', 'PARTNER_REMIT'];

interface PartnerRemitAccountsProps {
  /** Narrow the panel to one channel — a screen about paying the fund back
   *  only needs the remittance account. Omit for both. */
  only?: 'PARTNER_REMIT' | 'INSTALLMENT';
  className?: string;
}

export function PartnerRemitAccounts({ only, className }: PartnerRemitAccountsProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);

  const wanted = only ? [only] : SHOWN_CHANNELS;

  const { data, isLoading } = useQuery({
    queryKey: ['partner-bank-accounts'],
    queryFn: () => apiClient.get<PartnerBankAccount[]>(
      '/v_partner_my_bank_accounts?order=channel_sort',
    ),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // The view returns every configured channel; the shop is shown only these.
  const rows = (data ?? []).filter(r => wanted.includes(r.channel));
  const missing = wanted.filter(c => !rows.some(r => r.channel === c));

  if (isLoading) return null;
  // Nothing configured and nothing to ask about — the caller is not a shop.
  if (rows.length === 0 && missing.length === 0) return null;

  const copy = async (row: PartnerBankAccount) => {
    if (!row.account_no) return;
    try {
      await navigator.clipboard.writeText(row.account_no);
      setCopied(row.channel);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // A denied clipboard is not worth an error state — the number is on screen
      // and can be read off it.
    }
  };

  return (
    <div className={`rounded-md border border-line overflow-hidden ${className ?? ''}`}>
      <div className="px-3 py-2 bg-surface flex items-center gap-2">
        <Landmark size={14} className="text-subtle shrink-0" />
        <span className="text-sm font-medium">
          {only === 'PARTNER_REMIT' ? t('partnerAccounts.remitTitle') : t('partnerAccounts.title')}
        </span>
      </div>

      {rows.map(row => (
        <div key={row.channel} className="px-3 py-2.5 border-t border-line flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-subtle">
              {row.channel_name ?? t(`partnerAccounts.channel_${row.channel}`, { defaultValue: row.channel })}
            </div>
            <div className="text-sm font-medium tabular-nums mt-0.5">{row.account_no ?? '—'}</div>
            <div className="text-xs text-subtle mt-0.5">
              {/* The bank name can be empty when the record keeps it as text. */}
              {row.bank_name || row.bank_code || '—'}
              {row.account_name && <> · {row.account_name}</>}
            </div>
            {/* Said on the remittance row only: this is the one people get wrong,
             *  because the obvious guess is the account customers pay into. */}
            {row.channel === 'PARTNER_REMIT' && (
              <div className="text-xs text-subtler mt-1">{t('partnerAccounts.remitHint')}</div>
            )}
          </div>
          {row.account_no && (
            <Button
              size="sm"
              variant="outline"
              startIcon={copied === row.channel ? <Check size={14} className="text-success" /> : <Copy size={14} />}
              onClick={() => copy(row)}
            >
              {copied === row.channel ? t('common.copied') : t('common.copy')}
            </Button>
          )}
        </div>
      ))}

      {missing.map(channel => (
        <div key={channel} className="px-3 py-2.5 border-t border-line">
          <div className="text-xs text-subtle">
            {t(`partnerAccounts.channel_${channel}`, { defaultValue: channel })}
          </div>
          <div className="text-sm mt-0.5">{t('partnerAccounts.notSet')}</div>
        </div>
      ))}
    </div>
  );
}
