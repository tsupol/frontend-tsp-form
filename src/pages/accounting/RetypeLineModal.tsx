import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Input, Select, Badge } from 'tsp-form';
import { ArrowRight, Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import type { BillLineRetypeOption, BillLineRetypeResult } from './accountingTypes';
import { translateApiError } from '../../lib/apiErrors';

// เปลี่ยนประเภท — change a manual line's charge type on a PAID bill before day
// close (mig 1547). Amount, quantity, payments and the day-close figure do not
// move; only the category does. Spec:
// UI_FEEDBACK/2026-10-31_IMPLEMENT_bill_line_retype_1547.md
//
// Everything the form may offer comes from the backend:
//   - which lines have the button and which types they may become →
//     v_bill_line_retype_options (the `options` rows of one line_id)
//   - what the change will do → fn_bill_line_retype with p_preview=true
//   - the change itself → fn_bill_line_retype (reason + branch PIN required)

/** One line's rows from v_bill_line_retype_options — same line_id throughout. */
export interface RetypeTarget {
  lineId: number;
  options: BillLineRetypeOption[];
}

interface Props {
  target: RetypeTarget | null;
  onClose: () => void;
  /** Called once the change is applied, with the RPC result (holds bill_detail). */
  onRetyped: (result: BillLineRetypeResult) => void;
}

/** Translate a charge-type code the way the service-fee report does, falling
 *  back to the ref-data name the view ships (th/en), then to the code. */
export function useChargeTypeLabel(options: BillLineRetypeOption[] | undefined) {
  const { t, i18n } = useTranslation();
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const o of options ?? []) {
      const name = i18n.language.startsWith('th') ? o.target_name_th : o.target_name_en;
      if (name) names.set(o.target_charge_type, name);
    }
    return (code: string): string =>
      t(`serviceFee.svcType.${code}`, { defaultValue: '' }) || names.get(code) || code;
  }, [options, t, i18n.language]);
}

export function RetypeLineModal({ target, onClose, onRetyped }: Props) {
  const { t } = useTranslation();
  const open = target !== null;

  // Keep the last target through the close transition (guide: the modal's
  // data must outlive its `open` prop).
  const lastTarget = useRef<RetypeTarget | null>(target);
  if (target) lastTarget.current = target;
  const shown = target ?? lastTarget.current;
  const options = shown?.options ?? [];
  const line = options[0] ?? null;
  const labelFor = useChargeTypeLabel(options);

  const [view, setView] = useState<'form' | 'done'>('form');
  const [newType, setNewType] = useState<string>('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [preview, setPreview] = useState<BillLineRetypeResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [result, setResult] = useState<BillLineRetypeResult | null>(null);

  // Reset on open (not on target change — the row may vanish after success).
  useEffect(() => {
    if (open) {
      setView('form');
      setNewType('');
      setReason('');
      setPin('');
      setError('');
      setConfirmClose(false);
      setPreview(null);
      setResult(null);
    }
  }, [open]);

  // Dry run on every type choice so the user sees the new description and
  // that nothing else moves before confirming. Nothing is written, no PIN used.
  const previewSeq = useRef(0);
  useEffect(() => {
    if (!open || !line || !newType) { setPreview(null); return; }
    const seq = ++previewSeq.current;
    setPreviewBusy(true);
    apiClient.rpc<BillLineRetypeResult>('fn_bill_line_retype', {
      p_line_id: line.line_id,
      p_new_charge_type: newType,
      p_preview: true,
    }).then(res => {
      if (seq === previewSeq.current) { setPreview(res); setError(''); }
    }).catch(err => {
      if (seq !== previewSeq.current) return;
      setPreview(null);
      setError(err instanceof ApiError ? (translateApiError(err, t) || err.message) : String(err));
    }).finally(() => {
      if (seq === previewSeq.current) setPreviewBusy(false);
    });
  }, [open, line, newType, t]);

  const dirty = view === 'form' && (newType !== '' || reason.trim() !== '' || pin !== '');

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const canSubmit = !!line && newType !== '' && reason.trim() !== '' && pin !== '' && !busy && !previewBusy;

  const handleSubmit = async () => {
    if (!line || !canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.rpc<BillLineRetypeResult>('fn_bill_line_retype', {
        p_line_id: line.line_id,
        p_new_charge_type: newType,
        p_reason: reason.trim(),
        p_pin: pin,
      });
      setResult(res);
      setView('done');
      onRetyped(res);
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const typeOptions = options.map(o => ({ value: o.target_charge_type, label: labelFor(o.target_charge_type) }));
  const qty = line?.quantity ?? 1;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done' ? t('accounting.bills.retype.doneTitle') : t('accounting.bills.retype.title')}
          </h2>
        </div>

        {view === 'form' && line && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                {/* Target line */}
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line flex flex-col gap-1">
                  <div className="font-medium text-sm">{line.bill_code_display}</div>
                  <div className="text-sm truncate">{line.current_description}</div>
                  <div className="flex items-center gap-2 text-xs text-subtle tabular-nums">
                    <Badge color="default" size="xs">{labelFor(line.current_charge_type)}</Badge>
                    <span>{fmtCurrency(line.amount)}{qty > 1 ? ` × ${qty}` : ''}</span>
                  </div>
                </div>

                {/* New type — only what the view offers */}
                <div className="flex flex-col">
                  <label className="form-label">{t('accounting.bills.retype.newType')} *</label>
                  <Select
                    options={typeOptions}
                    value={newType || null}
                    onChange={(v) => setNewType((v as string) ?? '')}
                    placeholder={t('accounting.bills.retype.newTypePlaceholder')}
                    searchable={false}
                    showChevron
                  />
                </div>

                {/* What will happen — from the dry run */}
                {newType && (
                  <div className="alert alert-info">
                    <Info size={16} />
                    <div className="min-w-0">
                      <div className="alert-description flex items-center gap-1.5 flex-wrap">
                        <span>{labelFor(line.current_charge_type)}</span>
                        <ArrowRight size={14} className="shrink-0" />
                        <span className="font-medium">{labelFor(newType)}</span>
                      </div>
                      {previewBusy && <div className="text-xs text-subtle mt-0.5">{t('common.loading')}</div>}
                      {!previewBusy && preview && (
                        <>
                          <div className="text-xs mt-0.5">{preview.line.new_description}</div>
                          <div className="text-xs text-subtle mt-0.5">
                            {t('accounting.bills.retype.unchanged', { amount: fmtCurrency(preview.line.amount * (preview.line.quantity || 1)) })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Reason + PIN */}
                <div className="flex flex-col">
                  <label className="form-label">{t('accounting.bills.retype.reason')} *</label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('accounting.bills.retype.reasonPlaceholder')}
                    className="w-full"
                  />
                </div>
                <BranchPinInput value={pin} onChange={setPin} label={t('accounting.bills.pin')} required />
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleSubmit} disabled={!canSubmit}>
                {busy ? t('common.loading') : t('accounting.bills.retype.confirm')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && line && result && (
          <ActionDoneView
            headline={t('accounting.bills.retype.doneTitle')}
            contractCode={line.bill_code_display}
            stateTransition={{
              from: labelFor(result.line.old_charge_type),
              to: labelFor(result.line.new_charge_type),
              fromColor: 'default',
              toColor: 'success',
            }}
            detailRows={[
              { label: t('accounting.bills.retype.description'), value: result.line.new_description },
              { label: t('accounting.bills.retype.amount'), value: fmtCurrency(result.line.amount * (result.line.quantity || 1)) },
              { label: t('accounting.bills.retype.billTotal'), value: fmtCurrency(result.bill.total_amount), emphasis: true },
            ]}
            onClose={forceClose}
          />
        )}
      </Modal>

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
