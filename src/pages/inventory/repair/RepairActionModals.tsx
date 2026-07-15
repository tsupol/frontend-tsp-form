import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Select, TextArea, Input, Badge, useSnackbarContext } from 'tsp-form';
import { CheckCircle, XCircle, Plus } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { CurrencyInput } from '../../../components/CurrencyInput';
import { BranchPaymentAccountField } from '../../../components/BranchPaymentAccountField';
import { ActionDoneView } from '../../contracts/ActionDoneView';
import { fmtCurrency } from '../../../lib/format';
import type {
  RepairOrder, RepairItemType, RepairPayMethod, RefRepairItemType, RepairRenderDoc,
} from '../repairTypes';

function translateErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
    return translated || err.message;
  }
  return t('common.error');
}

function RepairTargetBox({ order, subtitle }: { order: RepairOrder; subtitle?: string }) {
  return (
    <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
      <div className="font-medium text-sm">{order.code_display}</div>
      <div className="text-xs text-subtle">
        {[order.product_display_name, order.serial_no].filter(Boolean).join(' · ') || order.customer_name || '—'}
      </div>
      {subtitle && <div className="text-xs text-subtle mt-0.5">{subtitle}</div>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Charge sheet — add / void line items. Live sheet from fn_repair_render so the
 * running total matches the BE cache. ADD applies the item_type's sign server-side
 * (we always send a positive amount). UNCOLLECTED requires a reason.
 * ──────────────────────────────────────────────────────────────────────────── */

export function RepairChargeModal({
  open, onClose, order, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  order: RepairOrder;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [itemType, setItemType] = useState<RepairItemType>('CHARGE');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // Lines committed to the server during THIS open — drives the Done button and
  // whether closing needs to refresh. Each "Add" commits immediately server-side.
  const [addedCount, setAddedCount] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);

  const { data: itemTypes } = useQuery({
    queryKey: ['ref-repair-item-types'],
    queryFn: () => apiClient.get<RefRepairItemType[]>('/v_ref_repair_item_types?order=sort_order'),
    staleTime: 60 * 60 * 1000,
  });

  // The render doc's charge_items don't carry an id to void; the sheet here is a
  // read-only running preview. Per-line VOID (fn_inv_repair_charge_set op=VOID)
  // needs the charge_item_id which fn_repair_render doesn't expose — voiding is
  // therefore not offered in this modal (add lines only). Correcting a wrong line
  // = add an offsetting DISCOUNT, or cancel + recreate before intake.
  const { data: doc, refetch: refetchDoc } = useQuery({
    queryKey: ['repair-render', order.repair_order_id, 'CHARGE_NOTICE'],
    queryFn: () => apiClient.rpc<RepairRenderDoc>('fn_repair_render', {
      p_repair_order_id: order.repair_order_id, p_doc_type: 'CHARGE_NOTICE',
    }),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setItemType('CHARGE'); setDescription(''); setAmount('');
      setBusy(false); setErrorMessage(''); setAddedCount(0); setConfirmClose(false);
    }
  }, [open]);

  const requireReason = itemTypes?.find(x => x.item_type === itemType)?.require_reason ?? false;
  const amountNum = Number(amount) || 0;
  const canAdd = !busy && description.trim().length >= 3 && amountNum > 0;

  // Nav-guard dirtiness = a line typed into the add-row but not yet committed.
  // (Committed lines are already saved server-side, so they're not "unsaved".)
  const hasPendingInput = description.trim().length > 0 || amount.trim().length > 0;

  const addLine = async () => {
    setBusy(true);
    setErrorMessage('');
    try {
      await apiClient.rpc('fn_inv_repair_charge_set', {
        p_repair_order_id: order.repair_order_id,
        p_op: 'ADD', p_item_type: itemType, p_description: description.trim(), p_amount: amountNum,
      });
      setDescription(''); setAmount('');
      setAddedCount(c => c + 1);
      await refetchDoc();
      onChanged();
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (hasPendingInput) { setConfirmClose(true); return; }
    forceClose();
  };

  const items = doc?.charge_items ?? [];

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="34rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('repair.chargeTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>&times;</button>
      </div>
      <div className="modal-content">
        <RepairTargetBox order={order} />

        {/* Running sheet */}
        {items.length > 0 && (
          <div className="rounded-md border border-line overflow-hidden mb-4">
            {items.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 border-b border-line last:border-b-0 text-sm">
                <div className="min-w-0 flex items-center gap-2">
                  <Badge size="xs" color={it.item_type === 'CHARGE' ? 'default' : it.item_type === 'DISCOUNT' ? 'info' : 'warning'}>
                    {t(`repair.itemType_${it.item_type}`)}
                  </Badge>
                  <span className="truncate">{it.description}</span>
                </div>
                <span className={`tabular-nums shrink-0 ${it.amount < 0 ? 'text-danger' : ''}`}>{fmtCurrency(it.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2 bg-surface text-sm font-semibold">
              <span>{t('repair.chargeNet')}</span>
              <span className="tabular-nums">{fmtCurrency(doc?.charge_net ?? 0)}</span>
            </div>
          </div>
        )}

        {/* Add-line row */}
        <div className="form-grid">
          <div className="flex gap-2">
            <div style={{ width: '11rem' }}>
              <Select
                options={(itemTypes ?? []).map(x => ({ value: x.item_type, label: t(`repair.itemType_${x.item_type}`) }))}
                value={itemType}
                onChange={(v) => setItemType((v as RepairItemType) || 'CHARGE')}
                searchable={false}
                showChevron
              />
            </div>
            <div style={{ width: '10rem' }}>
              <CurrencyInput value={amount} onChange={(raw) => setAmount(raw)} placeholder="0.00" className="w-full" />
            </div>
          </div>
          <div className="flex flex-col">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={requireReason ? t('repair.uncollectedReasonPlaceholder') : t('repair.chargeDescPlaceholder')}
              className="w-full"
            />
          </div>
          <Button color="primary" startIcon={<Plus size={16} />} onClick={addLine} disabled={!canAdd}>
            {t('repair.addLine')}
          </Button>
        </div>

        {errorMessage && (
          <div className="alert alert-danger mt-4 animate-pop-in">
            <XCircle size={16} />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
      <div className="modal-footer">
        {addedCount > 0 ? (
          <Button
            color="primary"
            disabled={busy || hasPendingInput}
            onClick={() => { onChanged(); forceClose(); addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('repair.chargeSaved')}</span></div> }); }}
          >
            {t('common.done')}
          </Button>
        ) : (
          <Button variant="ghost" disabled={busy} onClick={handleClose}>{t('common.close')}</Button>
        )}
      </div>
    </Modal>

    {/* Nav guard — a line was typed into the add-row but not committed. */}
    <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
      <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
      <div className="modal-content"><p>{t('repair.chargePendingLineMessage')}</p></div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
      </div>
    </Modal>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Draft edit (DRAFT_UPDATE) — edit the mutable DRAFT fields before intake.
 * COALESCE update; walk-in customer fields only shown for WALK_IN.
 * ──────────────────────────────────────────────────────────────────────────── */

export function RepairDraftEditModal({
  open, onClose, order, onDone,
}: {
  open: boolean; onClose: () => void; order: RepairOrder; onDone: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [repairNote, setRepairNote] = useState(order.repair_note ?? '');
  const [conditionNote, setConditionNote] = useState(order.condition_note ?? '');
  const [intakeTerms, setIntakeTerms] = useState(order.intake_terms ?? '');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open) {
      setRepairNote(order.repair_note ?? '');
      setConditionNote(order.condition_note ?? '');
      setIntakeTerms(order.intake_terms ?? '');
      setBusy(false); setErrorMessage('');
    }
  }, [open, order]);

  const symptomOk = repairNote.trim().length >= 3;

  const submit = async () => {
    if (!symptomOk) return;
    setBusy(true); setErrorMessage('');
    try {
      await apiClient.rpc('fn_inv_repair_draft_update', {
        p_repair_order_id: order.repair_order_id,
        p_repair_note: repairNote.trim(),
        p_condition_note: conditionNote.trim() || null,
        p_intake_terms: intakeTerms.trim() || null,
      });
      onDone(); onClose();
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('repair.draftSaved')}</span></div> });
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="30rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('repair.editDraftTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>
      <div className="modal-content">
        <RepairTargetBox order={order} />
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('repair.symptom')} <span className="text-danger">*</span></label>
            <TextArea value={repairNote} onChange={(e) => setRepairNote(e.target.value)} rows={2} />
            {repairNote.length > 0 && !symptomOk && <span className="text-xs text-danger mt-1">{t('repair.symptomTooShort')}</span>}
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('repair.conditionNote')}</label>
            <TextArea value={conditionNote} onChange={(e) => setConditionNote(e.target.value)} rows={2} />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('repair.intakeTerms')}</label>
            <TextArea value={intakeTerms} onChange={(e) => setIntakeTerms(e.target.value)} rows={2} />
          </div>
        </div>
        {errorMessage && (
          <div className="alert alert-danger mt-4 animate-pop-in"><XCircle size={16} /><span>{errorMessage}</span></div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={submit} disabled={busy || !symptomOk}>{busy ? t('common.loading') : t('common.save')}</Button>
      </div>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Cost / work note (COST_SET) — internal cost + work note, drives gross_profit.
 * COALESCE update: only non-null fields change.
 * ──────────────────────────────────────────────────────────────────────────── */

export function RepairCostModal({
  open, onClose, order, onDone,
}: {
  open: boolean;
  onClose: () => void;
  order: RepairOrder;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [cost, setCost] = useState(order.repair_cost != null ? String(order.repair_cost) : '');
  const [costNote, setCostNote] = useState(order.cost_note ?? '');
  const [workNote, setWorkNote] = useState(order.work_note ?? '');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open) {
      setCost(order.repair_cost != null ? String(order.repair_cost) : '');
      setCostNote(order.cost_note ?? '');
      setWorkNote(order.work_note ?? '');
      setBusy(false); setErrorMessage('');
    }
  }, [open, order]);

  const submit = async () => {
    setBusy(true);
    setErrorMessage('');
    try {
      await apiClient.rpc('fn_inv_repair_cost_set', {
        p_repair_order_id: order.repair_order_id,
        p_repair_cost: cost.trim() === '' ? null : Number(cost),
        p_cost_note: costNote.trim() || null,
        p_work_note: workNote.trim() || null,
      });
      onDone(); onClose();
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('repair.costSaved')}</span></div> });
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="30rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('repair.costTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>
      <div className="modal-content">
        <RepairTargetBox order={order} subtitle={t('repair.costHint')} />
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('repair.repairCost')}</label>
            <CurrencyInput value={cost} onChange={(raw) => setCost(raw)} placeholder="0.00" className="w-full" />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('repair.costNote')}</label>
            <Input value={costNote} onChange={(e) => setCostNote(e.target.value)} className="w-full" />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('repair.workNote')}</label>
            <TextArea value={workNote} onChange={(e) => setWorkNote(e.target.value)} rows={2} />
          </div>
        </div>
        {errorMessage && (
          <div className="alert alert-danger mt-4 animate-pop-in">
            <XCircle size={16} /><span>{errorMessage}</span>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={submit} disabled={busy}>{busy ? t('common.loading') : t('common.save')}</Button>
      </div>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Charge notice — freeze/print the price notice. No input; just confirm + issue.
 * ──────────────────────────────────────────────────────────────────────────── */

export function RepairChargeNoticeModal({
  open, onClose, order, onDone,
}: {
  open: boolean; onClose: () => void; order: RepairOrder; onDone: (issued: boolean) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => { if (open) { setBusy(false); setErrorMessage(''); } }, [open]);

  const submit = async () => {
    setBusy(true); setErrorMessage('');
    try {
      await apiClient.rpc('fn_inv_repair_charge_notice_issue', { p_repair_order_id: order.repair_order_id });
      onDone(true); onClose();
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('repair.chargeNoticeTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>
      <div className="modal-content">
        <RepairTargetBox order={order} />
        <p className="text-sm text-subtle">{t('repair.chargeNoticeHint')}</p>
        <div className="mt-3 flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
          <span className="text-subtle">{t('repair.chargeNet')}</span>
          <span className="tabular-nums font-semibold">{fmtCurrency(order.c_charge_net)}</span>
        </div>
        {errorMessage && (
          <div className="alert alert-danger mt-4 animate-pop-in"><XCircle size={16} /><span>{errorMessage}</span></div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={submit} disabled={busy}>{busy ? t('common.loading') : t('repair.issueNotice')}</Button>
      </div>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pay — collect a repair payment (full or partial/deposit). Wallets require a
 * contract (CUSTOMER_CONTRACT). TRANSFER requires a bank account. On success →
 * ActionDoneView with the created bill (download/print receipt).
 * ──────────────────────────────────────────────────────────────────────────── */

export function RepairPayModal({
  open, onClose, order, onDone,
}: {
  open: boolean; onClose: () => void; order: RepairOrder; onDone: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<RepairPayMethod>('CASH');
  const [bankAccountId, setBankAccountId] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [billId, setBillId] = useState<number | null>(null);

  const hasContract = order.contract_id != null;

  const methodOptions = useMemo(() => {
    const base: RepairPayMethod[] = ['CASH', 'TRANSFER'];
    const wallets: RepairPayMethod[] = ['CREDIT_WALLET', 'INSURANCE_WALLET', 'SAVING_WALLET'];
    return [...base, ...(hasContract ? wallets : [])].map(m => ({ value: m, label: t(`repair.method_${m}`) }));
  }, [hasContract, t]);

  useEffect(() => {
    if (open) {
      setView('form');
      setAmount(order.c_charge_balance > 0 ? String(order.c_charge_balance) : '');
      setMethod('CASH'); setBankAccountId(null); setReference('');
      setBusy(false); setErrorMessage(''); setBillId(null);
    }
  }, [open, order.c_charge_balance]);

  const amountNum = Number(amount) || 0;
  const needsBank = method === 'TRANSFER';
  const canSubmit = !busy && amountNum > 0 && (!needsBank || bankAccountId != null);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErrorMessage('');
    try {
      const res = await apiClient.rpc<{ bill_id?: number }>('fn_bill_repair_pay', {
        p_repair_order_id: order.repair_order_id,
        p_amount: amountNum,
        p_method: method,
        p_bank_account_id: needsBank ? bankAccountId : null,
        p_reference: reference.trim() || null,
      });
      setBillId(res?.bill_id ?? null);
      setView('done');
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  const remainingAfter = Math.max(0, order.c_charge_balance - amountNum);

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="30rem" width="100%">
      {view === 'form' ? (
        <>
          <div className="modal-header">
            <h2 className="modal-title">{t('repair.payTitle')}</h2>
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
          </div>
          <div className="modal-content">
            <RepairTargetBox order={order} subtitle={`${t('repair.balance')}: ${fmtCurrency(order.c_charge_balance)}`} />
            <div className="form-grid">
              <div className="flex flex-col">
                <label className="form-label">{t('repair.amount')}</label>
                <CurrencyInput value={amount} onChange={(raw) => setAmount(raw)} placeholder="0.00" className="w-full" />
                {amountNum > 0 && amountNum < order.c_charge_balance && (
                  <span className="text-xs text-subtle mt-1">{t('repair.remainingAfter', { amount: fmtCurrency(remainingAfter) })}</span>
                )}
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('repair.method')}</label>
                <Select
                  options={methodOptions}
                  value={method}
                  onChange={(v) => { setMethod((v as RepairPayMethod) || 'CASH'); setBankAccountId(null); }}
                  searchable={false}
                  showChevron
                />
              </div>
              {needsBank && (
                <BranchPaymentAccountField onResolve={setBankAccountId} active={needsBank} />
              )}
              <div className="flex flex-col">
                <label className="form-label">{t('repair.reference')}</label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} className="w-full" placeholder={t('repair.referencePlaceholder')} />
              </div>
            </div>
            {errorMessage && (
              <div className="alert alert-danger mt-4 animate-pop-in"><XCircle size={16} /><span>{errorMessage}</span></div>
            )}
          </div>
          <div className="modal-footer">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button color="primary" onClick={submit} disabled={!canSubmit}>{busy ? t('common.loading') : t('repair.confirmPay')}</Button>
          </div>
        </>
      ) : (
        <ActionDoneView
          headline={t('repair.payDone')}
          contractCode={order.code_display}
          detailRows={[
            { label: t('repair.amount'), value: fmtCurrency(amountNum), emphasis: true },
            { label: t('repair.method'), value: t(`repair.method_${method}`) },
          ]}
          billId={billId}
          onClose={() => { onDone(); onClose(); }}
        />
      )}
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Refund — return an overpayment / deposit. CASH or TRANSFER only (no wallets).
 * ──────────────────────────────────────────────────────────────────────────── */

export function RepairRefundModal({
  open, onClose, order, onDone,
}: {
  open: boolean; onClose: () => void; order: RepairOrder; onDone: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'TRANSFER'>('CASH');
  const [bankAccountId, setBankAccountId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Refund-due magnitude = the negative balance.
  const refundDue = order.c_charge_balance < 0 ? -order.c_charge_balance : 0;

  useEffect(() => {
    if (open) {
      setAmount(refundDue > 0 ? String(refundDue) : '');
      setMethod('CASH'); setBankAccountId(null); setNote(''); setBusy(false); setErrorMessage('');
    }
  }, [open, refundDue]);

  const amountNum = Number(amount) || 0;
  const needsBank = method === 'TRANSFER';
  const canSubmit = !busy && amountNum > 0 && amountNum <= order.c_charge_paid && (!needsBank || bankAccountId != null);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErrorMessage('');
    try {
      await apiClient.rpc('fn_bill_repair_refund', {
        p_repair_order_id: order.repair_order_id,
        p_amount: amountNum,
        p_method: method,
        p_bank_account_id: needsBank ? bankAccountId : null,
        p_note: note.trim() || null,
      });
      onDone(); onClose();
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('repair.refundSuccess')}</span></div> });
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="30rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('repair.refundTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>
      <div className="modal-content">
        <RepairTargetBox order={order} subtitle={`${t('repair.refundDue')}: ${fmtCurrency(refundDue)}`} />
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('repair.amount')}</label>
            <CurrencyInput value={amount} onChange={(raw) => setAmount(raw)} placeholder="0.00" className="w-full" />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('repair.method')}</label>
            <Select
              options={(['CASH', 'TRANSFER'] as const).map(m => ({ value: m, label: t(`repair.method_${m}`) }))}
              value={method}
              onChange={(v) => { setMethod((v as 'CASH' | 'TRANSFER') || 'CASH'); setBankAccountId(null); }}
              searchable={false}
              showChevron
            />
          </div>
          {needsBank && <BranchPaymentAccountField onResolve={setBankAccountId} active={needsBank} />}
          <div className="flex flex-col">
            <label className="form-label">{t('repair.note')}</label>
            <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t('repair.notePlaceholder')} />
          </div>
        </div>
        {errorMessage && (
          <div className="alert alert-danger mt-4 animate-pop-in"><XCircle size={16} /><span>{errorMessage}</span></div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={submit} disabled={!canSubmit}>{busy ? t('common.loading') : t('repair.confirmRefund')}</Button>
      </div>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Cancel — IN_REPAIR → VOIDED. Blocked by BE if any money was collected
 * (REPAIR_HAS_PAYMENTS → refund to 0 first). Reason ≥ 3 chars.
 * ──────────────────────────────────────────────────────────────────────────── */

export function RepairCancelModal({
  open, onClose, order, onDone,
}: {
  open: boolean; onClose: () => void; order: RepairOrder; onDone: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => { if (open) { setReason(''); setBusy(false); setErrorMessage(''); } }, [open]);

  const canSubmit = !busy && reason.trim().length >= 3;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErrorMessage('');
    try {
      await apiClient.rpc('fn_inv_repair_cancel', {
        p_repair_order_id: order.repair_order_id,
        p_reason: reason.trim(),
      });
      onDone(); onClose();
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('repair.cancelSuccess')}</span></div> });
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('repair.cancelTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>
      <div className="modal-content">
        <RepairTargetBox order={order} />
        {order.c_charge_paid > 0 && (
          <div className="alert alert-warning mb-3">
            <XCircle size={16} />
            <span>{t('repair.cancelHasPayments')}</span>
          </div>
        )}
        <div className="flex flex-col">
          <label className="form-label">{t('repair.cancelReason')}</label>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t('repair.cancelReasonPlaceholder')} />
        </div>
        {errorMessage && (
          <div className="alert alert-danger mt-4 animate-pop-in"><XCircle size={16} /><span>{errorMessage}</span></div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={submit} disabled={!canSubmit}>{busy ? t('common.loading') : t('repair.confirmCancel')}</Button>
      </div>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Discard — hard-delete a DRAFT (before intake). Simple confirm.
 * ──────────────────────────────────────────────────────────────────────────── */

export function RepairDiscardModal({
  open, onClose, order, onDone,
}: {
  open: boolean; onClose: () => void; order: RepairOrder; onDone: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => { if (open) { setBusy(false); setErrorMessage(''); } }, [open]);

  const submit = async () => {
    setBusy(true); setErrorMessage('');
    try {
      await apiClient.rpc('fn_inv_repair_draft_discard', { p_repair_order_id: order.repair_order_id });
      onDone(); onClose();
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('repair.discardSuccess')}</span></div> });
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('repair.discardTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>
      <div className="modal-content">
        <RepairTargetBox order={order} />
        <p className="text-sm text-subtle">{t('repair.discardHint')}</p>
        {errorMessage && (
          <div className="alert alert-danger mt-4 animate-pop-in"><XCircle size={16} /><span>{errorMessage}</span></div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={submit} disabled={busy}>{busy ? t('common.loading') : t('repair.confirmDiscard')}</Button>
      </div>
    </Modal>
  );
}
