// Take the money on a bill so that pressing the button again finishes the job
// instead of starting it over — UI_FEEDBACK/2026-10-04_BUG_payment_confirm_not_retried_after_add.md.
//
// Paying is `fn_bill_payment_add` once per tender, then `fn_bill_payment_confirm`.
// If a round stops after some adds reached the server (confirm failed, or a
// response never came back), the old screens re-ran the whole sequence: the
// first tender went in twice, or — once the bill was PAID — add was refused with
// SALE.STATE.BILL_NOT_OPEN and confirm was never reached again. Confirm is what
// moves the contract on, allocates installments and sends the payment notice.
//
// So every round reads the bill first and does only what is missing:
//   - adds only the tenders this payment has not recorded yet
//   - calls confirm whenever the bill is fully paid (repeat confirms are safe)
//
// "Already recorded" is judged against the payments that were NOT on the bill
// when this payment started, so a part-paid bill's earlier payments are never
// mistaken for this one's. Change the tenders (or the bill) and it starts afresh.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../lib/api';

export interface SettleTender {
  method: string;
  amount: number;
  bank_account_id?: number | null;
  /** Any other fn_bill_payment_add params the caller sends (p_reference, p_contract_id, …). */
  extra?: Record<string, unknown>;
}

interface BillPaymentRow {
  id: number;
  amount: number;
  method: string;
  bank_account_id: number | null;
  is_reversal: boolean;
  ref_voided_id: number | null;
}

interface BillState {
  bill_id: number;
  status: string;
  payments: BillPaymentRow[] | null;
}

interface Attempt {
  billId: number;
  key: string;
  /** Live payment ids already on the bill before this payment's first round. */
  baseline: Set<number>;
}

async function readBill(billId: number): Promise<BillState | null> {
  const rows = await apiClient.get<BillState[]>(
    `/v_bill_detail?bill_id=eq.${billId}&select=bill_id,status,payments`,
  );
  return rows[0] ?? null;
}

/** Payments still standing — neither a reversal nor reversed by one. */
function livePayments(bill: BillState): BillPaymentRow[] {
  const rows = bill.payments ?? [];
  const reversed = new Set(rows.filter(p => p.is_reversal && p.ref_voided_id != null).map(p => p.ref_voided_id));
  return rows.filter(p => !p.is_reversal && !reversed.has(p.id));
}

function sameTender(t: SettleTender, p: BillPaymentRow): boolean {
  return t.method === p.method
    && Math.abs(t.amount - p.amount) < 0.01
    && (t.method !== 'TRANSFER' || (t.bank_account_id ?? null) === (p.bank_account_id ?? null));
}

export function isBillNotOpen(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'SALE.STATE.BILL_NOT_OPEN';
}

export function useBillSettle() {
  const attempt = useRef<Attempt | null>(null);

  /**
   * Record whatever of `tenders` the bill does not have yet, then confirm.
   * Returns the confirm result. Throws if any step fails — call it again with
   * the same arguments to carry on from where it stopped.
   */
  const settle = useCallback(async <T = unknown>(opts: {
    billId: number;
    tenders: SettleTender[];
    /** fn_bill_payment_confirm params besides p_bill_id (p_contract_id, p_confirmed_by, …). */
    confirm?: Record<string, unknown>;
  }): Promise<T> => {
    const { billId, confirm } = opts;
    const tenders = opts.tenders.filter(t => t.amount > 0);
    const key = JSON.stringify(tenders.map(t => [t.method, t.amount, t.bank_account_id ?? null]));

    const bill = await readBill(billId);
    if (bill && bill.status !== 'PAID') {
      const live = livePayments(bill);
      if (!attempt.current || attempt.current.billId !== billId || attempt.current.key !== key) {
        attempt.current = { billId, key, baseline: new Set(live.map(p => p.id)) };
      }
      const baseline = attempt.current.baseline;
      const ours = live.filter(p => !baseline.has(p.id));
      const missing = tenders.filter(t => {
        const i = ours.findIndex(p => sameTender(t, p));
        if (i < 0) return true;
        ours.splice(i, 1);
        return false;
      });
      for (const t of missing) {
        try {
          await apiClient.rpc('fn_bill_payment_add', {
            p_bill_id: billId,
            p_method: t.method,
            p_amount: t.amount,
            p_bank_account_id: t.method === 'TRANSFER' ? (t.bank_account_id ?? null) : null,
            ...t.extra,
          });
        } catch (err) {
          // The bill is already paid in full — nothing left to add, go confirm.
          if (isBillNotOpen(err)) break;
          throw err;
        }
      }
    }

    const result = await apiClient.rpc<T>('fn_bill_payment_confirm', { p_bill_id: billId, ...confirm });
    attempt.current = null;
    return result;
  }, []);

  /** Forget a half-finished payment (call when the screen is closed or reset). */
  const reset = useCallback(() => { attempt.current = null; }, []);

  return { settle, reset };
}

/** A bill's status, or null if it can't be read. */
export async function readBillStatus(billId: number): Promise<string | null> {
  try {
    return (await readBill(billId))?.status ?? null;
  } catch {
    return null;
  }
}

const AWAITING_PAYMENT = new Set(['PENDING_PAYMENT', 'PENDING_PAYMENT_AND_SIGN']);

/**
 * Self-repair for a contract still waiting for payment whose opening bill is
 * already PAID — the payment went in but confirm never did (BUG 2026-10-04 §3.6).
 * Confirms once per bill when the contract is shown; on failure it reports the
 * error and offers `retry`. Fires only in that state, so viewing a healthy
 * contract never repeats a confirm (a repeat on an old bill re-sends the
 * customer's payment notice).
 */
export function usePaidOpenBillConfirm(opts: {
  contractId: number | null | undefined;
  contractState: string | null | undefined;
  onConfirmed?: () => void;
  /** Off while the screen is taking the payment itself. */
  enabled?: boolean;
}) {
  const { contractId, contractState, onConfirmed, enabled = true } = opts;
  const queryClient = useQueryClient();
  const awaiting = enabled && contractId != null && !!contractState && AWAITING_PAYMENT.has(contractState);

  const { data: paidBillId, isPending } = useQuery({
    queryKey: ['contract-open-bill-paid', contractId],
    queryFn: async () => {
      const rows = await apiClient.get<Array<{ id: number }>>(
        `/v_bills?contract_id=eq.${contractId}&bill_purpose=eq.CONTRACT_OPEN&status=eq.PAID&is_cancelled=is.false&select=id&order=created_at.desc&limit=1`,
      );
      return rows[0]?.id ?? null;
    },
    enabled: awaiting,
    staleTime: 0,
  });

  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tried = useRef<number | null>(null);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  const run = useCallback(async (billId: number, cId: number) => {
    setConfirming(true);
    setError(null);
    try {
      await apiClient.rpc('fn_bill_payment_confirm', { p_bill_id: billId, p_contract_id: cId });
      queryClient.invalidateQueries({ queryKey: ['contract-open-bill-paid', cId] });
      onConfirmedRef.current?.();
    } catch (err) {
      setError(err);
    } finally {
      setConfirming(false);
    }
  }, [queryClient]);

  const stuckBillId = awaiting && paidBillId != null ? paidBillId : null;

  useEffect(() => {
    if (stuckBillId == null || contractId == null || tried.current === stuckBillId) return;
    tried.current = stuckBillId;
    void run(stuckBillId, contractId);
  }, [stuckBillId, contractId, run]);

  const retry = useCallback(() => {
    if (stuckBillId != null && contractId != null) void run(stuckBillId, contractId);
  }, [stuckBillId, contractId, run]);

  /** Still finding out whether there is anything to repair. */
  const checking = awaiting && isPending;

  return { stuckBillId, checking, confirming, error, retry };
}
