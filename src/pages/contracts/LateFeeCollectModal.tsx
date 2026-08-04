import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, MaskedInput, Input, LabeledCheckbox } from 'tsp-form';
import { XCircle, AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { ActionDoneView, type ActionDoneDetailRow } from './ActionDoneView';
import { translateApiError } from '../../lib/apiErrors';

/* ─────────────────────────────────────────────────────────────────────────────
   Late Fee Collect (LATE_FEE_COLLECT) — เก็บค่าปรับ on a contract with accrued
   OVERDUE_PENALTY in late_fee_ledger.

   Single atomic RPC (no cart / no payment step, doc 37 §7b):
     fn_bill_late_fee_collect(p_contract_id, p_fee_type='OVERDUE_PENALTY',
       p_amount, p_waive_amount, p_note, p_created_by)
   The backend creates the CONTRACT_FEE INVOICE bill, drains the ledger, and (when
   a waive amount is given) adds the negative LATE_FEE_WAIVE line itself.

   Collect amount defaults to the full accrued balance, capped at it. Waive must be
   ≤ collect. Net charged = collect − waive. BE enforces the LATE_FEE_COLLECT /
   LATE_FEE_WAIVE permissions — the UI does not pre-gate on role (backend owns auth).
   ──────────────────────────────────────────────────────────────────────────── */

interface ContractForLateFee {
  id: number;
  code: string;
  code_display: string | null;
  late_fee_balance: number | null;
}

interface LateFeeResult {
  bill_id: number;
  bill_code?: string;
  amount?: number;
  waive_amount?: number;
  bill_total?: number;
  remaining_balance?: number;
}

export function LateFeeCollectModal({ open, contract, onClose, onSuccess }: {
  open: boolean;
  contract: ContractForLateFee | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [amount, setAmount] = useState('');
  const [waiveOn, setWaiveOn] = useState(false);
  const [waiveAmount, setWaiveAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LateFeeResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const balance = contract?.late_fee_balance ?? 0;

  const resetForm = () => {
    setView('form');
    // Default the collect amount to the full accrued balance.
    setAmount(balance > 0 ? String(balance) : '');
    setWaiveOn(false);
    setWaiveAmount('');
    setNote('');
    setError('');
    setSubmitting(false);
    setResult(null);
    setConfirmClose(false);
  };

  useEffect(() => {
    if (open) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, balance]);

  const collect = Math.min(parseFloat(amount) || 0, balance);
  const waive = waiveOn ? (parseFloat(waiveAmount) || 0) : 0;
  const net = Math.max(0, collect - waive);

  const isDirty = !!amount || waiveOn || !!note;

  // ── Validation (mirror BE guards for fast feedback) ─────────────────────
  const blockReasons: string[] = [];
  if (balance <= 0) blockReasons.push(t('lateFee.blockNoBalance'));
  if (balance > 0 && collect <= 0) blockReasons.push(t('lateFee.blockNoCollect'));
  if (waive > collect) blockReasons.push(t('lateFee.blockWaiveExceeds'));
  // Waiving part of a fee must be justified (audit trail) — reason mandatory on waive.
  if (waive > 0 && !note.trim()) blockReasons.push(t('lateFee.blockWaiveReason'));
  const canSubmit = blockReasons.length === 0 && !submitting && !!contract;

  const handleConfirm = async () => {
    if (!canSubmit || !contract) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiClient.rpc<LateFeeResult>('fn_bill_late_fee_collect', {
        p_contract_id: contract.id,
        p_fee_type: 'OVERDUE_PENALTY',
        p_amount: collect,
        p_waive_amount: waive,
        p_note: note.trim() || null,
        p_created_by: user?.user_id ?? null,
      });
      setResult(res);
      setView('done');
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Close handling (write-modal checklist rule 3) ───────────────────────
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const contractCode = contract?.code_display ?? contract?.code ?? '';

  const doneDetailRows: ActionDoneDetailRow[] = result ? [
    { label: t('lateFee.collected'), value: fmtCurrency(result.amount ?? collect) },
    ...((result.waive_amount ?? waive) > 0
      ? [{ label: t('lateFee.waived'), value: fmtCurrency(result.waive_amount ?? waive) }]
      : []),
    { label: t('lateFee.netCharged'), value: fmtCurrency(result.bill_total ?? net), emphasis: true },
    { label: t('lateFee.remainingBalance'), value: fmtCurrency(result.remaining_balance ?? 0) },
  ] : [];

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%" ariaLabel="Collect late fee">
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('lateFee.title')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={t('lateFee.done')}
              contractCode={contractCode}
              billId={result.bill_id}
              detailRows={doneDetailRows}
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content flex flex-col gap-4">
                {/* Contract target */}
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                </div>

                {/* Accrued balance */}
                <div className="flex justify-between items-center p-3 rounded-lg border border-line bg-surface-subtle">
                  <span className="text-sm text-subtle">{t('lateFee.accruedBalance')}</span>
                  <span className="font-semibold tabular-nums">{fmtCurrency(balance)}</span>
                </div>

                {balance > 0 && (
                  <div className="form-grid">
                    <div className="flex flex-col">
                      <label className="form-label">{t('lateFee.collectAmount')}</label>
                      <MaskedInput
                        mask="number"
                        decimalScale={2}
                        value={amount}
                        onChange={setAmount}
                        size="sm"
                        className="w-full"
                        placeholder="0.00"
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <LabeledCheckbox
                        label={t('lateFee.waiveSome')}
                        checked={waiveOn}
                        onChange={(e) => { setWaiveOn(e.target.checked); if (!e.target.checked) setWaiveAmount(''); }}
                      />
                      {waiveOn && (
                        <MaskedInput
                          mask="number"
                          decimalScale={2}
                          value={waiveAmount}
                          onChange={setWaiveAmount}
                          size="sm"
                          className="w-full"
                          placeholder="0.00"
                        />
                      )}
                    </div>

                    <div className="flex flex-col">
                      <label className="form-label">
                        {t('lateFee.note')}
                        {waive > 0 && <span className="text-danger ml-0.5">*</span>}
                      </label>
                      <Input
                        size="sm"
                        className="w-full"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={waive > 0 ? t('lateFee.notePlaceholderWaive') : t('lateFee.notePlaceholder')}
                      />
                    </div>

                    {/* Net preview */}
                    {waive > 0 && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-subtle">{t('lateFee.netCharged')}</span>
                        <span className="font-semibold tabular-nums">{fmtCurrency(net)}</span>
                      </div>
                    )}
                  </div>
                )}

                {error && (
                  <div className="alert alert-danger">
                    <XCircle size={16} />
                    <div className="alert-description">{error}</div>
                  </div>
                )}
              </div>

              <div className="modal-footer flex-col items-stretch gap-2">
                {!canSubmit && blockReasons.length > 0 && (
                  <div className="alert alert-warning">
                    <AlertCircle size={16} />
                    <ul className="list-disc pl-4 text-sm space-y-0.5">
                      {[...new Set(blockReasons)].map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                  <Button
                    color="primary"
                    disabled={!canSubmit}
                    startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                    onClick={handleConfirm}
                  >
                    {submitting ? t('common.loading') : t('lateFee.confirm')}
                  </Button>
                </div>
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
