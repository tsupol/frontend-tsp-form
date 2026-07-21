import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { XCircle, Loader2, CheckCircle, FileSignature, AlertTriangle, CalendarClock } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { ActionDoneView } from './ActionDoneView';
import { useContractInvalidate } from './useContractInvalidate';

/* ─────────────────────────────────────────────────────────────────────────────
   Resume contract (ปลดพัก + ออกตารางใหม่ · RESUME_CONTRACT) — FLOW B of the
   pause/resume rebuild. Doc: UI_FEEDBACK/2026-07-20_PAUSE_RESUME_IMPLEMENTATION_GUIDE.md §3.

   ⭐ The most important — and most user-confusing — screen of the feature.

   Resume is NOT symmetric with pause. Pressing "resume" does NOT resume the
   contract; it ISSUES a new-schedule proposal that must be signed by 4 people
   (customer + lessor + 2 witnesses). The schedule only shifts on SEAL. So:

     resume_preview  → read-only, no PIN, no document — call as many times as you
                       like while the user flips between date options (§3 B1).
     resume          → issues the signing doc (resumed:false / rescheduled:false
                       is NOT an error — it means "awaiting signatures"). NO PIN
                       (§0.4, §7.8 — the RPC has no p_pin param).

   Hard rules of the B1 screen (§3 B1 / §7):
     - is_selectable=false → disable the option + explain via not_selectable_reason
     - ALWAYS show unchanged[] if present ("not shifted, still due as before") —
       hiding it makes the customer think old debt shifted too (§7.7)
     - FE never computes dates — send the chosen adjust_days back verbatim (§7)
     - always show "installment count / total unchanged" so the customer doesn't
       think the debt grew

   Re-confirming (changing the date choice) just re-calls fn_contract_resume; the
   old proposal auto-voids, leaving exactly one COLLECTING doc (§3 B2). No manual
   void needed.
   ──────────────────────────────────────────────────────────────────────────── */

interface ResumeOption {
  adjust_days: number;
  final_shift_days: number;
  new_first_due: string;
  new_due_day: number;
  is_selectable: boolean;
  not_selectable_reason: string | null;   // 'unstable_day' | ...
}

interface ResumeShiftedInstallment {
  pay_no: number;
  old_due_date: string;
  new_due_date: string;
  due_amount: number;
  paid_amount: number;
}

interface ResumeUnchangedInstallment {
  pay_no: number;
  due_date: string;
  due_amount: number;
  paid_amount: number;
  reason: string;   // 'OVERDUE_BEFORE_PAUSE'
}

interface ResumePreview {
  contract: { contract_id: number; code_display: string; state: string };
  pause: {
    pause_id: number;
    paused_from: string;
    resume_date: string;
    pause_days: number;
    reason_code: string;
    note: string | null;
  };
  shift: { pause_duration_days: number; staff_adjust_days: number; final_shift_days: number };
  options: ResumeOption[];
  installments: ResumeShiftedInstallment[];
  unchanged: ResumeUnchangedInstallment[];
  summary: {
    shifted_count: number;
    unchanged_count: number;
    new_first_due: string;
    new_due_day: number;
    total_installments: number;
  };
}

interface ResumeResult {
  contract_id: number;
  signing_id: number;
  signing_status: string;
  resumed: boolean;       // false at issue — schedule hasn't moved yet
  rescheduled: boolean;   // false at issue — awaiting signatures
  next_action: string;    // 'COLLECT_SIGNATURES'
}

function apiErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    return (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '')
      || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export function ResumeContractModal({ open, contract, onClose, onSuccess, onNavigateSigning }: {
  open: boolean;
  contract: { id: number; code_display: string | null; code: string } | null;
  onClose: () => void;
  onSuccess: () => void;
  onNavigateSigning?: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useContractInvalidate(contract?.id ?? 0);

  const [view, setView] = useState<'form' | 'done'>('form');
  const [preview, setPreview] = useState<ResumePreview | null>(null);
  const [selectedAdjust, setSelectedAdjust] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ResumeResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const loadPreview = useCallback(async (contractId: number) => {
    setLoadingPreview(true);
    setError('');
    try {
      const res = await apiClient.rpc<ResumePreview>('fn_contract_resume_preview', {
        p_contract_id: contractId,
        p_adjust_days: null,   // preview the default shift; options[] carries the alternatives
      });
      setPreview(res);
      // Default-select the 0-adjust option (the plain pause-duration shift).
      const zero = res.options.find(o => o.adjust_days === 0 && o.is_selectable);
      setSelectedAdjust(zero ? 0 : (res.options.find(o => o.is_selectable)?.adjust_days ?? null));
    } catch (err) {
      setError(apiErr(err, t));
    } finally {
      setLoadingPreview(false);
    }
  }, [t]);

  useEffect(() => {
    if (open && contract) {
      setView('form');
      setPreview(null);
      setSelectedAdjust(null);
      setError('');
      setResult(null);
      setConfirmClose(false);
      loadPreview(contract.id);
    }
  }, [open, contract, loadPreview]);

  const isDirty = selectedAdjust !== null;
  const canSubmit = selectedAdjust !== null && !submitting && !!preview;

  const handleConfirm = async () => {
    if (!canSubmit || !contract || selectedAdjust === null) return;
    setSubmitting(true);
    setError('');
    try {
      // NO p_pin — signatures are the control (§7.8). Send the chosen adjust_days
      // verbatim; the FE never computes the resulting dates.
      const res = await apiClient.rpc<ResumeResult>('fn_contract_resume', {
        p_contract_id: contract.id,
        p_adjust_days: selectedAdjust,
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
    // Preview is read-only and generates no garbage; only treat an actual date
    // pick as dirty. Even then, nothing is persisted until confirm — a light guard.
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const contractCode = preview?.contract.code_display ?? contract?.code_display ?? contract?.code ?? '';
  const selectedOption = preview?.options.find(o => o.adjust_days === selectedAdjust) ?? null;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="42rem" width="100%" ariaLabel="Resume contract">
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '92dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('resume.title')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>×</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={t('resume.done_headline')}
              contractCode={contractCode}
              tone="neutral"
              detailRows={selectedOption ? [
                {
                  label: t('resume.done_newFirstDue'),
                  value: <DateTime value={selectedOption.new_first_due} showTime={false} />,
                  emphasis: true,
                },
                {
                  label: t('resume.done_newDueDay'),
                  value: t('resume.dayOfMonth', { day: selectedOption.new_due_day }),
                },
              ] : []}
              extras={
                <div className="alert alert-info">
                  <FileSignature size={16} />
                  <span>{t('resume.done_awaitSign')}</span>
                </div>
              }
              secondaryAction={onNavigateSigning ? {
                label: t('resume.goToSigning'),
                startIcon: <FileSignature size={14} />,
                onClick: () => { onNavigateSigning(); forceClose(); },
              } : undefined}
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content flex flex-col gap-4">
                {/* Contract + pause span */}
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                  {preview && (
                    <div className="text-xs text-subtle mt-0.5">
                      {t('resume.pauseSpan', { days: preview.pause.pause_days })}{' '}
                      (<DateTime value={preview.pause.paused_from} showTime={false} />{' → '}
                      <DateTime value={preview.pause.resume_date} showTime={false} />)
                    </div>
                  )}
                </div>

                {loadingPreview ? (
                  <div className="flex items-center justify-center py-8 text-subtle">
                    <Loader2 size={24} className="animate-spin" />
                  </div>
                ) : preview ? (
                  <>
                    {/* Date-option picker (radio) — §3 B1 */}
                    <div className="flex flex-col gap-2">
                      <label className="form-label">{t('resume.pickNewDate')}</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {preview.options.map((opt) => {
                          const disabled = !opt.is_selectable;
                          const selected = selectedAdjust === opt.adjust_days;
                          return (
                            <button
                              key={opt.adjust_days}
                              type="button"
                              disabled={disabled}
                              onClick={() => setSelectedAdjust(opt.adjust_days)}
                              title={disabled && opt.not_selectable_reason
                                ? t(`resume.notSelectable_${opt.not_selectable_reason}`, { defaultValue: '' })
                                : undefined}
                              className={[
                                'flex items-center justify-between gap-2 px-3 py-2.5 rounded-md border text-left transition-colors',
                                selected ? 'border-primary bg-primary-soft' : 'border-line bg-surface',
                                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary',
                              ].join(' ')}
                            >
                              <div className="flex flex-col min-w-0">
                                <span className="text-sm font-medium">
                                  {t('resume.shiftDays', { days: opt.final_shift_days })}
                                </span>
                                <span className="text-xs text-subtle">
                                  {t('resume.nextDueShort')}{' '}
                                  <DateTime value={opt.new_first_due} showTime={false} />
                                </span>
                              </div>
                              {disabled && opt.not_selectable_reason ? (
                                <span className="text-[11px] text-subtle shrink-0">
                                  {t(`resume.notSelectableTag_${opt.not_selectable_reason}`, { defaultValue: t('resume.notSelectableTag_generic') })}
                                </span>
                              ) : selected ? (
                                <CheckCircle size={16} className="text-primary shrink-0" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Shifted installments */}
                    {preview.installments.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <label className="form-label">
                          {t('resume.shiftedTable', { count: preview.summary.shifted_count })}
                        </label>
                        <div className="rounded-md border border-line overflow-hidden">
                          {preview.installments.map((inst) => (
                            <div
                              key={inst.pay_no}
                              className="flex items-center justify-between gap-3 px-3 py-2 border-b border-line last:border-b-0 text-sm"
                            >
                              <span className="text-subtle shrink-0 w-16">
                                {t('resume.installmentNo', { no: inst.pay_no })}
                              </span>
                              <span className="flex items-center gap-1.5 min-w-0 flex-1 justify-center text-xs">
                                <DateTime value={inst.old_due_date} showTime={false} />
                                <span className="text-subtler">→</span>
                                <span className="font-medium"><DateTime value={inst.new_due_date} showTime={false} /></span>
                              </span>
                              <span className="tabular-nums shrink-0">{fmtCurrency(inst.due_amount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Unchanged installments — overdue-before-pause, NOT shifted.
                        MUST always show if present, or the customer thinks old debt
                        shifted too (§7.7). */}
                    {preview.unchanged.length > 0 && (
                      <div className="rounded-md border border-warning-border bg-warning-soft px-3 py-2.5 flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 text-sm text-warning-fg font-medium">
                          <AlertTriangle size={14} className="shrink-0" />
                          {t('resume.unchangedWarn')}
                        </div>
                        {preview.unchanged.map((inst) => (
                          <div key={inst.pay_no} className="flex items-center justify-between gap-3 text-sm text-warning-fg">
                            <span>
                              {t('resume.installmentNo', { no: inst.pay_no })}{' · '}
                              <DateTime value={inst.due_date} showTime={false} />{' '}
                              <span className="text-xs">({t('resume.unchangedTag')})</span>
                            </span>
                            <span className="tabular-nums">{fmtCurrency(inst.due_amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Count / total unchanged reassurance (§7) */}
                    <div className="flex items-center gap-2 text-xs text-subtle">
                      <CalendarClock size={14} className="shrink-0" />
                      <span>
                        {t('resume.totalUnchanged', { count: preview.summary.total_installments })}
                      </span>
                    </div>
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
                  startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <FileSignature size={16} />}
                  onClick={handleConfirm}
                >
                  {submitting ? t('common.loading') : t('resume.confirmIssue')}
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
