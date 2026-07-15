import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Tooltip, PopOver } from 'tsp-form';
import { Printer, FileText, FilePlus, User, Package, PackagePlus, PackageCheck, Banknote, ExternalLink, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '../../../lib/api';
import { DateTime } from '../../../components/DateTime';
import { CopyButton } from '../../../components/CopyButton';
import { fmtCurrency } from '../../../lib/format';
import type {
  RepairOrder, RepairAvailableActions, RepairAction, RepairActionCode, RepairRenderDoc,
} from '../repairTypes';
import { SUB_STATE_COLOR, RESULT_COLOR } from '../repairTypes';
import type { BeMediaRepairDoc } from '../../../lib/beMedia';
import { RepairIntakeModal, RepairCloseModal } from './RepairFlowModals';
import {
  RepairChargeModal, RepairCostModal, RepairChargeNoticeModal,
  RepairPayModal, RepairRefundModal, RepairCancelModal, RepairDiscardModal, RepairDraftEditModal,
} from './RepairActionModals';
import { RepairDocPreviewModal } from './RepairDocPreviewModal';

// Icon per action_code for the quick (primary) footer buttons.
const ACTION_ICON: Partial<Record<RepairActionCode, React.ReactNode>> = {
  INTAKE: <PackagePlus size={16} />,     // receive device in
  CHARGE_SET: <FileText size={16} />,    // build the charge sheet
  PAY: <Banknote size={16} />,           // collect payment
  CLOSE: <PackageCheck size={16} />,     // hand device back / close
};

// Quick (primary) actions — the forward step for each state, shown inline as
// filled buttons. Everything else (edit, cost, notice, refund, cancel, discard)
// drops into the "More" overflow so the footer stays a clean one-tap row.
// Same primary/more split as the AssetsPage footer. CHARGE_SET is deliberately
// NOT here — it lives inline in the charge-sheet section (in-context editing).
const QUICK_ACTIONS = new Set<RepairActionCode>(['INTAKE', 'PAY', 'CLOSE']);
// Actions surfaced in-context (not in the footer at all).
const INLINE_ACTIONS = new Set<RepairActionCode>(['CHARGE_SET']);
const DANGER_ACTIONS = new Set<RepairActionCode>(['CANCEL', 'DISCARD']);

export function RepairDetailPanel({
  order, isMobile, onRefresh,
}: {
  order: RepairOrder;
  isMobile: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [activeAction, setActiveAction] = useState<RepairActionCode | null>(null);
  const [previewDoc, setPreviewDoc] = useState<BeMediaRepairDoc | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
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

  // ATTACH_MEDIA has no direct RPC (dead ref) — hidden for now. The rest render.
  const actions = (caps?.actions ?? []).filter(a => a.action_code !== 'ATTACH_MEDIA');

  // Footer = quick actions inline + everything else in "More". CHARGE_SET is
  // pulled out entirely — it's rendered in the charge-sheet section instead.
  const footerActions = actions.filter(a => !INLINE_ACTIONS.has(a.action_code));
  const quickActions = footerActions.filter(a => QUICK_ACTIONS.has(a.action_code));
  const moreActions = footerActions.filter(a => !QUICK_ACTIONS.has(a.action_code));

  // The CHARGE_SET action (surfaced inline in the charge-sheet section).
  const chargeAction = actions.find(a => a.action_code === 'CHARGE_SET');
  const chargeActionEnabled = !!chargeAction && chargeAction.is_permitted && chargeAction.blocking_reason === null;

  const pick = (code: RepairActionCode) => { setActiveAction(code); setMoreOpen(false); };
  const close = () => setActiveAction(null);
  const done = () => { onRefresh(); };

  const charges = doc?.charge_items ?? [];

  return (
    <div className="relative flex flex-col h-full min-w-0 overflow-hidden">
      {/* Header */}
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{order.code_display}</span>
          <CopyButton value={order.code_display} />
          <Badge size="sm" color={SUB_STATE_COLOR[order.sub_state]}>{t(`repair.subState_${order.sub_state}`)}</Badge>
          <Badge size="sm" color="default">{t(`repair.type_${order.repair_type}`)}</Badge>
          {order.result && (
            <Badge size="sm" color={RESULT_COLOR[order.result]}>{t(`repair.result_${order.result}`)}</Badge>
          )}
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

      {/* Body */}
      {/* Device — primary identity band */}
      <div className="flex-none px-4 py-3 border-b border-line">
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
        <div className="text-[11px] text-subtler font-mono truncate mt-0.5">
          {[order.serial_no, order.imei && `IMEI ${order.imei}`].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>

      {/* Customer + contract cross-link */}
      <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-2 text-sm">
        <User size={13} className="text-subtle shrink-0" />
        <span className="font-medium truncate">{order.customer_name ?? '—'}</span>
        {order.customer_tel && <span className="text-xs text-subtle shrink-0">{order.customer_tel}</span>}
        {order.contract_id != null && (
          <Link to={`/admin/contracts/search/${order.contract_id}`} className="ml-auto inline-flex items-center gap-1 text-xs text-primary-fg hover:underline shrink-0">
            {order.contract_code_display ?? t('repair.viewContract')}
            <ExternalLink size={10} />
          </Link>
        )}
      </div>

      {/* Money — prominent stat band (once there's a charge sheet) */}
      {order.c_charge_gross > 0 && (
        <div className="flex-none grid grid-cols-3 gap-3 px-4 py-3 border-b border-line bg-surface">
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

      {/* Branch + timeline — quiet metadata band */}
      <div className="flex-none px-4 py-2 border-b border-line flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle">
        <span><span className="text-subtler">{t('repair.branch')}:</span> {order.branch_name}</span>
        <span><span className="text-subtler">{t('repair.created')}:</span> <DateTime value={order.created_at} /></span>
        {order.promised_date && <span><span className="text-subtler">{t('repair.promised')}:</span> <DateTime value={order.promised_date} showTime={false} /></span>}
        {order.intake_at && <span><span className="text-subtler">{t('repair.intakeAt')}:</span> <DateTime value={order.intake_at} /></span>}
        {order.closed_at && <span><span className="text-subtler">{t('repair.closedAt')}:</span> <DateTime value={order.closed_at} /></span>}
      </div>

      {/* Scrollable content — symptom, condition, charge sheet */}
      <div className="flex-1 overflow-auto better-scroll px-4 py-3 flex flex-col gap-4">
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
            <p className="text-sm text-subtle whitespace-pre-wrap">{order.condition_note}</p>
          </div>
        )}

        {/* Charge sheet — the CHARGE_SET action lives here (in-context), not in
            the footer. Shown whenever the action is available (even with 0 lines,
            so an IN_REPAIR order can start its sheet) or once lines exist. */}
        {(chargeAction || charges.length > 0) && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="text-xs font-semibold text-subtle uppercase tracking-wider">{t('repair.chargeSheet')}</div>
              {chargeAction && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  startIcon={<FilePlus size={14} />}
                  disabled={!chargeActionEnabled}
                  onClick={() => pick('CHARGE_SET')}
                >
                  {charges.length > 0 ? t('repair.editCharges') : t('repairActions.CHARGE_SET')}
                </Button>
              )}
            </div>
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
          </div>
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
      <RepairChargeNoticeModal open={activeAction === 'CHARGE_NOTICE'} onClose={close} order={order} onDone={(issued) => { done(); if (issued) setPreviewDoc('CHARGE_NOTICE'); }} />
      <RepairPayModal open={activeAction === 'PAY'} onClose={close} order={order} onDone={done} />
      <RepairRefundModal open={activeAction === 'REFUND'} onClose={close} order={order} onDone={done} />
      <RepairCancelModal open={activeAction === 'CANCEL'} onClose={close} order={order} onDone={done} />
      <RepairCloseModal open={activeAction === 'CLOSE'} onClose={close} order={order} onDone={done} />

      <RepairDocPreviewModal
        open={previewDoc != null}
        onClose={() => setPreviewDoc(null)}
        repairOrderId={order.repair_order_id}
        repairCode={order.code_display}
        docType={previewDoc ?? 'INTAKE'}
      />
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
