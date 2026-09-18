// Finance reviews one shop close-out before it can be paid (140 §6).
//
// The order is the order a reviewer works in: what this is and what it is
// worth, then the evidence (handover photos, the device), then what has
// happened to it so far, and the two things they can do about it at the bottom.
//
// The buttons are drawn from fn_partner_settlement_available_actions, never
// from the settlement's status: a user with the permission but outside this
// shop's reviewer pool must see the button disabled with the reason, and a user
// the backend refuses outright must not see it at all. FIN_CHECK / FIN_UNCHECK
// are one RPC with a flag, so they render as a single "checked" toggle driven
// by `finance_checked_at`.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Tooltip, LabeledCheckbox } from 'tsp-form';
import {
  ArrowLeft, ExternalLink, Images, History, Smartphone,
  Wallet, AlertTriangle, CheckCircle2, Store,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { ContractPhotoGroups } from '../contracts/ContractPhotoGroups';
import {
  usePartnerSettlementActions,
  usePartnerSettlementCloseLog,
  usePartnerSettlementReturnReasons,
  usePartnerSettlementStatusRef,
} from './usePartnerSettlements';
import { PartnerSettlementReturnModal } from './PartnerSettlementReturnModal';
import { PartnerSettlementCheckModal } from './PartnerSettlementCheckModal';
import {
  settlementStatusColor,
  type PartnerSettlementDetail,
  type PartnerSettlementLine,
  type PartnerSettlementCloseLogRow,
  type PartnerSettlementAction,
} from './partnerSettlementTypes';

/** Blocking reasons that mean "this user should not see the button at all". */
const HIDDEN_REASONS = new Set(['status_not_allowed', 'permission_denied']);
/** Blocking reasons that only describe the tick's own state. */
const TICK_REASONS = new Set(['already_checked', 'not_checked']);

interface PartnerSettlementReviewPanelProps {
  detail: PartnerSettlementDetail | null;
  loading: boolean;
  isMobile: boolean;
  onBack?: () => void;
  /**
   * Who ticked "checked", from the queue row. The detail view does not carry
   * it (only the queue does), so the page passes it down when it has it.
   */
  checkedByName?: string | null;
}

export function PartnerSettlementReviewPanel({
  detail, loading, isMobile, onBack, checkedByName,
}: PartnerSettlementReviewPanelProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isThai = i18n.language === 'th';

  const [returnOpen, setReturnOpen] = useState(false);
  const [checkTarget, setCheckTarget] = useState<boolean | null>(null);

  const contractId = detail?.contract_id ?? null;
  const { actions } = usePartnerSettlementActions(contractId);
  const { rows: logRows } = usePartnerSettlementCloseLog(contractId);
  const statusRef = usePartnerSettlementStatusRef();
  const reasons = usePartnerSettlementReturnReasons();

  const statusLabel = (code: string | null) => {
    if (!code) return '—';
    const row = statusRef.find(s => s.code === code);
    if (row) return isThai ? row.name_th : row.name_en;
    return t(`partnerSettlement.status.${code}`, { defaultValue: code });
  };

  const reasonLabel = (code: string | null) => {
    if (!code) return null;
    const row = reasons.find(r => r.code === code);
    if (row) return isThai ? row.name_th : row.name_en;
    return code;
  };

  if (!detail) {
    return (
      <div className="flex-1 flex items-center justify-center text-subtler">
        <div className="text-center">
          <Wallet size={32} className="mx-auto mb-2 opacity-50" />
          <div className="text-sm">
            {loading ? t('common.loading') : t('partnerSettlement.selectHint')}
          </div>
        </div>
      </div>
    );
  }

  const checkedAt = actions?.finance_checked_at ?? null;
  const isChecked = !!checkedAt;

  // The capability answer, split the way it is used: the tick is a checkbox,
  // the send-back is a button, and anything the backend hides stays hidden.
  const byCode = (code: string): PartnerSettlementAction | undefined =>
    actions?.actions.find(a => a.action_code === code);

  const tickAction = byCode(isChecked ? 'FIN_UNCHECK' : 'FIN_CHECK');
  const returnAction = byCode('CLOSE_RETURN');

  // `already_checked` / `not_checked` are not a refusal — they only say the
  // flag is already where this action would put it, which the checkbox shows.
  const tickBlocked = tickAction
    && !tickAction.is_available
    && tickAction.blocking_reason
    && !TICK_REASONS.has(tickAction.blocking_reason)
      ? tickAction.blocking_reason
      : null;
  const tickHidden = !tickAction
    || (tickAction.blocking_reason != null && HIDDEN_REASONS.has(tickAction.blocking_reason));

  const returnBlocked = returnAction && !returnAction.is_available
    ? returnAction.blocking_reason
    : null;
  const returnHidden = !returnAction
    || (returnBlocked != null && HIDDEN_REASONS.has(returnBlocked));

  const blockingText = (reason: string) =>
    t(`blockingReason.${reason}`, { ns: 'apiErrors', defaultValue: reason });

  // The device the shop had bound when it submitted — the MDM tab is where
  // finance confirms the phone is actually enrolled and locked.
  const submitSnapshot = [...logRows]
    .reverse()
    .find(r => r.action_code === 'CLOSE_SUBMIT')?.check_snapshot ?? null;
  const deviceId = submitSnapshot?.device_id ?? null;

  const lines = detail.lines ?? [];

  return (
    <>
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        {isMobile && onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center w-8 h-8 -ml-2 cursor-pointer bg-transparent border-none text-current"
            aria-label={t('common.back')}
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <span className="font-medium text-sm truncate">{detail.settlement_code}</span>
        <Badge color={settlementStatusColor(detail.status)} size="sm">
          {statusLabel(detail.status)}
        </Badge>
        {isChecked && (
          <Badge color="success" size="sm">{t('partnerSettlement.checkedBadge')}</Badge>
        )}
      </div>

      <div className="flex-1 overflow-auto better-scroll px-4 py-3 flex flex-col gap-4">
        <HeaderBlock
          detail={detail}
          onOpenContract={() => navigate(`/admin/contracts/search/${detail.contract_id}`)}
        />

        <AmountsBlock detail={detail} lines={lines} />

        <section>
          <SectionTitle icon={<Images size={14} />} text={t('partnerSettlement.photosTitle')} />
          {/* Read-only here: the album locks itself once the shop submits, and
              that lock is what this panel is reviewing. */}
          <ContractPhotoGroups contractId={detail.contract_id} />
        </section>

        {deviceId != null && (
          <section>
            <SectionTitle icon={<Smartphone size={14} />} text={t('partnerSettlement.deviceTitle')} />
            <button
              type="button"
              onClick={() => navigate(`/admin/inventory/assets/${deviceId}?tab=mdm`)}
              className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
            >
              {t('partnerSettlement.openMdmTab')}
              <ExternalLink size={12} />
            </button>
          </section>
        )}

        <HistoryBlock
          rows={logRows}
          statusLabel={statusLabel}
          reasonLabel={reasonLabel}
        />
      </div>

      {(!tickHidden || !returnHidden) && (
        <div className="flex-none border-t border-line px-4 py-3 flex items-center gap-3 flex-wrap">
          {!tickHidden && (
            <Tooltip
              content={tickBlocked
                ? blockingText(tickBlocked)
                : isChecked
                  ? t('partnerSettlement.uncheckTitle')
                  : t('partnerSettlement.checkTitle')}
              placement="top"
            >
              <span className="inline-flex">
                <LabeledCheckbox
                  label={
                    <span className="flex flex-col">
                      <span className="text-sm">{t('partnerSettlement.checkedFlag')}</span>
                      {isChecked && (
                        <span className="block text-xs text-subtle">
                          {checkedByName ? `${checkedByName} · ` : ''}
                          <DateTime value={checkedAt} showTime />
                        </span>
                      )}
                    </span>
                  }
                  checked={isChecked}
                  disabled={!!tickBlocked}
                  onChange={() => setCheckTarget(!isChecked)}
                />
              </span>
            </Tooltip>
          )}

          <span className="flex-1" />

          {!returnHidden && (
            <Tooltip
              content={returnBlocked
                ? blockingText(returnBlocked)
                : t('partnerSettlement.returnTitle')}
              placement="top"
            >
              <Button
                variant="outline"
                size="sm"
                color="danger"
                disabled={!!returnBlocked}
                onClick={() => setReturnOpen(true)}
              >
                {t('partnerSettlement.returnTitle')}
              </Button>
            </Tooltip>
          )}
        </div>
      )}

      <PartnerSettlementReturnModal
        open={returnOpen}
        detail={detail}
        onClose={() => setReturnOpen(false)}
      />

      <PartnerSettlementCheckModal
        open={checkTarget !== null}
        detail={detail}
        checked={checkTarget ?? true}
        onClose={() => setCheckTarget(null)}
      />
    </>
  );
}

function SectionTitle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2 text-sm font-medium">
      <span className="text-subtle">{icon}</span>
      {text}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-xs text-subtle">{label}</span>
      <span className="text-sm truncate">{children}</span>
    </div>
  );
}

/** Who this settlement belongs to, and how to get to the contract. */
function HeaderBlock({ detail, onOpenContract }: {
  detail: PartnerSettlementDetail;
  onOpenContract: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section>
      <SectionTitle icon={<Store size={14} />} text={t('partnerSettlement.overviewTitle')} />
      <div className="grid grid-cols-2 gap-3 rounded-md border border-line p-3">
        <Field label={t('partnerSettlement.branch')}>{detail.branch_name ?? '—'}</Field>
        <Field label={t('partnerSettlement.customer')}>{detail.customer_name ?? '—'}</Field>
        <Field label={t('partnerSettlement.contract')}>
          <button
            type="button"
            onClick={onOpenContract}
            className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
          >
            {detail.contract_code}
            <ExternalLink size={12} />
          </button>
        </Field>
        <Field label={t('partnerSettlement.activatedAt')}>
          <DateTime value={detail.activated_at} showTime />
        </Field>
        <Field label={t('partnerSettlement.submittedAt')}>
          {detail.close_submitted_at
            ? <DateTime value={detail.close_submitted_at} showTime />
            : '—'}
        </Field>
        <Field label={t('partnerSettlement.submittedBy')}>
          {detail.close_submitted_by_name ?? '—'}
        </Field>
      </div>
    </section>
  );
}

/** The money: the three totals, then every line behind them. */
function AmountsBlock({ detail, lines }: {
  detail: PartnerSettlementDetail;
  lines: PartnerSettlementLine[];
}) {
  const { t } = useTranslation();

  return (
    <section>
      <SectionTitle icon={<Wallet size={14} />} text={t('partnerSettlement.amountsTitle')} />

      <div className="rounded-md border border-line p-3 flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('partnerSettlement.totalToBranch')}>
            <span className="tabular-nums">{fmtCurrency(detail.total_to_branch)}</span>
          </Field>
          <Field label={t('partnerSettlement.totalFromBranch')}>
            <span className="tabular-nums">{fmtCurrency(detail.total_from_branch)}</span>
          </Field>
          <Field label={t('partnerSettlement.netAmount')}>
            <span className="tabular-nums font-medium">{fmtCurrency(detail.net_amount)}</span>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3 border-t border-line pt-2">
          <Field label={t('partnerSettlement.financedAmount')}>
            <span className="tabular-nums">{fmtCurrency(detail.financed_amount)}</span>
          </Field>
          <Field label={t('partnerSettlement.branchRate')}>
            {detail.branch_rate_percent != null ? `${detail.branch_rate_percent}%` : '—'}
          </Field>
          {/* Staff-only figures — the shop's own view returns null for these. */}
          <Field label={t('partnerSettlement.companyRate')}>
            {detail.company_rate_percent != null ? `${detail.company_rate_percent}%` : '—'}
          </Field>
          <Field label={t('partnerSettlement.docFeeOwner')}>
            {detail.doc_fee_owner_type
              ? t(`partnerSettlement.docFeeOwner_${detail.doc_fee_owner_type}`, {
                  defaultValue: detail.doc_fee_owner_type,
                })
              : '—'}
          </Field>
          <Field label={t('partnerSettlement.clawback')}>
            {detail.clawback_by_branch
              ? t('partnerSettlement.clawbackDays', { days: detail.clawback_check_days ?? 0 })
              : t('partnerSettlement.clawbackNone')}
          </Field>
        </div>
      </div>

      <div className="mt-2 rounded-md border border-line divide-y divide-line">
        {lines.length === 0 ? (
          <div className="p-3 text-sm text-subtler">{t('common.noData')}</div>
        ) : lines.map(line => <LineRow key={line.line_id} line={line} />)}
      </div>
    </section>
  );
}

function LineRow({ line }: { line: PartnerSettlementLine }) {
  const { t } = useTranslation();
  // A reversed line and its reversal both stay on the settlement — struck
  // through so the figure is visible but obviously no longer counted.
  const isVoid = line.status === 'VOID' || line.line_type === 'REVERSAL';
  const sign = line.direction === 'FROM_BRANCH' ? '−' : line.direction === 'MEMO' ? '' : '+';

  return (
    <div className={`px-3 py-2 flex items-center gap-2 ${line.is_memo ? 'text-subtle' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className={`text-sm truncate ${isVoid ? 'line-through' : ''}`}>
          {t(`partnerSettlement.lineType.${line.line_type}`, { defaultValue: line.line_type })}
          {line.is_memo && (
            <span className="ml-1.5 text-xs">({t('partnerSettlement.memoLine')})</span>
          )}
        </div>
        {line.rate_percent != null && line.base_amount != null && (
          <div className="text-xs text-subtle">
            {line.rate_percent}% · {fmtCurrency(line.base_amount)}
          </div>
        )}
      </div>
      <div className={`text-sm tabular-nums shrink-0 ${isVoid ? 'line-through' : ''}`}>
        {sign}{fmtCurrency(line.amount)}
      </div>
    </div>
  );
}

/** Submit / withdraw / send-back / tick, oldest first. */
function HistoryBlock({ rows, statusLabel, reasonLabel }: {
  rows: PartnerSettlementCloseLogRow[];
  statusLabel: (code: string | null) => string;
  reasonLabel: (code: string | null) => string | null;
}) {
  const { t } = useTranslation();

  return (
    <section>
      <SectionTitle icon={<History size={14} />} text={t('partnerSettlement.historyTitle')} />
      {rows.length === 0 ? (
        <div className="text-sm text-subtler">{t('common.noData')}</div>
      ) : (
        <div className="rounded-md border border-line divide-y divide-line">
          {rows.map(row => (
            <div key={row.log_id} className="px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">
                  {t(`partnerSettlement.logAction.${row.action_code}`, {
                    defaultValue: row.action_code,
                  })}
                </span>
                {row.to_status && row.to_status !== row.from_status && (
                  <Badge size="sm" color="default">{statusLabel(row.to_status)}</Badge>
                )}
                <span className="flex-1" />
                <span className="text-xs text-subtle">
                  {row.actor_name ?? '—'} · <DateTime value={row.created_at} showTime />
                </span>
              </div>
              {row.reason_code && (
                <div className="text-sm mt-0.5">
                  {reasonLabel(row.reason_code) ?? row.reason_code}
                </div>
              )}
              {row.note && <div className="text-sm text-subtle mt-0.5">{row.note}</div>}
              {row.check_snapshot && <SnapshotLine snapshot={row.check_snapshot} />}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** What the shop had on file the moment it submitted — one compact line. */
function SnapshotLine({ snapshot }: {
  snapshot: NonNullable<PartnerSettlementCloseLogRow['check_snapshot']>;
}) {
  const { t } = useTranslation();
  const parts: string[] = [];
  if (snapshot.device_id != null) {
    parts.push(t('partnerSettlement.snapshotDevice', { id: snapshot.device_id }));
  }
  if (snapshot.total_photos != null) {
    parts.push(t('partnerSettlement.snapshotPhotos', { count: snapshot.total_photos }));
  }
  const groups = snapshot.photo_groups ?? [];
  if (groups.length > 0) {
    parts.push(t('partnerSettlement.snapshotGroups', { count: groups.length }));
  }
  if (parts.length === 0) return null;

  const checks = snapshot.checks ?? [];
  const allOk = checks.length > 0 && checks.every(c => c.ok);

  return (
    <div className="text-xs text-subtle mt-1 flex items-center gap-1.5 flex-wrap">
      {checks.length > 0 && (
        allOk
          ? <CheckCircle2 size={12} className="text-success shrink-0" />
          : <AlertTriangle size={12} className="text-warning-fg shrink-0" />
      )}
      <span>{parts.join(' · ')}</span>
    </div>
  );
}
