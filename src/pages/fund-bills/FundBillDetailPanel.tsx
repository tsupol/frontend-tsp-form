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
// it moves to. The shop's own rows and the fund company's own rows therefore sit
// in separate blocks — a shop never sees the company's, and folding them into
// one list would make the two totals impossible to read.
//
// The panel owns no routing and no page chrome — the host decides where it sits
// and what the header around it says, so the same component serves the desktop
// two-panel layout and the mobile detail stack.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Tooltip } from 'tsp-form';
import { useNavigate } from 'react-router-dom';
import {
  Building2, ExternalLink, FileQuestion, Plus, Smartphone, Store, Trash2, Wrench,
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
} from './useFundBills';
import {
  fundBillStatusColor,
  type FundBillAction,
  type FundBillLine,
  type FundBillStatus,
} from './fundBillTypes';
import { FundBillPayModal } from './FundBillPayModal';
import { FundBillVoidModal } from './FundBillVoidModal';
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
const WIRED_ACTIONS = new Set(['PAY', 'VOID', 'CREDIT_NOTE', 'ADD_LINE', 'CLAWBACK_COLLECT']);

/** Actions driven from a row rather than the footer. */
const ROW_ACTIONS = new Set(['ADD_SETTLEMENT', 'REMOVE_SETTLEMENT', 'REMOVE_LINE']);

/** One contract's worth of lines, as the shop's block groups them. */
interface ContractGroup {
  settlement_id: number | null;
  settlement_code: string | null;
  contract_id: number | null;
  contract_code: string | null;
  lines: FundBillLine[];
  net: number;
}

/** A line's contribution to the document's net: toward the party, or back. */
function signedAmount(line: FundBillLine): number {
  if (line.direction === 'MEMO') return 0;
  return line.direction === 'TO_PARTY' ? line.amount : -line.amount;
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
  const log = useFundBillLog(billId);
  const transfers = useFundBillDeviceTransfers(billId);

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

  /** Branch-facing lines: the shop's side of the document. */
  const branchLines = lines.rows.filter(l => l.party_type === 'BRANCH');
  /** Company-facing lines: the fund company's own commission and doc fee. */
  const companyLines = lines.rows.filter(l => l.party_type === 'COMPANY');
  /** Anything else the backend sends (holding top-ups, outside payees). */
  const otherLines = lines.rows.filter(
    l => l.party_type !== 'BRANCH' && l.party_type !== 'COMPANY',
  );

  const branchNet = branchLines.reduce((sum, l) => sum + signedAmount(l), 0);
  const companyNet = companyLines.reduce((sum, l) => sum + signedAmount(l), 0);

  /** Group the shop's contract lines by settlement; hand-entered lines belong
   *  to no contract and are listed on their own so the two never blur. */
  const contractGroups: ContractGroup[] = [];
  for (const line of branchLines) {
    if (line.is_manual) continue;
    let group = contractGroups.find(g => g.settlement_id === line.settlement_id);
    if (!group) {
      group = {
        settlement_id: line.settlement_id,
        settlement_code: line.settlement_code,
        contract_id: line.contract_id,
        contract_code: line.contract_code,
        lines: [],
        net: 0,
      };
      contractGroups.push(group);
    }
    group.lines.push(line);
    group.net += signedAmount(line);
  }
  const manualLines = branchLines.filter(l => l.is_manual);

  const footerActions = (actions?.actions ?? [])
    .filter(a => !ROW_ACTIONS.has(a.action_code))
    .filter(a => a.is_available || !HIDDEN_REASONS.has(a.blocking_reason ?? ''))
    .sort((a, b) => a.sort_order - b.sort_order);

  /** Is a row-level action offered at all right now? */
  const rowActionOk = (code: string) =>
    (actions?.actions ?? []).some(a => a.action_code === code && a.is_available);

  const runAction = (code: string) => {
    if (code === 'PAY') setPayOpen(true);
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

              {/* The two sides of the document. The shop's net is what gets
               *  transferred; the company's is recorded, never transferred —
               *  keeping them on separate tiles is what stops the two being
               *  read as one number. */}
              <div className="px-3 py-2.5 border-t border-line grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-subtle flex items-center gap-1">
                    <Store size={12} />{t('fundBill.branchNet')}
                  </div>
                  <div className="text-lg font-semibold tabular-nums">{fmtCurrency(branchNet)}</div>
                </div>
                <div>
                  <div className="text-xs text-subtle flex items-center gap-1">
                    <Building2 size={12} />{t('fundBill.companyNet')}
                  </div>
                  <div className="text-base font-semibold tabular-nums">{fmtCurrency(companyNet)}</div>
                </div>
                <div className="sm:text-right">
                  <div className="text-xs text-subtle">{t('fundBill.netAmount')}</div>
                  <div className="text-lg font-semibold tabular-nums">{fmtCurrency(bill.net_amount)}</div>
                  {bill.returned_net !== 0 && (
                    <>
                      <div className="text-xs text-subtle mt-1">{t('fundBill.netAfterReturns')}</div>
                      <div className="text-base font-semibold tabular-nums text-success-fg">
                        {fmtCurrency(bill.net_after_returns)}
                      </div>
                    </>
                  )}
                </div>
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

            {/* The shop's side, grouped by contract. */}
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
                              {fmtCurrency(group.net)}
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
                </>
              )}
            </div>

            {/* The fund company's own side — never shown to a shop, and never
             *  transferred: it is recorded as paid the moment the document is. */}
            {companyLines.length > 0 && (
              <div className="rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface flex items-center gap-2">
                  <Building2 size={14} className="text-subtle" />
                  <span className="text-sm font-medium">{t('fundBill.companyLines')}</span>
                  <span className="flex-1" />
                  <span className="text-sm tabular-nums font-medium">{fmtCurrency(companyNet)}</span>
                </div>
                {companyLines.map(renderLine)}
                <div className="px-3 py-2 border-t border-line text-xs text-subtle">
                  {t('fundBill.companyLinesHint')}
                </div>
              </div>
            )}

            {otherLines.length > 0 && (
              <div className="rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface text-sm font-medium">
                  {t('fundBill.otherLines')}
                </div>
                {otherLines.map(renderLine)}
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
        netAmount={removeSettlement?.net ?? 0}
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
