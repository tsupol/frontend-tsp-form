// Early payoff from a customer's slip (UI_FEEDBACK/2026-10-16_DELIVERY_slip_early_payoff,
// mig 1452). The slip review drawer gains a third action, ปิดจบ: the slip's money
// settles every unpaid installment on a CONTRACT_PAYOFF bill instead of paying one
// installment. Every figure here comes from fn_payment_submission_payoff_preview —
// the screen never works out the payoff amount or the discount itself.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge, Button, Modal, TextArea } from 'tsp-form';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { apiClient } from '../lib/api';
import { fmtCurrency } from '../lib/format';
import { prepareErrorParams, translateApiError, translateErrorCode } from '../lib/apiErrors';
import { useAuth } from '../contexts/AuthContext';
import { ActionDoneView, type ActionDoneDetailRow } from '../pages/contracts/ActionDoneView';
import { BranchPinInput } from './BranchPinInput';
import { BranchPaymentAccountField } from './BranchPaymentAccountField';
import { ModalErrorBand } from './ModalErrorBand';
import type { SubmissionRow } from './SubmissionReviewPanel';

export type PayoffPhase =
  | 'WAITING_DISCOUNT_APPROVAL' | 'READY_TO_FINISH' | 'DISCOUNT_REJECTED' | 'DONE' | 'BILL_GONE';

export interface PayoffPreview {
  contract: {
    id: number;
    code_display: string;
    state: string;
    commercial_model: string;
    paid_installment_count: number;
    total_installments: number;
  };
  payoff: { gross_remaining: number; count_unpaid: number; net: number; fin1_discount: number };
  wallets: { insurance: number; credit: number; saving: number; total: number };
  cap: { enabled: boolean; max_pct: number; max_amount: number; base?: number; commercial_model?: string } | null;
  slip_amount: number;
  implied_discount: number;
  needs_approval: boolean;
  payoff_bill: {
    bill_id: number;
    code_display: string;
    status: string;
    total_amount: number;
    discount_amount: number | null;
    discount_approval_status: string | null;
    discount_decision_reason: string | null;
  } | null;
  phase: string;
  verdict: 'OK' | 'OK_NEEDS_APPROVAL' | 'BLOCKED';
  reason_code: string | null;
  reason_params: Record<string, unknown>;
  next_step_code: string;
  late_fee_balance: number;
  after_payoff: { contract_stays_active: boolean; late_fee_balance: number; contract_complete_blocked_by: string[] };
}

interface PayoffResult {
  status: string;
  phase: string;
  next_step_code: string;
  payoff_bill: {
    bill_id: number;
    code_display: string;
    status: string;
    total_amount: number;
    gross?: number;
    discount_amount: number | null;
    installments_count?: number;
  } | null;
  payments?: { method: string; amount: number }[];
  contract?: { id: number; code_display: string; paid_installment_count: number; total_installments: number; late_fee_balance: number };
}

interface WithdrawResult {
  cancelled_bill: { bill_id: number; code_display: string; status: string } | null;
}

/** The words a person reads for a blocked payoff — the same sentence the review
 *  RPC would answer with, built from the preview's reason_code + reason_params. */
export function payoffBlockedText(preview: PayoffPreview | undefined, t: ReturnType<typeof useTranslation>['t']): string {
  if (!preview?.reason_code) return '';
  const params = prepareErrorParams(preview.reason_params, t);
  return translateErrorCode(preview.reason_code, params, t)
    || translateErrorCode(preview.reason_code.toLowerCase(), params, t)
    || translateErrorCode(`${preview.reason_code}_basic`, params, t)
    || preview.reason_code;
}

const PHASE_COLOR: Record<PayoffPhase, 'info' | 'success' | 'danger'> = {
  WAITING_DISCOUNT_APPROVAL: 'info',
  READY_TO_FINISH: 'success',
  DISCOUNT_REJECTED: 'danger',
  DONE: 'success',
  BILL_GONE: 'danger',
};

/** Marks a slip that is tied to a payoff bill, so it never reads as an ordinary
 *  slip waiting for review (whose อนุมัติ would then fail as locked). */
export function SlipPayoffBadge({ row }: { row: Pick<SubmissionRow, 'payoff_phase'> }) {
  const { t } = useTranslation();
  const phase = row.payoff_phase;
  if (!phase) return null;
  return (
    <Badge size="xs" color={PHASE_COLOR[phase] ?? 'default'}>
      {t(`paymentSubmissions.payoffPhase_${phase}`)}
    </Badge>
  );
}

/** Drawer body block: where the payoff stands, the bill it is on, and the discount. */
export function SlipPayoffStatusBox({ row, preview, onNavigate }: {
  row: SubmissionRow;
  preview: PayoffPreview | undefined;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const phase = row.payoff_phase;
  if (!phase) return null;
  // Written out in full: a class name pieced together at runtime is never generated.
  const box =
    PHASE_COLOR[phase] === 'success' ? 'bg-success-soft border-success-border' :
    PHASE_COLOR[phase] === 'danger' ? 'bg-danger-soft border-danger-border' :
    'bg-info-soft border-info-border';
  const title =
    PHASE_COLOR[phase] === 'success' ? 'text-success-fg' :
    PHASE_COLOR[phase] === 'danger' ? 'text-danger-fg' :
    'text-info-fg';
  const decisionReason = preview?.payoff_bill?.discount_decision_reason;
  return (
    <div className={`px-3 py-2.5 rounded-md border ${box}`}>
      <div className={`text-sm font-medium ${title}`}>{t(`paymentSubmissions.payoffPhase_${phase}`)}</div>
      <div className="text-xs text-subtle mt-1">{t(`paymentSubmissions.payoffPhaseHint_${phase}`)}</div>
      {phase === 'DISCOUNT_REJECTED' && decisionReason && (
        <div className="text-xs text-subtle mt-1">
          {t('contract.payoffDiscount_decisionReason')}: {decisionReason}
        </div>
      )}
      <div className="mt-2 space-y-1 text-sm">
        {row.payoff_bill_id != null && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-subtle shrink-0">{t('paymentSubmissions.payoffBill')}</span>
            <span className="text-right inline-flex items-center gap-1.5 flex-wrap justify-end">
              <Link
                to={`/admin/accounting/bills/${row.payoff_bill_id}`}
                className="text-primary-fg inline-flex items-center gap-1 no-underline hover:underline tabular-nums"
                onClick={onNavigate}
              >
                {row.payoff_bill_code_display}
                <ExternalLink size={12} />
              </Link>
              {row.payoff_bill_status && (
                <Badge size="xs" color={row.payoff_bill_status === 'VOIDED' ? 'danger' : 'default'}>
                  {t(`paymentSubmissions.billStatus_${row.payoff_bill_status}`, { defaultValue: row.payoff_bill_status })}
                </Badge>
              )}
            </span>
          </div>
        )}
        {row.payoff_bill_total != null && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-subtle shrink-0">{t('paymentSubmissions.payoffBillTotal')}</span>
            <span className="tabular-nums">{fmtCurrency(row.payoff_bill_total)}</span>
          </div>
        )}
        {row.payoff_discount_amount != null && row.payoff_discount_amount > 0 && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-subtle shrink-0">{t('contract.payoffDiscount_amount')}</span>
            <span className="tabular-nums">
              {fmtCurrency(row.payoff_discount_amount)}
              {row.payoff_discount_status && (
                <span className="text-xs text-subtle"> · {t(`paymentSubmissions.payoffDiscountStatus_${row.payoff_discount_status}`, { defaultValue: row.payoff_discount_status })}</span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Line({ label, value, emphasis, sub }: { label: string; value: string; emphasis?: boolean; sub?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <span className="text-subtle">
        {label}
        {sub && <span className="block text-xs text-subtler">{sub}</span>}
      </span>
      <span className={`tabular-nums text-right ${emphasis ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  );
}

/** Keeps the last non-null value through a modal's close transition. */
function useLast<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(value ?? null);
  if (value != null) ref.current = value;
  return value ?? ref.current;
}

export function SlipPayoffConfirmModal({
  open, row: rowProp, preview: previewProp, onClose, onFinished,
}: {
  open: boolean;
  row: SubmissionRow | null;
  preview: PayoffPreview | undefined;
  onClose: () => void;
  /** The done view was dismissed after a successful press — the slip changed. */
  onFinished: () => void;
}) {
  const { t } = useTranslation();
  const row = useLast(rowProp);
  const preview = useLast(previewProp);
  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PayoffResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  // The slip's money lands on the payoff bill as a TRANSFER payment, and a bill
  // payment only takes one of the branch's two channel accounts — not any account
  // of the branch (the drawer's approve list). Same picker the contract payoff uses.
  const [accountId, setAccountId] = useState<number | null>(null);

  useEffect(() => {
    if (open) { setView('form'); setReason(''); setError(null); setResult(null); setBusy(false); }
  }, [open, rowProp?.id]);

  // The first press of a FIN2 slip below the payoff figure asks for a discount and
  // needs a reason; the second press (discount already agreed) needs nothing more.
  const asksDiscount = !!preview && preview.needs_approval && !preview.payoff_bill;
  const finishing = preview?.phase === 'READY_TO_FINISH';
  const dirty = view === 'form' && reason.trim() !== '';

  const forceClose = () => {
    setConfirmClose(false);
    const finished = view === 'done';
    onClose();
    if (finished) onFinished();
  };
  const handleClose = () => {
    if (busy) return;
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (!row || !preview || accountId == null) return;
    if (asksDiscount && !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.rpc<PayoffResult>('fn_payment_submission_review', {
        p_submission_id: row.id,
        p_action: 'PAYOFF',
        p_bank_account_id: accountId,
        p_discount_reason: asksDiscount ? reason.trim() : null,
      });
      setResult(res);
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const walletLines = preview
    ? (['insurance', 'credit', 'saving'] as const).filter(k => (preview.wallets?.[k] ?? 0) > 0)
    : [];
  const lateFeeAfter = preview?.after_payoff?.late_fee_balance ?? preview?.late_fee_balance ?? 0;
  const capBase = preview?.cap?.base ?? preview?.payoff.gross_remaining ?? 0;

  const doneRows: ActionDoneDetailRow[] = [];
  if (result?.payoff_bill) {
    doneRows.push({ label: t('paymentSubmissions.payoffBill'), value: result.payoff_bill.code_display });
    if (result.payoff_bill.discount_amount) {
      doneRows.push({ label: t('contract.payoffDiscount_amount'), value: fmtCurrency(result.payoff_bill.discount_amount) });
    }
    doneRows.push({ label: t('paymentSubmissions.payoffBillTotal'), value: fmtCurrency(result.payoff_bill.total_amount), emphasis: true });
  }
  for (const p of result?.payments ?? []) {
    doneRows.push({ label: t(`paymentMethod.${p.method}`, { defaultValue: p.method }), value: fmtCurrency(p.amount) });
  }
  if (result?.contract) {
    doneRows.push({
      label: t('paymentSubmissions.payoffInstallmentsPaid'),
      value: `${result.contract.paid_installment_count}/${result.contract.total_installments}`,
    });
    if (result.contract.late_fee_balance > 0) {
      doneRows.push({ label: t('paymentSubmissions.payoffLateFeeLeft'), value: fmtCurrency(result.contract.late_fee_balance) });
    }
  }
  const isDone = result?.phase === 'DONE';
  const contractId = result?.contract?.id ?? preview?.contract.id ?? row?.contract_id;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%" ariaLabel={t('paymentSubmissions.payoffTitle')}>
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('paymentSubmissions.payoffTitle')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={isDone ? t('paymentSubmissions.payoffDoneHeadline') : t('paymentSubmissions.payoffWaitingHeadline')}
              contractCode={result.contract?.code_display ?? preview?.contract.code_display ?? row?.contract_code_display ?? ''}
              contractLink={contractId != null ? { to: `/admin/contracts/search/${contractId}`, onNavigate: forceClose } : undefined}
              tone={isDone ? 'success' : 'neutral'}
              detailRows={doneRows}
              billId={isDone ? result.payoff_bill?.bill_id ?? null : null}
              extras={
                <div className="space-y-2">
                  <div className="alert alert-info">
                    <div className="alert-description text-xs">
                      {t(`paymentSubmissions.payoffNext_${result.next_step_code}`, { defaultValue: '' })
                        || t('paymentSubmissions.payoffContractStaysOpen')}
                    </div>
                  </div>
                </div>
              }
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content min-w-0">
                {row && (
                  <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
                    <div className="font-medium text-sm">{preview?.contract.code_display ?? row.contract_code_display}</div>
                    <div className="text-xs text-subtle">{t('paymentSubmissions.payoffSlipLine', { code: row.code_display ?? row.id })}</div>
                  </div>
                )}

                {preview && (
                  <>
                    <div className="mb-4 rounded-md border border-line divide-y divide-line text-sm">
                      <Line label={t('paymentSubmissions.payoffSlipAmount')} value={fmtCurrency(preview.slip_amount)} />
                      {walletLines.map(k => (
                        <Line
                          key={k}
                          label={t(`paymentSubmissions.payoffWallet_${k}`)}
                          value={fmtCurrency(preview.wallets[k])}
                        />
                      ))}
                      <Line
                        label={t('paymentSubmissions.payoffRemaining', { count: preview.payoff.count_unpaid })}
                        value={fmtCurrency(preview.payoff.gross_remaining)}
                      />
                      {preview.implied_discount > 0 && (
                        <Line
                          label={t('contract.payoffDiscount_amount')}
                          value={fmtCurrency(preview.implied_discount)}
                          emphasis
                          sub={preview.needs_approval && preview.cap
                            ? t('contract.payoffDiscount_cap', {
                              max: fmtCurrency(preview.cap.max_amount),
                              pct: preview.cap.max_pct,
                              base: fmtCurrency(capBase),
                            })
                            : undefined}
                        />
                      )}
                    </div>

                    {asksDiscount && (
                      <div className="mb-4 flex flex-col gap-2">
                        <div className="px-3 py-2.5 rounded-md bg-info-soft border border-info-border">
                          <div className="text-sm font-medium text-info-fg">{t('paymentSubmissions.payoffNeedsApprovalTitle')}</div>
                          <div className="text-xs text-subtle mt-1">{t('paymentSubmissions.payoffNeedsApprovalHint')}</div>
                        </div>
                        <div className="flex flex-col">
                          <label className="form-label">{t('contract.payoffDiscount_reason')} *</label>
                          <TextArea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={t('paymentSubmissions.payoffReasonPlaceholder')}
                            rows={2}
                            disabled={busy}
                          />
                        </div>
                      </div>
                    )}

                    {finishing && (
                      <div className="mb-4 px-3 py-2.5 rounded-md bg-success-soft border border-success-border">
                        <div className="text-sm font-medium text-success-fg">{t('paymentSubmissions.payoffPhase_READY_TO_FINISH')}</div>
                        <div className="text-xs text-subtle mt-1">{t('paymentSubmissions.payoffPhaseHint_READY_TO_FINISH')}</div>
                      </div>
                    )}

                    <div className="mb-4 alert alert-warning">
                      <AlertTriangle size={16} />
                      <div className="alert-description text-xs space-y-1">
                        {lateFeeAfter > 0 && (
                          <div>{t('paymentSubmissions.payoffLateFeeStays', { amount: fmtCurrency(lateFeeAfter) })}</div>
                        )}
                        <div>{t('paymentSubmissions.payoffContractStaysOpen')}</div>
                      </div>
                    </div>

                    <BranchPaymentAccountField
                      active={open}
                      recommendChannel="INSTALLMENT"
                      onResolve={setAccountId}
                    />
                  </>
                )}
              </div>
              <ModalErrorBand message={error} onDismiss={() => setError(null)} />
              <div className="modal-footer">
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void submit()}
                  disabled={busy || !preview || accountId == null || (asksDiscount && !reason.trim())}
                >
                  {busy
                    ? t('common.loading')
                    : asksDiscount ? t('paymentSubmissions.payoffSubmitDiscount') : t('paymentSubmissions.payoffSubmit')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" size="sm" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" size="sm" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}

export function SlipPayoffWithdrawModal({ open, row: rowProp, onClose, onFinished }: {
  open: boolean;
  row: SubmissionRow | null;
  onClose: () => void;
  onFinished: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const row = useLast(rowProp);
  // Company admin withdraws without a branch PIN (DELIVERY §4) — UI visibility only.
  const needsPin = user?.role_code !== 'COMPANY_ADMIN';
  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WithdrawResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) { setView('form'); setNote(''); setPin(''); setError(null); setResult(null); setBusy(false); }
  }, [open, rowProp?.id]);

  const dirty = view === 'form' && (note.trim() !== '' || pin !== '');
  const forceClose = () => {
    setConfirmClose(false);
    const finished = view === 'done';
    onClose();
    if (finished) onFinished();
  };
  const handleClose = () => {
    if (busy) return;
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (!row) return;
    if (needsPin && pin.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.rpc<WithdrawResult>('fn_payment_submission_review', {
        p_submission_id: row.id,
        p_action: 'PAYOFF_WITHDRAW',
        p_branch_id: row.branch_id,
        p_pin: needsPin ? pin : null,
        p_reject_reason: note.trim() || null,
      });
      setResult(res);
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%" ariaLabel={t('paymentSubmissions.payoffWithdrawTitle')}>
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('paymentSubmissions.payoffWithdrawTitle')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>
          {view === 'done' && result ? (
            <ActionDoneView
              headline={t('paymentSubmissions.payoffWithdrawDone')}
              contractCode={row?.contract_code_display ?? ''}
              contractLink={row ? { to: `/admin/contracts/search/${row.contract_id}`, onNavigate: forceClose } : undefined}
              tone="neutral"
              detailRows={result.cancelled_bill
                ? [{ label: t('paymentSubmissions.payoffBillCancelled'), value: result.cancelled_bill.code_display }]
                : []}
              extras={<div className="text-xs text-subtle">{t('paymentSubmissions.payoffWithdrawDoneHint')}</div>}
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content min-w-0">
                {row && (
                  <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
                    <div className="font-medium text-sm">{row.contract_code_display}</div>
                    <div className="text-xs text-subtle">{t('paymentSubmissions.payoffSlipLine', { code: row.code_display ?? row.id })}</div>
                  </div>
                )}
                <div className="form-grid gap-3">
                  <div className="text-sm">
                    {t('paymentSubmissions.payoffWithdrawExplain', { bill: row?.payoff_bill_code_display ?? '—' })}
                  </div>
                  <div className="flex flex-col">
                    <label className="form-label">{t('paymentSubmissions.payoffWithdrawNote')}</label>
                    <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={busy} />
                  </div>
                  {needsPin && <BranchPinInput value={pin} onChange={setPin} required disabled={busy} />}
                </div>
              </div>
              <ModalErrorBand message={error} onDismiss={() => setError(null)} />
              <div className="modal-footer">
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
                <Button
                  color="danger"
                  size="sm"
                  onClick={() => void submit()}
                  disabled={busy || (needsPin && pin.length !== 6)}
                >
                  {busy ? t('common.loading') : t('paymentSubmissions.payoffWithdraw')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" size="sm" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" size="sm" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
