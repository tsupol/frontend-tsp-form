// One fund-money document, as the right-hand panel of the fund-bills page.
//
// Buttons come from `fn_fund_bill_available_actions` and nothing else: the
// document's status alone cannot tell whether this user is in the shop's payout
// pool, so drawing from status would offer actions that die on submit. Reasons
// that mean "not yours / not now" hide the button; reasons that are a state of
// the document itself (empty, negative, already paid) show it disabled with the
// reason on its tooltip, because that is something the user can act on.
//
// The lines carry two axes that must stay apart: whose money a line is
// (`owner_type`) and who it moves to (`party_type`). The boxes split on the
// second: the shop's box holds every line dealt with the shop, the company box
// holds the fund company's own share. Neither box is totalled here — the
// header carries the three figures the backend computes for what really moved
// (bank, fund book, company book; mig 1421), and nothing on this screen adds
// an amount to another.
//
// Money movements are listed one per row with their kind named and each of the
// three places signed from the view, so "−28,144 bank · −100 fund book ·
// +100 company book" reads as what it is. The slip strip sits only on rows
// that touched a bank (`bank_amount` non-null).
//
// The panel owns no routing and no page chrome — the host decides where it sits
// and what the header around it says, so the same component serves the desktop
// two-panel layout and the mobile detail stack.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Tooltip } from 'tsp-form';
import { Link } from 'react-router-dom';
import {
  Building2, ExternalLink, FileQuestion, Landmark, Plus, Smartphone, Store, Trash2, Wallet, Wrench,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { EntityCodeLink } from '../../components/EntityCodeLink';
import { fmtCurrency, formatEntityCode } from '../../lib/format';
import { blockingReasonText } from '../../lib/apiErrors';
import {
  useFundBill,
  useFundBillActions,
  useFundBillClearings,
  useFundBillDeviceTransfers,
  useFundBillLines,
  useFundBillLog,
  useFundBillPayments,
  useFundBillSettlements,
  useFundBillIdByCode,
} from './useFundBills';
import {
  fundBillStatusColor,
  type FundBillAction,
  type FundBillLine,
  type FundBillPayment,
  type FundBillStatus,
} from './fundBillTypes';
import { FundBillPayModal } from './FundBillPayModal';
import { FundBillVoidModal } from './FundBillVoidModal';
import { FundBillIssueModal } from './FundBillIssueModal';
import { FundBillCreditNoteModal } from './FundBillCreditNoteModal';
import { FundBillAddLineModal } from './FundBillAddLineModal';
import { FundBillRemoveLineModal } from './FundBillRemoveLineModal';
import { FundBillAddSettlementModal } from './FundBillAddSettlementModal';
import { FundBillRemoveSettlementModal } from './FundBillRemoveSettlementModal';
import { FundClawbackCollectModal } from '../fund-clawback/FundClawbackCollectModal';
import { FundPaymentEvidence } from './FundPaymentEvidence';

/** Reasons that mean the button has no business being on screen at all. */
const HIDDEN_REASONS = new Set(['status_not_allowed', 'permission_denied', 'not_in_pool']);

/** Actions with a modal here. Anything else the backend adds shows as not-wired. */
const WIRED_ACTIONS = new Set(['ISSUE', 'PAY', 'VOID', 'CREDIT_NOTE', 'ADD_LINE', 'CLAWBACK_COLLECT']);

/** A commission document's lines are the released tranches and nothing else —
 *  the backend allows no hand-entered or added rows on it (mig 1401). */
const NO_EDIT_PURPOSE_ACTIONS = new Set(['ADD_LINE', 'ADD_SETTLEMENT', 'REMOVE_LINE', 'REMOVE_SETTLEMENT']);

/** Actions driven from a row rather than the footer. */
const ROW_ACTIONS = new Set(['ADD_SETTLEMENT', 'REMOVE_SETTLEMENT', 'REMOVE_LINE']);

/** One contract's worth of lines, as the shop's block groups them. */
interface ContractGroup {
  settlement_id: number | null;
  settlement_code: string | null;
  contract_id: number | null;
  contract_code: string | null;
  lines: FundBillLine[];
}

interface FundBillDetailPanelProps {
  billId: number | null;
  /** Mobile stacks the panels, so the rail is not on screen beside it. */
  isMobile: boolean;
}

export function FundBillDetailPanel({ billId, isMobile }: FundBillDetailPanelProps) {
  const { t, i18n } = useTranslation();

  const { bill, isLoading, isFetched } = useFundBill(billId);
  const creditNoteId = useFundBillIdByCode(bill?.credit_note_code ?? null);
  // A credit note points at the document it undoes; name it so finance can go back.
  const isCreditNote = bill?.bill_type === 'CREDIT_NOTE';
  const { bill: reversedBill } = useFundBill(isCreditNote ? bill?.ref_bill_id ?? null : null);
  const { actions } = useFundBillActions(billId);
  // A typed or stale id resolves to no row. Without this the page renders an
  // empty shell that reads as broken rather than "there is no such document".
  const notFound = isFetched && !bill;
  const lines = useFundBillLines(billId);
  const clearings = useFundBillClearings(billId);
  const payments = useFundBillPayments(billId);
  const log = useFundBillLog(billId);
  const transfers = useFundBillDeviceTransfers(billId);
  const settlements = useFundBillSettlements(
    lines.rows.flatMap(l => (l.settlement_id != null ? [l.settlement_id] : [])),
  );

  const [issueOpen, setIssueOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [creditNoteOpen, setCreditNoteOpen] = useState(false);
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [addSettlementOpen, setAddSettlementOpen] = useState(false);
  const [removeSettlement, setRemoveSettlement] = useState<ContractGroup | null>(null);
  const [removeLine, setRemoveLine] = useState<FundBillLine | null>(null);
  const [collectOpen, setCollectOpen] = useState(false);

  /** The backend ships Thai names on every row; English falls back to the code. */
  const statusLabel = (code: FundBillStatus) =>
    (i18n.language === 'th' && bill?.status_name)
      ? bill.status_name
      : t(`fundBill.status_${code}`, { defaultValue: code });

  /**
   * Split by who the money moves to. The shop's box is every line dealt with
   * the shop — its lines add up to the shop's figure on its payment request —
   * and the company's own share (its commission) stands in a box of its own.
   */
  const branchLines = lines.rows.filter(l => l.party_type === 'BRANCH');
  const companyLines = lines.rows.filter(l => l.party_type === 'COMPANY');
  /** Lines dealt with anyone else (a vendor on an expense, the fund itself). */
  const otherLines = lines.rows.filter(l => l.party_type !== 'BRANCH' && l.party_type !== 'COMPANY');
  const documentLines = [...branchLines, ...otherLines];

  /** Money has moved once the document is paid; before that the three
   *  movement figures are all zero and the document's own amount is the one
   *  that means something. */
  const moneyMoved = bill?.status === 'PAID' || bill?.status === 'PARTIAL';

  /** A signed figure from the view, as the view signs it. Null = untouched. */
  const signed = (n: number | null | undefined) =>
    n == null ? '—' : `${n > 0 ? '+' : ''}${fmtCurrency(n)}`;
  const signedClass = (n: number | null | undefined) =>
    n == null ? 'text-subtler' : n < 0 ? 'text-danger-fg' : n > 0 ? 'text-success-fg' : '';

  /** The line's name; a commission says whose and carries its rate. */
  const lineName = (line: FundBillLine) => {
    const base = i18n.language === 'th' && line.line_type_name
      ? line.line_type_name
      : t(`fundBill.lineType_${line.line_type}`, { defaultValue: line.line_type });
    if (line.line_type === 'COMMISSION') {
      const who = line.party_type === 'COMPANY'
        ? t('fundBill.commissionCompany') : t('fundBill.commissionShop');
      return line.rate_percent != null ? `${who} ${Number(line.rate_percent)}%` : who;
    }
    return base;
  };

  /** A movement's name: the view's Thai, else the kind's own label. */
  const paymentName = (p: FundBillPayment) =>
    i18n.language === 'th' && p.payment_kind_name
      ? p.payment_kind_name
      : t(`fundBill.paymentKind_${p.payment_kind}`, { defaultValue: p.payment_kind });

  /** Group the contract lines by settlement; hand-entered lines belong to no
   *  contract and are listed on their own so the two never blur. */
  const contractGroups: ContractGroup[] = [];
  for (const line of documentLines) {
    if (line.is_manual) continue;
    let group = contractGroups.find(g => g.settlement_id === line.settlement_id);
    if (!group) {
      group = {
        settlement_id: line.settlement_id,
        settlement_code: line.settlement_code,
        contract_id: line.contract_id,
        contract_code: line.contract_code,
        lines: [],
      };
      contractGroups.push(group);
    }
    group.lines.push(line);
  }
  /** Each contract's figure is its payment request's own net — what the shop
   *  gets for it. Never the lines added up: that counts the company's
   *  commission as going to the shop (lessons-learned §9). */
  const settlementNet = (id: number | null) =>
    settlements.rows.find(s => s.settlement_id === id)?.net_amount ?? null;
  const manualLines = documentLines.filter(l => l.is_manual);
  /** One product per contract on a payout: the group's product is its lines'. */
  const groupProduct = (group: ContractGroup) =>
    group.lines.find(l => l.product_display_name)?.product_display_name ?? null;

  const isCommissionExtra = bill?.bill_purpose === 'COMMISSION_EXTRA';
  const purposeAllows = (code: string) => !(isCommissionExtra && NO_EDIT_PURPOSE_ACTIONS.has(code));

  const footerActions = (actions?.actions ?? [])
    .filter(a => !ROW_ACTIONS.has(a.action_code))
    .filter(a => purposeAllows(a.action_code))
    .filter(a => a.is_available || !HIDDEN_REASONS.has(a.blocking_reason ?? ''))
    .sort((a, b) => a.sort_order - b.sort_order);

  /** Is a row-level action offered at all right now? */
  const rowActionOk = (code: string) =>
    purposeAllows(code)
    && (actions?.actions ?? []).some(a => a.action_code === code && a.is_available);

  const runAction = (code: string) => {
    if (code === 'ISSUE') setIssueOpen(true);
    else if (code === 'PAY') setPayOpen(true);
    else if (code === 'VOID') setVoidOpen(true);
    else if (code === 'CREDIT_NOTE') setCreditNoteOpen(true);
    else if (code === 'ADD_LINE') setAddLineOpen(true);
    else if (code === 'CLAWBACK_COLLECT') setCollectOpen(true);
  };

  const renderActionButton = (a: FundBillAction) => {
    const label = t(`fundBill.action_${a.action_code}`, { defaultValue: a.action_code });
    const wired = WIRED_ACTIONS.has(a.action_code);
    const lines: string[] = [label];
    let endIcon: React.ReactNode = undefined;

    if (!wired) {
      endIcon = <Wrench size={12} />;
      lines.push(t('contract.actionNotImplemented'));
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
          color={a.action_code === 'VOID' || a.action_code === 'CREDIT_NOTE' ? 'danger' : undefined}
          endIcon={endIcon}
          disabled={!a.is_available || !wired}
          onClick={() => runAction(a.action_code)}
        >
          {label}
        </Button>
      </Tooltip>
    );
  };

  /** One money line, the same shape in every block. */
  const renderLine = (line: FundBillLine) => (
    <div key={line.line_id} className="px-3 py-2 border-t border-line flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm truncate">{lineName(line)}</span>
          {line.is_manual && (
            <Badge color="warning" size="sm">{t('fundBill.manualLine')}</Badge>
          )}
          {/* Line kinds no longer say whose money it is — the owner does. */}
          {line.owner_type === 'COMPANY' && (
            <Badge color="info" size="sm">{t('fundBill.ownerShare_COMPANY')}</Badge>
          )}
          <span className="flex-1" />
          <span
            className={`text-sm tabular-nums shrink-0 ${
              line.direction === 'FROM_PARTY' ? 'text-danger-fg' : ''
            }`}
          >
            {line.direction === 'FROM_PARTY' ? '−' : ''}{fmtCurrency(line.amount)}
          </span>
        </div>
        {(line.reason_code || line.note) && (
          <div className="text-xs text-subtle mt-0.5">
            {line.reason_code && (
              <>{t(`fundBill.reason_${line.reason_code}`, { defaultValue: line.reason_code })}</>
            )}
            {line.reason_code && line.note && ' · '}
            {line.note}
          </div>
        )}
      </div>
      {line.is_manual && rowActionOk('REMOVE_LINE') && (
        <Button
          size="sm"
          variant="outline"
          startIcon={<Trash2 size={14} className="text-danger" />}
          onClick={() => setRemoveLine(line)}
        />
      )}
    </div>
  );

  return (
    <>
      {/* Desktop keeps a header of its own: the rail beside it shows a list of
       *  codes, so the panel has to say which one is open. Mobile gets the code
       *  from the page's own header and would only repeat it here. */}
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-medium truncate">{bill?.bill_code ?? ''}</span>
          {bill && <CopyButton value={bill.bill_code} size={14} className="shrink-0" />}
          {bill && (
            <Badge color={fundBillStatusColor(bill.status)} size="sm">
              {statusLabel(bill.status)}
            </Badge>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto better-scroll px-4 py-3">
        {isLoading && !bill && (
          <div className="p-8 text-center text-subtler">{t('common.loading', { defaultValue: 'Loading…' })}</div>
        )}

        {notFound && (
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <FileQuestion size={40} className="text-subtler" />
            <div className="text-subtler">{t('fundBill.notFound')}</div>
          </div>
        )}

        {bill && (
          <div className="max-w-4xl mx-auto flex flex-col gap-4">
            {/* A reversed document keeps its status and its amounts — the only
             *  sign it was undone is this flag, so it has to be loud. */}
            {isCreditNote && bill.ref_bill_id != null && (
              <div className="alert alert-info">
                <span>
                  {t('fundBill.creditNoteOfBanner')}{' '}
                  <EntityCodeLink to={`/admin/fund-bills/${bill.ref_bill_id}`} code={reversedBill?.bill_code ?? `#${bill.ref_bill_id}`} />
                </span>
              </div>
            )}
            {bill.is_reversed && (
              <div className="alert alert-warning">
                <span>
                  {t('fundBill.reversedBanner')}
                  {bill.credit_note_code && <> · <EntityCodeLink
                    to={creditNoteId != null ? `/admin/fund-bills/${creditNoteId}` : null}
                    code={bill.credit_note_code}
                  /></>}
                </span>
              </div>
            )}

            {/* Header card — the shop, the purpose, the money. */}
            <div className="@container/hdr rounded-md border border-line overflow-hidden">
              <div className="px-3 py-2.5 bg-surface flex items-center gap-2 flex-wrap">
                <span className="font-medium">{bill.branch_name ?? bill.company_name ?? '—'}</span>
                <Badge color={fundBillStatusColor(bill.status)} size="sm">
                  {statusLabel(bill.status)}
                </Badge>
                <Badge color="default" size="sm">
                  {i18n.language === 'th' && bill.purpose_name
                    ? bill.purpose_name
                    : t(`fundBill.purpose_${bill.bill_purpose}`, { defaultValue: bill.bill_purpose })}
                </Badge>
                <span className="flex-1" />
                <span className="text-xs text-subtle">
                  <DateTime value={bill.bill_date} showTime={false} />
                </span>
              </div>

              {/* What really moved, each place signed as its book sees it.
               *  Not the document's own net: that differs from the bank by the
               *  company's money the shop kept, and read as "paid" it looked
               *  like an overpayment. Before payment nothing has moved, so the
               *  document's amount is the figure. */}
              {moneyMoved ? (
                <>
                  {/* Three places money sits, read as one strip: equal weight,
                   *  each with its own icon, a thin divider between them. Which
                   *  one it is comes from the icon + label, not the size; the
                   *  in/out colour on the number carries direction. */}
                  <div className="border-t border-line grid grid-cols-1 @[22rem]/hdr:grid-cols-3 divide-y @[22rem]/hdr:divide-y-0 @[22rem]/hdr:divide-x divide-line">
                    {([
                      { icon: Landmark, label: t('fundBill.bankNet'), value: bill.bank_net },
                      { icon: Wallet, label: t('fundBill.fundBookNet'), value: bill.fund_book_net },
                      { icon: Building2, label: t('fundBill.companyBookNet'), value: bill.company_book_net },
                    ] as const).map(({ icon: Icon, label, value }) => (
                      <div key={label} className="px-3 py-2.5 flex flex-col gap-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-xs text-subtle min-w-0">
                          <Icon size={13} className="shrink-0" />
                          <span className="truncate">{label}</span>
                        </div>
                        <div className={`text-lg font-semibold tabular-nums ${signedClass(value)}`}>
                          {signed(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {bill.returned_net !== 0 && (
                    <div className="px-3 py-2 border-t border-line flex items-center gap-2 text-sm">
                      <span className="text-subtle">{t('fundBill.netAfterReturns')}</span>
                      <span className="flex-1" />
                      <span className="font-semibold tabular-nums text-success-fg">
                        {fmtCurrency(bill.net_after_returns)}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="px-3 py-2.5 border-t border-line flex items-end gap-5 flex-wrap">
                  <div>
                    <div className="text-xs text-subtle">{t('fundBill.documentAmount')}</div>
                    <div className="text-xl font-semibold tabular-nums">{fmtCurrency(bill.net_amount)}</div>
                  </div>
                  {bill.returned_net !== 0 && (
                    <div>
                      <div className="text-xs text-subtle">{t('fundBill.netAfterReturns')}</div>
                      <div className="text-base font-semibold tabular-nums text-success-fg">
                        {fmtCurrency(bill.net_after_returns)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {bill.void_reason && (
                <div className="px-3 py-2.5 border-t border-line text-sm">
                  <span className="text-subtle">{t('fundBill.voidReason')}: </span>
                  {bill.void_reason}
                </div>
              )}
              {bill.note && (
                <div className="px-3 py-2.5 border-t border-line text-sm">
                  <span className="text-subtle">{t('fundBill.note')}: </span>
                  {bill.note}
                </div>
              )}
            </div>

            {/* A commission document: one line per released tranche, each its
             *  own contract. No payment requests, so nothing to group by. */}
            {isCommissionExtra && (
              <div className="rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface flex items-center gap-2">
                  <Store size={14} className="text-subtle" />
                  <span className="text-sm font-medium">
                    {t('shopCommission.billTranches', { count: documentLines.length })}
                  </span>
                </div>
                {documentLines.length === 0 ? (
                  <div className="p-6 text-center text-subtler text-sm">{t('fundBill.noLinesYet')}</div>
                ) : documentLines.map(line => (
                  <div key={line.line_id} className="px-3 py-2 border-t border-line">
                    <div className="flex items-center gap-2">
                      {line.contract_id ? (
                        <Link
                          to={`/admin/contracts/search/${line.contract_id}`}
                          className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
                        >
                          {formatEntityCode(line.contract_code)}
                          <ExternalLink size={12} />
                        </Link>
                      ) : (
                        <span className="text-sm">—</span>
                      )}
                      {line.installments_paid != null && (
                        <Badge color="default" size="sm">
                          {t('shopCommission.payNoN', { n: line.installments_paid })}
                          {line.tier_pct != null && ` · ${Number(line.tier_pct)}%`}
                        </Badge>
                      )}
                      <span className="flex-1" />
                      <span className="text-sm tabular-nums shrink-0">{fmtCurrency(line.amount)}</span>
                    </div>
                    {(line.product_display_name || line.note) && (
                      <div className="text-xs text-subtle mt-0.5">
                        {line.product_display_name}
                        {line.product_display_name && line.note && ' · '}
                        {line.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* The document's lines, grouped by contract. */}
            {!isCommissionExtra && (
            <div className="rounded-md border border-line overflow-hidden">
              <div className="px-3 py-2 bg-surface flex items-center gap-2">
                <Store size={14} className="text-subtle" />
                <span className="text-sm font-medium">
                  {t('fundBill.branchLines', { count: contractGroups.length })}
                </span>
                <span className="flex-1" />
                {rowActionOk('ADD_SETTLEMENT') && (
                  <Button
                    size="sm"
                    variant="outline"
                    startIcon={<Plus size={14} />}
                    onClick={() => setAddSettlementOpen(true)}
                  >
                    {t('fundBill.addSettlement')}
                  </Button>
                )}
              </div>

              {contractGroups.length === 0 && manualLines.length === 0 ? (
                <div className="p-6 text-center text-subtler text-sm">
                  {t('fundBill.noLinesYet')}
                </div>
              ) : (
                <>
                  {contractGroups.map(group => (
                    <div key={group.settlement_id ?? 'none'} className="border-t border-line">
                      <div className="px-3 py-2 bg-surface-shallow flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {/* The payment request opens its own review page —
                             *  a real link so it honours ctrl/middle-click. */}
                            {group.settlement_id != null ? (
                              <Link
                                to={`/admin/partner-settlements/${group.settlement_id}`}
                                className="font-medium text-sm truncate text-primary-fg hover:underline inline-flex items-center gap-1"
                              >
                                {group.settlement_code ?? '—'}
                                <ExternalLink size={12} className="shrink-0" />
                              </Link>
                            ) : (
                              <span className="font-medium text-sm truncate">
                                {group.settlement_code ?? '—'}
                              </span>
                            )}
                            <span className="flex-1" />
                            <span className="text-sm tabular-nums shrink-0 font-medium">
                              {fmtCurrency(settlementNet(group.settlement_id))}
                            </span>
                          </div>
                          {/* The contract is where finance goes to check what was
                           *  actually sold, so the code is the link — no separate
                           *  action button for it. */}
                          {group.contract_id && (
                            <Link
                              to={`/admin/contracts/search/${group.contract_id}`}
                              className="text-sm text-primary-fg hover:underline inline-flex items-center gap-1 mt-0.5"
                            >
                              {formatEntityCode(group.contract_code)}
                              <ExternalLink size={12} />
                            </Link>
                          )}
                          {groupProduct(group) && (
                            <div className="text-xs text-subtle mt-0.5 truncate">{groupProduct(group)}</div>
                          )}
                        </div>
                        {rowActionOk('REMOVE_SETTLEMENT') && (
                          <Button
                            size="sm"
                            variant="outline"
                            startIcon={<Trash2 size={14} className="text-danger" />}
                            onClick={() => setRemoveSettlement(group)}
                          >
                            {t('fundBill.removeSettlement')}
                          </Button>
                        )}
                      </div>
                      {group.lines.map(renderLine)}
                    </div>
                  ))}

                  {manualLines.length > 0 && (
                    <div className="border-t border-line">
                      <div className="px-3 py-2 bg-surface-shallow text-sm font-medium">
                        {t('fundBill.manualLines')}
                      </div>
                      {manualLines.map(renderLine)}
                    </div>
                  )}

                </>
              )}
            </div>
            )}

            {/* The fund company's own share — its commission on the contracts.
             *  It never reaches the shop: it moves from the fund's book to the
             *  company's, which the movement list below shows as one row. */}
            {companyLines.length > 0 && (
              <div className="rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface flex items-center gap-2">
                  <Building2 size={14} className="text-subtle" />
                  <span className="text-sm font-medium">{t('fundBill.companyLines')}</span>
                </div>
                {companyLines.map(line => (
                  <div key={line.line_id} className="px-3 py-2 border-t border-line">
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate">{lineName(line)}</span>
                      <span className="flex-1" />
                      <span
                        className={`text-sm tabular-nums shrink-0 ${
                          line.direction === 'FROM_PARTY' ? 'text-danger-fg' : ''
                        }`}
                      >
                        {line.direction === 'FROM_PARTY' ? '−' : ''}{fmtCurrency(line.amount)}
                      </span>
                    </div>
                    {(line.contract_code || line.product_display_name) && (
                      <div className="text-xs text-subtle mt-0.5 truncate">
                        {line.contract_code && formatEntityCode(line.contract_code)}
                        {line.contract_code && line.product_display_name && ' · '}
                        {line.product_display_name}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Documents that cleared this one — a buyback, a clawback. */}
            {clearings.rows.length > 0 && (
              <div className="rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface text-sm font-medium">
                  {t('fundBill.clearings')}
                </div>
                {clearings.rows.map(c => (
                  <Link
                    key={c.clearing_bill_id}
                    to={`/admin/fund-bills/${c.clearing_bill_id}`}
                    className="block w-full text-left px-3 py-2.5 border-t border-line"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-primary-fg">{c.clearing_bill_code}</span>
                      <Badge color={fundBillStatusColor(c.status)} size="sm">
                        {t(`fundBill.status_${c.status}`, { defaultValue: c.status })}
                      </Badge>
                      <span className="flex-1" />
                      <span className="text-sm tabular-nums shrink-0">{fmtCurrency(c.net_amount)}</span>
                    </div>
                    <div className="text-xs text-subtle mt-0.5">
                      {i18n.language === 'th' && c.purpose_name
                        ? c.purpose_name
                        : t(`fundBill.purpose_${c.bill_purpose}`, { defaultValue: c.bill_purpose })}
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* Money movements, one row per place money went. Each row says
             *  what it is and signs the three places from the view — the
             *  bank, the fund's book, the company's book — so a withheld amount
             *  reads as "left the fund's book, entered the company's", not as
             *  a second payment to the shop. */}
            {payments.rows.length > 0 && (
              <div className="@container rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface text-sm font-medium">
                  {t('fundBill.payments')}
                </div>
                {/* Column headers only once the panel is wide enough to run as a
                 *  table; on a narrow panel each row stacks its own labels. */}
                <div className="hidden @md:grid px-3 py-1.5 border-t border-line grid-cols-[1fr_auto_auto_auto] gap-x-3 text-xs text-subtle">
                  <span />
                  <span className="text-right w-24">{t('fundBill.colBank')}</span>
                  <span className="text-right w-24">{t('fundBill.colFundBook')}</span>
                  <span className="text-right w-24">{t('fundBill.colCompanyBook')}</span>
                </div>
                {payments.rows.map(p => (
                  <div key={p.payment_id} className={`px-3 py-2.5 border-t border-line ${p.voided_at ? 'opacity-60' : ''}`}>
                    <div className="@md:grid @md:grid-cols-[1fr_auto_auto_auto] @md:gap-x-3 @md:items-start">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {p.is_reversal && (
                            <Badge color="warning" size="sm">{t('fundBill.reversalRow')}</Badge>
                          )}
                          <span className="text-sm">{paymentName(p)}</span>
                          {p.voided_at && (
                            <Badge color="default" size="sm">{t('fundBill.paymentVoided')}</Badge>
                          )}
                        </div>
                        <div className="text-xs text-subtle mt-0.5 flex flex-wrap gap-x-3">
                          {p.party_name && <span>{p.party_name}</span>}
                          <span><DateTime value={p.paid_date} showTime={false} /></span>
                          <span>
                            {i18n.language === 'th' && p.method_name
                              ? p.method_name
                              : t(`fundBill.method_${p.method}`, { defaultValue: p.method })}
                          </span>
                          {p.dest_account_no && (
                            <span>{p.dest_bank_code} · {p.dest_account_no}</span>
                          )}
                          {p.reference && <span>{p.reference}</span>}
                        </div>
                      </div>
                      {/* Narrow: the three figures sit on their own line, each
                       *  labelled and wrapping, so the name keeps its width.
                       *  Wide: they become the three right-aligned columns. */}
                      {([
                        { label: t('fundBill.colBank'), value: p.bank_amount },
                        { label: t('fundBill.colFundBook'), value: p.fund_book_amount },
                        { label: t('fundBill.colCompanyBook'), value: p.company_book_amount },
                      ] as const).map(({ label, value }, i) => (
                        <div
                          key={label}
                          className={`flex items-baseline gap-1.5 text-sm tabular-nums @md:block @md:text-right @md:w-24 ${i === 0 ? 'mt-1.5 @md:mt-0' : ''}`}
                        >
                          <span className="text-xs text-subtle @md:hidden">{label}</span>
                          <span className={signedClass(value)}>{signed(value)}</span>
                        </div>
                      ))}
                    </div>

                    {/* A slip belongs to the movement, and only to one that
                     *  went through a bank — a book-to-book row has nothing to
                     *  photograph (bank_amount null ⇔ held_by NONE on every row
                     *  on DEV, 2026-10-12). A cancelled row is read-only; the
                     *  backend refuses an attach there. */}
                    {p.bank_amount != null && (
                      <div className="mt-2">
                        <FundPaymentEvidence
                          paymentId={p.payment_id}
                          canEdit={!p.voided_at && bill.status !== 'VOIDED'}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Devices — the part of "paid" that changes who owns what. */}
            {transfers.rows.length > 0 && (
              <div className="rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface text-sm font-medium flex items-center gap-2">
                  <Smartphone size={14} className="text-subtle" />
                  {t('fundBill.devices')}
                </div>
                {transfers.rows.map(d => (
                  <div key={d.transfer_id} className="px-3 py-2.5 border-t border-line">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{d.asset_code ?? `#${d.asset_id}`}</span>
                      <Badge color={d.source_type === 'FUND_BILL' ? 'success' : 'warning'} size="sm">
                        {t(`fundBill.transfer_${d.source_type}`, { defaultValue: d.source_type })}
                      </Badge>
                      <span className="flex-1" />
                      <span className="text-sm tabular-nums shrink-0">{fmtCurrency(d.cost_basis_after)}</span>
                    </div>
                    <div className="text-xs text-subtle mt-0.5">
                      {d.contract_code ? formatEntityCode(d.contract_code) : '—'} ·{' '}
                      {t(`fundBill.owner_${d.from_owner_type}`, { defaultValue: d.from_owner_type ?? '—' })}
                      {' → '}
                      {t(`fundBill.owner_${d.to_owner_type}`, { defaultValue: d.to_owner_type })}
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
                  {t('fundBill.history')}
                </div>
                {log.rows.map(l => (
                  <div key={l.log_id} className="px-3 py-2 border-t border-line text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">
                        {t(`fundBill.logAction_${l.action_code}`, { defaultValue: l.action_code })}
                      </span>
                      {l.settlement_id && (
                        <span className="text-subtle text-xs">#{l.settlement_id}</span>
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

      <FundBillIssueModal open={issueOpen} bill={bill} onClose={() => setIssueOpen(false)} onPay={() => setPayOpen(true)} />
      <FundBillPayModal open={payOpen} bill={bill} onClose={() => setPayOpen(false)} />
      <FundBillVoidModal open={voidOpen} bill={bill} onClose={() => setVoidOpen(false)} />
      <FundBillCreditNoteModal open={creditNoteOpen} bill={bill} onClose={() => setCreditNoteOpen(false)} />
      <FundBillAddLineModal open={addLineOpen} bill={bill} onClose={() => setAddLineOpen(false)} />
      <FundBillAddSettlementModal
        open={addSettlementOpen}
        billId={billId}
        billCode={bill?.bill_code ?? ''}
        branchId={bill?.branch_id ?? null}
        onClose={() => setAddSettlementOpen(false)}
      />
      <FundBillRemoveSettlementModal
        open={!!removeSettlement}
        billId={billId}
        billCode={bill?.bill_code ?? ''}
        settlementId={removeSettlement?.settlement_id ?? null}
        settlementCode={removeSettlement?.settlement_code ?? null}
        contractCode={removeSettlement?.contract_code ?? null}
        netAmount={settlementNet(removeSettlement?.settlement_id ?? null)}
        onClose={() => setRemoveSettlement(null)}
      />
      <FundBillRemoveLineModal
        open={!!removeLine}
        billId={billId}
        billCode={bill?.bill_code ?? ''}
        line={removeLine}
        onClose={() => setRemoveLine(null)}
      />
      <FundClawbackCollectModal
        open={collectOpen}
        bill={bill}
        onClose={() => setCollectOpen(false)}
      />
    </>
  );
}
