import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Tooltip, PopOver } from 'tsp-form';
import { Printer, FileText, FilePlus, User, Package, PackagePlus, PackageCheck, Banknote, ExternalLink, ChevronDown, Phone, CheckCircle2, AlertTriangle, CalendarClock, Coins, Pencil, Download, Loader2, PauseCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '../../../lib/api';
import { DateTime } from '../../../components/DateTime';
import { CopyButton } from '../../../components/CopyButton';
import { useBillPdfDownload } from '../../../hooks/useBillPdfDownload';
import { BillReceipt } from '../../contracts/workspace/BillReceipt';
import { printWithMarker } from '../../../lib/printDoc';
import { fmtCurrency, formatTel } from '../../../lib/format';
import type {
  RepairOrder, RepairAvailableActions, RepairAction, RepairActionCode, RepairRenderDoc,
} from '../repairTypes';
import { SUB_STATE_COLOR, RESULT_COLOR } from '../repairTypes';
import type { BeMediaRepairDoc } from '../../../lib/beMedia';
import { RepairIntakeModal, RepairCloseModal } from './RepairFlowModals';
import {
  RepairChargeModal, RepairCostModal, RepairChargeNoticeModal,
  RepairPayModal, RepairRefundModal, RepairCancelModal, RepairDiscardModal, RepairDraftEditModal,
  RepairMarkCompletedModal, RepairUncompleteModal, RepairPickupSetModal, RepairNoteAddModal,
} from './RepairActionModals';
import { RepairDocPreviewModal } from './RepairDocPreviewModal';
import { RepairConditionPhotos } from './RepairConditionPhotos';
import { RepairTimeline } from './RepairTimeline';
import { PauseContractModal } from '../../contracts/PauseContractModal';

// fn_contract_check_pausable — just the slice the repair-page pause prompt needs.
interface PausableCheck {
  allowed: boolean;
  reason: string | null;
  contract: { contract_id: number; code_display: string; is_paused: boolean };
}

// Icon per action_code for the quick (primary) footer buttons.
const ACTION_ICON: Partial<Record<RepairActionCode, React.ReactNode>> = {
  INTAKE: <PackagePlus size={16} />,          // receive device in
  CHARGE_SET: <FileText size={16} />,         // build the charge sheet
  MARK_COMPLETED: <CheckCircle2 size={16} />, // tech marks the work done
  PAY: <Banknote size={16} />,                // collect payment
  CLOSE: <PackageCheck size={16} />,          // hand device back / close
};

// Quick (primary) actions — the forward step for each state, shown inline as
// filled buttons. Everything else (edit, cost, notice, refund, cancel, discard)
// drops into the "More" overflow so the footer stays a clean one-tap row.
// Same primary/more split as the AssetsPage footer. CHARGE_SET is deliberately
// NOT here — it lives inline in the charge-sheet section (in-context editing).
const QUICK_ACTIONS = new Set<RepairActionCode>(['INTAKE', 'MARK_COMPLETED', 'PAY', 'CLOSE']);
// Actions surfaced in-context (not in the footer at all): CHARGE_SET in the
// charge-sheet section, PICKUP_SET in the pickup metadata row, COST_SET in the
// internal cost band.
const INLINE_ACTIONS = new Set<RepairActionCode>(['CHARGE_SET', 'PICKUP_SET', 'COST_SET']);
const DANGER_ACTIONS = new Set<RepairActionCode>(['CANCEL', 'DISCARD', 'UNCOMPLETE']);

// One row of v_bills for a repair order (mig 685 added repair_order_id). Same
// shape as the contract bill list — INVOICE = charge, CREDIT_NOTE = refund.
interface RepairBillRow {
  id: number;
  code_display: string;
  bill_type: string;                    // INVOICE | CREDIT_NOTE
  bill_type_label_short: string | null;
  bill_purpose: string;
  bill_purpose_label: string | null;
  status: string;
  total_amount: number;
  paid_amount: number;
  bill_date: string;
  is_cancelled: boolean;
}

// One payment embedded on a bill (v_bill_detail.payments) — same subset the
// contract bill list renders under each bill.
interface BillPaymentEmbedded {
  id: number;
  method: string | null;
  amount: number;
  bank_name: string | null;
  reference: string | null;
  is_reversal: boolean;
}

function getBillStatusColor(status: string, isCancelled: boolean): 'success' | 'warning' | 'danger' | 'default' {
  if (isCancelled) return 'danger';
  switch (status) {
    case 'PAID': return 'success';
    case 'OPEN':
    case 'PARTIAL': return 'warning';
    case 'VOIDED': return 'danger';
    default: return 'default';
  }
}

export function RepairDetailPanel({
  order, isMobile, onRefresh,
}: {
  order: RepairOrder;
  isMobile: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeAction, setActiveAction] = useState<RepairActionCode | 'NOTE_ADD' | null>(null);
  const [previewDoc, setPreviewDoc] = useState<BeMediaRepairDoc | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [tab, setTab] = useState<'details' | 'money' | 'photos' | 'history'>('details');
  // Money tab holds two sub-tabs — same split as the contract Money tab:
  // ค่าซ่อม (charge sheet + internal cost) and บิล (the generated bills).
  const [moneySection, setMoneySection] = useState<'charges' | 'bills'>('charges');
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  // Data-driven action catalog — filtered to status + permissions by the BE.
  const { data: caps } = useQuery({
    queryKey: ['repair-actions', order.repair_order_id, order.status, order.sub_state],
    queryFn: () => apiClient.rpc<RepairAvailableActions>('fn_repair_available_actions', {
      p_repair_order_id: order.repair_order_id,
    }),
  });

  // Pause prompt — a contract device sent for repair should have its debt clock
  // frozen (no late fees / no dunning while the customer has no phone). Only for a
  // CUSTOMER_CONTRACT repair that's actually IN_REPAIR; the alert renders only when
  // the check RPC says allowed (self-hides on loaner-bound / already-paused /
  // pause-disabled). Never for shop-stock / walk-in (no contract to pause).
  const pauseEligible = order.repair_type === 'CUSTOMER_CONTRACT'
    && order.contract_id != null
    && order.status === 'IN_REPAIR';
  const { data: pausable } = useQuery({
    queryKey: ['repair-pause-check', order.contract_id],
    queryFn: () => apiClient.rpc<PausableCheck>('fn_contract_check_pausable', {
      p_contract_id: order.contract_id,
    }),
    enabled: pauseEligible,
    staleTime: 30 * 1000,
  });

  // Charge sheet preview (running lines) for IN_REPAIR+ orders.
  const { data: doc } = useQuery({
    queryKey: ['repair-render', order.repair_order_id, 'CHARGE_NOTICE', order.updated_at],
    queryFn: () => apiClient.rpc<RepairRenderDoc>('fn_repair_render', {
      p_repair_order_id: order.repair_order_id, p_doc_type: 'CHARGE_NOTICE',
    }),
    enabled: order.status !== 'DRAFT',
  });

  // Bills the system generated for this repair (fn_bill_repair_pay / _refund),
  // straight from v_bills — mig 685 added repair_order_id, so we filter the same
  // view the contract bill list uses (contract → ?contract_id, repair →
  // ?repair_order_id). INVOICE = charge, CREDIT_NOTE = refund. Only on the บิล
  // sub-tab of Money.
  const { data: bills = [] } = useQuery({
    queryKey: ['repair-bills', order.repair_order_id, order.updated_at],
    queryFn: () => apiClient.get<RepairBillRow[]>(
      `/v_bills?repair_order_id=eq.${order.repair_order_id}&order=bill_date.desc,id.desc`,
    ),
    enabled: tab === 'money' && moneySection === 'bills' && order.status !== 'DRAFT',
  });

  // Payments embedded per bill via v_bill_detail — method / bank / ref / VOID,
  // shown as a strip under each bill (same as the contract bill list). One
  // in.(...) round trip for all bills; the print path shares the same key.
  const billIdsKey = bills.map(b => b.id).join(',');
  const { data: paymentsByBill } = useQuery<Record<number, BillPaymentEmbedded[]>>({
    queryKey: ['repair-bill-payments', order.repair_order_id, billIdsKey],
    enabled: billIdsKey.length > 0,
    queryFn: async () => {
      const rows = await apiClient.get<Array<{ bill_id: number; payments: BillPaymentEmbedded[] | null }>>(
        `/v_bill_detail?bill_id=in.(${billIdsKey})`,
      );
      const out: Record<number, BillPaymentEmbedded[]> = {};
      for (const r of rows) out[r.bill_id] = r.payments ?? [];
      return out;
    },
  });
  const { downloadingId, download: downloadBill } = useBillPdfDownload();

  // Per-bill browser print — mount the receipt off-screen for the chosen bill,
  // warm its queries, then window.print() isolated via the 'bill' marker. Same
  // portal pattern as BillsPage (Modal can't reach the @page box). One at a time.
  const [printBillId, setPrintBillId] = useState<number | null>(null);
  const printBill = async (billId: number | null) => {
    if (billId == null) return;
    try {
      const billRow = await queryClient.fetchQuery({
        queryKey: ['bill-detail', billId],
        queryFn: () => apiClient.get<{ branch_id?: number }[]>(`/v_bill_detail?bill_id=eq.${billId}`).then(rows => rows[0] ?? null),
      });
      const branchId = billRow?.branch_id;
      if (branchId != null) {
        await queryClient.fetchQuery({
          queryKey: ['branch-info', branchId],
          queryFn: () => apiClient.get(`/v_branches?id=eq.${branchId}&select=id,name,address`).then((rows: unknown) => (rows as unknown[])[0] ?? null),
        });
      }
    } catch { /* receipt shows its own loading state if warming fails */ }
    setPrintBillId(billId);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      printWithMarker('bill');
      setPrintBillId(null);
    }));
  };

  const actions = caps?.actions ?? [];

  // ATTACH_MEDIA is not a footer button — it maps to the self-serve condition-
  // photo album rendered in-context below (its own Add / Capture buttons, like
  // SellOut). We drive the album's editable state off this action's capability
  // when the RPC exposes it, and keep it out of the footer to avoid duplication.
  const attachMediaAction = actions.find(a => a.action_code === 'ATTACH_MEDIA');
  const photosEditable = attachMediaAction
    ? (attachMediaAction.is_permitted && attachMediaAction.blocking_reason === null)
    : (order.sub_state !== 'CLOSED' && order.sub_state !== 'VOIDED');

  // Footer = quick actions inline + everything else in "More". CHARGE_SET is
  // pulled out entirely (charge-sheet section); ATTACH_MEDIA is pulled out too
  // (the photo album owns it). PAY is hidden once the balance is cleared —
  // nothing left to collect (the action engine still returns it for overpayment).
  const footerActions = actions.filter(a =>
    !INLINE_ACTIONS.has(a.action_code)
    && a.action_code !== 'ATTACH_MEDIA'
    && !(a.action_code === 'PAY' && order.c_charge_balance <= 0));
  const quickActions = footerActions.filter(a => QUICK_ACTIONS.has(a.action_code));
  const moreActions = footerActions.filter(a => !QUICK_ACTIONS.has(a.action_code));

  // The CHARGE_SET action (surfaced inline in the charge-sheet section).
  const chargeAction = actions.find(a => a.action_code === 'CHARGE_SET');
  const chargeActionEnabled = !!chargeAction && chargeAction.is_permitted && chargeAction.blocking_reason === null;

  // The PICKUP_SET action (surfaced inline in the pickup metadata row — DRAFT only).
  const pickupAction = actions.find(a => a.action_code === 'PICKUP_SET');
  const pickupActionEnabled = !!pickupAction && pickupAction.is_permitted && pickupAction.blocking_reason === null;

  // The COST_SET action (internal repair cost — surfaced inline in the cost band,
  // staff-only, never printed). "Not recorded yet" gets a ⚠ so staff notice.
  const costAction = actions.find(a => a.action_code === 'COST_SET');
  const costActionEnabled = !!costAction && costAction.is_permitted && costAction.blocking_reason === null;
  const costRecorded = order.repair_cost != null;

  const pick = (code: RepairActionCode | 'NOTE_ADD') => { setActiveAction(code); setMoreOpen(false); };
  const close = () => setActiveAction(null);
  const done = () => { onRefresh(); };

  // pickup_days_left is a v_repair_worklist-only field; fn_repair_search (which
  // feeds this panel) returns v_repair_orders, which has pickup_deadline but not
  // days_left. Fall back to comparing the deadline date to today.
  const overdue = order.pickup_days_left != null
    ? order.pickup_days_left < 0
    : order.pickup_deadline != null && new Date(order.pickup_deadline) < new Date();

  const charges = doc?.charge_items ?? [];

  return (
    <div className="relative flex flex-col h-full min-w-0 overflow-hidden">
      {/* Header */}
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{order.code_display}</span>
          <CopyButton value={order.code_display} />
          <div className="ml-auto flex items-center gap-1">
            {order.intake_document_id != null && (
              <Tooltip content={t('repair.printIntake')}>
                <Button variant="ghost" size="sm" className="btn-icon-sm" startIcon={<Printer size={16} />} onClick={() => setPreviewDoc('INTAKE')} />
              </Tooltip>
            )}
            {order.c_charge_gross > 0 && (
              <Tooltip content={t('repair.printChargeNotice')}>
                <Button variant="ghost" size="sm" className="btn-icon-sm" startIcon={<FileText size={16} />} onClick={() => setPreviewDoc('CHARGE_NOTICE')} />
              </Tooltip>
            )}
            {order.close_document_id != null && (
              <Tooltip content={t('repair.printReturn')}>
                <Button variant="ghost" size="sm" className="btn-icon-sm" startIcon={<Package size={16} />} onClick={() => setPreviewDoc('RETURN')} />
              </Tooltip>
            )}
          </div>
        </div>
      )}

      {/* Tabs — right under the header. Details holds identity/summary/meta +
          symptom; money = ค่าซ่อม (charge sheet + cost) / บิล (bills) sub-tabs;
          photos = album; history = timeline. Mirrors the contract panel, which
          also groups charges + bills under one Money tab. */}
      <div className="flex-none flex items-center gap-1 px-3 border-b border-line">
        {(['details', 'money', 'photos', 'history'] as const).map(tk => (
          <button
            key={tk}
            type="button"
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
              tab === tk ? 'border-primary text-fg' : 'border-transparent text-subtle hover:text-fg'
            }`}
            onClick={() => setTab(tk)}
          >
            {t(`repair.tab_${tk}`)}
          </button>
        ))}
      </div>

      {/* Scrollable content — symptom, condition, charge sheet, cost, photos / history */}
      <div className="flex-1 overflow-auto better-scroll px-4 py-3 flex flex-col gap-4">
       {tab === 'history' ? (
        <RepairTimeline
          repairOrderId={order.repair_order_id}
          updatedAt={order.updated_at}
          onAddNote={() => pick('NOTE_ADD')}
        />
       ) : tab === 'photos' ? (
        <RepairConditionPhotos
          repairOrderId={order.repair_order_id}
          code={order.code_display}
          editable={photosEditable}
        />
       ) : tab === 'money' ? (
        <>
        {/* Sub-tabs — ค่าซ่อม (charge sheet + internal cost) / บิล (generated
            bills). Same money grouping as the contract detail panel. */}
        <div className="flex-none flex items-center gap-1 border-b border-line -mt-1">
          {(['charges', 'bills'] as const).map(sec => (
            <button
              key={sec}
              type="button"
              className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
                moneySection === sec ? 'border-primary text-fg' : 'border-transparent text-subtle hover:text-fg'
              }`}
              onClick={() => setMoneySection(sec)}
            >
              {t(`repair.moneySection_${sec}`)}
            </button>
          ))}
        </div>

        {moneySection === 'charges' ? (
        <>
        {/* Charge sheet — the CHARGE_SET action lives here (in-context), not in
            the footer. Shown whenever the action is available (even with 0 lines,
            so an IN_REPAIR order can start its sheet) or once lines exist. The
            edit button sits at the bottom-right, under the lines. */}
        {(chargeAction || charges.length > 0) ? (
          <div>
            {/* Summary — net (what the customer owes), paid, balance. Profit
                (net − internal cost) only when the cost is recorded. The bottom
                line up top; the itemized charge sheet below explains it. */}
            {order.c_charge_gross > 0 && (
              <div className="mb-3 rounded-md border border-line overflow-hidden text-sm">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-line">
                  <span className="text-subtle">{t('repair.chargeNet')}</span>
                  <span className="tabular-nums font-medium">{fmtCurrency(order.c_charge_net)}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-line">
                  <span className="text-subtle">{t('repair.paid')}</span>
                  <span className="tabular-nums">{fmtCurrency(order.c_charge_paid)}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-subtle">{order.c_charge_balance < 0 ? t('repair.refundDue') : t('repair.balance')}</span>
                  <span className={`tabular-nums font-semibold ${
                    order.c_charge_balance > 0 ? 'text-warning-fg' : order.c_charge_balance < 0 ? 'text-danger' : 'text-success'
                  }`}>{fmtCurrency(Math.abs(order.c_charge_balance))}</span>
                </div>
                {costRecorded && (
                  <div className="flex items-center justify-between px-3 py-1.5 border-t border-line bg-surface">
                    <span className="text-subtle inline-flex items-center gap-1">
                      <Coins size={12} className="shrink-0" />{t('repair.grossProfit')}
                    </span>
                    <span className={`tabular-nums font-semibold ${
                      order.c_charge_net - (order.repair_cost ?? 0) < 0 ? 'text-danger' : 'text-success'
                    }`}>{fmtCurrency(order.c_charge_net - (order.repair_cost ?? 0))}</span>
                  </div>
                )}
              </div>
            )}

            <div className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1">{t('repair.chargeSheet')}</div>
            {charges.length > 0 ? (
              <div className="rounded-md border border-line overflow-hidden">
                {charges.map((it, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-line last:border-b-0 text-sm">
                    <div className="min-w-0 flex items-center gap-2">
                      <Badge size="xs" color={it.item_type === 'CHARGE' ? 'default' : it.item_type === 'DISCOUNT' ? 'info' : 'warning'}>
                        {t(`repair.itemType_${it.item_type}`)}
                      </Badge>
                      <span className="truncate">{it.description}</span>
                    </div>
                    <span className={`tabular-nums shrink-0 ${it.amount < 0 ? 'text-danger' : ''}`}>{fmtCurrency(it.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-subtler">{t('repair.noChargesYet')}</p>
            )}

            {chargeAction && (
              <div className="flex justify-end mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  startIcon={<FilePlus size={14} />}
                  disabled={!chargeActionEnabled}
                  onClick={() => pick('CHARGE_SET')}
                >
                  {charges.length > 0 ? t('repair.editCharges') : t('repairActions.CHARGE_SET')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-subtler">{t('repair.noChargesYet')}</p>
        )}

        {/* Internal repair cost (staff-only, never on the customer's PDF). A ⚠
            flags "not recorded yet" so staff know the profit isn't captured. */}
        {(costAction || costRecorded) && (
          <div className="rounded-md border border-line px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Coins size={14} className="text-subtle shrink-0" />
              <span className="text-xs font-semibold text-subtle uppercase tracking-wider">{t('repair.costAxis')}</span>
              {costRecorded ? (
                <span className="ml-auto font-semibold tabular-nums text-sm">{fmtCurrency(order.repair_cost ?? 0)}</span>
              ) : (
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-warning-fg">
                  <AlertTriangle size={13} />{t('repair.costNotRecorded')}
                </span>
              )}
              {costAction && (
                <Button
                  variant={costRecorded ? 'ghost' : 'outline'}
                  size="sm"
                  className={costRecorded ? 'btn-icon-sm' : ''}
                  startIcon={costRecorded ? <Pencil size={14} /> : undefined}
                  disabled={!costActionEnabled}
                  onClick={() => pick('COST_SET')}
                >
                  {costRecorded ? undefined : t('repair.setCost')}
                </Button>
              )}
            </div>
            {order.cost_note && <p className="text-xs text-subtle mt-1.5">{order.cost_note}</p>}
            {order.work_note && <p className="text-sm mt-1.5 whitespace-pre-wrap">{order.work_note}</p>}
          </div>
        )}
        </>
        ) : (
        <>
        {/* Bills — the invoices/credit-notes the system generated for this
            repair (fn_bill_repair_pay / _refund), from v_bills. INVOICE = charge
            collected, CREDIT_NOTE = refund (negative). Click the code to open the
            bill, or download / print its receipt. Mirrors the contract bill list. */}
        {bills.length === 0 ? (
          <p className="text-sm text-subtler">{order.status === 'DRAFT' ? t('repair.noChargesYet') : t('common.noData')}</p>
        ) : (
          <div>
            <div className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1">{t('repair.bills')}</div>
            <div className="flex flex-col gap-2">
              {bills.map(bill => {
                const isRefund = bill.bill_type === 'CREDIT_NOTE';
                const signedTotal = isRefund ? -Math.abs(bill.total_amount) : bill.total_amount;
                const payments = paymentsByBill?.[bill.id] ?? [];
                return (
                  <div
                    key={bill.id}
                    className={`border border-line rounded-md px-3 py-2.5 ${bill.is_cancelled ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      {/* Left: code → purpose → badges, one stack */}
                      <div className="flex flex-col gap-1 min-w-0">
                        <Link
                          to={`/admin/accounting/bills/${bill.id}`}
                          className="font-mono text-xs text-primary-fg inline-flex items-center gap-1 no-underline hover:underline"
                        >
                          {bill.code_display}
                          <ExternalLink size={12} />
                        </Link>
                        <div className="text-sm truncate">{bill.bill_purpose_label ?? bill.bill_purpose}</div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge size="xs" color={isRefund ? 'warning' : 'default'}>
                            {t(`repair.billType_${bill.bill_type}`, { defaultValue: bill.bill_type_label_short ?? bill.bill_type })}
                          </Badge>
                          <Badge size="xs" color={getBillStatusColor(bill.status, bill.is_cancelled)}>
                            {bill.is_cancelled
                              ? t('contract.billStatus_CANCELLED', { defaultValue: 'Cancelled' })
                              : t(`contract.billStatus_${bill.status}`, { defaultValue: bill.status })}
                          </Badge>
                        </div>
                      </div>
                      {/* Right: amount + date top-aligned with the code, actions below */}
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className={`text-sm font-medium tabular-nums ${bill.is_cancelled ? 'line-through text-subtler' : isRefund ? 'text-danger' : ''}`}>
                          {fmtCurrency(signedTotal)}
                        </div>
                        <div className="text-xs text-subtle"><DateTime value={bill.bill_date} showTime={false} /></div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Tooltip content={t('repair.printBill')}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="btn-icon-sm"
                              startIcon={<Printer size={14} />}
                              onClick={() => printBill(bill.id)}
                              aria-label={t('repair.printBill')}
                            />
                          </Tooltip>
                          <Tooltip content={t('repair.downloadBill')}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="btn-icon-sm"
                              disabled={downloadingId === bill.id}
                              startIcon={downloadingId === bill.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                              onClick={() => downloadBill(bill.id)}
                              aria-label={t('repair.downloadBill')}
                            />
                          </Tooltip>
                        </div>
                      </div>
                    </div>

                    {payments.length > 0 && (
                      <div className="mt-2.5 pt-2.5 border-t border-line flex flex-col gap-1.5">
                        {payments.map(p => (
                          <div
                            key={p.id}
                            className={`flex items-center justify-between gap-3 text-xs ${p.is_reversal ? 'opacity-50 line-through' : ''}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-subtle">└</span>
                              <span>{p.method ? t(`wizard.method_${p.method}`, { defaultValue: p.method }) : '—'}</span>
                              {p.bank_name && <span className="text-subtle truncate">{p.bank_name}</span>}
                              {p.reference && <span className="text-subtle font-mono truncate">{p.reference}</span>}
                              {p.is_reversal && <Badge size="xs" color="danger">VOID</Badge>}
                            </div>
                            <span className="tabular-nums shrink-0">{fmtCurrency(p.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </>
        )}
        </>
       ) : (
        <>
        {/* Device — primary identity band */}
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium truncate">
            {order.asset_id != null ? (
              <Link to={`/admin/inventory/assets/${order.asset_id}`} className="inline-flex items-center gap-1 text-primary-fg hover:underline">
                {order.product_display_name ?? order.asset_code_display ?? '—'}
                <ExternalLink size={11} />
              </Link>
            ) : (
              order.product_display_name ?? '—'
            )}
            {order.master_color_name && <span className="text-subtle font-normal">· {order.master_color_name}</span>}
          </div>
          <div className="text-xs text-subtle font-mono truncate mt-0.5">
            {[order.serial_no, order.imei && `IMEI ${order.imei}`].filter(Boolean).join(' · ') || '—'}
          </div>
          <div className="flex items-center flex-wrap gap-1.5 mt-2">
            <Badge size="sm" color={SUB_STATE_COLOR[order.sub_state]}>{t(`repair.subState_${order.sub_state}`)}</Badge>
            <Badge size="sm" color="default">{t(`repair.type_${order.repair_type}`)}</Badge>
            {order.result && (
              <Badge size="sm" color={RESULT_COLOR[order.result]}>{t(`repair.result_${order.result}`)}</Badge>
            )}
          </div>
        </div>

        {/* Customer + contract cross-link */}
        <div className="flex items-center gap-2 text-sm">
          <User size={13} className="text-subtle shrink-0" />
          <span className="font-medium truncate">{order.customer_name ?? '—'}</span>
          {order.customer_tel && (
            <a
              href={`tel:${order.customer_tel.replace(/\D/g, '')}`}
              className="inline-flex items-center gap-1 text-xs text-subtle shrink-0 hover:text-fg tabular-nums"
            >
              <Phone size={11} className="shrink-0" />
              {formatTel(order.customer_tel)}
            </a>
          )}
          {order.contract_id != null && (
            <Link to={`/admin/contracts/search/${order.contract_id}`} className="ml-auto inline-flex items-center gap-1 text-xs text-primary-fg hover:underline shrink-0">
              {order.contract_code_display ?? t('repair.viewContract')}
              <ExternalLink size={10} />
            </Link>
          )}
        </div>

        {/* Pause prompt — only when the contract is genuinely pausable (check RPC
            allowed). Bridges the repair flow to the contract's pause: staff receive
            the device here, so nudge them to freeze the debt clock without leaving
            the page. Already-paused shows a quiet confirmation instead. */}
        {pauseEligible && pausable?.allowed && (
          <div className="alert alert-warning">
            <PauseCircle />
            <div>
              <div className="alert-title text-warning-fg">{t('repair.pausePromptTitle')}</div>
              <div className="alert-description">{t('repair.pausePromptHint')}</div>
            </div>
            <Button size="sm" color="primary" className="shrink-0 self-center ml-auto" onClick={() => setPauseOpen(true)}>
              {t('repair.pausePromptButton')}
            </Button>
          </div>
        )}
        {pauseEligible && pausable?.contract.is_paused && (
          <div className="alert alert-info">
            <PauseCircle />
            <div>
              <div className="alert-title text-info-fg">{t('repair.pauseAlreadyPaused')}</div>
            </div>
          </div>
        )}

        {/* Money — prominent stat band (once there's a charge sheet) */}
        {order.c_charge_gross > 0 && (
          <div className="grid grid-cols-3 gap-3 px-3 py-3 rounded-md border border-line bg-surface">
            <div>
              <div className="text-xs text-subtle">{t('repair.chargeNet')}</div>
              <div className="font-semibold text-base tabular-nums">{fmtCurrency(order.c_charge_net)}</div>
            </div>
            <div>
              <div className="text-xs text-subtle">{t('repair.paid')}</div>
              <div className="font-semibold text-base tabular-nums">{fmtCurrency(order.c_charge_paid)}</div>
            </div>
            <div>
              <div className="text-xs text-subtle">{order.c_charge_balance < 0 ? t('repair.refundDue') : t('repair.balance')}</div>
              <div className={`font-semibold text-base tabular-nums ${
                order.c_charge_balance > 0 ? 'text-warning-fg' : order.c_charge_balance < 0 ? 'text-danger' : 'text-success'
              }`}>{fmtCurrency(Math.abs(order.c_charge_balance))}</div>
            </div>
          </div>
        )}

        {/* Timeline metadata — a clean label/value list (was a cramped inline
            wrap that ran labels into their values). Three axes read from here:
            work (completed_by/at, repair_days) and delivery (pickup deadline). */}
        <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-subtler">{t('repair.branch')}</dt>
          <dd className="text-subtle">{order.branch_name}</dd>

          <dt className="text-subtler">{t('repair.created')}</dt>
          <dd className="text-subtle"><DateTime value={order.created_at} /></dd>

          {order.promised_date && <>
            <dt className="text-subtler">{t('repair.promised')}</dt>
            <dd className="text-subtle"><DateTime value={order.promised_date} showTime={false} /></dd>
          </>}

          {order.intake_at && <>
            <dt className="text-subtler">{t('repair.intakeAt')}</dt>
            <dd className="text-subtle"><DateTime value={order.intake_at} /></dd>
          </>}

          {order.completed_at && <>
            <dt className="text-subtler inline-flex items-center gap-1"><CheckCircle2 size={12} className="text-success shrink-0" />{t('repair.completedAt')}</dt>
            <dd className="text-success">
              <DateTime value={order.completed_at} />
              {order.completed_by_name && <div className="text-subtle">{t('repair.completedBy')}: {order.completed_by_name}</div>}
            </dd>
          </>}

          {order.repair_days != null && <>
            <dt className="text-subtler">{t('repair.repairDays')}</dt>
            <dd className="text-subtle">{t('repair.repairDaysValue', { days: order.repair_days })}</dd>
          </>}

          {order.pickup_deadline && order.status !== 'CLOSED' && order.status !== 'VOIDED' && <>
            <dt className="text-subtler inline-flex items-center gap-1"><CalendarClock size={12} className="shrink-0" />{t('repair.pickupDeadline')}</dt>
            <dd className={overdue ? 'text-danger' : 'text-subtle'}>
              <DateTime value={order.pickup_deadline} showTime={false} />
              {order.pickup_days_left != null && (
                <span> · {overdue ? t('repair.pickupOverdue', { days: -order.pickup_days_left }) : t('repair.pickupDaysLeft', { days: order.pickup_days_left })}</span>
              )}
            </dd>
          </>}

          {order.closed_at && <>
            <dt className="text-subtler">{t('repair.closedAt')}</dt>
            <dd className="text-subtle"><DateTime value={order.closed_at} /></dd>
          </>}

          {/* Pickup window is agreed at DRAFT (printed on the intake doc). Editable
              only while DRAFT — the action engine drops PICKUP_SET afterwards. */}
          {pickupAction && <>
            <dt className="text-subtler">{t('repair.pickupDays')}</dt>
            <dd className="text-subtle inline-flex items-center gap-1">
              {order.pickup_days ?? '—'}
              <Button variant="ghost" size="sm" className="btn-icon-xs" disabled={!pickupActionEnabled} startIcon={<CalendarClock size={12} />} onClick={() => pick('PICKUP_SET')} />
            </dd>
          </>}
        </dl>

        <hr className="border-line" />

        {order.status === 'VOIDED' && order.cancel_reason && (
          <div className="alert alert-danger">
            <span>{t('repair.cancelledReason')}: {order.cancel_reason}</span>
          </div>
        )}

        {order.repair_note && (
          <div>
            <div className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1">{t('repair.symptom')}</div>
            <p className="text-sm whitespace-pre-wrap">{order.repair_note}</p>
          </div>
        )}
        {order.condition_note && (
          <div>
            <div className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1">{t('repair.conditionNote')}</div>
            <p className="text-sm whitespace-pre-wrap">{order.condition_note}</p>
          </div>
        )}
        </>
       )}
      </div>

      {/* Data-driven action footer — quick actions inline + "More" overflow
          (same primary/more split as the AssetsPage footer). */}
      {footerActions.length > 0 && (
        <div className="flex-none border-t border-line px-4 py-3 flex flex-wrap items-center gap-2">
          {quickActions.map(a => (
            <ActionButton key={a.action_code} action={a} primary onClick={() => pick(a.action_code)} />
          ))}
          {moreActions.length > 0 && (
            <Button
              ref={moreTriggerRef}
              variant="outline"
              size="sm"
              endIcon={<ChevronDown size={14} />}
              onClick={() => setMoreOpen(v => !v)}
            >
              {t('contract.moreActions', { defaultValue: 'More' })}
            </Button>
          )}
          <PopOver
            isOpen={moreOpen}
            onClose={() => setMoreOpen(false)}
            triggerRef={moreTriggerRef}
            placement="top"
            align="end"
            maxWidth="28rem"
            maxHeight="60vh"
          >
            <div className="flex flex-wrap gap-2 p-3">
              {moreActions.map(a => (
                <ActionButton key={a.action_code} action={a} onClick={() => pick(a.action_code)} />
              ))}
            </div>
          </PopOver>
        </div>
      )}

      {/* Modals — one per action */}
      <RepairDraftEditModal open={activeAction === 'DRAFT_UPDATE'} onClose={close} order={order} onDone={done} />
      <RepairDiscardModal open={activeAction === 'DISCARD'} onClose={close} order={order} onDone={done} />
      <RepairIntakeModal open={activeAction === 'INTAKE'} onClose={close} order={order} onDone={done} />
      <RepairChargeModal open={activeAction === 'CHARGE_SET'} onClose={close} order={order} onChanged={done} />
      <RepairCostModal open={activeAction === 'COST_SET'} onClose={close} order={order} onDone={done} />
      <RepairPickupSetModal open={activeAction === 'PICKUP_SET'} onClose={close} order={order} onDone={done} />
      <RepairChargeNoticeModal open={activeAction === 'CHARGE_NOTICE'} onClose={close} order={order} onDone={(issued) => { done(); if (issued) setPreviewDoc('CHARGE_NOTICE'); }} />
      <RepairMarkCompletedModal open={activeAction === 'MARK_COMPLETED'} onClose={close} order={order} onDone={done} />
      <RepairUncompleteModal open={activeAction === 'UNCOMPLETE'} onClose={close} order={order} onDone={done} />
      <RepairPayModal open={activeAction === 'PAY'} onClose={close} order={order} onDone={done} />
      <RepairRefundModal open={activeAction === 'REFUND'} onClose={close} order={order} onDone={done} />
      <RepairCancelModal open={activeAction === 'CANCEL'} onClose={close} order={order} onDone={done} />
      <RepairCloseModal open={activeAction === 'CLOSE'} onClose={close} order={order} onDone={done} />
      <RepairNoteAddModal open={activeAction === 'NOTE_ADD'} onClose={close} order={order} onDone={done} />

      {/* Pause the linked contract from the repair page (reuses the contract's
          own pause modal). Re-check ONLY on close — not on success — so the modal
          keeps its own success→done view intact. Invalidating mid-success would
          make its internal check_pausable flip to "already paused" while the done
          view is still showing. So the alert flips only after the user clicks Done. */}
      <PauseContractModal
        open={pauseOpen}
        contract={order.contract_id != null
          ? { id: order.contract_id, code_display: order.contract_code_display, code: order.contract_code_display ?? '' }
          : null}
        onSuccess={() => { /* refresh happens on close, not here — see note above */ }}
        onClose={() => {
          setPauseOpen(false);
          queryClient.invalidateQueries({ queryKey: ['repair-pause-check', order.contract_id] });
          onRefresh();
        }}
      />

      <RepairDocPreviewModal
        open={previewDoc != null}
        onClose={() => setPreviewDoc(null)}
        repairOrderId={order.repair_order_id}
        repairCode={order.code_display}
        docType={previewDoc ?? 'INTAKE'}
      />

      {/* Off-screen bill receipt — portaled to body so no panel ancestor becomes
          the positioning context for .bill-receipt (its print rule is
          position:absolute against the page). Hidden on screen via
          .print-only-receipt; isolated for window.print() by the 'bill' marker.
          Mounted only while printing (GOTCHA 5: never a second live copy). */}
      {printBillId != null && createPortal(
        <div className="print-only-receipt" aria-hidden>
          <BillReceipt billId={printBillId} hidePrintButton />
        </div>,
        document.body,
      )}
    </div>
  );
}

// A single data-driven action button. Enabled iff is_permitted && !blocking_reason.
// Blocked → disabled + tooltip explaining why. `primary` = inline quick-action
// (filled); otherwise outline (used in the "More" popover). Danger actions
// (cancel/discard) always render danger-colored.
function ActionButton({ action, primary = false, onClick }: { action: RepairAction; primary?: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const enabled = action.is_permitted && action.blocking_reason === null;
  const isDanger = DANGER_ACTIONS.has(action.action_code);
  const color = isDanger ? 'danger' : (primary && enabled ? 'primary' : undefined);
  const variant = color ? undefined : 'outline';

  const btn = (
    <Button
      color={color}
      variant={variant}
      size="sm"
      startIcon={primary ? ACTION_ICON[action.action_code] : undefined}
      disabled={!enabled}
      onClick={onClick}
    >
      {t(`repairActions.${action.action_code}`)}
    </Button>
  );

  if (enabled) return btn;
  const reason = action.blocking_reason ?? (action.is_permitted ? '' : 'permission_denied');
  return (
    <Tooltip content={t(`repairBlock.${reason}`)}>
      <span className="inline-flex">{btn}</span>
    </Tooltip>
  );
}
