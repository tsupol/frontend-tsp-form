import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, TextArea, MaskedInput } from 'tsp-form';
import { XCircle, AlertCircle, Loader2, CheckCircle, ArrowRight, Printer } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';
import { DateTime } from '../../components/DateTime';
import { ActionDoneView, type ActionDoneDetailRow } from './ActionDoneView';
import { ContractPreviewModal } from './ContractPreviewModal';
import type { ContractMin } from '../../lib/contractPdf/contractMin';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency } from '../../lib/format';
import { ModalErrorBand } from '../../components/ModalErrorBand';

/* ─────────────────────────────────────────────────────────────────────────────
   Amend signed terms — correct the instalment or the number of instalments on a
   contract the customer has already signed, agreed by phone, without calling
   them back to sign again.
   Spec: UI_FEEDBACK/2026-09-15_SPEC_contract_amend_signed_terms.md

   Why it exists: eight corrections since August each needed a developer to edit
   a signed document by hand. One of those was edited after all four signatures
   were captured against the old figures, so that document no longer records
   what the customer signed.

   ⚠ Three rules from the spec that are easy to get wrong:
   1. NEVER compute the total or the discount here. Both come from the preview,
      or what the user approves won't match what gets written.
   2. The PIN is the OWNING BRANCH's, not the admin's — an admin sits in the
      office and has to ask the branch for it. The field says which branch.
   3. The down payment is shown but never editable: it is already paid and tied
      to a bill and a closed day.

   The spec said the write call was not deployed. It is — checked live on
   2026-09-15, preview answers and returns the shape below, minus two blocks the
   spec promised (the schedule-change summary and the addendum), which arrive
   only on commit. Both are optional here.
   ──────────────────────────────────────────────────────────────────────────── */

/** The server refuses anything above this (checked live: 61 is rejected and
 *  names the limit, 60 passes). Catching it here saves a round trip. */
const TERM_MONTHS_MAX = 60;

interface ContractForAmend {
  id: number;
  code: string;
  code_display: string | null;
  branch_name?: string | null;
}

/** api.v_contract_rate_comparison — `cur_*` is what the contract holds today.
 *  The `snap_*` columns are a rate-card baseline, NOT the live terms. */
interface RateComparison {
  cur_installment_amount: number | null;
  cur_term_months: number | null;
  cur_down_amount: number | null;
  cur_agreed_price: number | null;
  cur_installment_total: number | null;
  discount_amount: number | null;
  discount_percent: number | null;
  is_financial_locked: boolean;
}

interface AmendTerms {
  installment_amount: number;
  value_month: number;
  agreed_price: number;
  discount_amount: number;
  discount_percent: number;
  installment_total: number;
}

interface AmendResult {
  contract_id: number;
  code_display: string | null;
  before: AmendTerms;
  after: AmendTerms;
  down_payment: number;
  schedule_preview: Array<{ pay_no: number; due_date: string; due_amount: number; status: string }>;
  /** Absent on preview (measured live 2026-09-15) — present only on commit,
   *  so every read of it must cope with it missing. */
  schedule_change?: {
    rows_added: number;
    rows_removed: number;
    rows_updated: number;
    last_installment_amount: number;
  };
  discount_policy: {
    needs_approval: boolean;
    max_discount_percent?: number;
    excess_discount_percent?: number;
  };
  addendum?: { signing_id: number; change_reason: string; doc_kind: string; requires_sign: boolean };
  applied: boolean;
}

export function AmendSignedTermsModal({ open, contract, pinRequired, onClose, onSuccess }: {
  open: boolean;
  contract: ContractForAmend | null;
  /** From fn_contract_available_actions.pin_required — never hard-code. */
  pinRequired: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [installmentStr, setInstallmentStr] = useState('');
  const [termStr, setTermStr] = useState('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<AmendResult | null>(null);
  const [result, setResult] = useState<AmendResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [previewDocOpen, setPreviewDocOpen] = useState(false);

  const { data: current, isLoading, isError } = useQuery({
    queryKey: ['contract-rate-comparison', contract?.id],
    queryFn: () => apiClient.get<RateComparison[]>(
      `/v_contract_rate_comparison?contract_id=eq.${contract!.id}`
      + '&select=cur_installment_amount,cur_term_months,cur_down_amount,cur_agreed_price'
      + ',cur_installment_total,discount_amount,discount_percent,is_financial_locked',
    ).then(rows => rows[0] ?? null),
    enabled: open && !!contract,
    staleTime: 30 * 1000,
  });

  const resetForm = () => {
    setView('form');
    setInstallmentStr('');
    setTermStr('');
    setReason('');
    setPin('');
    setError('');
    setPreview(null);
    setResult(null);
    setPreviewing(false);
    setSubmitting(false);
    setConfirmClose(false);
    setScheduleOpen(false);
  };

  useEffect(() => {
    if (open) resetForm();
  }, [open]);

  // Seed the boxes with what the contract holds, so the form opens on the
  // current terms and the user edits from there.
  useEffect(() => {
    if (!current) return;
    if (current.cur_installment_amount != null) setInstallmentStr(String(current.cur_installment_amount));
    if (current.cur_term_months != null) setTermStr(String(current.cur_term_months));
  }, [current]);

  const installment = installmentStr === '' ? null : parseFloat(installmentStr);
  const term = termStr === '' ? null : parseInt(termStr, 10);

  const changedFromCurrent = !!current && (
    installment !== current.cur_installment_amount || term !== current.cur_term_months
  );
  const isDirty = changedFromCurrent || reason.trim().length > 0 || pin.length > 0;

  const termTooLong = term != null && term > TERM_MONTHS_MAX;
  const inputsValid = installment != null && installment > 0
    && term != null && term > 0 && !termTooLong;
  const canPreview = inputsValid && changedFromCurrent && !previewing && !!contract;
  const canSubmit = !!preview && !submitting && (!pinRequired || pin.length === 6);

  // A preview describes one specific pair of figures; editing them makes it
  // stale, so drop it rather than let the user confirm something they changed.
  useEffect(() => {
    setPreview(null);
  }, [installmentStr, termStr]);

  const callAmend = (isPreview: boolean) => apiClient.rpc<AmendResult>('fn_contract_amend_signed_terms', {
    p_contract_id: contract!.id,
    p_installment_amount: installment,
    p_value_month: term,
    ...(reason.trim() ? { p_reason: reason.trim() } : {}),
    p_preview: isPreview,
    ...(isPreview ? {} : { p_pin: pinRequired ? pin : null }),
  });

  const handlePreview = async () => {
    if (!canPreview) return;
    setPreviewing(true);
    setError('');
    try {
      setPreview(await callAmend(true));
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiError ? (translateApiError(err, t) || err.message) : String(err));
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await callAmend(false);
      setResult(res);
      setView('done');
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? (translateApiError(err, t) || err.message) : String(err));
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

  const schedule = preview?.schedule_preview ?? [];
  const lastDiffers = schedule.length > 1
    && schedule[schedule.length - 1].due_amount !== schedule[0].due_amount;

  const contractCode = contract?.code_display ?? contract?.code ?? '';

  // Only the commit response carries the addendum, so this is null until the
  // change is written — which is also the only time the document exists.
  const amendSigningId = result?.addendum?.signing_id ?? null;

  // The preview viewer reads only these three; everything else on ContractMin
  // is a display fallback for call sites that render the full lease packet.
  const contractForPreview: ContractMin | null = contract
    ? ({ id: contract.id, code: contract.code, code_display: contract.code_display } as ContractMin)
    : null;

  const doneDetailRows: ActionDoneDetailRow[] = result ? [
    {
      label: t('amendTerms.installmentLabel'),
      value: `${fmtCurrency(result.before.installment_amount)} → ${fmtCurrency(result.after.installment_amount)}`,
      emphasis: true,
    },
    {
      label: t('amendTerms.termLabel'),
      value: `${result.before.value_month} → ${result.after.value_month}`,
      emphasis: result.before.value_month !== result.after.value_month,
    },
    {
      label: t('amendTerms.scheduleUpdated'),
      value: String(result.schedule_change?.rows_updated ?? result.schedule_preview?.length ?? 0),
    },
  ] : [];

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="40rem" width="100%" ariaLabel="Amend signed terms">
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('amendTerms.title')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={t('amendTerms.done')}
              contractCode={result.code_display ?? contractCode}
              detailRows={doneDetailRows}
              extras={
                <div className="text-xs text-subtle">{t('amendTerms.addendumNote')}</div>
              }
              /* The change record renders through the ordinary contract PDF
                 route, addressed by the addendum's own signing id (BE answer
                 2026-09-16). It carries no customer signature line, so there is
                 nothing to collect — staff just file or hand over a copy.
                 Absent only if the server omitted the addendum block. */
              secondaryAction={amendSigningId != null ? {
                label: t('amendTerms.printAddendum'),
                startIcon: <Printer size={16} />,
                onClick: () => setPreviewDocOpen(true),
              } : undefined}
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content flex flex-col gap-4 [&>*]:shrink-0">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                  <div className="text-xs text-subtle mt-0.5">{t('amendTerms.intro')}</div>
                </div>

                {isLoading && (
                  <div className="flex items-center gap-2 text-sm text-subtle">
                    <Loader2 size={14} className="animate-spin" />
                    <span>{t('common.loading')}</span>
                  </div>
                )}

                {isError && (
                  <div className="alert alert-danger">
                    <XCircle size={16} />
                    <div className="alert-description">{t('common.error')}</div>
                  </div>
                )}

                {current?.is_financial_locked && (
                  <div className="alert alert-warning">
                    <AlertCircle size={16} />
                    <div className="alert-description">{t('amendTerms.financialLocked')}</div>
                  </div>
                )}

                {current && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto] gap-3 items-start">
                      <div className="flex flex-col">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <label className="form-label mb-0">{t('amendTerms.installmentLabel')}</label>
                          <span className="text-[11px] text-subtle tabular-nums">
                            {t('amendTerms.currentValue', { value: fmtCurrency(current.cur_installment_amount ?? 0) })}
                          </span>
                        </div>
                        <MaskedInput
                          mask="number"
                          decimalScale={0}
                          value={installmentStr}
                          onChange={(raw) => setInstallmentStr(raw)}
                        />
                      </div>

                      <div className="flex flex-col">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <label className="form-label mb-0">{t('amendTerms.termLabel')}</label>
                          <span className="text-[11px] text-subtle tabular-nums">
                            {t('amendTerms.currentValue', { value: String(current.cur_term_months ?? '—') })}
                          </span>
                        </div>
                        <MaskedInput
                          mask="number"
                          decimalScale={0}
                          value={termStr}
                          onChange={(raw) => setTermStr(raw)}
                          error={termTooLong}
                        />
                        {termTooLong && (
                          <div className="text-[11px] text-danger-fg mt-1">
                            {t('amendTerms.termTooLong', { max: TERM_MONTHS_MAX })}
                          </div>
                        )}
                      </div>

                      {/* Paid already, tied to a bill and a closed day. Sits beside
                          the two editable figures so it reads as part of the same
                          set, but takes only the width its number needs. */}
                      <div className="flex flex-col col-span-2 sm:col-span-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <label className="form-label mb-0">{t('amendTerms.downLabel')}</label>
                          <span className="text-[11px] text-subtle">{t('amendTerms.downNotEditable')}</span>
                        </div>
                        <div className="h-[38px] flex items-center justify-end px-3 rounded-md bg-surface-soft border border-line tabular-nums font-medium">
                          {fmtCurrency(current.cur_down_amount ?? 0)}
                        </div>
                      </div>
                    </div>


                    <div className="flex flex-col">
                      <label className="form-label">{t('amendTerms.reasonLabel')}</label>
                      <TextArea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        placeholder={t('amendTerms.reasonPlaceholder')}
                      />
                    </div>

                    {!preview && (
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          color="primary"
                          disabled={!canPreview}
                          startIcon={previewing ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                          onClick={handlePreview}
                        >
                          {previewing ? t('common.loading') : t('amendTerms.previewButton')}
                        </Button>
                      </div>
                    )}

                    {/* Before → after, straight from the preview. Nothing here is
                        computed locally (spec §4). */}
                    {preview && (
                      <div className="border border-line rounded-md overflow-hidden">
                        {/* The change itself, set large — it is the one thing the
                            user is approving. Old value struck through beside it,
                            so both are readable at a glance. */}
                        <div className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="text-sm text-subtle">{t('amendTerms.installmentLabel')}</span>
                          <span className="text-sm text-subtler line-through tabular-nums">
                            {fmtCurrency(preview.before.installment_amount)}
                          </span>
                          <ArrowRight size={14} className="text-subtler shrink-0" />
                          <span className="text-2xl font-semibold tabular-nums leading-none">
                            {fmtCurrency(preview.after.installment_amount)}
                          </span>
                          <span className="text-sm text-subtle">×</span>
                          <span className="text-2xl font-semibold tabular-nums leading-none">
                            {preview.after.value_month}
                          </span>
                        </div>

                        {preview.before.value_month !== preview.after.value_month && (
                          <div className="px-4 py-3 border-t border-line flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="text-sm text-subtle">{t('amendTerms.termLabel')}</span>
                            <span className="text-sm text-subtler line-through tabular-nums">
                              {preview.before.value_month}
                            </span>
                            <ArrowRight size={14} className="text-subtler shrink-0" />
                            <span className="text-2xl font-semibold tabular-nums leading-none">
                              {preview.after.value_month}
                            </span>
                          </div>
                        )}

                        {schedule.length > 0 && (
                          <div className="px-4 py-2.5 border-t border-line flex items-baseline justify-between gap-3 flex-wrap">
                            <span className="text-xs text-subtle">
                              <DateTime value={schedule[0].due_date} showTime={false} />
                              {' – '}
                              <DateTime value={schedule[schedule.length - 1].due_date} showTime={false} />
                            </span>
                            <button
                              type="button"
                              className="text-xs text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer"
                              onClick={() => setScheduleOpen(true)}
                            >
                              {t('amendTerms.showSchedule', { count: schedule.length })}
                            </button>
                          </div>
                        )}

                        {lastDiffers && (
                          <div className="px-4 py-2 border-t border-line flex items-center justify-between text-sm">
                            <span className="text-subtle">{t('amendTerms.lastInstalment')}</span>
                            <span className="tabular-nums font-medium">
                              {fmtCurrency(schedule[schedule.length - 1].due_amount)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {preview?.discount_policy?.needs_approval && (
                      <div className="alert alert-warning">
                        <AlertCircle size={16} />
                        <div className="alert-description">{t('amendTerms.needsApproval')}</div>
                      </div>
                    )}

                    {/* The owning branch's PIN, not the admin's — say which. */}
                    {preview && pinRequired && (
                      <BranchPinInput
                        value={pin}
                        onChange={setPin}
                        label={contract?.branch_name
                          ? t('amendTerms.pinLabelBranch', { branch: contract.branch_name })
                          : undefined}
                        required
                      />
                    )}
                  </>
                )}
              </div>

              <ModalErrorBand message={error} />

              <div className="modal-footer">
                <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                <Button
                  color="primary"
                  disabled={!canSubmit}
                  startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                  onClick={handleConfirm}
                >
                  {submitting ? t('common.loading') : t('amendTerms.confirm')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        maxWidth="28rem"
        width="100%"
        ariaLabel="Instalment schedule"
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('amendTerms.scheduleTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={() => setScheduleOpen(false)} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          <div className="border border-line rounded-md overflow-hidden">
            {schedule.map(row => (
              <div key={row.pay_no} className="flex items-center justify-between px-4 py-2 text-sm border-b border-line last:border-b-0">
                <span className="text-subtle tabular-nums">
                  {t('amendTerms.payNo', { n: row.pay_no })}
                  {' · '}
                  <DateTime value={row.due_date} showTime={false} />
                </span>
                <span className="tabular-nums font-medium">{fmtCurrency(row.due_amount)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="outline" onClick={() => setScheduleOpen(false)}>{t('common.close')}</Button>
        </div>
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>

      <ContractPreviewModal
        open={previewDocOpen}
        onClose={() => setPreviewDocOpen(false)}
        contract={contractForPreview}
        target={amendSigningId != null ? { signingId: amendSigningId } : undefined}
      />
    </>
  );
}
