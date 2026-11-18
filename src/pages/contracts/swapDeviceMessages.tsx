import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { AlertTriangle, Loader2, Undo2, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';

// "สลับเครื่อง" for deal-partner shops (IMPLEMENT 2026-11-18 partner_swap_device,
// migs 1697–1709). The shop is outside the company and rarely talks to us, so every
// refusal answers three things in one place (§1b): what happened, what they can do
// themselves, and who to call if they can't — built from `code` + `params`, never
// from the DB's English `message`. The same text serves the button before it is
// pressed (blocking_params.code) and the refusal after (error.code).

const KNOWN = new Set([
  'PARTNER.STATE.SETTLEMENT_CLOSE_SUBMITTED',
  'PARTNER.STATE.SETTLEMENT_IN_PAYOUT',
  'PARTNER.STATE.ALREADY_PAID_TO_BRANCH',
  'PARTNER.STATE.USE_RETURN_DOCUMENT',
  'SALE.AUTH.PIN_REQUIRED',
  'CORE.AUTH.INVALID_PIN',
  'SALE.VALIDATION.REASON_REQUIRED',
  'SALE.AUTH.PERMISSION_DENIED',
  'CONTRACT.VALIDATION.ASSET_NOT_OWNED_BY_BRANCH',
  'CONTRACT.VALIDATION.ASSET_MODEL_MISMATCH',
  'CONTRACT.VALIDATION.ASSET_CONDITION_MISMATCH',
  'CONTRACT.VALIDATION.ASSET_CROSS_COMPANY_TYPE',
  'SALE.VALIDATION.SAME_DEVICE',
  'INV.STATE.ASSET_NOT_AVAILABLE',
  'CONTRACT.VALIDATION.NOT_ELIGIBLE_FOR_SNAPSHOT',
  'SALE.VALIDATION.BIND_DENIED',
  'CONTRACT.STATE.SNAPSHOT_REQUIRES_ACTIVE_OR_PENDING',
]);

export const WITHDRAW_CODE = 'PARTNER.STATE.SETTLEMENT_CLOSE_SUBMITTED';

const keyOf = (code: string) => code.toLowerCase().replace(/\./g, '_');

export interface SwapProblem {
  code: string | null;
  params: Record<string, unknown>;
  traceId?: string | null;
}

export function swapProblemFromError(err: unknown): SwapProblem {
  if (err instanceof ApiError) {
    return { code: err.code ?? null, params: (err.messageParams as Record<string, unknown>) ?? {}, traceId: err.traceId ?? null };
  }
  return { code: null, params: {}, traceId: null };
}

/** The three lines for one refusal, in the shop's words. */
export function useSwapProblemText() {
  const { t } = useTranslation();
  return (p: SwapProblem): { what: string; next: string; who: string; known: boolean } => {
    const known = !!p.code && KNOWN.has(p.code);
    const base = known ? `swapDevice.err.${keyOf(p.code!)}` : 'swapDevice.err.unknown';
    const params = {
      ...p.params,
      condition: p.params.contract_is_used_asset === true ? t('swapDevice.used') : p.params.contract_is_used_asset === false ? t('swapDevice.new') : '',
    };
    const pick = (part: string) => t(`${base}.${part}`, { ...params, defaultValue: '' });
    let what = pick('what');
    // USE_RETURN_DOCUMENT: say the open return document when there is one.
    if (p.code === 'PARTNER.STATE.USE_RETURN_DOCUMENT' && typeof p.params.return_code === 'string') {
      what = `${what} ${t('swapDevice.err.partner_state_use_return_document.withReturn', { return_code: p.params.return_code })}`;
    }
    return { what, next: pick('next'), who: pick('who'), known };
  };
}

/**
 * The refusal box: what happened, what to do, who to call — plus, when the shop has
 * already submitted its close-out, the button that withdraws it right here (§5b).
 * `tone` danger after a press, warning before one.
 */
export function SwapProblemBox({
  problem, contractId, tone = 'danger', onWithdrawn,
}: {
  problem: SwapProblem;
  contractId: number;
  tone?: 'danger' | 'warning';
  onWithdrawn?: () => void;
}) {
  const { t } = useTranslation();
  const text = useSwapProblemText()(problem);
  const queryClient = useQueryClient();
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawn, setWithdrawn] = useState(false);

  const withdraw = async () => {
    setWithdrawing(true);
    setWithdrawError('');
    try {
      // The withdraw lives on the settlement's own action list (CLOSE_WITHDRAW).
      const res = await apiClient.rpc<{ actions?: { action_code: string; is_available: boolean; blocking_reason?: string | null }[] }>(
        'fn_partner_settlement_available_actions', { p_contract_id: contractId },
      );
      const row = res?.actions?.find(a => a.action_code === 'CLOSE_WITHDRAW');
      if (!row?.is_available) {
        setWithdrawError(row?.blocking_reason
          ? t(`blockingReason.${row.blocking_reason}`, { ns: 'apiErrors', defaultValue: row.blocking_reason })
          : t('swapDevice.withdrawUnavailable'));
        return;
      }
      await apiClient.rpc('fn_partner_settlement_close_withdraw', { p_contract_id: contractId, p_note: t('swapDevice.withdrawNote') });
      setWithdrawn(true);
      queryClient.invalidateQueries({ queryKey: ['contract-actions', contractId] });
      queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0]).includes('settlement') });
      onWithdrawn?.();
    } catch (err) {
      setWithdrawError(err instanceof ApiError ? (translateApiError(err, t) || err.code || '') : String(err));
    } finally {
      setWithdrawing(false);
    }
  };

  const Icon = tone === 'danger' ? XCircle : AlertTriangle;
  return (
    <div className={`alert alert-${tone} items-start`} data-swap-problem={problem.code ?? 'unknown'}>
      <Icon size={16} className="shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1.5 min-w-0">
        <span className="font-medium">{text.what}</span>
        {text.next && <span className="text-sm">{text.next}</span>}
        {text.who && <span className="text-sm">{text.who}</span>}
        {problem.code === WITHDRAW_CODE && !withdrawn && (
          <Button size="sm" variant="outline" className="self-start" startIcon={withdrawing ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
            disabled={withdrawing} onClick={withdraw} data-action="CLOSE_WITHDRAW">
            {t('swapDevice.withdrawButton')}
          </Button>
        )}
        {withdrawn && <span className="text-sm font-medium">{t('swapDevice.withdrawDone')}</span>}
        {withdrawError && <span className="text-sm">{withdrawError}</span>}
        {(!text.known || problem.traceId) && (
          <span className="text-xs opacity-80 font-mono">
            {[problem.code, problem.traceId && `trace ${problem.traceId}`].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
}
