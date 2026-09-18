// One return document, as fund finance reads it.
//
// Two tabs: the facts (who, which device, which money, where it is now) and the
// history (the merged timeline, shared with the shop side).
//
// Buttons come from `fn_partner_return_available_actions` and nothing else. The
// document's status cannot tell whether this user is in the shop's payout pool
// or what is still blocking a close, so drawing from status would offer actions
// that die on submit. Reasons meaning "not yours / not now" hide the button;
// reasons that are a state of the document (no resolution yet, buyback unpaid,
// waiting for the warehouse) show it disabled with the reason on its tooltip,
// because those are things the user can act on.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Tooltip } from 'tsp-form';
import {
  ArrowLeft, ExternalLink, FileQuestion, Image as ImageIcon, PackageSearch, Wrench,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { PartnerReturnTimeline } from '../../components/PartnerReturnTimeline';
import { fmtCurrency } from '../../lib/format';
import { blockingReasonText } from '../../lib/apiErrors';
import {
  usePartnerReturnActions,
  usePartnerReturnDetail,
  usePartnerReturnLog,
  usePartnerReturnRow,
  usePartnerReturnTimeline,
  useReturnResolutionRef,
  useReturnStatusRef,
} from './usePartnerReturns';
import {
  nextStepColor,
  returnStatusColor,
  type PartnerReturnAction,
  type PartnerReturnQueueRow,
  type PartnerReturnStatus,
} from './partnerReturnTypes';
import { ReturnSetResolutionModal } from './ReturnSetResolutionModal';
import { ReturnBuybackPaidModal } from './ReturnBuybackPaidModal';
import { ReturnShipModal } from './ReturnShipModal';
import { ReturnWarehouseReceiveModal } from './ReturnWarehouseReceiveModal';
import { ReturnCloseModal } from './ReturnCloseModal';
import { ReturnVoidModal } from './ReturnVoidModal';
import { ReturnReissueModal } from './ReturnReissueModal';

/** Reasons that mean the button has no business being on screen at all. */
const HIDDEN_REASONS = new Set(['status_not_allowed', 'permission_denied']);

/** Actions with a modal here. Anything else the backend adds shows as not-wired. */
const WIRED_ACTIONS = new Set([
  'SET_RESOLUTION', 'BUYBACK_PAID', 'SHIP', 'WAREHOUSE_RECEIVE', 'CLOSE', 'VOID', 'SIGNING_REISSUE',
]);

type Tab = 'detail' | 'history';

interface Props {
  returnId: number | null;
  isMobile: boolean;
  onBack: () => void;
  /** The queue row, when this return is open — it carries the warehouse and next step. */
  queueRow?: PartnerReturnQueueRow | null;
}

export function PartnerReturnDetailPanel({ returnId, isMobile, onBack, queueRow }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const { detail, isLoading, isFetched } = usePartnerReturnDetail(returnId);
  const { row } = usePartnerReturnRow(returnId);
  const { actions } = usePartnerReturnActions(returnId);
  const log = usePartnerReturnLog(returnId);
  const timeline = usePartnerReturnTimeline(returnId);
  const statusRef = useReturnStatusRef();
  const resolutionRef = useReturnResolutionRef();

  const [tab, setTab] = useState<Tab>('detail');
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [buybackOpen, setBuybackOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [reissueOpen, setReissueOpen] = useState(false);

  useEffect(() => { setTab('detail'); }, [returnId]);

  const notFound = returnId != null && isFetched && !detail;

  const statusLabel = (code: PartnerReturnStatus) => {
    const ref = statusRef.find(s => s.code === code);
    if (!ref) return t(`partnerReturn.status_${code}`, { defaultValue: code });
    return i18n.language === 'th' ? ref.name_th : ref.name_en;
  };

  const resolutionLabel = (code: string) => {
    const ref = resolutionRef.find(r => r.code === code);
    if (!ref) return t(`partnerReturn.resolution_${code}`, { defaultValue: code });
    return i18n.language === 'th' ? ref.name_th : ref.name_en;
  };

  // The queue row is the only place `warehouse_branch_*` / `transfer_shipped_at`
  // live while a return is open; `v_partner_returns` answers once it is closed.
  const extras = queueRow ?? row ?? null;
  const warehouseName = extras?.warehouse_branch_name ?? null;
  const closeBlock = actions?.close_block ?? queueRow?.close_block ?? null;

  const footerActions = (actions?.actions ?? [])
    .filter(a => a.is_available || !HIDDEN_REASONS.has(a.blocking_reason ?? ''))
    .sort((a, b) => a.sort_order - b.sort_order);

  const runAction = (code: string) => {
    if (code === 'SET_RESOLUTION') setResolutionOpen(true);
    else if (code === 'BUYBACK_PAID') setBuybackOpen(true);
    else if (code === 'SHIP') setShipOpen(true);
    else if (code === 'WAREHOUSE_RECEIVE') setWarehouseOpen(true);
    else if (code === 'CLOSE') setCloseOpen(true);
    else if (code === 'VOID') setVoidOpen(true);
    else if (code === 'SIGNING_REISSUE') setReissueOpen(true);
  };

  const renderActionButton = (a: PartnerReturnAction) => {
    const label = t(`partnerReturn.action_${a.action_code}`, { defaultValue: a.action_code });
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
          variant={a.action_code === 'CLOSE' ? 'primary' : 'outline'}
          color={a.action_code === 'VOID' ? 'danger' : undefined}
          endIcon={endIcon}
          disabled={!a.is_available || !wired}
          onClick={() => runAction(a.action_code)}
        >
          {label}
        </Button>
      </Tooltip>
    );
  };

  if (returnId == null) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-subtler p-8">
        <PackageSearch size={40} />
        <div className="text-center">{t('partnerReturn.pickOne')}</div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        {isMobile && (
          <button
            className="flex items-center justify-center w-nav h-nav -ml-2 cursor-pointer bg-transparent border-none text-current"
            onClick={onBack}
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <span className="font-medium truncate">{detail?.return_code ?? ''}</span>
        {detail && (
          <Badge color={returnStatusColor(detail.status)} size="sm">
            {statusLabel(detail.status)}
          </Badge>
        )}
        {queueRow && (
          <Badge color={nextStepColor(queueRow.next_step)} size="sm">
            {t(`partnerReturn.nextStep_${queueRow.next_step}`, { defaultValue: queueRow.next_step })}
          </Badge>
        )}
      </div>

      <div className="flex-none border-b border-line flex px-2">
        {(['detail', 'history'] as Tab[]).map(key => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
              tab === key ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
            }`}
          >
            {t(`partnerReturn.tab_${key}`)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto better-scroll px-4 py-3">
        {isLoading && !detail && (
          <div className="p-8 text-center text-subtler">{t('common.loading', { defaultValue: 'Loading…' })}</div>
        )}

        {notFound && (
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <FileQuestion size={40} className="text-subtler" />
            <div className="text-subtler">{t('partnerReturn.notFound')}</div>
          </div>
        )}

        {detail && tab === 'detail' && (
          <div className="max-w-3xl mx-auto flex flex-col gap-4">
            {/* Who and what — the shop, the contract, the customer, the device. */}
            <div className="rounded-md border border-line overflow-hidden">
              <div className="px-3 py-2.5 bg-surface flex items-center gap-2 flex-wrap">
                <span className="font-medium">{detail.branch_name}</span>
                <Badge color="default" size="sm">
                  {t(`partnerReturn.openedBy_${detail.opened_by_side}`, {
                    defaultValue: detail.opened_by_side ?? '—',
                  })}
                </Badge>
                <span className="flex-1" />
                <span className="text-xs text-subtle">
                  {detail.created_by_name} · <DateTime value={detail.created_at} showTime />
                </span>
              </div>

              <div className="px-3 py-2.5 border-t border-line grid gap-2 sm:grid-cols-2 text-sm">
                <Fact label={t('partnerReturn.contract')}>
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/contracts/${detail.contract_id}`)}
                    className="text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                  >
                    {detail.contract_code}
                    <ExternalLink size={12} />
                  </button>
                  {detail.contract_state && (
                    <span className="text-xs text-subtle ml-1">
                      {t(`contract.state_${detail.contract_state}`, { defaultValue: detail.contract_state })}
                    </span>
                  )}
                </Fact>
                <Fact label={t('partnerReturn.customer')}>{detail.customer_name ?? '—'}</Fact>
                <Fact label={t('partnerReturn.device')}>
                  {detail.device_code ?? '—'}
                  {detail.device_bucket && (
                    <span className="text-xs text-subtle ml-1">
                      {t(`partnerReturn.bucket_${detail.device_bucket}`, { defaultValue: detail.device_bucket })}
                    </span>
                  )}
                  {detail.device_owner_type && (
                    <span className="text-xs text-subtle ml-1">
                      · {t(`partnerReturn.owner_${detail.device_owner_type}`, {
                        defaultValue: detail.device_owner_type,
                      })}
                    </span>
                  )}
                </Fact>
                <Fact label={t('partnerReturn.receivePoint')}>
                  {t(`partnerReturn.receivePoint_${detail.receive_point}`, {
                    defaultValue: detail.receive_point,
                  })}
                </Fact>
                <Fact label={t('partnerReturn.reason')}>
                  {t(`partnerReturn.reason_${detail.reason_code}`, { defaultValue: detail.reason_code })}
                </Fact>
                {detail.note && <Fact label={t('partnerReturn.note')}>{detail.note}</Fact>}
              </div>
            </div>

            {/* The money it hangs off — settlement and the payout that paid it. */}
            <div className="rounded-md border border-line overflow-hidden">
              <div className="px-3 py-2 bg-surface text-sm font-medium">
                {t('partnerReturn.moneySection')}
              </div>
              <div className="px-3 py-2.5 border-t border-line grid gap-2 sm:grid-cols-2 text-sm">
                <Fact label={t('partnerReturn.settlement')}>
                  {detail.settlement_code ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/partner-settlements/${detail.settlement_id}`)}
                      className="text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                    >
                      {detail.settlement_code}
                      <ExternalLink size={12} />
                    </button>
                  ) : '—'}
                  {detail.settlement_status && (
                    <span className="text-xs text-subtle ml-1">
                      {t(`partnerSettlement.status.${detail.settlement_status}`, {
                        defaultValue: detail.settlement_status,
                      })}
                    </span>
                  )}
                </Fact>
                <Fact label={t('partnerReturn.settlementNetAmount')}>
                  {detail.settlement_net_amount != null ? fmtCurrency(detail.settlement_net_amount) : '—'}
                </Fact>
                <Fact label={t('partnerReturn.paidPayout')}>
                  {detail.paid_payout_code ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/partner-payouts/${detail.paid_payout_id}`)}
                      className="text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                    >
                      {detail.paid_payout_code}
                      <ExternalLink size={12} />
                    </button>
                  ) : t('partnerReturn.notPaidYet')}
                </Fact>
                <Fact label={t('partnerReturn.guarantee')}>
                  {detail.guarantee_until
                    ? <><DateTime value={detail.guarantee_until} showTime={false} />{' '}
                        <Badge color={detail.in_guarantee_at_open ? 'success' : 'default'} size="sm">
                          {detail.in_guarantee_at_open
                            ? t('partnerReturn.inGuarantee')
                            : t('partnerReturn.outOfGuarantee')}
                        </Badge>
                      </>
                    : '—'}
                </Fact>
              </div>
            </div>

            {/* How it ends, and where the device is on the way there. */}
            <div className="rounded-md border border-line overflow-hidden">
              <div className="px-3 py-2 bg-surface text-sm font-medium">
                {t('partnerReturn.progressSection')}
              </div>
              <div className="px-3 py-2.5 border-t border-line grid gap-2 sm:grid-cols-2 text-sm">
                <Fact label={t('partnerReturn.receivedAt')}>
                  {detail.received_at
                    ? <><DateTime value={detail.received_at} showTime />
                        {detail.received_by_name && <span className="text-xs text-subtle ml-1">· {detail.received_by_name}</span>}
                      </>
                    : '—'}
                </Fact>
                <Fact label={t('partnerReturn.resolutionLabel')}>
                  {detail.resolution ? resolutionLabel(detail.resolution) : t('partnerReturn.resolutionNotSet')}
                </Fact>
                {detail.resolution === 'BUYBACK' && (
                  <>
                    <Fact label={t('partnerReturn.buybackAmount')}>
                      {detail.buyback_amount != null ? fmtCurrency(detail.buyback_amount) : '—'}
                    </Fact>
                    <Fact label={t('partnerReturn.buybackFee')}>
                      {detail.buyback_fee != null ? fmtCurrency(detail.buyback_fee) : '—'}
                    </Fact>
                    <Fact label={t('partnerReturn.buybackTotal')}>
                      <b className="tabular-nums">
                        {fmtCurrency((detail.buyback_amount ?? 0) + (detail.buyback_fee ?? 0))}
                      </b>
                      {detail.buyback_adjustment_id != null && (
                        <Badge color="success" size="sm" className="ml-1">{t('partnerReturn.buybackPaidBadge')}</Badge>
                      )}
                    </Fact>
                  </>
                )}
                {detail.resolution === 'TO_WAREHOUSE' && (
                  <>
                    <Fact label={t('partnerReturn.warehouse')}>{warehouseName ?? '—'}</Fact>
                    <Fact label={t('partnerReturn.shippedAt')}>
                      {extras?.transfer_shipped_at
                        ? <DateTime value={extras.transfer_shipped_at} showTime />
                        : '—'}
                    </Fact>
                    <Fact label={t('partnerReturn.warehouseReceivedAt')}>
                      {detail.warehouse_received_at
                        ? <DateTime value={detail.warehouse_received_at} showTime />
                        : '—'}
                    </Fact>
                  </>
                )}
                {detail.closed_at && (
                  <Fact label={t('partnerReturn.closedAt')}>
                    <DateTime value={detail.closed_at} showTime />
                    {extras?.contract_close_reason && (
                      <span className="text-xs text-subtle ml-1">
                        · {t(`partnerReturn.closeReason_${extras.contract_close_reason}`, {
                          defaultValue: extras.contract_close_reason,
                        })}
                      </span>
                    )}
                  </Fact>
                )}
                {detail.void_reason && (
                  <Fact label={t('partnerReturn.voidReason')}>{detail.void_reason}</Fact>
                )}
              </div>

              {closeBlock?.reason && detail.is_open && (
                <div className="px-3 py-2.5 border-t border-line text-sm">
                  <span className="text-subtle">{t('partnerReturn.closeBlockLabel')}: </span>
                  {t(`partnerReturn.closeBlock_${closeBlock.reason}`, {
                    defaultValue: t('partnerReturn.closeBlockGeneric'),
                  })}
                </div>
              )}
            </div>

            {/* The two return photo slots — read-only here; the shop attaches them. */}
            {(detail.return_photos ?? []).length > 0 && (
              <div className="rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface text-sm font-medium flex items-center gap-2">
                  <ImageIcon size={14} className="text-subtle" />
                  {t('partnerReturn.photos')}
                </div>
                {(detail.return_photos ?? []).map(slot => (
                  <div key={slot.slot} className="px-3 py-2.5 border-t border-line flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 truncate">
                      {t(`partnerReturn.photoSlot_${slot.slot}`, { defaultValue: slot.label_th })}
                    </span>
                    <span className="text-xs text-subtle tabular-nums">
                      {slot.count} / {slot.max_shots}
                    </span>
                  </div>
                ))}
                {!detail.allows_photo_edit && (
                  <div className="px-3 py-2 border-t border-line text-xs text-subtle">
                    {t('partnerReturn.photosLocked')}
                  </div>
                )}
              </div>
            )}

            {/* The document's own steps. The merged story is on the history tab. */}
            {log.rows.length > 0 && (
              <div className="rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface text-sm font-medium">
                  {t('partnerReturn.logSection')}
                </div>
                {log.rows.map(l => (
                  <div key={l.log_id} className="px-3 py-2 border-t border-line text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">
                        {t(`partnerReturn.logAction_${l.action_code}`, { defaultValue: l.action_code })}
                      </span>
                      {l.from_status && l.to_status && l.from_status !== l.to_status && (
                        <span className="text-xs text-subtle">
                          {statusLabel(l.from_status)} → {statusLabel(l.to_status)}
                        </span>
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

        {detail && tab === 'history' && (
          <div className="max-w-3xl mx-auto">
            <PartnerReturnTimeline rows={timeline.rows} contractId={detail.contract_id} />
          </div>
        )}
      </div>

      {footerActions.length > 0 && tab === 'detail' && (
        <div className="flex-none border-t border-line px-4 py-3 flex items-center gap-2 flex-wrap">
          {footerActions.map(renderActionButton)}
        </div>
      )}

      <ReturnSetResolutionModal
        open={resolutionOpen}
        detail={detail}
        actions={actions}
        onClose={() => setResolutionOpen(false)}
      />
      <ReturnBuybackPaidModal
        open={buybackOpen}
        detail={detail}
        actions={actions}
        onClose={() => setBuybackOpen(false)}
      />
      <ReturnShipModal
        open={shipOpen}
        detail={detail}
        warehouseName={warehouseName}
        onClose={() => setShipOpen(false)}
      />
      <ReturnWarehouseReceiveModal
        open={warehouseOpen}
        detail={detail}
        warehouseName={warehouseName}
        onClose={() => setWarehouseOpen(false)}
      />
      <ReturnCloseModal
        open={closeOpen}
        detail={detail}
        closeBlock={closeBlock}
        onClose={() => setCloseOpen(false)}
      />
      <ReturnVoidModal open={voidOpen} detail={detail} onClose={() => setVoidOpen(false)} />
      <ReturnReissueModal open={reissueOpen} detail={detail} onClose={() => setReissueOpen(false)} />
    </>
  );
}

/** One label/value pair in a fact grid. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-subtle">{label}</div>
      <div className="mt-0.5 break-words">{children}</div>
    </div>
  );
}
