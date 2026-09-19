// One payout document.
//
// Buttons come from `fn_partner_payout_available_actions` and nothing else: the
// document's status alone cannot tell whether this user is in the shop's payout
// pool, so drawing from status would offer actions that die on submit. Reasons
// that mean "not yours / not now" hide the button; reasons that are a state of
// the document itself (empty, negative, has adjustments) show it disabled with
// the reason on its tooltip, because that is something the user can act on.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { PageNav, PageNavPanel, MobileHeader, Badge, Button, Tooltip } from 'tsp-form';
import { ArrowLeft, FileQuestion, Plus, Smartphone, Trash2, Wrench } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { blockingReasonText } from '../../lib/apiErrors';
import {
  usePartnerPayoutActions,
  usePartnerPayoutDetail,
  usePartnerPayoutLog,
  usePayoutDeviceTransfers,
  usePayoutStatusRef,
} from './usePartnerPayouts';
import {
  payoutStatusColor,
  type PartnerPayoutStatus,
  type PayoutAction,
  type PayoutAdjustmentRow,
  type PayoutSettlementRow,
} from './partnerPayoutTypes';
import { PayoutPayModal } from './PayoutPayModal';
import { PayoutVoidModal } from './PayoutVoidModal';
import { PayoutReverseModal } from './PayoutReverseModal';
import { PayoutAdjustModal } from './PayoutAdjustModal';
import { PayoutAdjustVoidModal } from './PayoutAdjustVoidModal';
import { PayoutAddSettlementModal } from './PayoutAddSettlementModal';
import { PayoutRemoveSettlementModal } from './PayoutRemoveSettlementModal';

/** Reasons that mean the button has no business being on screen at all. */
const HIDDEN_REASONS = new Set(['status_not_allowed', 'permission_denied']);

/** Actions with a modal here. Anything else the backend adds shows as not-wired. */
const WIRED_ACTIONS = new Set(['PAY', 'VOID', 'REVERSE', 'ADJUST']);

/** Actions driven from a row rather than the footer. */
const ROW_ACTIONS = new Set(['ADD_SETTLEMENT', 'REMOVE_SETTLEMENT', 'REMOVE_LINE', 'ADJUST_VOID']);

export function PartnerPayoutDetailPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { payoutId: payoutIdParam } = useParams<{ payoutId: string }>();
  const payoutId = payoutIdParam ? Number(payoutIdParam) : null;

  const { detail, isLoading, isFetched } = usePartnerPayoutDetail(payoutId);
  const { actions } = usePartnerPayoutActions(payoutId);
  // A typed or stale id resolves to no row. Without this the page renders an
  // empty shell that reads as broken rather than "there is no such document".
  const notFound = isFetched && !detail;
  const log = usePartnerPayoutLog(payoutId);
  const transfers = usePayoutDeviceTransfers(payoutId);
  const statusRef = usePayoutStatusRef();

  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PayoutSettlementRow | null>(null);
  const [voidAdjustTarget, setVoidAdjustTarget] = useState<PayoutAdjustmentRow | null>(null);

  const statusLabel = (code: PartnerPayoutStatus) => {
    const row = statusRef.find(s => s.code === code);
    if (!row) return t(`partnerPayout.status_${code}`, { defaultValue: code });
    return i18n.language === 'th' ? row.name_th : row.name_en;
  };

  const settlements = detail?.settlements ?? [];
  const adjustments = detail?.adjustments ?? [];

  /** Which side of the document a person is looking at.
   *  The owner reads the two directions as separate lists that happen to share a
   *  document, so the tabs split them rather than only netting them together. */
  const [moneyTab, setMoneyTab] = useState<'requested' | 'returned' | 'net'>('net');

  /** Live adjustments only — a cancelled row is history, not money. */
  const liveAdjustments = adjustments.filter(a => a.is_active);

  /** "ขอจ่าย" — what the shop asked for. Each settlement already nets the down
   *  payment and doc fee it kept, so the figure here is the settlement's own net,
   *  not its gross: that is how the owner's sheet reads the column (his 56,802 is
   *  the two settlements netted, with only the buyback sitting under "คืน").
   *  A top-up transferred afterwards belongs on this side too. */
  const requestedTotal =
    settlements.reduce((sum, s) => sum + s.net_amount, 0) +
    liveAdjustments.filter(a => a.direction === 'TO_BRANCH').reduce((sum, a) => sum + a.amount, 0);
  const requestedCount =
    settlements.length + liveAdjustments.filter(a => a.direction === 'TO_BRANCH').length;

  /** "คืน" — money coming back from the shop after the fact: a device buyback,
   *  an overpayment returned. Not the down payment, which never left the shop. */
  const returnedTotal = liveAdjustments
    .filter(a => a.direction === 'FROM_BRANCH')
    .reduce((sum, a) => sum + a.amount, 0);
  const returnedCount = liveAdjustments.filter(a => a.direction === 'FROM_BRANCH').length;

  /** Negative = money leaves the fund, matching the owner's spreadsheet. */
  const signedNet = returnedTotal - requestedTotal;

  /** Rows for the tab in view. A settlement is a request for money, so the
   *  "returned" tab drops them entirely and shows only what came back. */
  const visibleSettlements = moneyTab === 'returned' ? [] : settlements;

  /** Adjustments split by direction; the returned tab is where a buyback lands.
   *  A single-direction tab shows live rows only — a cancelled row is history,
   *  and padding a "what came back" list with struck-through entries is exactly
   *  the noise these tabs exist to remove. The net tab keeps the full record. */
  const visibleAdjustments =
    moneyTab === 'requested' ? liveAdjustments.filter(a => a.direction === 'TO_BRANCH')
    : moneyTab === 'returned' ? liveAdjustments.filter(a => a.direction === 'FROM_BRANCH')
    : adjustments;

  const footerActions = (actions?.actions ?? [])
    .filter(a => !ROW_ACTIONS.has(a.action_code))
    .filter(a => a.is_available || !HIDDEN_REASONS.has(a.blocking_reason ?? ''))
    .sort((a, b) => a.sort_order - b.sort_order);

  /** Is a row-level action offered at all right now? */
  const rowActionOk = (code: string) =>
    (actions?.actions ?? []).some(a => a.action_code === code && a.is_available);

  /** The row-level action itself, so a blocked one can say why instead of vanishing.
   *  mig 1281 only lets an adjustment row be cancelled on the day it was recorded;
   *  after that the evaluator answers `adjustment_not_today`, and the person needs
   *  to read that rather than find the button gone. */
  const rowAction = (code: string) =>
    (actions?.actions ?? []).find(a => a.action_code === code);

  const runAction = (code: string) => {
    if (code === 'PAY') setPayOpen(true);
    else if (code === 'VOID') setVoidOpen(true);
    else if (code === 'REVERSE') setReverseOpen(true);
    else if (code === 'ADJUST') setAdjustOpen(true);
  };

  const renderActionButton = (a: PayoutAction) => {
    const label = t(`partnerPayout.action_${a.action_code}`, { defaultValue: a.action_code });
    const wired = WIRED_ACTIONS.has(a.action_code);
    const lines: string[] = [label];
    let endIcon: React.ReactNode = undefined;

    if (!wired) {
      endIcon = <Wrench size={12} />;
      lines.push(t('actionNotImplemented', { defaultValue: 'Not yet wired in this page' }));
    }
    if (!a.is_available && a.blocking_reason) {
      lines.push(blockingReasonText(a, t));
    }

    const tooltipContent = lines.length === 1 ? lines[0] : (
      <div className="flex flex-col gap-0.5">
        {lines.map((line, i) => (
          <div key={i} className={i === 0 ? 'font-medium' : 'text-xs opacity-90'}>{line}</div>
        ))}
      </div>
    );

    return (
      <Tooltip key={a.action_code} content={tooltipContent}>
        <Button
          size="sm"
          variant={a.action_code === 'PAY' ? 'primary' : 'outline'}
          color={a.action_code === 'VOID' || a.action_code === 'REVERSE' ? 'danger' : undefined}
          endIcon={endIcon}
          disabled={!a.is_available || !wired}
          onClick={() => runAction(a.action_code)}
        >
          {label}
        </Button>
      </Tooltip>
    );
  };

  return (
    <PageNav panels={['list']} className="h-dvh overflow-hidden">
      {({ isMobile }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                <button
                  className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                  onClick={() => navigate('/admin/partner-payouts')}
                >
                  <ArrowLeft size={20} />
                </button>
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {detail?.payout_code ?? t('partnerPayout.pageTitle')}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                startIcon={<ArrowLeft size={16} />}
                onClick={() => navigate('/admin/partner-payouts')}
              />
              <h1 className="heading-2 shrink-0">{detail?.payout_code ?? ''}</h1>
              {detail && (
                <Badge color={payoutStatusColor(detail.status)} size="sm">
                  {statusLabel(detail.status)}
                </Badge>
              )}
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 flex flex-col">
              <div className="flex-1 overflow-auto better-scroll px-4 py-3">
                {isLoading && !detail && (
                  <div className="p-8 text-center text-subtler">{t('common.loading', { defaultValue: 'Loading…' })}</div>
                )}

                {notFound && (
                  <div className="p-8 flex flex-col items-center gap-3 text-center">
                    <FileQuestion size={40} className="text-subtler" />
                    <div className="text-subtler">{t('partnerPayout.notFound')}</div>
                    <Button variant="outline" size="sm" onClick={() => navigate('/admin/partner-payouts')}>
                      {t('partnerPayout.backToList')}
                    </Button>
                  </div>
                )}

                {detail && (
                  <div className="max-w-4xl mx-auto flex flex-col gap-4">
                    {/* Header card — the shop, the account on the document, the money. */}
                    <div className="rounded-md border border-line overflow-hidden">
                      <div className="px-3 py-2.5 bg-surface flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{detail.branch_name}</span>
                        <Badge color={payoutStatusColor(detail.status)} size="sm">
                          {statusLabel(detail.status)}
                        </Badge>
                        <span className="flex-1" />
                        <span className="text-xs text-subtle">
                          {detail.created_by_name} · <DateTime value={detail.created_at} showTime />
                        </span>
                      </div>

                      <div className="px-3 py-2.5 border-t border-line grid gap-2 sm:grid-cols-2">
                        <div>
                          <div className="text-xs text-subtle">{t('partnerPayout.shopAccount')}</div>
                          <div className="text-sm mt-0.5">
                            {detail.payout_account_no
                              ? <>{detail.payout_bank_code} · {detail.payout_account_no}</>
                              : '—'}
                          </div>
                          {detail.payout_account_name && (
                            <div className="text-xs text-subtle">{detail.payout_account_name}</div>
                          )}
                        </div>
                        <div className="sm:text-right">
                          <div className="text-xs text-subtle">{t('partnerPayout.netAmount')}</div>
                          <div className="text-lg font-semibold tabular-nums">{fmtCurrency(detail.net_amount)}</div>
                          {detail.status === 'PAID' && detail.adjustment_count > 0 && (
                            <>
                              <div className="text-xs text-subtle mt-1">{t('partnerPayout.adjustedNet')}</div>
                              <div className="text-base font-semibold tabular-nums text-success-fg">
                                {fmtCurrency(detail.adjusted_net)}
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* The overview the owner asks to read first: what we owe the
                       *  shop, what the shop owes back, and the one number that is
                       *  actually transferred. Signed the way the owner's own sheet
                       *  reads it — negative means money leaves the fund — so the
                       *  net here does not silently disagree with his spreadsheet. */}
                      <div className="px-3 py-2.5 border-t border-line grid grid-cols-3 gap-3">
                        <div>
                          <div className="text-xs text-subtle">
                            {t('partnerPayout.summaryRequested')} ({requestedCount})
                          </div>
                          <div className="font-semibold text-sm tabular-nums">{fmtCurrency(requestedTotal)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-subtle">
                            {t('partnerPayout.summaryReturned')} ({returnedCount})
                          </div>
                          <div className="font-semibold text-sm tabular-nums">{fmtCurrency(returnedTotal)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-subtle">{t('partnerPayout.summaryNet')}</div>
                          <div
                            className={`font-semibold text-sm tabular-nums ${
                              signedNet < 0 ? 'text-danger-fg' : signedNet > 0 ? 'text-success-fg' : ''
                            }`}
                          >
                            {fmtCurrency(signedNet)}
                          </div>
                        </div>
                      </div>

                      {(detail.paid_date || detail.reference || detail.source_account_display) && (
                        <div className="px-3 py-2.5 border-t border-line text-sm flex flex-wrap gap-x-4 gap-y-1">
                          {detail.paid_date && (
                            <span>
                              <span className="text-subtle">{t('partnerPayout.paidDate')}: </span>
                              <DateTime value={detail.paid_date} showTime={false} />
                            </span>
                          )}
                          {detail.source_account_display && (
                            <span>
                              <span className="text-subtle">{t('partnerPayout.sourceAccount')}: </span>
                              {detail.source_account_display}
                            </span>
                          )}
                          {detail.reference && (
                            <span>
                              <span className="text-subtle">{t('partnerPayout.reference')}: </span>
                              {detail.reference}
                            </span>
                          )}
                          {detail.paid_by_name && (
                            <span>
                              <span className="text-subtle">{t('partnerPayout.paidBy')}: </span>
                              {detail.paid_by_name}
                            </span>
                          )}
                        </div>
                      )}

                      {detail.void_reason && (
                        <div className="px-3 py-2.5 border-t border-line text-sm">
                          <span className="text-subtle">{t('partnerPayout.voidReason')}: </span>
                          {detail.void_reason}
                        </div>
                      )}
                      {detail.reversed_at && (
                        <div className="px-3 py-2.5 border-t border-line text-sm">
                          <span className="text-subtle">{t('partnerPayout.reverseReason')}: </span>
                          {t(`partnerPayout.reverseReason_${detail.reverse_reason_code}`, {
                            defaultValue: detail.reverse_reason_code ?? '—',
                          })}
                          {detail.reverse_note && <> · {detail.reverse_note}</>}
                        </div>
                      )}
                      {detail.note && (
                        <div className="px-3 py-2.5 border-t border-line text-sm">
                          <span className="text-subtle">{t('partnerPayout.note')}: </span>
                          {detail.note}
                        </div>
                      )}
                    </div>

                    {/* Settlements on the document. */}
                    <div className="rounded-md border border-line overflow-hidden">
                      <div className="px-3 py-2 bg-surface flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {t('partnerPayout.settlementsOnDocument', { count: visibleSettlements.length })}
                        </span>
                        <span className="flex-1" />
                        {rowActionOk('ADD_SETTLEMENT') && (
                          <Button
                            size="sm"
                            variant="outline"
                            startIcon={<Plus size={14} />}
                            onClick={() => setAddOpen(true)}
                          >
                            {t('partnerPayout.addSettlement')}
                          </Button>
                        )}
                      </div>

                      {/* Split the two directions apart. Netting them on one line is
                       *  what made the document hard to read; each tab shows one side
                       *  on its own, and "net" keeps the combined view. */}
                      <div className="px-3 border-t border-line flex gap-1">
                        {([
                          ['requested', 'tabRequested', 'tabRequestedHint'],
                          ['returned', 'tabReturned', 'tabReturnedHint'],
                          ['net', 'tabNet', 'tabNetHint'],
                        ] as const).map(([key, label, hint]) => (
                          <Tooltip key={key} content={t(`partnerPayout.${hint}`)} placement="bottom">
                            <button
                              type="button"
                              onClick={() => setMoneyTab(key)}
                              className={`px-3 py-2 text-sm border-b-2 bg-transparent cursor-pointer transition-colors ${
                                moneyTab === key
                                  ? 'border-primary text-primary-fg font-medium'
                                  : 'border-transparent text-subtle hover:text-fg'
                              }`}
                            >
                              {t(`partnerPayout.${label}`)}
                            </button>
                          </Tooltip>
                        ))}
                      </div>

                      {settlements.length === 0 ? (
                        <div className="p-6 text-center text-subtler text-sm">
                          {t('partnerPayout.noSettlementsYet')}
                        </div>
                      ) : visibleSettlements.length === 0 ? (
                        /* On a single-direction tab an empty side is the normal
                         * case, not a fault — keep it to one quiet line so the
                         * money that IS on this side stays the eye's target. */
                        <div className="px-3 py-2 text-subtler text-sm border-t border-line">
                          {t('partnerPayout.noRowsInTab')}
                        </div>
                      ) : visibleSettlements.map(s => (
                        <div key={s.settlement_id} className="px-3 py-2.5 border-t border-line flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">{s.settlement_code}</span>
                              <span className="flex-1" />
                              <span className="text-sm tabular-nums shrink-0">{fmtCurrency(s.net_amount)}</span>
                            </div>
                            <div className="text-sm mt-0.5 truncate">
                              {s.contract_code} · {s.customer_name ?? '—'}
                            </div>
                            <div className="text-xs text-subtle mt-0.5">
                              {t('partnerPayout.toBranch')} {fmtCurrency(s.total_to_branch)} ·{' '}
                              {t('partnerPayout.fromBranch')} {fmtCurrency(s.total_from_branch)}
                            </div>
                          </div>
                          {rowActionOk('REMOVE_SETTLEMENT') && (
                            <Button
                              size="sm"
                              variant="outline"
                              startIcon={<Trash2 size={14} className="text-danger" />}
                              onClick={() => setRemoveTarget(s)}
                            >
                              {t('partnerPayout.removeSettlement')}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Adjustments — only ever exist on a paid document. */}
                    {visibleAdjustments.length > 0 && (
                      <div className="rounded-md border border-line overflow-hidden">
                        <div className="px-3 py-2 bg-surface text-sm font-medium">
                          {t('partnerPayout.adjustments')}
                        </div>
                        {visibleAdjustments.map(a => (
                          <div key={a.adjustment_id} className="px-3 py-2.5 border-t border-line flex items-start gap-3">
                            <div className={`flex-1 min-w-0 ${a.is_active ? '' : 'line-through text-subtler'}`}>
                              <div className="flex items-center gap-2">
                                <Badge color={a.direction === 'TO_BRANCH' ? 'info' : 'warning'} size="sm">
                                  {t(`partnerPayout.direction_${a.direction}`)}
                                </Badge>
                                <span className="flex-1" />
                                <span className="text-sm tabular-nums shrink-0">{fmtCurrency(a.amount)}</span>
                              </div>
                              <div className="text-sm mt-0.5">{a.reason}</div>
                              <div className="text-xs text-subtle mt-0.5">
                                <DateTime value={a.paid_date} showTime={false} />
                                {a.reference && <> · {a.reference}</>}
                              </div>
                              {!a.is_active && a.void_reason && (
                                <div className="text-xs text-subtler mt-0.5">
                                  {t('partnerPayout.voidReason')}: {a.void_reason}
                                </div>
                              )}
                            </div>
                            {a.is_active && (() => {
                              const av = rowAction('ADJUST_VOID');
                              if (!av) return null;
                              if (!av.is_available && HIDDEN_REASONS.has(av.blocking_reason ?? '')) return null;
                              const btn = (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  startIcon={<Trash2 size={14} className="text-danger" />}
                                  disabled={!av.is_available}
                                  onClick={() => setVoidAdjustTarget(a)}
                                >
                                  {t('partnerPayout.adjustVoidAction')}
                                </Button>
                              );
                              if (av.is_available) return btn;
                              return (
                                <Tooltip content={blockingReasonText(av, t)} placement="top">
                                  <span>{btn}</span>
                                </Tooltip>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Devices — the part of "paid" that changes who owns what. */}
                    {transfers.rows.length > 0 && (
                      <div className="rounded-md border border-line overflow-hidden">
                        <div className="px-3 py-2 bg-surface text-sm font-medium flex items-center gap-2">
                          <Smartphone size={14} className="text-subtle" />
                          {t('partnerPayout.devices')}
                        </div>
                        {transfers.rows.map(d => (
                          <div key={d.transfer_id} className="px-3 py-2.5 border-t border-line">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">{d.asset_code ?? `#${d.asset_id}`}</span>
                              <Badge
                                color={d.source_type === 'PARTNER_PAYOUT' ? 'success' : 'warning'}
                                size="sm"
                              >
                                {t(`partnerPayout.transfer_${d.source_type}`, { defaultValue: d.source_type })}
                              </Badge>
                              <span className="flex-1" />
                              <span className="text-sm tabular-nums shrink-0">{fmtCurrency(d.cost_basis_after)}</span>
                            </div>
                            <div className="text-xs text-subtle mt-0.5">
                              {d.contract_code ?? '—'} · {t(`partnerPayout.owner_${d.from_owner_type}`, { defaultValue: d.from_owner_type ?? '—' })}
                              {' → '}
                              {t(`partnerPayout.owner_${d.to_owner_type}`, { defaultValue: d.to_owner_type })}
                              {' · '}
                              <DateTime value={d.created_at} showTime />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* History. */}
                    {log.rows.length > 0 && (
                      <div className="rounded-md border border-line overflow-hidden">
                        <div className="px-3 py-2 bg-surface text-sm font-medium">
                          {t('partnerPayout.history')}
                        </div>
                        {log.rows.map(l => (
                          <div key={l.log_id} className="px-3 py-2 border-t border-line text-sm">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">
                                {t(`partnerPayout.logAction_${l.action_code}`, { defaultValue: l.action_code })}
                              </span>
                              {l.settlement_code && (
                                <span className="text-subtle text-xs">{l.settlement_code}</span>
                              )}
                              <span className="flex-1" />
                              <span className="text-xs text-subtle">
                                {l.actor_name} · <DateTime value={l.created_at} showTime />
                              </span>
                            </div>
                            {l.note && <div className="text-xs text-subtle mt-0.5">{l.note}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {footerActions.length > 0 && (
                <div className="flex-none border-t border-line px-4 py-3 flex items-center gap-2 flex-wrap">
                  {footerActions.map(renderActionButton)}
                </div>
              )}
            </PageNavPanel>
          </div>

          <PayoutPayModal open={payOpen} detail={detail} onClose={() => setPayOpen(false)} />
          <PayoutVoidModal open={voidOpen} detail={detail} onClose={() => setVoidOpen(false)} />
          <PayoutReverseModal open={reverseOpen} detail={detail} onClose={() => setReverseOpen(false)} />
          <PayoutAdjustModal open={adjustOpen} detail={detail} onClose={() => setAdjustOpen(false)} />
          <PayoutAddSettlementModal
            open={addOpen}
            payoutId={payoutId}
            payoutCode={detail?.payout_code ?? ''}
            branchId={detail?.branch_id ?? null}
            onClose={() => setAddOpen(false)}
          />
          <PayoutRemoveSettlementModal
            open={!!removeTarget}
            payoutId={payoutId}
            payoutCode={detail?.payout_code ?? ''}
            settlement={removeTarget}
            onClose={() => setRemoveTarget(null)}
          />
          <PayoutAdjustVoidModal
            open={!!voidAdjustTarget}
            payoutId={payoutId}
            payoutCode={detail?.payout_code ?? ''}
            adjustment={voidAdjustTarget}
            onClose={() => setVoidAdjustTarget(null)}
          />
        </>
      )}
    </PageNav>
  );
}
