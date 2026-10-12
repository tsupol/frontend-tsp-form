// The shop's payment request on its contract page — UI_SUMMARY/140 §1 + §4.
//
// Two halves of one card:
//   the money  — what the fund owes for this contract, line by line, from
//                v_partner_my_settlement_detail. `net_amount` is the view's own
//                figure; adding the lines up here would double-count a reversal.
//   the close-out — drawn entirely from fn_partner_settlement_available_actions:
//                the checklist, why the finance team sent it back, and which
//                buttons exist. Never from the request's status.
//
// A contract with no request yet (not active, or not a shop contract) answers
// 404 and the whole card renders nothing.
//
// Submitting freezes the handover photos, so both verbs refresh the album's
// checklist as well as this card (141 §5).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Tooltip } from 'tsp-form';
import {
  Wallet, CheckCircle2, XCircle, AlertTriangle, Undo2, ChevronDown, ChevronRight, Images, History,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { blockingReasonText } from '../../lib/apiErrors';
import { useAuth } from '../../contexts/AuthContext';
import {
  usePartnerMySettlementDetail,
  usePartnerSettlementActions,
  usePartnerSettlementCloseLog,
  useSettlementStatusRef,
  useSettlementReturnReasons,
  useRefLabel,
  usePhotoGroupLabels,
} from './usePartnerSettlement';
import { settlementBadgeColor, type SettlementCheck } from './partnerSettlementTypes';
import { SettlementCloseModal, type CloseAction } from './SettlementCloseModal';

interface SettlementCardProps {
  contractId: number | null;
  /** Card chrome — `plain` for a bordered card in a detail panel. */
  variant?: 'plain' | 'flush';
  /** Opens the tab the photo album lives on, when the checklist points there. */
  onOpenAlbum?: () => void;
  className?: string;
}

export function SettlementCard({
  contractId, variant = 'plain', onOpenAlbum, className,
}: SettlementCardProps) {
  const { t, i18n } = useTranslation();
  const { isDealPartner } = useAuth();
  const isThai = i18n.language === 'th';

  const [showHistory, setShowHistory] = useState(false);
  const [closeAction, setCloseAction] = useState<CloseAction | null>(null);

  // Shop-only: staff read the same request through their own finance queue,
  // and the shop views answer 403 for them.
  const applies = isDealPartner && contractId != null;

  const { detail, isError: detailFailed, error: detailError } = usePartnerMySettlementDetail(contractId, applies);
  const { caps, isLoading: capsLoading } = usePartnerSettlementActions(contractId, applies);
  const { rows: logRows } = usePartnerSettlementCloseLog(contractId, applies && !!detail);
  const statusRef = useSettlementStatusRef();
  const returnReasons = useSettlementReturnReasons();
  const refLabel = useRefLabel();
  const groupLabel = usePhotoGroupLabels();

  if (!applies) return null;
  // A contract with no request answers with no rows; a failed call is a
  // backend fault, so say so instead of hiding the card as if nothing were owed.
  if (detailFailed) {
    return (
      <div className={`alert alert-warning ${className ?? ''}`} data-testid="settlement-card-load-failed">
        <AlertTriangle size={18} />
        <div>
          <div className="alert-title">{t('settlement.loadFailedTitle')}</div>
          <div className="alert-description">
            {t('settlement.loadFailedDesc')}
            {detailError instanceof Error && detailError.message && (
              <div className="text-xs opacity-80 mt-1 break-words">{detailError.message}</div>
            )}
          </div>
        </div>
      </div>
    );
  }
  // No request for this contract — nothing to say (404 on the capability call).
  if (!detail && !capsLoading && !caps) return null;
  if (!detail) return null;

  const statusLabel = refLabel(statusRef, detail.status)
    || t(`settlement.status_${detail.status}`, { defaultValue: detail.status });

  // The check's own name, in the reader's language — the list is data (140 §4).
  const checkName = (c: SettlementCheck) => (isThai ? c.name_th : c.name_en) || c.code;

  const findAction = (code: string) => caps?.actions.find(a => a.action_code === code) ?? null;
  // status_not_allowed / permission_denied hide the button entirely; every
  // other reason shows it disabled with the reason on it (140 §4).
  const visibleAction = (code: string) => {
    const a = findAction(code);
    if (!a) return null;
    if (a.blocking_reason === 'status_not_allowed' || a.blocking_reason === 'permission_denied') return null;
    return a;
  };
  const submitAction = visibleAction('CLOSE_SUBMIT');
  const withdrawAction = visibleAction('CLOSE_WITHDRAW');

  const lines = (detail.lines ?? []).filter(l => !l.is_memo);

  const wrapperClass = variant === 'flush'
    ? `border-b border-line px-4 py-4 ${className ?? ''}`
    : `rounded-md border border-line bg-surface px-4 py-3 ${className ?? ''}`;

  const renderButton = (
    code: CloseAction,
    label: string,
    color: 'primary' | 'danger',
  ) => {
    const a = code === 'CLOSE_SUBMIT' ? submitAction : withdrawAction;
    if (!a) return null;
    const reason = !a.is_available ? blockingReasonText(a, t) : '';
    const button = (
      <Button
        size="sm"
        color={color}
        variant={color === 'danger' ? 'outline' : undefined}
        disabled={!a.is_available}
        onClick={() => setCloseAction(code)}
        data-action={code}
        data-blocked-reason={!a.is_available ? (a.blocking_reason ?? 'unavailable') : undefined}
      >
        {label}
      </Button>
    );
    return reason
      ? <Tooltip key={code} content={reason} placement="top">{button}</Tooltip>
      : <span key={code}>{button}</span>;
  };

  return (
    <>
      <div className={wrapperClass}>
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-subtle shrink-0" />
          <span className="font-medium text-sm flex-1 min-w-0 truncate">
            {t('settlement.cardTitle')}
          </span>
          <Badge color={settlementBadgeColor(detail.status)} size="sm">{statusLabel}</Badge>
        </div>

        <div className="mt-1 text-xs text-subtle">{detail.settlement_code}</div>

        {/* The money. Plus = the fund pays it, minus = the shop already holds it. */}
        <div className="mt-3 rounded-md border border-line overflow-hidden">
          {lines.map(line => {
            const isVoid = line.status === 'VOID' || line.line_type === 'REVERSAL';
            const isFrom = line.direction === 'FROM_BRANCH';
            return (
              <div
                key={line.line_id}
                className="flex items-center justify-between gap-2 px-3 py-2 border-b border-line last:border-b-0"
              >
                <div className={`min-w-0 ${isVoid ? 'line-through text-subtler' : ''}`}>
                  <div className="text-sm truncate">
                    {t(`settlement.lineType_${line.line_type}`, { defaultValue: line.line_type })}
                  </div>
                  {isFrom && (
                    <div className="text-xs text-subtle">{t('settlement.heldByShop')}</div>
                  )}
                  {line.rate_percent != null && line.base_amount != null && (
                    <div className="text-xs text-subtle tabular-nums">
                      {line.rate_percent}% · {fmtCurrency(line.base_amount)}
                    </div>
                  )}
                </div>
                <span
                  className={`text-sm tabular-nums shrink-0 ${
                    isVoid ? 'line-through text-subtler' : isFrom ? 'text-danger-fg' : ''
                  }`}
                >
                  {isFrom ? '−' : '+'}{fmtCurrency(line.amount)}
                </span>
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-hover">
            <span className="text-sm font-medium">{t('settlement.netAmount')}</span>
            <span className="text-sm font-semibold tabular-nums">{fmtCurrency(detail.net_amount)}</span>
          </div>
        </div>

        {/* Why the finance team sent it back — the whole reason the shop is here. */}
        {caps?.last_return && (
          <div className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-danger-fg">
              <Undo2 size={14} className="shrink-0" />
              {t('settlement.sentBack')}
              {': '}
              {refLabel(returnReasons, caps.last_return.reason_code)}
            </div>
            {caps.last_return.note && (
              <div className="text-sm text-danger-fg mt-0.5">{caps.last_return.note}</div>
            )}
            <div className="text-xs text-danger-fg mt-1 opacity-80">
              <DateTime value={caps.last_return.returned_at} showTime />
            </div>
          </div>
        )}

        {/* The checklist. The items come from the backend — never hardcoded. */}
        {/* The checklist is what stands between the shop and submitting, so it
            goes away once neither close-out button is on offer — after payment
            it would describe a submission that can no longer happen. */}
        {caps && caps.checks.checks.length > 0 && (submitAction || withdrawAction) && (
          <div className="mt-3">
            <div className="text-xs font-medium text-subtle uppercase tracking-wider">
              {t('settlement.checklist')}
            </div>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {caps.checks.checks.map(c => {
                const missingGroups = c.detail?.missing_groups ?? [];
                return (
                  <div key={c.code} className="flex items-start gap-2">
                    {c.ok
                      ? <CheckCircle2 size={14} className="text-success shrink-0 mt-0.5" />
                      : <XCircle size={14} className="text-danger-fg shrink-0 mt-0.5" />}
                    <div className="min-w-0">
                      <div className={`text-sm ${c.ok ? '' : 'text-danger-fg'}`}>{checkName(c)}</div>
                      {missingGroups.length > 0 && (
                        <div className="text-xs text-danger-fg mt-0.5">
                          {missingGroups.map(g => groupLabel(g)).join(' · ')}
                        </div>
                      )}
                      {!c.ok && missingGroups.length > 0 && onOpenAlbum && (
                        <button
                          type="button"
                          onClick={onOpenAlbum}
                          className="mt-1 text-xs text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                        >
                          <Images size={12} />
                          {t('settlement.goToAlbum')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {caps && caps.close_submit_count > 0 && (
          <div className="mt-2 text-xs text-subtle">
            {t('settlement.submitCountLine', { count: caps.close_submit_count })}
            {caps.close_submitted_at && (
              <> · <DateTime value={caps.close_submitted_at} showTime /></>
            )}
          </div>
        )}

        {(submitAction || withdrawAction || logRows.length > 0) && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {logRows.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory(v => !v)}
                className="text-sm text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
              >
                {showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <History size={14} />
                {t('settlement.history', { count: logRows.length })}
              </button>
            )}
            <div className="flex-1" />
            {renderButton('CLOSE_WITHDRAW', t('settlement.withdrawClose'), 'danger')}
            {renderButton('CLOSE_SUBMIT', t('settlement.submitClose'), 'primary')}
          </div>
        )}

        {showHistory && logRows.length > 0 && (
          <div className="mt-3 rounded-md border border-line overflow-hidden">
            {logRows.map(row => (
              <div key={row.log_id} className="px-3 py-2 border-b border-line last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm">
                    {t(`settlement.logAction_${row.action_code}`, { defaultValue: row.action_code })}
                  </span>
                  <span className="flex-1" />
                  <span className="text-xs text-subtle">
                    <DateTime value={row.created_at} showTime />
                  </span>
                </div>
                <div className="text-xs text-subtle mt-0.5">
                  {row.actor_name}
                  {row.reason_code && <> · {refLabel(returnReasons, row.reason_code)}</>}
                  {row.note && <> — {row.note}</>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <SettlementCloseModal
        open={closeAction != null}
        action={closeAction ?? 'CLOSE_SUBMIT'}
        contractId={contractId}
        settlementCode={detail.settlement_code}
        // A refusal names either a check (`HANDOVER_PHOTOS`) or a photo group;
        // try the check's name first, then the album's own label for the group.
        checkLabel={(code) => {
          const check = caps?.checks.checks.find(c => c.code === code);
          if (check) return checkName(check);
          return groupLabel(code);
        }}
        onClose={() => setCloseAction(null)}
      />
    </>
  );
}
