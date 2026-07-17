import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Tooltip, PopOver } from 'tsp-form';
import { Printer, FileText, FilePlus, User, Package, PackagePlus, PackageCheck, Banknote, ExternalLink, ChevronDown, Phone, CheckCircle2, AlertTriangle, CalendarClock, Coins, Pencil, Download, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '../../../lib/api';
import { DateTime } from '../../../components/DateTime';
import { CopyButton } from '../../../components/CopyButton';
import { useBillPdfDownload } from '../../../hooks/useBillPdfDownload';
import { BillReceipt } from '../../contracts/workspace/BillReceipt';
import { printWithMarker } from '../../../lib/printDoc';
import { fmtCurrency, formatTel } from '../../../lib/format';
import type {
  RepairOrder, RepairAvailableActions, RepairAction, RepairActionCode, RepairRenderDoc, RepairTimelineEvent,
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
  const [tab, setTab] = useState<'details' | 'charges' | 'photos' | 'history'>('details');
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  // Data-driven action catalog — filtered to status + permissions by the BE.
  const { data: caps } = useQuery({
    queryKey: ['repair-actions', order.repair_order_id, order.status, order.sub_state],
    queryFn: () => apiClient.rpc<RepairAvailableActions>('fn_repair_available_actions', {
      p_repair_order_id: order.repair_order_id,
    }),
  });

  // Charge sheet preview (running lines) for IN_REPAIR+ orders.
  const { data: doc } = useQuery({
    queryKey: ['repair-render', order.repair_order_id, 'CHARGE_NOTICE', order.updated_at],
    queryFn: () => apiClient.rpc<RepairRenderDoc>('fn_repair_render', {
      p_repair_order_id: order.repair_order_id, p_doc_type: 'CHARGE_NOTICE',
    }),
    enabled: order.status !== 'DRAFT',
  });

  // Bills the system already generated for this repair (fn_bill_repair_pay /
  // _refund). No dedicated bill view exposes repair_order_id, but the timeline
  // records each PAYMENT/REFUND with its bill_id + code — enough to list them as
  // downloadable receipts. Only fetched on the Charges tab.
  const { data: billEvents = [] } = useQuery({
    queryKey: ['repair-bills', order.repair_order_id, order.updated_at],
    queryFn: () => apiClient.get<RepairTimelineEvent[]>(
      `/v_repair_timeline?repair_order_id=eq.${order.repair_order_id}&event_code=in.(PAYMENT,REFUND)&order=log_id.desc`,
    ),
    enabled: tab === 'charges' && order.status !== 'DRAFT',
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
  // (the photo album owns it).
  const footerActions = actions.filter(a => !INLINE_ACTIONS.has(a.action_code) && a.action_code !== 'ATTACH_MEDIA');
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

      {/* Tabs — right under the header. Details holds identity/money/meta +
          symptom; charges = charge sheet + internal cost; photos = album;
          history = timeline (last). Keeps each view from being a wall of info. */}
      <div className="flex-none flex items-center gap-1 px-3 border-b border-line">
        {(['details', 'charges', 'photos', 'history'] as const).map(tk => (
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
       ) : tab === 'charges' ? (
        <>
        {/* Charge sheet — the CHARGE_SET action lives here (in-context), not in
            the footer. Shown whenever the action is available (even with 0 lines,
            so an IN_REPAIR order can start its sheet) or once lines exist. The
            edit button sits at the bottom-right, under the lines. */}
        {(chargeAction || charges.length > 0) ? (
          <div>
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

        {/* Bills — receipts the system already generated (fn_bill_repair_pay /
            _refund), listed newest-first with a per-bill PDF download. We only
            display them; the pay/refund modals create them. */}
        {billEvents.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1">{t('repair.bills')}</div>
            <div className="rounded-md border border-line overflow-hidden">
              {billEvents.map(ev => {
                const billId = typeof ev.detail?.bill_id === 'number' ? ev.detail.bill_id : null;
                const billCode = typeof ev.detail?.code_display === 'string' ? ev.detail.code_display : null;
                const amount = typeof ev.detail?.amount === 'number' ? ev.detail.amount : null;
                const voided = ev.bill_status === 'VOIDED';
                return (
                  <div key={ev.log_id} className="flex items-center gap-2 px-3 py-2 border-b border-line last:border-b-0 text-sm">
                    <Badge size="xs" color={ev.event_code === 'REFUND' ? 'warning' : 'default'}>
                      {t(`repair.event_${ev.event_code}`)}
                    </Badge>
                    <div className="min-w-0 flex flex-col">
                      <span className={`font-mono text-xs truncate ${voided ? 'line-through text-subtler' : ''}`}>{billCode ?? '—'}</span>
                      <span className="text-xs text-subtler"><DateTime value={ev.event_at} /></span>
                    </div>
                    {voided && <Badge size="xs" color="danger">{t('repair.billVoided')}</Badge>}
                    {amount != null && (
                      <span className={`ml-auto tabular-nums shrink-0 ${voided ? 'line-through text-subtler' : ev.event_code === 'REFUND' ? 'text-danger' : ''}`}>
                        {fmtCurrency(amount)}
                      </span>
                    )}
                    <Tooltip content={t('repair.printBill')}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="btn-icon-sm shrink-0"
                        disabled={billId == null}
                        startIcon={<Printer size={14} />}
                        onClick={() => printBill(billId)}
                      />
                    </Tooltip>
                    <Tooltip content={t('repair.downloadBill')}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="btn-icon-sm shrink-0"
                        disabled={billId == null || downloadingId === billId}
                        startIcon={downloadingId === billId ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        onClick={() => downloadBill(billId)}
                      />
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </div>
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
