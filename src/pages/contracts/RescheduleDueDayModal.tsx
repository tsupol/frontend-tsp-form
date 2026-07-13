import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, TextArea } from 'tsp-form';
import { XCircle, AlertCircle, Loader2, CheckCircle, CalendarClock } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';
import { DateTime } from '../../components/DateTime';
import { ActionDoneView, type ActionDoneDetailRow } from './ActionDoneView';

/* ─────────────────────────────────────────────────────────────────────────────
   Reschedule due day (RESCHEDULE_DUE_DAY) — เลื่อนวันครบกำหนดชำระ +1..+5 วัน
   from the activation date, only while still inside the 5-day post-activate
   window with zero payments. Doc: UI_SUMMARY/126_CONTRACT_RESCHEDULE_DUE_DAY.md

   ⚠ Two mistakes that hurt real customers (see doc §2.5 / Mistake 0-1):
   1. p_shift_days is the ABSOLUTE total offset from activate (1..5), NOT a delta.
      We send the `shift_days` the view returns verbatim — never compute it.
   2. The PIN field shows only when the evaluator says pin_required (BM=true,
      HQ=false). We take pinRequired straight from fn_contract_available_actions —
      never hard-code it.

   The new due day is not "day N of the current month" — the anchor moves by real
   calendar days across month ends. We render new_first_due / new_due_day from the
   view; the FE never derives a date.
   ──────────────────────────────────────────────────────────────────────────── */

interface ContractForReschedule {
  id: number;
  code: string;
  code_display: string | null;
}

// api.v_contract_reschedule_options — one row per shift_days (1..5)
interface RescheduleOption {
  contract_id: number;
  current_due_day: number;
  current_shift_days: number;
  current_first_due: string | null;
  reschedule_deadline: string | null;
  shift_days: number;          // absolute total offset from activate — send verbatim
  new_due_day: number;
  new_first_due: string;
  is_selectable: boolean;
  not_selectable_reason: 'unstable_day' | 'current_due_day' | null;
}

interface RescheduleResult {
  contract_id: number;
  contract_code_display: string | null;
  shift_days: number;
  previous_shift_days: number;
  old_due_day: number;
  new_due_day: number;
  old_first_due: string;
  new_first_due: string;
  installments_shifted: number;
  pin_used: boolean;
  next_due_date: string | null;
  next_due_amount: number | null;
}

const MIN_REASON_LEN = 10;

export function RescheduleDueDayModal({ open, contract, pinRequired, onClose, onSuccess }: {
  open: boolean;
  contract: ContractForReschedule | null;
  /** From fn_contract_available_actions.pin_required — BM=true, HQ=false. Never hard-code. */
  pinRequired: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [selectedShift, setSelectedShift] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RescheduleResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const { data: options, isLoading, isError } = useQuery({
    queryKey: ['contract-reschedule-options', contract?.id],
    queryFn: () => apiClient.get<RescheduleOption[]>(
      `/v_contract_reschedule_options?contract_id=eq.${contract!.id}&order=shift_days`,
    ),
    enabled: open && !!contract,
    staleTime: 30 * 1000,
  });

  const meta = options?.[0] ?? null;

  const resetForm = () => {
    setView('form');
    setSelectedShift(null);
    setReason('');
    setPin('');
    setError('');
    setSubmitting(false);
    setResult(null);
    setConfirmClose(false);
  };

  useEffect(() => {
    if (open) resetForm();
  }, [open]);

  const reasonTrimmedLen = reason.trim().length;
  const isDirty = selectedShift !== null || reasonTrimmedLen > 0 || pin.length > 0;

  // ── Validation (disables Confirm; each field carries its own inline hint) ──
  const formValid = selectedShift !== null
    && reasonTrimmedLen >= MIN_REASON_LEN
    && (!pinRequired || pin.length === 6);
  const canSubmit = formValid && !submitting && !!contract && !!meta;

  const handleConfirm = async () => {
    if (!canSubmit || !contract || selectedShift === null) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiClient.rpc<RescheduleResult>('fn_contract_reschedule_due_day', {
        p_contract_id: contract.id,
        p_shift_days: selectedShift,           // absolute total offset — verbatim from view
        p_reason: reason.trim(),
        p_pin: pinRequired ? pin : null,
      });
      setResult(res);
      setView('done');
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Close handling (write-modal checklist rule 3) ────────────────────────
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const contractCode = contract?.code_display ?? contract?.code ?? '';

  const doneDetailRows: ActionDoneDetailRow[] = result ? [
    {
      label: t('reschedule.newDueDayLabel'),
      value: t('reschedule.dayOfMonth', { day: result.new_due_day }),
      emphasis: true,
    },
    {
      label: t('reschedule.firstDueLabel'),
      value: <DateTime value={result.new_first_due} showTime={false} />,
    },
    { label: t('reschedule.installmentsShifted'), value: String(result.installments_shifted) },
    ...(result.next_due_date
      ? [{ label: t('reschedule.nextDue'), value: <DateTime value={result.next_due_date} showTime={false} /> }]
      : []),
  ] : [];

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="34rem" width="100%" ariaLabel="Reschedule due day">
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('reschedule.title')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={t('reschedule.done')}
              contractCode={result.contract_code_display ?? contractCode}
              detailRows={doneDetailRows}
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content flex flex-col gap-4">
                {/* Contract target */}
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                  {meta && (
                    <div className="text-xs text-subtle mt-0.5">
                      {t('reschedule.currentSchedule', { day: meta.current_due_day })}
                      {meta.current_first_due && (
                        <>
                          {' · '}
                          {t('reschedule.firstDueShort')}{' '}
                          <DateTime value={meta.current_first_due} showTime={false} />
                        </>
                      )}
                    </div>
                  )}
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center py-8 text-subtle">
                    <Loader2 size={24} className="animate-spin" />
                  </div>
                ) : isError || !meta ? (
                  <div className="alert alert-warning">
                    <AlertCircle size={16} />
                    <div className="alert-description">{t('reschedule.notAvailable')}</div>
                  </div>
                ) : (
                  <>
                    {/* Day picker */}
                    <div className="flex flex-col gap-2">
                      <label className="form-label">{t('reschedule.pickNewDay')}</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {options!.map((opt) => {
                          const isCurrent = opt.not_selectable_reason === 'current_due_day';
                          const disabled = !opt.is_selectable;
                          const selected = selectedShift === opt.shift_days;
                          return (
                            <button
                              key={opt.shift_days}
                              type="button"
                              disabled={disabled}
                              onClick={() => setSelectedShift(opt.shift_days)}
                              className={[
                                'flex items-center justify-between gap-2 px-3 py-2.5 rounded-md border text-left transition-colors',
                                selected
                                  ? 'border-primary bg-primary-soft'
                                  : 'border-line bg-surface',
                                disabled
                                  ? 'opacity-50 cursor-not-allowed'
                                  : 'cursor-pointer hover:border-primary',
                              ].join(' ')}
                            >
                              <div className="flex flex-col min-w-0">
                                <span className="text-sm font-medium">
                                  {t('reschedule.dayOfMonth', { day: opt.new_due_day })}
                                </span>
                                <span className="text-xs text-subtle">
                                  {t('reschedule.firstDueShort')}{' '}
                                  <DateTime value={opt.new_first_due} showTime={false} />
                                </span>
                              </div>
                              {isCurrent ? (
                                <span className="text-[11px] text-subtle shrink-0">
                                  {t('reschedule.currentTag')}
                                </span>
                              ) : opt.not_selectable_reason === 'unstable_day' ? (
                                <span className="text-[11px] text-subtle shrink-0">
                                  {t('reschedule.unstableTag')}
                                </span>
                              ) : selected ? (
                                <CheckCircle size={16} className="text-primary shrink-0" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Reason — mandatory free text ≥10 chars */}
                    <div className="flex flex-col">
                      <label className="form-label">{t('reschedule.reasonLabel')}</label>
                      <TextArea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        placeholder={t('reschedule.reasonPlaceholder')}
                      />
                      <div className="text-[11px] text-subtle mt-1">
                        {t('reschedule.reasonHint', { min: MIN_REASON_LEN, count: reasonTrimmedLen })}
                      </div>
                    </div>

                    {/* PIN — only when the evaluator says so (BM), never hard-coded */}
                    {pinRequired && (
                      <BranchPinInput value={pin} onChange={setPin} required />
                    )}

                    {/* Deadline reminder */}
                    {meta?.reschedule_deadline && (
                      <div className="flex items-center gap-2 text-xs text-subtle">
                        <CalendarClock size={14} className="shrink-0" />
                        <span>
                          {t('reschedule.deadlineNote')}{' '}
                          <DateTime value={meta.reschedule_deadline} showTime={false} />
                          {' · '}
                          {t('reschedule.customerNotified')}
                        </span>
                      </div>
                    )}
                  </>
                )}

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
                  startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                  onClick={handleConfirm}
                >
                  {submitting ? t('common.loading') : t('reschedule.confirm')}
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
