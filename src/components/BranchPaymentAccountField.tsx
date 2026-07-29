import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge } from 'tsp-form';
import { AlertCircle, Check } from 'lucide-react';
import { apiClient } from '../lib/api';

export type PaymentChannel = 'STORE_FRONT' | 'INSTALLMENT';

/** Payment QR image bound to the account (public-bucket key at paths.original).
 *  Compose the URL with publicMediaUrl (no presign). null = no QR uploaded. */
export interface PaymentQrMedia {
  media_id: number;
  usage_type: string;
  access_level: string;
  sort_order: number;
  paths: { original: string };
}

/** v_branch_payment_account — both channel slots for the logged-in staff's own
 *  branch (JWT-scoped). 2 rows: STORE_FRONT + INSTALLMENT. */
export interface BranchPaymentAccount {
  account_id: number;
  bank_name: string;
  account_number: string;
  account_number_display: string | null;
  account_name: string;
  source: 'OVERRIDE' | 'PRIMARY';
  channel: PaymentChannel;
  channel_name_th: string;
  is_promptpay: boolean;
  promptpay_id: string | null;
  qr_media: PaymentQrMedia | null;
}

export function useBranchPaymentAccounts(enabled = true) {
  return useQuery({
    queryKey: ['branch-payment-accounts'],
    queryFn: () => apiClient.get<BranchPaymentAccount[]>('/v_branch_payment_account'),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** Legacy single-account hook (STORE_FRONT) — kept for the dashboard tile that
 *  just displays "the branch receiving account". New TRANSFER flows use the
 *  picker (BranchPaymentAccountField) instead. */
export function useBranchPaymentAccount(enabled = true) {
  const q = useBranchPaymentAccounts(enabled);
  const account = (q.data ?? []).find(a => a.channel === 'STORE_FRONT')
    ?? (q.data ?? [])[0] ?? null;
  return { ...q, data: account };
}

interface Props {
  /** Reports the resolved account_id (or null) so the host sets bank_account_id. */
  onResolve: (accountId: number | null) => void;
  /** Render/query only when the host needs it (e.g. method === 'TRANSFER'). */
  active?: boolean;
  /** Which channel to pre-select. Installment-type collections → INSTALLMENT,
   *  everything else → STORE_FRONT (default). Staff can still switch. */
  recommendChannel?: PaymentChannel;
}

/**
 * TRANSFER receiving-account picker. The branch has 2 channel-slot accounts
 * (หน้าร้าน / ค่างวด); the backend rejects any account that isn't one of them.
 * Pre-selects `recommendChannel`. When both channels resolve to the same
 * account, collapses to a read-only display. Reports the chosen account_id.
 */
export function BranchPaymentAccountField({ onResolve, active = true, recommendChannel = 'STORE_FRONT' }: Props) {
  const { t } = useTranslation();
  const { data: accounts = [], isSuccess } = useBranchPaymentAccounts(active);

  const [channel, setChannel] = useState<PaymentChannel>(recommendChannel);

  const byChannel = useMemo(() => {
    const m = new Map<PaymentChannel, BranchPaymentAccount>();
    for (const a of accounts) m.set(a.channel, a);
    return m;
  }, [accounts]);

  // Reset to the recommended channel whenever it changes or data first loads.
  useEffect(() => {
    setChannel(recommendChannel);
  }, [recommendChannel]);

  const selected = byChannel.get(channel) ?? [...byChannel.values()][0] ?? null;

  // Report the resolved id to the host, guarding by value to avoid update loops
  // (onResolve is often an inline closure).
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;
  const lastReported = useRef<number | null | undefined>(undefined);
  const resolvedId = active ? selected?.account_id ?? null : null;
  useEffect(() => {
    if (!active) { lastReported.current = undefined; return; }
    if (lastReported.current !== resolvedId) {
      lastReported.current = resolvedId;
      onResolveRef.current(resolvedId);
    }
  }, [active, resolvedId]);

  if (!active) return null;

  if (accounts.length === 0) {
    return isSuccess ? (
      <div className="alert alert-warning">
        <AlertCircle size={16} />
        <div className="alert-description">{t('bankAccount.noReceivingAccount')}</div>
      </div>
    ) : null;
  }

  const AccountLine = ({ a }: { a: BranchPaymentAccount }) => (
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium truncate text-fg">{a.bank_name}</div>
      <div className="text-xs truncate">
        <span className="text-fg tabular-nums tracking-widest font-semibold">
          {a.account_number_display ?? a.account_number}
        </span>
        <span className="text-subtle"> · {a.account_name}</span>
      </div>
    </div>
  );

  // Always a per-channel picker — even when both slots resolve to the same
  // account — so the staff explicitly choose where the transfer landed.
  const channels: PaymentChannel[] = ['STORE_FRONT', 'INSTALLMENT'];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs text-subtle">{t('bankAccount.pickChannel', { defaultValue: 'Which account received the transfer?' })}</div>
      {channels.map((ch) => {
        const a = byChannel.get(ch);
        if (!a) return null;
        const isSel = ch === channel;
        return (
          <button
            key={ch}
            type="button"
            onClick={() => setChannel(ch)}
            className={`flex items-center gap-3 rounded-md border px-3 py-2 text-left cursor-pointer transition-colors ${
              isSel ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-hover bg-transparent'
            }`}
          >
            <Badge size="sm" color={ch === 'INSTALLMENT' ? 'info' : 'default'}>
              {t(`bankChannel.channel_${ch}`, { defaultValue: ch })}
            </Badge>
            <AccountLine a={a} />
            {a.source === 'OVERRIDE' && (
              <Badge color="warning" size="sm">{t('bankAccount.temporary')}</Badge>
            )}
            {isSel && <Check size={16} className="text-primary-fg shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
