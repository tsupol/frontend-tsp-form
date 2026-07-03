import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Select, TextArea, MaskedInput, FormErrorMessage } from 'tsp-form';
import { XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency } from '../../lib/format';
import { fmtNum } from './inventoryUtils';
import { ActionDoneView, type ActionDoneDetailRow } from '../contracts/ActionDoneView';

// Quantity write-off (loss) for a retail / accessory variant on the branch
// sellable-stock page. FIFO lot deduction + a JOURNAL/STOCK_LOSS bill, all
// server-side. See UI_FEEDBACK/2026-07-03_DELIVERED_stock_write_off_from_branch_sellable_view.md.

interface LossReason {
  code: string;
  name_th: string;
  name_en: string;
}

interface WriteOffResult {
  variant_id: number;
  variant_sku: string;
  variant_name: string;
  branch_id: number;
  reason_code: string;
  qty_before: number;
  qty_lost: number;
  qty_after: number;
  total_amount: number;
  total_cost: number;
  unit_cost_avg: number;
  bill_id: number | null;
  bill_code: string | null;
}

export interface RetailWriteOffTarget {
  variantId: number;
  branchId: number;
  /** available qty (ON_HAND_AVAILABLE) — used as the qty max */
  available: number;
  displayName: string;
}

interface Props {
  /** null = closed. Modal itself is always mounted. */
  target: RetailWriteOffTarget | null;
  onClose: () => void;
  /** called after a successful write-off so the caller can refetch the list */
  onDone: () => void;
}

export function RetailWriteOffModal({ target, onClose, onDone }: Props) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<WriteOffResult | null>(null);

  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  const open = target !== null;

  // Reset to a clean form each time the modal opens for a new target.
  useEffect(() => {
    if (open) {
      setView('form');
      setResult(null);
      setQty('');
      setReason('');
      setNote('');
      setErrorMsg('');
      setConfirmClose(false);
      setSubmitting(false);
    }
  }, [open, target?.variantId, target?.branchId]);

  const { data: reasons } = useQuery({
    queryKey: ['adjustment-reasons', 'LOSS'],
    queryFn: () => apiClient.get<LossReason[]>(
      '/v_ref_adjustment_reasons?direction=eq.LOSS&is_active=eq.true&order=sort_order',
    ),
    staleTime: 5 * 60 * 1000,
  });

  const reasonOptions = useMemo(
    () => (reasons ?? []).map(r => ({
      value: r.code,
      label: i18n.language === 'th' ? r.name_th : r.name_en,
    })),
    [reasons, i18n.language],
  );

  const qtyNum = qty ? parseInt(qty, 10) : 0;
  const available = target?.available ?? 0;
  const qtyInvalid = qtyNum <= 0 || qtyNum > available;
  const isDirty = qty !== '' || reason !== '' || note !== '';
  const canSubmit = !qtyInvalid && !!reason && !submitting;

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };
  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleSubmit = async () => {
    if (!target || !canSubmit) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      const res = await apiClient.rpc<WriteOffResult>('fn_inv_stock_loss_journal', {
        p_variant_id: target.variantId,
        p_qty: qtyNum,
        p_reason_code: reason,
        p_note: note.trim() || null,
        p_branch_id: target.branchId,
      });
      setResult(res);
      setView('done');
      // Sellable-stock list is trigger-backed; invalidate so the row refreshes.
      queryClient.invalidateQueries({ queryKey: ['branch-stock'] });
      onDone();
    } catch (err) {
      // Surface the available count when the qty raced the server.
      if (err instanceof ApiError && err.code === 'INV.VALIDATION.INSUFFICIENT_STOCK') {
        const avail = err.messageParams?.available;
        setErrorMsg(t('branchStock.writeOff.insufficient', {
          available: typeof avail === 'number' ? avail : available,
        }));
      } else {
        setErrorMsg(translateApiError(err, t));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reasonLabel = (code: string) =>
    reasonOptions.find(o => o.value === code)?.label ?? code;

  const doneRows: ActionDoneDetailRow[] = result ? [
    { label: t('branchStock.writeOff.qtyLost'), value: fmtNum(result.qty_lost) },
    { label: t('branchStock.writeOff.reason'), value: reasonLabel(result.reason_code) },
    { label: t('branchStock.writeOff.remaining'), value: fmtNum(result.qty_after), emphasis: true },
    { label: t('branchStock.writeOff.value'), value: fmtCurrency(result.total_amount) },
  ] : [];

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        {view === 'form' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">{t('branchStock.writeOff.title')}</h2>
              <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
            </div>
            <div className="modal-content">
              {/* Target box */}
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
                <div className="font-medium text-sm">{target?.displayName}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {t('branchStock.writeOff.available', { count: available })}
                </div>
              </div>

              {errorMsg && (
                <div className="alert alert-danger mb-4">
                  <XCircle size={18} />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('branchStock.writeOff.qty')}</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={0}
                    allowNegative={false}
                    value={qty}
                    onChange={(raw) => setQty(raw)}
                    placeholder="0"
                    error={qty !== '' && qtyInvalid}
                    className="w-full"
                  />
                  {qty !== '' && qtyInvalid && (
                    <FormErrorMessage error={{ message: t('branchStock.writeOff.qtyRange', { max: available }) }} />
                  )}
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('branchStock.writeOff.reason')}</label>
                  <Select
                    options={reasonOptions}
                    value={reason || null}
                    onChange={(val) => setReason((val as string) ?? '')}
                    placeholder={t('branchStock.writeOff.reasonPlaceholder')}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('branchStock.writeOff.note')}</label>
                  <TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder={t('branchStock.writeOff.notePlaceholder')}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={submitting}>
                {t('common.cancel')}
              </Button>
              <Button color="danger" onClick={handleSubmit} disabled={!canSubmit}>
                {t('branchStock.writeOff.confirm')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            headline={t('branchStock.writeOff.done')}
            contractCode={result.variant_name || target?.displayName || ''}
            tone="warning"
            detailRows={doneRows}
            billId={result.bill_id}
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
