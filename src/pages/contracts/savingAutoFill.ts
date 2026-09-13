/**
 * Saving-wallet auto-fill for the contract-open payment step.
 *
 * Owner request (2026-09-13, OHM #5): staff kept forgetting to spend a saving
 * contract's accumulated balance when opening the contract — the money sat in
 * `c_saving_balance` while the customer paid the whole down payment again in
 * cash. So the UI now:
 *   1. seeds the payment rows with SAVING_WALLET already applied,
 *   2. announces it once in a dialog ("this contract has X baht saved"),
 *   3. warns whenever less than the full balance ends up being used.
 *
 * Used by both live open-payment screens:
 *   • workspace/PanelReviewPay.tsx  — the open wizard's Review & Pay step
 *   • ContractActions.tsx           — PendingPaymentModal (resume PENDING_PAYMENT)
 *
 * Not applied to DEAL_PARTNER branches: their bills accept only
 * PARTNER_COLLECT (NOTICE 1196), so there is no wallet row to seed.
 */

export interface SavingPaymentLine {
  method: string;
  amount: number;
  bank_account_id: number | null;
}

/** How much of the saving balance a bill of `totalAmount` can absorb. */
export function savingApplied(savingBalance: number, totalAmount: number): number {
  if (savingBalance <= 0 || totalAmount <= 0) return 0;
  return Math.min(savingBalance, totalAmount);
}

/**
 * Initial payment rows with the saving wallet already spent.
 *
 * - balance covers the bill  → one SAVING_WALLET row for the full total
 * - balance is partial       → SAVING_WALLET row + a CASH row for the rest
 * - no balance / no charge   → one CASH row for the total (previous behaviour)
 */
export function buildSavingSeededPayments(
  savingBalance: number,
  totalAmount: number,
  fallbackMethod = 'CASH',
): SavingPaymentLine[] {
  const applied = savingApplied(savingBalance, totalAmount);
  if (applied <= 0) {
    return [{ method: fallbackMethod, amount: totalAmount, bank_account_id: null }];
  }
  const remainder = totalAmount - applied;
  const rows: SavingPaymentLine[] = [
    { method: 'SAVING_WALLET', amount: applied, bank_account_id: null },
  ];
  if (remainder > 0.01) {
    rows.push({ method: fallbackMethod, amount: remainder, bank_account_id: null });
  }
  return rows;
}

/**
 * How much of the saving balance the current rows leave unspent, given that
 * the bill could have absorbed `savingApplied(...)` of it. Returns 0 when the
 * rows already use everything the bill can take.
 */
export function unusedSaving(
  payments: Array<{ method: string; amount: number }>,
  savingBalance: number,
  totalAmount: number,
): number {
  const applied = savingApplied(savingBalance, totalAmount);
  if (applied <= 0) return 0;
  const used = payments
    .filter(p => p.method === 'SAVING_WALLET')
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  const unused = applied - used;
  return unused > 0.01 ? unused : 0;
}
