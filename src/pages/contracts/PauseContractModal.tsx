import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { XCircle, User, Phone, Smartphone, Wrench, Loader2, PauseCircle, AlertCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';
import { DateTime } from '../../components/DateTime';
import { formatTel, fmtCurrency } from '../../lib/format';
import { ActionDoneView, type ActionDoneDetailRow } from './ActionDoneView';
import { useContractInvalidate } from './useContractInvalidate';

/* ─────────────────────────────────────────────────────────────────────────────
   Pause contract (พักชำระ · PAUSE_CONTRACT) — FLOW A of the pause/resume rebuild.
   Doc: UI_FEEDBACK/2026-07-20_PAUSE_RESUME_IMPLEMENTATION_GUIDE.md §2.

   Mental model: device is in for repair, customer has no device to use, so the
   shop freezes the debt clock — no late fees, no dunning, overdue clock stops.
   Open-ended until resume. This is ONE person + PIN + a free-text reason, done
   instantly — NOT symmetric with resume (which issues a 4-signature schedule).

   check_pausable returns the whole confirm screen in one call (§7.3 — never fan
   out to several endpoints). PIN is required for pause (§0.4: hardcode, the flags
   can't be trusted — pause needs PIN, resume/repossess don't). Reason is free
   text ≥10 chars, NOT a dropdown (§7.4: a dropdown gets first-option-spammed).
   ──────────────────────────────────────────────────────────────────────────── */

const MIN_REASON_LEN = 10;

interface PauseDevice {
  asset_id: number;
  asset_code: string;
  serial_no: string | null;
  imei: string | null;
  current_bucket: string;
  product_display_name: string | null;
}
interface PauseContract { contract_id: number; code_display: string; state: string; is_paused: boolean }
interface PauseCustomer { customer_id: number; full_name: string; tel: string | null }
interface PauseRepairOrder {
  repair_order_id: number;
  repair_no: string;
  status: string;
  intake_at: string | null;
  completed_at: string | null;
}
interface PauseDebt {
  overdue_days: number;
  overdue_count: number;
  overdue_amount: number;
  situation_code: string | null;
}

// fn_contract_check_pausable — the full confirm screen in one shot.
interface CheckPausableResult {
  allowed: boolean;
  reason: string | null;
  contract: PauseContract;
  customer: PauseCustomer;
  primary_device: PauseDevice | null;
  repair_order: PauseRepairOrder | null;   // nullable — no open repair order isn't a blocker (§2 A2)
  debt: PauseDebt;
}

interface PauseResult {
  contract_id: number;
  pause_id: number;
  paused_from: string;
  is_paused: boolean;
  next_action: string | null;   // null = terminal, no follow-up (unlike resume)
}

function apiErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    return (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '')
      || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export function PauseContractModal({ open, contract, onClose, onSuccess }: {
  open: boolean;
  contract: { id: number; code_display: string | null; code: string } | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useContractInvalidate(contract?.id ?? 0);

  const [view, setView] = useState<'form' | 'done'>('form');
  const [check, setCheck] = useState<CheckPausableResult | null>(null);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loadingCheck, setLoadingCheck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PauseResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const runCheck = useCallback(async (contractId: number) => {
    setLoadingCheck(true);
    setError('');
    try {
      const res = await apiClient.rpc<CheckPausableResult>('fn_contract_check_pausable', {
        p_contract_id: contractId,
      });
      setCheck(res);
    } catch (err) {
      setError(apiErr(err, t));
    } finally {
      setLoadingCheck(false);
    }
  }, [t]);

  useEffect(() => {
    if (open && contract) {
      setView('form');
      setCheck(null);
      setReason('');
      setPin('');
      setError('');
      setResult(null);
      setConfirmClose(false);
      runCheck(contract.id);
    }
  }, [open, contract, runCheck]);

  const reasonTrimmedLen = reason.trim().length;
  const isDirty = reasonTrimmedLen > 0 || pin.length > 0;

  // Reason ≥10 chars + 6-digit PIN, and the backend must say it's pausable.
  const formValid = reasonTrimmedLen >= MIN_REASON_LEN && pin.length === 6;
  const canSubmit = formValid && check?.allowed === true && !submitting;

  const handleConfirm = async () => {
    if (!canSubmit || !contract) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiClient.rpc<PauseResult>('fn_contract_pause', {
        p_contract_id: contract.id,
        p_note: reason.trim(),
        p_pin: pin,
      });
      setResult(res);
      setView('done');
      invalidate();
      onSuccess();
    } catch (err) {
      setError(apiErr(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const contractCode = check?.contract.code_display ?? contract?.code_display ?? contract?.code ?? '';
  const device = check?.primary_device;
  const deviceIdentifier = device?.serial_no ?? device?.imei;

  const doneDetailRows: ActionDoneDetailRow[] = result ? [
    {
      label: t('pause.done_pausedFrom'),
      value: <DateTime value={result.paused_from} showTime={false} />,
      emphasis: true,
    },
  ] : [];

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%" ariaLabel="Pause contract">
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('pause.title')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>×</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={t('pause.done_headline')}
              contractCode={contractCode}
              detailRows={doneDetailRows}
              extras={
                <div className="alert alert-info">
                  <PauseCircle size={16} />
                  <span>{t('pause.done_note')}</span>
                </div>
              }
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content flex flex-col gap-4">
                {/* Contract target */}
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                  <div className="text-xs text-subtle mt-0.5">{t('pause.intro')}</div>
                </div>

                {loadingCheck ? (
                  <div className="flex items-center justify-center py-8 text-subtle">
                    <Loader2 size={24} className="animate-spin" />
                  </div>
                ) : check ? (
                  <>
                    {/* Blocked — show reason instead of the confirm form (§2 A2) */}
                    {!check.allowed && (
                      <div className="alert alert-warning">
                        <AlertCircle size={16} />
                        <div className="alert-description">
                          {check.reason
                            ? t(`pause.blocked_${check.reason}`, { defaultValue: t('pause.blocked_generic') })
                            : t('pause.blocked_generic')}
                        </div>
                      </div>
                    )}

                    {/* Customer — staff confirms identity, can't do it for them */}
                    <div className="rounded-md border border-line px-3 py-3 bg-surface flex flex-col gap-3">
                      <div className="flex items-center gap-2 text-sm">
                        <User size={14} className="text-subtle shrink-0" />
                        <span className="font-medium truncate">{check.customer.full_name}</span>
                        {check.customer.tel && (
                          <span className="inline-flex items-center gap-1 text-xs text-subtle shrink-0 tabular-nums">
                            <Phone size={11} />{formatTel(check.customer.tel)}
                          </span>
                        )}
                      </div>

                      {/* Device in for repair */}
                      {device && (
                        <div className="flex items-start gap-2 text-sm">
                          <Wrench size={14} className="text-warning-fg shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs text-subtle">{t('pause.deviceInRepair')}</div>
                            <div className="truncate">{device.product_display_name ?? device.asset_code}</div>
                            <div className="text-xs text-subtle font-mono">
                              {device.asset_code}{deviceIdentifier ? ` · ${deviceIdentifier}` : ''}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Repair order — optional (§2 A2 note) */}
                      {check.repair_order && (
                        <div className="text-xs text-subtle flex items-center gap-1.5">
                          <Smartphone size={12} className="shrink-0" />
                          {t('pause.repairNo')}: <span className="font-mono">{check.repair_order.repair_no}</span>
                        </div>
                      )}
                    </div>

                    {/* Current overdue — pausing is allowed even while overdue; staff
                        must SEE they're pausing someone who owes N installments (§2 A2). */}
                    {check.debt.overdue_count > 0 && (
                      <div className="rounded-md border border-warning-border bg-warning-soft px-3 py-2.5 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-warning-fg">
                            {t('pause.overdueWarn', { count: check.debt.overdue_count })}
                          </span>
                          <span className="font-semibold tabular-nums text-warning-fg">
                            {fmtCurrency(check.debt.overdue_amount)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Reason — mandatory free text ≥10 chars (NOT a dropdown) */}
                    {check.allowed && (
                      <>
                        <div className="flex flex-col">
                          <label className="form-label">{t('pause.reasonLabel')}</label>
                          <TextArea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={2}
                            placeholder={t('pause.reasonPlaceholder')}
                          />
                          <div className="text-[11px] text-subtle mt-1">
                            {t('pause.reasonHint', { min: MIN_REASON_LEN, count: reasonTrimmedLen })}
                          </div>
                        </div>

                        {/* PIN — always required for pause (§0.4) */}
                        <BranchPinInput value={pin} onChange={setPin} required />
                      </>
                    )}
                  </>
                ) : null}

                {error && (
                  <div className="alert alert-danger">
                    <XCircle size={16} />
                    <div className="alert-description">{error}</div>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                <Button
                  color="primary"
                  disabled={!canSubmit}
                  startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <PauseCircle size={16} />}
                  onClick={handleConfirm}
                >
                  {submitting ? t('common.loading') : t('pause.confirm')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Discard-confirm sub-modal (always mounted) */}
      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
