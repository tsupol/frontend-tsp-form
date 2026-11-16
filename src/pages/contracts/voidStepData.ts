// ยกเลิกในวัน — the step list's shape (IMPLEMENT 2026-11-16 void_…_1684 §2.2); drawn by VoidSteps.tsx.

export interface VoidStep {
  step: string;
  hint_code?: string | null;
  device_id?: number | null;
  wallet_type?: string | null;
  balance?: number | null;
  bills?: { bill_id: number; code: string; bill_purpose?: string | null; status?: string | null; total_amount?: number | null }[] | null;
}

export type VoidStepTarget = { tab: 'device' } | { tab: 'money'; section: 'bills' | 'wallets' };

/** Steps carried by a capability row or an error's params, or null. */
export function voidStepsOf(params: Record<string, unknown> | null | undefined): VoidStep[] | null {
  const steps = params?.steps;
  return Array.isArray(steps) && steps.length > 0 ? (steps as VoidStep[]) : null;
}
