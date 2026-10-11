// One fund-money document, as the right-hand panel of the fund-bills page.
//
// Buttons come from `fn_fund_bill_available_actions` and nothing else: the
// document's status alone cannot tell whether this user is in the shop's payout
// pool, so drawing from status would offer actions that die on submit. Reasons
// that mean "not yours / not now" hide the button; reasons that are a state of
// the document itself (empty, negative, already paid) show it disabled with the
// reason on its tooltip, because that is something the user can act on.
//
// The lines carry two axes that must stay apart: whose money a line is, and who
// it moves to. Every row on a payout is a dealing with the shop, so they all sit
// in one list — the shop is shown its whole document, contract fee included.
//
// Whose money a row is decides only which book it lands in, and that shows as a
// breakdown under the list rather than as a second block. The contract fee is
// the case that makes this matter: it is one deduction from the shop, recorded
// as the fund company's income, so it appears once on the document and once in
// the company's book. An earlier version drew it twice; that was wrong.
//
// The panel owns no routing and no page chrome — the host decides where it sits
// and what the header around it says, so the same component serves the desktop
// two-panel layout and the mobile detail stack.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Tooltip } from 'tsp-form';
import { useNavigate } from 'react-router-dom';
import {
  Building2, ExternalLink, FileQuestion, Plus, Smartphone, Store, Trash2, Wallet, Wrench,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
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
  useFundBillBookLines,
  useFundBillSettlements,
} from './useFundBills';
import {
  fundBillStatusColor,
  type FundBillAction,
  type FundBillLine,
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
  const navigate = useNavigate();

  const { bill, isLoading, isFetched } = useFundBill(billId);
  const { actions } = useFundBillActions(billId);
  // A typed or stale id resolves to no row. Without this the page renders an
  // empty shell that reads as broken rather than "there is no such document".
  const notFound = isFetched && !bill;
  const lines = useFundBillLines(billId);
  const clearings = useFundBillClearings(billId);
  const payments = useFundBillPayments(billId);
  const bookLines = useFundBillBookLines(billId);
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
   * Every row of the document, in one list.
   *
   * A payout used to be split by who each row moves to, which drew the contract
   * fee twice — once as a deduction from the shop and once as the company's
   * receipt. The backend now emits it once, so the split is gone and the rows
   * read as what they are: one set of dealings with the shop.
   */
  const documentLines = lines.rows;

  /** The document's own total, as the backend states it. Never summed here:
   *  see the owner breakdown below for what re-deriving a money figure costs. */
  const documentNet = bill?.net_amount ?? 0;

  /**
   * What the document did to each money book, read from the book's own entries.
   *
   * ⛔ Do NOT derive this from the document's lines or its payment rows. Line
   * signs are written from the shop's end, so the company's items land on the
   * wrong side. Payment rows looked right but leave out that the company's share
   * also leaves the fund — on a two-contract payout (2026-10-07) they showed the
   * fund 3,010 better off than its book. The book entries are the books, so this
   * only groups them per book; no per-document total exists on the backend.
   */
  const ownerBreakdown = (() => {
    const byBook = new Map<string, number>();
    for (const e of bookLines.rows) {
      const owner = e.book_type === 'COMPANY' ? 'COMPANY' : 'HOLDING';
      byBook.set(owner, (byBook.get(owner) ?? 0) + e.signed_amount);
    }
    return [...byBook.entries()]
      .filter(([, net]) => net !== 0)
      .map(([owner, net]) => ({ owner, net }));
  })();

  /** Only once paid (no book entries before), and only when both books moved. */
  const showOwnerBreakdown = ownerBreakdown.length > 1;

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
          <span className="text-sm truncate">
            {i18n.language === 'th' && line.line_type_name
              ? line.line_type_name
              : t(`fundBill.lineType_${line.line_type}`, { defaultValue: line.line_type })}
          </span>
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
            {bill.is_reversed && (
              <div className="alert alert-warning">
                <span>
                  {t('fundBill.reversedBanner')}
                  {bill.credit_note_code && <> · {bill.credit_note_code}</>}
                </span>
              </div>
            )}

            {/* Header card — the shop, the purpose, the money. */}
            <div className="rounded-md border border-line overflow-hidden">
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

              {/* One total, because the document is one dealing. The split by
               *  whose money it is lives under the lines, where it explains the
               *  books rather than implying a second payment. */}
              <div className="px-3 py-2.5 border-t border-line flex items-end gap-4 flex-wrap">
                <div>
                  <div className="text-xs text-subtle">{t('fundBill.netAmount')}</div>
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
                        <button
                          type="button"
                          onClick={() => navigate(`/admin/contracts/search/${line.contract_id}`)}
                          className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                        >
                          {formatEntityCode(line.contract_code)}
                          <ExternalLink size={12} />
                        </button>
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
                    {line.note && <div className="text-xs text-subtle mt-0.5">{line.note}</div>}
                  </div>
                ))}
                <div className="border-t border-line bg-surface px-3 py-2 flex items-center gap-2">
                  <span className="text-sm font-medium">{t('fundBill.documentTotal')}</span>
                  <span className="flex-1" />
                  <span className="text-sm font-semibold tabular-nums">{fmtCurrency(documentNet)}</span>
                </div>
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
                            <span className="font-medium text-sm truncate">
                              {group.settlement_code ?? '—'}
                            </span>
                            <span className="flex-1" />
                            <span className="text-sm tabular-nums shrink-0 font-medium">
                              {fmtCurrency(settlementNet(group.settlement_id))}
                            </span>
                          </div>
                          {/* The contract is where finance goes to check what was
                           *  actually sold, so the code is the link — no separate
                           *  action button for it. */}
                          {group.contract_id && (
                            <button
                              type="button"
                              onClick={() => navigate(`/admin/contracts/search/${group.contract_id}`)}
                              className="text-sm text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer mt-0.5"
                            >
                              {formatEntityCode(group.contract_code)}
                              <ExternalLink size={12} />
                            </button>
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

                  {/* The document's own total, then whose money it was.
                   *  The second part is what explains a fund book that does not
                   *  match the bank: the company's share is withheld from the
                   *  single transfer, not sent separately. */}
                  <div className="border-t border-line bg-surface">
                    <div className="px-3 py-2 flex items-center gap-2">
                      <span className="text-sm font-medium">{t('fundBill.documentTotal')}</span>
                      <span className="flex-1" />
                      <span className="text-sm font-semibold tabular-nums">
                        {fmtCurrency(documentNet)}
                      </span>
                    </div>
                    {showOwnerBreakdown && (
                      <>
                        {ownerBreakdown.map(({ owner, net }) => (
                          <div
                            key={owner}
                            className="px-3 py-1.5 border-t border-line-subtle flex items-center gap-2"
                          >
                            {owner === 'COMPANY'
                              ? <Building2 size={12} className="text-subtle shrink-0" />
                              : <Wallet size={12} className="text-subtle shrink-0" />}
                            <span className="text-xs text-subtle truncate">
                              {t(`fundBill.ownerShare_${owner}`, { defaultValue: owner })}
                            </span>
                            <span className="flex-1" />
                            <span className="text-xs tabular-nums shrink-0">
                              {net > 0 ? '+' : ''}{fmtCurrency(net)}
                            </span>
                          </div>
                        ))}
                        <div className="px-3 py-2 border-t border-line-subtle text-xs text-subtle">
                          {t('fundBill.ownerShareHint')}
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            )}

            {/* Documents that cleared this one — a buyback, a clawback. */}
            {clearings.rows.length > 0 && (
              <div className="rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface text-sm font-medium">
                  {t('fundBill.clearings')}
                </div>
                {clearings.rows.map(c => (
                  <button
                    key={c.clearing_bill_id}
                    type="button"
                    onClick={() => navigate(`/admin/fund-bills/${c.clearing_bill_id}`)}
                    className="w-full text-left px-3 py-2.5 border-t border-line bg-transparent cursor-pointer"
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
                  </button>
                ))}
              </div>
            )}

            {/* The transfer rows. A paid payout has two: the shop's real
             *  transfer, and the company's internal one that touches no bank. */}
            {payments.rows.length > 0 && (
              <div className="rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface text-sm font-medium">
                  {t('fundBill.payments')}
                </div>
                {payments.rows.map(p => (
                  <div key={p.payment_id} className="px-3 py-2.5 border-t border-line">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm">{p.party_name ?? '—'}</span>
                      <Badge color={p.held_by === 'NONE' ? 'default' : 'info'} size="sm">
                        {i18n.language === 'th' && p.method_name
                          ? p.method_name
                          : t(`fundBill.method_${p.method}`, { defaultValue: p.method })}
                      </Badge>
                      {p.is_reversal && (
                        <Badge color="warning" size="sm">{t('fundBill.reversalRow')}</Badge>
                      )}
                      <span className="flex-1" />
                      <span className="text-sm tabular-nums shrink-0">{fmtCurrency(p.amount)}</span>
                    </div>
                    <div className="text-xs text-subtle mt-0.5 flex flex-wrap gap-x-3">
                      <span><DateTime value={p.paid_date} showTime={false} /></span>
                      {p.dest_account_no && (
                        <span>{p.dest_bank_code} · {p.dest_account_no}</span>
                      )}
                      {p.reference && <span>{p.reference}</span>}
                      {p.held_by === 'NONE' && <span>{t('fundBill.noBankMovement')}</span>}
                    </div>

                    {/* Evidence belongs to the movement, not the document. The
                     *  company's own row never touches a bank account, so there
                     *  is no slip to attach to it and the strip is left off.
                     *  A cancelled row is read-only — the backend refuses an
                     *  attach there. */}
                    {p.held_by !== 'NONE' && (
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
