import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Badge, Select, Button,
} from 'tsp-form';
import { XCircle, AlertTriangle, ImageOff, ExternalLink, CheckCircle, Loader2, Copy } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { wsClient } from '../lib/api/ws';
import { DateTime } from './DateTime';
import { fmtCurrency, formatDateTime } from '../lib/format';
import { useAuth } from '../contexts/AuthContext';
import { useMyPermissions } from '../hooks/useMyPermissions';
import { MediaLightbox, MediaThumbButton } from './MediaLightbox';
import { CopyButton } from './CopyButton';
import { normalizeKey } from '../lib/mediaPath';
import { translateApiError } from '../lib/apiErrors';
import { BillDayBlockedNotice } from './BillDayPreview';
import { useBillDatePreview, useBillDayConfirm } from '../hooks/useBillDay';
import { billDayShiftedText, type BillDay } from '../lib/billDay';
import {
  SlipPayoffBadge, SlipPayoffStatusBox, SlipPayoffConfirmModal, SlipPayoffWithdrawModal,
  payoffBlockedText, type PayoffPhase, type PayoffPreview,
} from './SlipPayoff';
import { SlipReopenModal } from './SlipReopenModal';
import { SlipRejectModal } from './SlipRejectModal';

export type SubmissionStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type SubmitterRole = 'PRIMARY' | 'CO_LESSEE';

export interface SubmissionRow {
  id: number;
  contract_id: number;
  contract_code: string;
  contract_code_display: string;
  branch_id: number;
  branch_name: string | null;
  customer_id: number;
  customer_name: string | null;
  customer_tel: string | null;
  amount: number;
  note: string | null;
  status: SubmissionStatus;
  reviewed_by: number | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  payment_id: number | null;
  submitted_at: string;
  submit_channel: string | null;
  transfer_at: string | null;
  sender_account_name: string | null;
  sender_bank: string | null;
  sender_account_no: string | null;
  receiver_account_name: string | null;
  receiver_bank: string | null;
  receiver_account_no: string | null;
  transaction_ref: string | null;
  ocr_source: string | null;
  allowed_actions: string[];
  submitted_by: number | null;
  submitter_username: string | null;
  is_staff_submitted: boolean;
  // mig 311 (2026-06-23): slip code + actual-submitter attribution.
  code: string | null;
  code_display: string | null;
  // 'CO_LESSEE' when a co-lessee submitted; null/'PRIMARY' for the primary lessee.
  submitter_role: SubmitterRole | null;
  // mig 535/620 (2026-07-14): the bill this slip's payment landed in, and whether
  // that money is still standing. bill_* are nullable (null = no bill yet — pending/
  // rejected slips, or the rare APPROVED-with-null-payment). The 3 void flags are
  // never null (false when there's no bill). Decide "is this money void?" off
  // `is_voided` alone; bill_is_voided / payment_is_voided only explain which kind.
  bill_id: number | null;
  bill_code_display: string | null;
  bill_status: string | null;
  bill_is_voided: boolean;
  payment_is_voided: boolean;
  is_voided: boolean;
  void_reason_code: string | null;
  // OCR advisory (mig 958) — the system reads the slip after submit and compares
  // it to what was entered. ALL advisory: never bind approve/reject to these.
  // match fields are 3-state — null = "not known yet", never render as mismatch.
  ocr_status: 'DONE' | 'PENDING' | 'ERROR' | 'NON_SLIP' | null;
  ocr_amount: number | null;
  ocr_amount_match: boolean | null;
  ocr_transfer_at: string | null;
  ocr_date_match: boolean | null;
  ocr_review_needed: boolean | null;
  // Duplicate-slip advisory (doc 64 §5.1) — same slip file/txref seen on another
  // submission in this holding. Advisory only; the common case is a re-send after
  // REJECT (dup_first_status='REJECTED' — nothing alarming).
  is_duplicate_slip: boolean;
  dup_count: number | null;
  dup_match_via: 'HASH' | 'TXREF' | 'HASH+TXREF' | null;
  dup_first_submission_id: number | null;
  dup_first_code_display: string | null;
  dup_first_status: SubmissionStatus | null;
  dup_first_submitted_at: string | null;
  dup_cross_customer: boolean | null;
  // Contract facts carried on the same row (mig 1186) — no per-row v_contract_detail
  // fetch needed. All are the contract's state AT READ TIME, not at submit time, so
  // an APPROVED slip's installment number moves on as the contract progresses.
  // device_external_ref = the funder's own customer code for the bound device.
  device_external_ref: string | null;
  contract_activated_at: string | null;
  paid_installment_count: number | null;
  total_installments: number | null;
  // First not-yet-settled installment = the one this slip pays down. Always within
  // [1, total_installments]; null until the contract has a schedule. Never derive it
  // from paid_installment_count + 1 — the DB owns the formula.
  current_installment_no: number | null;
  // mig 1452 — early payoff from this slip (ปิดจบ). All null when the slip is not
  // being used for a payoff. payoff_phase drives the label; allowed_actions then
  // carries PAYOFF / PAYOFF_WITHDRAW instead of APPROVE / REJECT.
  payoff_bill_id?: number | null;
  payoff_bill_code_display?: string | null;
  payoff_bill_status?: string | null;
  payoff_bill_total?: number | null;
  payoff_discount_amount?: number | null;
  payoff_discount_status?: string | null;
  payoff_phase?: PayoffPhase | null;
}

/**
 * Funder ref · activation date · installment n/total — the three contract facts
 * a reviewer needs while looking at a slip. Each piece is dropped when its value
 * is null (a pre-activation down-payment slip has no date and no installment),
 * and the whole line disappears when nothing is left.
 */
export function SubmissionContractInfoLine({ row, className }: { row: SubmissionRow; className?: string }) {
  const { t, i18n } = useTranslation();
  const parts: React.ReactNode[] = [];
  if (row.device_external_ref) {
    parts.push(t('paymentSubmissions.externalRefShort', { ref: row.device_external_ref }));
  }
  if (row.contract_activated_at) {
    parts.push(t('paymentSubmissions.activatedAtShort', {
      date: formatDateTime(row.contract_activated_at, i18n.language, false),
    }));
  }
  if (row.current_installment_no != null && row.total_installments != null) {
    parts.push(t('paymentSubmissions.installmentNoShort', {
      current: row.current_installment_no,
      total: row.total_installments,
    }));
  }
  if (parts.length === 0) return null;
  return <div className={className}>{parts.join(' · ')}</div>;
}

interface EntityMedia {
  entity_media_id: number;
  entity_type: string;
  entity_id: number;
  usage_type: string;
  storage_path: string;
  variants_json: Record<string, string> | null;
  created_at: string;
}

interface BankAccount {
  id: number;
  branch_id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_active: boolean;
  is_default: boolean;
  is_promptpay: boolean;
}

export const submissionStatusColor = (s: SubmissionStatus): 'warning' | 'success' | 'danger' | 'default' => {
  switch (s) {
    case 'PENDING_REVIEW': return 'warning';
    case 'APPROVED': return 'success';
    case 'REJECTED': return 'danger';
    case 'CANCELLED': return 'default';
  }
};

// Pill color for the submitter-role badge (mig 311). Only rendered for co-lessees.
export const submitterRoleColor = (r: SubmitterRole): 'info' | 'default' =>
  r === 'CO_LESSEE' ? 'info' : 'default';

type ReviewAction = 'approve' | 'reject' | 'reopen';

export interface SubmissionReviewProps {
  row: SubmissionRow | null;
  /** False while the host hides the panel (a closed drawer). Stops the live
   *  listeners and the per-slip lookups, and resets the form on the next show. */
  active?: boolean;
  /** `billDayNote` — set when approving put the bill on a later day (fund day close §D2). */
  onSuccess: (action: ReviewAction, extra?: { billDayNote: string | null }) => void;
  /** A payoff press or withdrawal finished and its own done view was dismissed —
   *  refresh and clear the selection; no snackbar needed, the done view already
   *  said what happened. */
  onChanged: () => void;
  /** A link inside the panel leads to another page — a drawer host closes here. */
  onNavigate?: () => void;
  /** Right end of the panel header (a drawer's close button). */
  headerEnd?: React.ReactNode;
  /** The slip code in the header links to the slip on the slip page — for hosts
   *  other than that page (the chat drawer). */
  linkCode?: boolean;
}

/**
 * The slip review panel — advisories, slip image, details, and the review
 * actions (approve / reject / reopen, ปิดจบ and its withdrawal). One component
 * for every place a slip is reviewed: the slip page renders it in its detail
 * panel, the contract chat inside a drawer.
 *
 * Returns the panel and its overlays (confirm boxes, bill-day dialog, image
 * zoom) separately, so a host whose container unmounts on close (Drawer) can
 * keep the overlays outside it — a Modal unmounted mid-exit strands its backdrop.
 * `panel` is null when no slip is given; `overlays` are always rendered.
 */
export function useSubmissionReview({
  row, active = true, onSuccess, onChanged, onNavigate, headerEnd, linkCode = false,
}: SubmissionReviewProps): { panel: React.ReactNode; overlays: React.ReactNode } {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { hasPermission } = useMyPermissions();
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [zoomedKey, setZoomedKey] = useState<string | null>(null);
  // Set when the customer cancels this slip while it is open — the `row` prop
  // is a snapshot, so we track the live cancel locally to disable any review
  // actions and show a banner (slip:contract WS, mig 313).
  const [liveCancelled, setLiveCancelled] = useState(false);

  useEffect(() => {
    if (active) {
      setBankAccountId('');
      setErrorMessage('');
      setLiveCancelled(false);
    }
  }, [active, row?.id]);

  // Listen for a customer cancel on this open slip. The slip:contract channel
  // emits { type: 'slip_status_changed', submission_id, status: 'CANCELLED' }.
  const contractId = row?.contract_id ?? null;
  const submissionId = row?.id ?? null;
  useEffect(() => {
    if (!active || contractId === null || submissionId === null) return;
    const unsub = wsClient.subscribe(`slip:contract:${contractId}`, (raw) => {
      const p = raw as { type?: string; submission_id?: number; status?: string };
      if (p?.type === 'slip_status_changed' && p.submission_id === submissionId && p.status === 'CANCELLED') {
        setLiveCancelled(true);
      }
    });
    return unsub;
  }, [active, contractId, submissionId]);

  const { data: slipMedia = [], isFetching: slipsFetching } = useQuery({
    queryKey: ['payment-submission-slips', row?.id],
    queryFn: () => apiClient.get<EntityMedia[]>(
      `/v_entity_media?entity_type=eq.PAYMENT_SUBMISSION&entity_id=eq.${row!.id}&order=sort_order`,
    ),
    enabled: active && !!row,
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts', row?.branch_id],
    queryFn: () => apiClient.get<BankAccount[]>(
      `/v_bank_accounts?is_active=is.true&branch_id=eq.${row!.branch_id}&order=is_default.desc,bank_name`,
    ),
    enabled: active && !!row && row.status === 'PENDING_REVIEW',
  });

  useEffect(() => {
    if (!row || row.status !== 'PENDING_REVIEW' || bankAccounts.length === 0) return;
    if (bankAccountId) return;
    const matched = row.receiver_account_no
      ? bankAccounts.find(b => b.account_number === row.receiver_account_no)
      : null;
    const defaulted = matched ?? bankAccounts.find(b => b.is_default) ?? bankAccounts[0];
    if (defaulted) setBankAccountId(String(defaulted.id));
  }, [row, bankAccounts, bankAccountId]);

  // Fund day close §D1: approving issues the installment bill. Ask which day it
  // lands on while the slip is open for review.
  const reviewable = active && !!row && row.status === 'PENDING_REVIEW' && !liveCancelled
    && (row.allowed_actions ?? []).includes('APPROVE');
  const billDayPreview = useBillDatePreview(row?.branch_id ?? null, 'CONTRACT_PAYMENT', reviewable);
  const billDayConfirm = useBillDayConfirm(billDayPreview);
  const billDayBlocked = reviewable && billDayPreview.data?.state === 'BLOCKED';

  // Early payoff (mig 1452): asked once when the slip opens — never per list row.
  // It decides whether ปิดจบ is pressable and carries every figure of the confirm box.
  const payoffCapable = active && !!row && row.status === 'PENDING_REVIEW' && !liveCancelled
    && (row.allowed_actions ?? []).some(a => a === 'PAYOFF' || a === 'PAYOFF_WITHDRAW');
  const { data: payoffPreview, isFetching: payoffPreviewLoading } = useQuery({
    queryKey: ['slip-payoff-preview', row?.id],
    queryFn: () => apiClient.rpc<PayoffPreview>('fn_payment_submission_payoff_preview', { p_submission_id: row!.id }),
    enabled: payoffCapable,
    staleTime: 0,
  });
  const [payoffOpen, setPayoffOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  useEffect(() => { if (!active) { setPayoffOpen(false); setWithdrawOpen(false); setReopenOpen(false); setRejectOpen(false); } }, [active]);

  const bankOptions = bankAccounts.map(b => ({
    value: String(b.id),
    label: `${b.bank_name} · ${b.account_number}${b.is_default ? ' ★' : ''}`,
  }));

  const overlays = (
    <>
      <SlipPayoffConfirmModal
        open={payoffOpen}
        row={row}
        preview={payoffPreview}
        onClose={() => setPayoffOpen(false)}
        onFinished={onChanged}
      />
      <SlipPayoffWithdrawModal
        open={withdrawOpen}
        row={row}
        onClose={() => setWithdrawOpen(false)}
        onFinished={onChanged}
      />
      <SlipRejectModal
        open={rejectOpen}
        row={row}
        onClose={() => setRejectOpen(false)}
        onFinished={onChanged}
      />
      <SlipReopenModal
        open={reopenOpen}
        row={row}
        onClose={() => setReopenOpen(false)}
        onFinished={onChanged}
      />
      {billDayConfirm.dialog}
      <MediaLightbox
        open={!!zoomedKey}
        onClose={() => setZoomedKey(null)}
        mediaKey={zoomedKey}
        alt="slip"
      />
    </>
  );

  if (!row) return { panel: null, overlays };

  // A live cancel (or a row that loaded already-cancelled) blocks all actions.
  const effectiveStatus: SubmissionStatus = liveCancelled ? 'CANCELLED' : row.status;
  const isPending = effectiveStatus === 'PENDING_REVIEW';
  const isRejected = effectiveStatus === 'REJECTED';
  const allowed = liveCancelled ? [] : (row.allowed_actions ?? []);
  const canApprove = allowed.includes('APPROVE');
  const canReject = allowed.includes('REJECT');
  const canReopen = allowed.includes('REOPEN');
  // allowed_actions says what the slip allows; the person also needs the payment
  // permissions (DELIVERY §6) — a company admin reviews slips but cannot take money,
  // and withdraws without them (no PIN). UI visibility only; the backend decides.
  const canPayoff = allowed.includes('PAYOFF')
    && hasPermission('PAYMENT.RECORD') && hasPermission('BILL.PAYMENT_CONFIRM');
  const canWithdrawPayoff = allowed.includes('PAYOFF_WITHDRAW')
    && (hasPermission('BILL.CANCEL') || user?.role_code === 'COMPANY_ADMIN');
  const payoffBlocked = payoffPreview?.verdict === 'BLOCKED';
  const payoffReason = payoffBlocked ? payoffBlockedText(payoffPreview, t) : '';

  const selectedBank = bankAccounts.find(b => String(b.id) === bankAccountId) ?? null;
  const receiverMismatch = !!(
    isPending &&
    row.receiver_account_no &&
    selectedBank &&
    selectedBank.account_number !== row.receiver_account_no
  );

  // Approve stays in the panel (bank account above, bill-day guard). Reject and
  // reopen each carry their own text, so they open their own windows.
  const handleApprove = async () => {
    if (!bankAccountId) return;
    setBusy('approve');
    setErrorMessage('');
    const start = Date.now();
    try {
      const res = await apiClient.rpc<{ bill_day?: BillDay | null } | null>('fn_payment_submission_review', {
        p_submission_id: row.id,
        p_action: 'APPROVE',
        p_channel: 'TRANSFER',
        p_branch_id: row.branch_id,
        p_bank_account_id: Number(bankAccountId),
        p_reject_reason: null,
        p_reviewed_by: user?.user_id ?? null,
      });
      onSuccess('approve', { billDayNote: billDayShiftedText(res?.bill_day, t, i18n.language) });
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setBusy(null);
    }
  };

  const headerCode = row.code_display ?? row.contract_code_display;

  const panel = (
    <div className="relative flex flex-col h-full min-h-0 min-w-0 overflow-hidden">
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2 min-w-0">
        {linkCode ? (
          <Link
            to={`/admin/payment-submissions/${row.id}${effectiveStatus === 'PENDING_REVIEW' ? '' : `?status=${effectiveStatus}`}`}
            className="font-semibold tabular-nums text-primary-fg no-underline hover:underline inline-flex items-center gap-1 min-w-0"
            onClick={() => onNavigate?.()}
          >
            <span className="truncate">{headerCode}</span>
            <ExternalLink size={12} className="shrink-0" />
          </Link>
        ) : (
          <span className="font-semibold truncate tabular-nums">{headerCode}</span>
        )}
        <CopyButton value={headerCode} size={14} className="shrink-0" />
        <Badge size="sm" color={submissionStatusColor(effectiveStatus)} className="shrink-0">
          {t(`paymentSubmissions.status_${effectiveStatus}`)}
        </Badge>
        {headerEnd && <div className="ml-auto shrink-0 flex items-center">{headerEnd}</div>}
      </div>

      <div className="flex-1 min-h-0 overflow-auto better-scroll px-4 py-3">
        <div className="space-y-4">
          {(row.submit_channel || row.ocr_source || row.payoff_phase) && (
            <div className="flex items-center gap-2 flex-wrap">
              <SlipPayoffBadge row={row} />
              {row.submit_channel && (
                <Badge size="sm" color="default">{row.submit_channel}</Badge>
              )}
              {row.ocr_source && (
                <Badge size="sm" color="info">{row.ocr_source}</Badge>
              )}
            </div>
          )}

          {/* Tied to a payoff bill: say where it stands up front, so nobody reads
              the slip as an ordinary one whose อนุมัติ has gone missing. */}
          <SlipPayoffStatusBox row={row} preview={payoffPreview} onNavigate={() => onNavigate?.()} />

          {liveCancelled && (
            <div className="alert alert-warning">
              <AlertTriangle size={16} />
              <div><div className="alert-description text-xs">{t('paymentSubmissions.cancelledByCustomer')}</div></div>
            </div>
          )}

          {/* Advisory signals — duplicate slip + OCR read-back. Both are hints for
              the reviewer, never blockers (approve/reject stay driven by allowed_actions). */}
          <div className="space-y-1.5">
            <DuplicateAdvisory row={row} />
            <OcrAdvisory row={row} />
          </div>

          {/* Money reversed — an APPROVED slip can still have its payment voided
              (whole bill cancelled, or just this payment reversed to a CN). The
              slip status alone reads "approved", so this must be loud. */}
          {row.is_voided && (
            <div className="alert alert-danger">
              <AlertTriangle size={16} />
              <div>
                <div className="alert-description text-xs">
                  {row.bill_is_voided
                    ? t('paymentSubmissions.voidedBill')
                    : t('paymentSubmissions.voidedPayment')}
                  {row.void_reason_code && (
                    <> · {t(`paymentSubmissions.voidReason_${row.void_reason_code}`, { defaultValue: t('paymentSubmissions.voidReasonUnspecified') })}</>
                  )}
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="form-label mb-1">{t('paymentSubmissions.slipImage')}</div>
            {slipsFetching && slipMedia.length === 0 ? (
              <div className="border border-line rounded-lg h-48 flex items-center justify-center text-subtle text-sm">
                {t('common.loading')}
              </div>
            ) : slipMedia.length === 0 ? (
              <div className="border border-line rounded-lg h-48 flex flex-col items-center justify-center gap-2 text-subtle text-sm">
                <ImageOff size={24} />
                <span>{t('paymentSubmissions.noSlip')}</span>
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {slipMedia.map((m) => {
                  const v = m.variants_json ?? {};
                  const thumbKey = v.sm || v.thumb || v.md || v.medium || v.original || m.storage_path;
                  const fullKey = v.original || v.lg || v.md || v.medium || m.storage_path;
                  return (
                    <MediaThumbButton
                      key={m.entity_media_id}
                      mediaKey={normalizeKey(thumbKey)}
                      alt="slip"
                      className="w-32 h-32 border border-line rounded-md overflow-hidden bg-surface cursor-zoom-in p-0"
                      onClick={() => setZoomedKey(normalizeKey(fullKey))}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2 text-sm">
            <DetailRow label={t('paymentSubmissions.contract')}>
              <Link
                to={`/admin/contracts/search/${row.contract_id}`}
                className="text-primary-fg inline-flex items-center gap-1 no-underline hover:underline"
                onClick={() => onNavigate?.()}
              >
                {row.contract_code_display}
                <ExternalLink size={12} />
              </Link>
            </DetailRow>
            <DetailRow label={t('paymentSubmissions.customer')}>
              <span className="text-right inline-flex items-center gap-1.5 flex-wrap justify-end">
                <span>{row.customer_name ?? '—'}</span>
                {row.submitter_role === 'CO_LESSEE' && (
                  <Badge size="xs" color={submitterRoleColor('CO_LESSEE')}>
                    {t('paymentSubmissions.submitterRole_CO_LESSEE')}
                  </Badge>
                )}
              </span>
            </DetailRow>
            <SubmissionContractInfoLine row={row} className="text-xs text-subtle text-right" />
            <DetailRow label={t('paymentSubmissions.customerTel')} value={row.customer_tel ?? '—'} />
            <DetailRow label={t('paymentSubmissions.branch')} value={row.branch_name ?? '—'} />
            <hr className="border-line my-2" />
            <DetailRow label={t('paymentSubmissions.amount')} value={fmtCurrency(row.amount)} mono />
            <DetailRow label={t('paymentSubmissions.transferAt')}>
              {row.transfer_at ? <DateTime value={row.transfer_at} /> : <span>—</span>}
            </DetailRow>
            <DetailRow label={t('paymentSubmissions.transactionRef')} value={row.transaction_ref ?? '—'} />
            {/* Which bill this slip's payment landed in. bill_id is null for slips
                with no payment yet (pending/rejected/cancelled) — render a dash then. */}
            <DetailRow label={t('paymentSubmissions.bill')}>
              {row.bill_id != null && row.bill_code_display ? (
                <span className="text-right inline-flex items-center gap-1.5 flex-wrap justify-end">
                  <Link
                    to={`/admin/accounting/bills/${row.bill_id}`}
                    className="text-primary-fg inline-flex items-center gap-1 no-underline hover:underline tabular-nums"
                    onClick={() => onNavigate?.()}
                  >
                    {row.bill_code_display}
                    <ExternalLink size={12} />
                  </Link>
                  {row.bill_status && (
                    <Badge size="xs" color={row.is_voided ? 'danger' : 'default'}>
                      {t(`paymentSubmissions.billStatus_${row.bill_status}`, { defaultValue: row.bill_status })}
                    </Badge>
                  )}
                </span>
              ) : (
                <span className="text-right">—</span>
              )}
            </DetailRow>
            <hr className="border-line my-2" />
            <div className="text-xs uppercase text-subtle tracking-wide mt-2">
              {t('paymentSubmissions.sender')}
            </div>
            <DetailRow label={t('paymentSubmissions.accountName')} value={row.sender_account_name ?? '—'} />
            <DetailRow label={t('paymentSubmissions.bank')} value={row.sender_bank ?? '—'} />
            <DetailRow label={t('paymentSubmissions.accountNumber')} value={row.sender_account_no ?? '—'} />
            <div className="text-xs uppercase text-subtle tracking-wide mt-2">
              {t('paymentSubmissions.receiver')}
            </div>
            <DetailRow label={t('paymentSubmissions.accountName')} value={row.receiver_account_name ?? '—'} />
            <DetailRow label={t('paymentSubmissions.bank')} value={row.receiver_bank ?? '—'} />
            <DetailRow label={t('paymentSubmissions.accountNumber')} value={row.receiver_account_no ?? '—'} />

            {row.note && (
              <>
                <hr className="border-line my-2" />
                <DetailRow label={t('paymentSubmissions.customerNote')} value={row.note} />
              </>
            )}

            {(row.reviewer_name || row.reviewed_at) && (
              <>
                <hr className="border-line my-2" />
                <DetailRow label={t('paymentSubmissions.reviewedBy')} value={row.reviewer_name ?? '—'} />
                <DetailRow label={t('paymentSubmissions.reviewedAt')}>
                  {row.reviewed_at ? <DateTime value={row.reviewed_at} /> : <span>—</span>}
                </DetailRow>
                {row.reject_reason && (
                  <DetailRow label={t('paymentSubmissions.rejectReason')} value={row.reject_reason} />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {(isPending || (isRejected && canReopen)) && (
        <div className="flex-none border-t border-line px-4 py-3 bg-bg">
          <div className="space-y-2 w-full">
            {errorMessage && (
              <div className="alert alert-danger animate-pop-in">
                <XCircle size={16} />
                <div><div className="alert-description text-xs">{errorMessage}</div></div>
              </div>
            )}

            {billDayBlocked && <BillDayBlockedNotice preview={billDayPreview.data} />}

            {/* One row: the bank account takes the free width on the left, the
                buttons sit on the right, sized to their text — the same footer
                shape as the other detail panels. A narrow panel wraps the buttons
                under the account. */}
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
              {isPending && canApprove ? (
                <div className="flex-1 min-w-[16rem]">
                  <div className="form-label mb-1">{t('paymentSubmissions.bankAccount')}</div>
                  <Select
                    options={bankOptions}
                    value={bankAccountId || null}
                    onChange={v => setBankAccountId((v as string) || '')}
                    size="sm"
                    placeholder={t('paymentSubmissions.selectBankAccount')}
                    searchable={false}
                  />
                </div>
              ) : <span className="flex-1" />}
              <div className="flex items-center gap-2 ml-auto">
                {/* ปิดจบ — settles the slip very differently from อนุมัติ, so it opens
                    its own confirm box. Greyed with the backend's reason in words. */}
                {isPending && canPayoff && (
                  <Button
                    variant="outline" size="sm"
                    disabled={!!busy || payoffPreviewLoading || !payoffPreview || payoffBlocked}
                    onClick={() => setPayoffOpen(true)}
                  >
                    {payoffPreviewLoading && !payoffPreview
                      ? t('common.loading')
                      : payoffPreview?.phase === 'READY_TO_FINISH'
                        ? t('paymentSubmissions.payoffFinishButton')
                        : t('paymentSubmissions.payoffButton')}
                  </Button>
                )}
                {isPending && canWithdrawPayoff && (
                  <Button
                    variant="outline" color="danger" size="sm"
                    disabled={!!busy}
                    onClick={() => setWithdrawOpen(true)}
                  >
                    {t('paymentSubmissions.payoffWithdraw')}
                  </Button>
                )}
                {isPending && canReject && (
                  <Button color="danger" size="sm" disabled={!!busy} onClick={() => setRejectOpen(true)}>
                    {t('paymentSubmissions.reject')}
                  </Button>
                )}
                {isPending && canApprove && (
                  <Button
                    color="success" size="sm"
                    disabled={!!busy || !bankAccountId || billDayBlocked}
                    onClick={() => billDayConfirm.guard(() => { void handleApprove(); })}
                  >
                    {busy === 'approve' ? t('common.loading') : t('paymentSubmissions.approve')}
                  </Button>
                )}
                {isRejected && canReopen && (
                  <Button color="primary" size="sm" onClick={() => setReopenOpen(true)}>
                    {t('paymentSubmissions.reopen')}
                  </Button>
                )}
              </div>
            </div>
            {isPending && canApprove && receiverMismatch && (
              <div className="alert alert-warning">
                <AlertTriangle size={14} />
                <div className="alert-description text-xs">
                  {t('paymentSubmissions.receiverMismatch')}
                </div>
              </div>
            )}
            {isPending && canPayoff && payoffBlocked && payoffReason && (
              <div className="text-xs text-subtle">{payoffReason}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return { panel, overlays };
}

/** The slip review panel with its overlays, for a host that stays mounted (a
 *  PageNav detail panel). `emptyState` shows while no slip is selected. */
export function SubmissionReviewPanel({ emptyState, ...props }: SubmissionReviewProps & { emptyState?: React.ReactNode }) {
  const { panel, overlays } = useSubmissionReview(props);
  return (
    <>
      {panel ?? emptyState ?? null}
      {overlays}
    </>
  );
}

// OCR advisory — reads slip vs. entered values. Advisory only; the reviewer still
// decides. 3-state matches: only render a mismatch on IS FALSE, never on null.
function OcrAdvisory({ row }: { row: SubmissionRow }) {
  const { t } = useTranslation();
  const s = row.ocr_status;
  // NULL (pre-OCR rows) / ERROR (unreadable — retrying) → show nothing. "Can't read"
  // is not "customer is wrong". PENDING shows a faint "reading…" note only.
  if (s == null || s === 'ERROR') return null;

  if (s === 'PENDING') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-subtle">
        <Loader2 size={13} className="animate-spin" />
        <span>{t('paymentSubmissions.ocrReading')}</span>
      </div>
    );
  }

  if (s === 'NON_SLIP') {
    return (
      <div className="alert alert-danger">
        <AlertTriangle size={16} />
        <div><div className="alert-description text-xs">{t('paymentSubmissions.ocrNonSlip')}</div></div>
      </div>
    );
  }

  // s === 'DONE'
  const amountMismatch = row.ocr_amount_match === false;
  const dateMismatch = row.ocr_date_match === false;
  const reviewNeeded = row.ocr_review_needed === true;
  const allClear = !amountMismatch && !dateMismatch && !reviewNeeded;

  if (allClear) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-success-fg">
        <CheckCircle size={13} />
        <span>{t('paymentSubmissions.ocrMatch')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {amountMismatch && (
        <div className="alert alert-warning">
          <AlertTriangle size={14} />
          <div className="alert-description text-xs">
            {t('paymentSubmissions.ocrAmountMismatch', {
              amount: row.ocr_amount != null ? fmtCurrency(row.ocr_amount) : '—',
            })}
          </div>
        </div>
      )}
      {dateMismatch && (
        <div className="alert alert-warning">
          <AlertTriangle size={14} />
          <div className="alert-description text-xs inline-flex flex-wrap items-center gap-1">
            <span>{t('paymentSubmissions.ocrDateMismatch')}</span>
            {row.ocr_transfer_at && <DateTime value={row.ocr_transfer_at} />}
          </div>
        </div>
      )}
      {reviewNeeded && (
        <div className="flex items-center gap-1.5 text-xs text-subtle">
          <AlertTriangle size={13} />
          <span>{t('paymentSubmissions.ocrReviewNeeded')}</span>
        </div>
      )}
    </div>
  );
}

// Duplicate-slip advisory — same slip file/txref already on another submission.
// Advisory only. Staff see the first duplicate's code + a cross-customer flag.
function DuplicateAdvisory({ row }: { row: SubmissionRow }) {
  const { t } = useTranslation();
  if (!row.is_duplicate_slip) return null;

  const cross = row.dup_cross_customer === true;
  const via = row.dup_match_via;
  return (
    <div className={`alert ${cross ? 'alert-danger' : 'alert-warning'}`}>
      <Copy size={16} />
      <div className="min-w-0">
        <div className="alert-description text-xs space-y-1">
          <div>
            {cross
              ? t('paymentSubmissions.dupCrossCustomer')
              : t('paymentSubmissions.dupSeenBefore', { count: row.dup_count ?? 1 })}
            {via && <> · {t(`paymentSubmissions.dupVia_${via}`, { defaultValue: via })}</>}
          </div>
          {row.dup_first_code_display && (
            <div className="inline-flex items-center gap-1.5 flex-wrap">
              <span className="text-subtle">{t('paymentSubmissions.dupFirstSeen')}</span>
              <span className="font-medium tabular-nums">{row.dup_first_code_display}</span>
              {row.dup_first_status && (
                <Badge size="xs" color={submissionStatusColor(row.dup_first_status)}>
                  {t(`paymentSubmissions.status_${row.dup_first_status}`)}
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono, children }: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-subtle shrink-0">{label}</span>
      {children ?? <span className={`text-right ${mono ? 'tabular-nums' : ''}`}>{value}</span>}
    </div>
  );
}
