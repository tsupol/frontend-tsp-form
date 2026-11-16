// "ยกเลิกในวัน" — what must be done before a same-day void (IMPLEMENT 2026-11-16
// void_reverses_added_down_terminate_same_day_1684 §2.2). The backend lists every pending
// step, in the order they must be done, both before the press (fn_contract_available_actions
// → VOID_CONTRACT.blocking_params.steps) and as the void's refusal
// (SALE.STATE.VOID_STEPS_PENDING → params.steps). One checker, one list; this draws it.

import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';
import type { VoidStep, VoidStepTarget } from './voidStepData';

/** Where the step's way out lives on the contract page; null = nothing the user can press. */
function targetOf(s: VoidStep): VoidStepTarget | null {
  switch (s.hint_code) {
    case 'USE_UNBIND_DEVICE': return { tab: 'device' };
    case 'CANCEL_BILLS_FIRST': return { tab: 'money', section: 'bills' };
    case 'USE_WALLET_CASHOUT': return { tab: 'money', section: 'wallets' };
    default: return null;
  }
}

export function VoidStepsList({ steps, onGo }: { steps: VoidStep[]; onGo?: (target: VoidStepTarget) => void }) {
  const { t } = useTranslation();
  const text = (s: VoidStep): string => {
    const amount = fmtCurrency(Number(s.balance ?? 0));
    switch (s.step) {
      case 'DEVICE_STILL_BOUND': return t('contract.voidSteps.DEVICE_STILL_BOUND');
      case 'RELATED_BILLS': return t('contract.voidSteps.RELATED_BILLS', { codes: (s.bills ?? []).map(b => b.code).join(', ') || '—' });
      case 'INSURANCE_BALANCE': return t('contract.voidSteps.INSURANCE_BALANCE', { amount });
      case 'CREDIT_BALANCE': return t('contract.voidSteps.CREDIT_BALANCE', { amount });
      case 'SAVING_BALANCE': return t('contract.voidSteps.SAVING_BALANCE', { amount });
      // A step this screen doesn't know yet: say it raw rather than drop it (§2.2).
      default: return [s.step, s.hint_code].filter(Boolean).join(' · ');
    }
  };
  const how = (s: VoidStep): string =>
    s.hint_code ? t(`contract.voidSteps.hint.${s.hint_code}`, { defaultValue: s.step === s.hint_code ? '' : s.hint_code }) : '';

  return (
    <ol className="flex flex-col gap-2" data-testid="void-steps">
      {steps.map((s, i) => {
        const target = targetOf(s);
        return (
          <li key={`${s.step}-${i}`} className="flex items-start gap-2 text-sm" data-step={s.step}>
            <span className="shrink-0 w-5 h-5 rounded-full border border-warning-border bg-warning-soft text-warning-fg text-xs font-semibold inline-flex items-center justify-center">{i + 1}</span>
            <div className="min-w-0 flex flex-col gap-0.5">
              <span className="font-medium">{text(s)}</span>
              {target && onGo ? (
                <button type="button" onClick={() => onGo(target)}
                  className="text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer self-start text-xs">
                  {how(s)}<ExternalLink size={12} />
                </button>
              ) : how(s) ? <span className="text-xs text-subtle">{how(s)}</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
