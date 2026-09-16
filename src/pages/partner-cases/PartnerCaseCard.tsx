// The shop's credit-approval card. One component, rendered on all three
// surfaces a shop meets its FIN1 contract on: the wizard, the drafts panel and
// the contract detail panel.
//
// What it shows is decided by the latest request plus the contract's own state
// — never by state alone (a contract can sit in DRAFT with no request at all,
// with a returned one, or with a withdrawn one, and those read differently).
// The buttons it offers come from the contract's capability RPC, so a shop
// without the submit permission simply sees no button.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from 'tsp-form';
import { ChevronDown, ChevronRight, ClipboardCheck, Clock, CheckCircle, Undo2, AlertTriangle } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { useAuth } from '../../contexts/AuthContext';
import {
  useContractPartnerCases,
  usePartnerCaseReturnReasons,
  usePartnerCaseStatusRef,
} from './usePartnerCases';
import { outcomeBadgeColor, type PartnerCase } from './partnerCaseTypes';
import { PartnerCaseSubmitModal } from './PartnerCaseSubmitModal';
import { PartnerCaseWithdrawModal } from './PartnerCaseWithdrawModal';

interface PartnerCaseCardProps {
  contractId: number | null;
  contractCode: string;
  /** Contract's commercial model — the flow is FIN1 only. */
  commercialModel?: string | null;
  /** Live contract state, so the card can tell "draft, never asked" from "returned". */
  contractState?: string | null;
  /** Card chrome. `plain` for a bordered card in a detail panel, `flush` inside the wizard's card column. */
  variant?: 'plain' | 'flush';
  className?: string;
}

/** Actions the contract's capability RPC exposes for this flow. */
interface ContractActionLite {
  action_code: string;
  is_available: boolean;
  is_permitted?: boolean;
  blocking_reason: string | null;
}

export function PartnerCaseCard({
  contractId,
  contractCode,
  commercialModel,
  contractState,
  variant = 'plain',
  className,
}: PartnerCaseCardProps) {
  const { t, i18n } = useTranslation();
  const { isDealPartner } = useAuth();

  const [showHistory, setShowHistory] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  // FIN1 shops only. A null commercial model means the caller could not tell us
  // yet — let the request fire and let the empty result decide.
  const applies = isDealPartner && (commercialModel == null || commercialModel === 'FIN1');

  const { latest, history, isLoading } = useContractPartnerCases(contractId, applies);
  const statusRef = usePartnerCaseStatusRef();
  const returnReasons = usePartnerCaseReturnReasons();

  // Buttons come from the backend. While a request is waiting the contract is
  // not in a draft state, so the wizard's own edit actions are already gone;
  // this only looks for the two that belong to this flow.
  const { data: actionsResp } = useQuery({
    queryKey: ['contract-actions', contractId],
    queryFn: () => apiClient.rpc<{ actions: ContractActionLite[] }>(
      'fn_contract_available_actions',
      { p_contract_id: contractId },
    ),
    enabled: applies && contractId != null,
    staleTime: 30 * 1000,
  });

  if (!applies) return null;

  const actions = actionsResp?.actions ?? [];
  const findAction = (code: string) => actions.find(a => a.action_code === code);
  const canSubmit = (() => {
    const a = findAction('PARTNER_CASE_SUBMIT');
    return !!a && a.is_available && a.is_permitted !== false;
  })();
  const canWithdraw = (() => {
    const a = findAction('PARTNER_CASE_WITHDRAW');
    return !!a && a.is_available && a.is_permitted !== false;
  })();

  const label = (code: string | null | undefined) => {
    if (!code) return '';
    const row = statusRef.find(s => s.code === code);
    if (!row) return code;
    return i18n.language === 'th' ? row.name_th : row.name_en;
  };

  const reasonLabel = (code: string | null | undefined) => {
    if (!code) return '';
    const row = returnReasons.find(r => r.code === code);
    if (!row) return code;
    return i18n.language === 'th' ? row.name_th : row.name_en;
  };

  // ── What the shop is looking at ────────────────────────────────────────────
  // `outcome` is the view's own derivation; the card never recomputes it.
  const outcome = latest?.outcome ?? null;
  const isWaiting = outcome === 'PENDING';
  const isApproved = outcome === 'IN_FORCE';
  const isExpired = outcome === 'EXPIRED';
  const isReturned = outcome === 'RETURNED';
  const isWithdrawn = outcome === 'WITHDRAWN';
  const isUsed = outcome === 'USED';

  // An active contract's approval is finished business — the card would only be
  // noise next to a live contract's own sections.
  if (isUsed && contractState === 'ACTIVE') return null;

  const headIcon = isWaiting ? <Clock size={16} className="text-warning-fg shrink-0" />
    : isApproved ? <CheckCircle size={16} className="text-success shrink-0" />
    : isReturned ? <Undo2 size={16} className="text-danger-fg shrink-0" />
    : isExpired ? <AlertTriangle size={16} className="text-danger-fg shrink-0" />
    : <ClipboardCheck size={16} className="text-subtle shrink-0" />;

  // The badge already carries the request's own status word. A headline that
  // repeats it verbatim (approved / approved) is noise, so only states whose
  // headline SAYS something the badge doesn't get one.
  const headline = !latest ? t('partnerCase.stateNever')
    : isWaiting ? t('partnerCase.stateWaiting')
    : isExpired ? t('partnerCase.stateExpired')
    : isReturned ? t('partnerCase.stateReturned')
    : null;

  const wrapperClass = variant === 'flush'
    ? `border-b border-line px-4 py-4 ${className ?? ''}`
    : `rounded-md border border-line bg-surface px-4 py-3 ${className ?? ''}`;

  return (
    <>
      <div className={wrapperClass}>
        <div className="flex items-center gap-2">
          {headIcon}
          <span className="font-medium text-sm flex-1 min-w-0">{t('partnerCase.cardTitle')}</span>
          {latest && (
            <Badge color={outcomeBadgeColor(latest.outcome)} size="sm">
              {label(latest.status)}
            </Badge>
          )}
        </div>

        <div className="mt-2 text-sm flex flex-col gap-1.5">
          {isLoading && !latest ? (
            <span className="text-subtle">{t('common.loading')}</span>
          ) : (
            <>
              {headline && <div className="font-medium">{headline}</div>}

              {/* Waiting — who is looking at it and since when. */}
              {isWaiting && latest && (
                <div className="text-subtle">
                  {t('partnerCase.submittedAt')}{' '}
                  <DateTime value={latest.submitted_at} showTime />
                  {latest.pool_name && <> · {latest.pool_name}</>}
                </div>
              )}

              {/* Approved — the date the approval stops being usable. */}
              {isApproved && latest?.approved_expires_at && (
                <div className="text-subtle">
                  {t('partnerCase.usableUntil')}{' '}
                  <DateTime value={latest.approved_expires_at} showTime />
                </div>
              )}

              {isExpired && (
                <div className="text-danger-fg">{t('partnerCase.expiredHint')}</div>
              )}

              {/* Returned — the reason is the whole point of the card here. */}
              {isReturned && latest && (
                <div className="rounded-md border border-danger-border bg-danger-soft px-3 py-2">
                  <div className="text-sm font-medium text-danger-fg">
                    {reasonLabel(latest.return_reason_code)}
                  </div>
                  {latest.return_reason && (
                    <div className="text-sm text-danger-fg mt-0.5">{latest.return_reason}</div>
                  )}
                  <div className="text-xs text-danger-fg mt-1 opacity-80">
                    <DateTime value={latest.returned_at} showTime />
                  </div>
                </div>
              )}

              {isWithdrawn && latest?.withdrawn_at && (
                <div className="text-subtle">
                  <DateTime value={latest.withdrawn_at} showTime />
                  {latest.withdraw_reason && <> · {latest.withdraw_reason}</>}
                </div>
              )}

              {!latest && (
                <div className="text-subtle">{t('partnerCase.neverHint')}</div>
              )}
            </>
          )}
        </div>

        {(canSubmit || canWithdraw || history.length > 0) && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory(v => !v)}
                className="text-sm text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
              >
                {showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {t('partnerCase.history', { count: history.length })}
              </button>
            )}
            <div className="flex-1" />
            {canWithdraw && (
              <Button size="sm" variant="outline" onClick={() => setWithdrawOpen(true)}>
                {t('partnerCase.withdraw')}
              </Button>
            )}
            {canSubmit && (
              <Button size="sm" color="primary" onClick={() => setSubmitOpen(true)}>
                {latest ? t('partnerCase.resubmit') : t('partnerCase.submit')}
              </Button>
            )}
          </div>
        )}

        {showHistory && history.length > 0 && (
          <div className="mt-3 rounded-md border border-line overflow-hidden">
            {history.map(h => (
              <PartnerCaseHistoryRow
                key={h.case_id}
                row={h}
                statusLabel={label(h.status)}
                reasonLabel={reasonLabel(h.return_reason_code)}
              />
            ))}
          </div>
        )}
      </div>

      <PartnerCaseSubmitModal
        open={submitOpen}
        contractId={contractId}
        contractCode={contractCode}
        isResubmit={!!latest}
        onClose={() => setSubmitOpen(false)}
      />
      <PartnerCaseWithdrawModal
        open={withdrawOpen}
        contractId={contractId}
        contractCode={contractCode}
        wasApproved={isApproved || isExpired}
        onClose={() => setWithdrawOpen(false)}
      />
    </>
  );
}

function PartnerCaseHistoryRow({
  row, statusLabel, reasonLabel,
}: { row: PartnerCase; statusLabel: string; reasonLabel: string }) {
  const { t } = useTranslation();
  return (
    <div className="px-3 py-2 border-b border-line last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="text-xs text-subtle tabular-nums">#{row.seq_no}</span>
        <Badge color={outcomeBadgeColor(row.outcome)} size="sm">{statusLabel}</Badge>
        <span className="flex-1" />
        <span className="text-xs text-subtle">
          <DateTime value={row.submitted_at} showTime />
        </span>
      </div>
      {row.return_reason_code && (
        <div className="text-xs text-subtle mt-1">
          {reasonLabel}
          {row.return_reason && <> — {row.return_reason}</>}
        </div>
      )}
      {row.withdraw_reason && (
        <div className="text-xs text-subtle mt-1">
          {t('partnerCase.withdrawReason')}: {row.withdraw_reason}
        </div>
      )}
    </div>
  );
}
