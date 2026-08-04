import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Select, TextArea, Input, Badge, MaskedInput, useSnackbarContext } from 'tsp-form';
import { CheckCircle, XCircle, Plus, Trash2, ChevronsRight } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { CurrencyInput } from '../../../components/CurrencyInput';
import { BranchPaymentAccountField } from '../../../components/BranchPaymentAccountField';
import { ActionDoneView } from '../../contracts/ActionDoneView';
import { fmtCurrency } from '../../../lib/format';
import { translateApiError } from '../../../lib/apiErrors';
import type {
  RepairOrder, RepairItemType, RepairPayMethod, RefRepairItemType, RepairRenderDoc, RepairResult,
} from '../repairTypes';

function translateErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    const translated = translateApiError(err, t);
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

// One tender line in the multi-channel repair payment.
interface RepairPayLine {
  method: RepairPayMethod;
  amount: number;
  bank_account_id: number | null;
  reference: string;
}

export function RepairPayModal({
  open, onClose, order, onDone,
}: {
  open: boolean; onClose: () => void; order: RepairOrder; onDone: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [lines, setLines] = useState<RepairPayLine[]>([{ method: 'CASH', amount: 0, bank_account_id: null, reference: '' }]);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorLine, setErrorLine] = useState<number | null>(null); // 1-based, from error.params.line
  const [billId, setBillId] = useState<number | null>(null);

  const hasContract = order.contract_id != null;

  // Wallet balances for the contract (how much the customer has). Same source as
  // the contract payment flow — the denormalized *_balance columns on v_contracts.
  // Only fetched when the repair is on a contract (walk-in/shop-stock have none).
  const { data: walletBalances } = useQuery({
    queryKey: ['repair-pay-wallets', order.contract_id],
    queryFn: async () => {
      const rows = await apiClient.get<{
        saving_balance: number | null;
        credit_balance: number | null;
        insurance_balance: number | null;
      }[]>(`/v_contracts?id=eq.${order.contract_id}&select=saving_balance,credit_balance,insurance_balance&limit=1`);
      return rows[0] ?? null;
    },
    enabled: open && hasContract,
  });

  const walletBalanceFor = (m: RepairPayMethod): number | null => {
    if (m === 'SAVING_WALLET') return walletBalances?.saving_balance ?? 0;
    if (m === 'CREDIT_WALLET') return walletBalances?.credit_balance ?? 0;
    if (m === 'INSURANCE_WALLET') return walletBalances?.insurance_balance ?? 0;
    return null; // CASH / TRANSFER — no wallet cap
  };

  const methodOptions = useMemo(() => {
    const base: RepairPayMethod[] = ['CASH', 'TRANSFER'];
    const wallets: RepairPayMethod[] = ['CREDIT_WALLET', 'INSURANCE_WALLET', 'SAVING_WALLET'];
    return [
      ...base.map(m => ({ value: m, label: t(`repair.method_${m}`) })),
      ...(hasContract ? wallets.map(m => {
        const bal = walletBalanceFor(m) ?? 0;
        return {
          value: m,
          // "Credit wallet (฿1,200)" — show the balance, disable at zero (matches
          // the contract payment dropdown). Server still enforces sufficiency.
          label: `${t(`repair.method_${m}`)} (${fmtCurrency(bal)})`,
          disabled: bal === 0,
        };
      }) : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasContract, t, walletBalances]);

  useEffect(() => {
    if (open) {
      setView('form');
      // Seed one line pre-filled to the full balance — the common case (pay in full,
      // one channel). Staff adds lines / adjusts to split.
      setLines([{ method: 'CASH', amount: order.c_charge_balance > 0 ? order.c_charge_balance : 0, bank_account_id: null, reference: '' }]);
      setBusy(false); setErrorMessage(''); setErrorLine(null); setBillId(null);
    }
  }, [open, order.c_charge_balance]);

  const updateLine = (idx: number, patch: Partial<RepairPayLine>) =>
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => {
    const remaining = Math.max(0, order.c_charge_balance - totalPay);
    setLines(prev => [...prev, { method: 'CASH', amount: remaining, bank_account_id: null, reference: '' }]);
  };
  const removeLine = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));

  const totalPay = lines.reduce((sum, l) => sum + (l.amount || 0), 0);
  const remainingAfter = order.c_charge_balance - totalPay;

  // Per-line validity — every line needs a positive amount, TRANSFER needs an
  // account, and a wallet line can't exceed its balance (BE enforces this too).
  const lineInvalid = (l: RepairPayLine): boolean => {
    if (!(l.amount > 0)) return true;
    if (l.method === 'TRANSFER' && l.bank_account_id == null) return true;
    const cap = walletBalanceFor(l.method);
    if (cap != null && l.amount > cap) return true;
    return false;
  };
  const canSubmit = !busy && totalPay > 0 && lines.every(l => !lineInvalid(l));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErrorMessage(''); setErrorLine(null);
    try {
      // One atomic call — server sums the lines into a single bill (mig 661).
      const res = await apiClient.rpc<{ bill_id?: number }>('fn_bill_repair_pay', {
        p_repair_order_id: order.repair_order_id,
        p_payments: lines.map(l => ({
          method: l.method,
          amount: Number(l.amount),
          ...(l.method === 'TRANSFER' && l.bank_account_id != null ? { bank_account_id: l.bank_account_id } : {}),
          ...(l.reference.trim() ? { reference: l.reference.trim() } : {}),
        })),
        p_note: null,
      });
      setBillId(res?.bill_id ?? null);
      setView('done');
    } catch (err) {
      // error params.line = 1-based failing line → highlight it (mig 661 contract).
      if (err instanceof ApiError) {
        const line = (err.messageParams as { line?: number } | undefined)?.line;
        if (typeof line === 'number') setErrorLine(line);
      }
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="32rem" width="100%">
      {view === 'form' ? (
        <>
          <div className="modal-header">
            <h2 className="modal-title">{t('repair.payTitle')}</h2>
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
          </div>
          <div className="modal-content">
            <RepairTargetBox order={order} subtitle={`${t('repair.balance')}: ${fmtCurrency(order.c_charge_balance)}`} />

            <div className="flex flex-col gap-3">
              <label className="form-label">{t('repair.paymentMethods')}</label>
              {lines.map((line, idx) => {
                const cap = walletBalanceFor(line.method);
                const over = cap != null && line.amount > cap;
                const isErrorLine = errorLine === idx + 1;
                return (
                  <div
                    key={idx}
                    className={`border rounded-lg p-3 flex flex-col gap-3 ${isErrorLine ? 'border-danger' : 'border-line'}`}
                  >
                    <div className="flex gap-3 items-end">
                      <div className="flex flex-col" style={{ width: '11rem' }}>
                        <label className="form-label text-xs">{t('repair.method')}</label>
                        <Select
                          options={methodOptions}
                          value={line.method}
                          onChange={(v) => updateLine(idx, { method: (v as RepairPayMethod) || 'CASH', bank_account_id: null })}
                          size="sm"
                          searchable={false}
                          showChevron
                        />
                      </div>
                      <div className="flex flex-col flex-1 min-w-0">
                        <label className="form-label text-xs">{t('repair.amount')}</label>
                        <MaskedInput
                          mask="number"
                          decimalScale={2}
                          value={line.amount ? String(line.amount) : ''}
                          onChange={(raw) => updateLine(idx, { amount: parseFloat(raw) || 0 })}
                          size="sm"
                          className="w-full"
                          endIcon={<ChevronsRight size={14} />}
                          onEndIconClick={() => {
                            // Fill this line with the remaining balance, capped to a
                            // wallet's balance if this is a wallet line.
                            const others = lines.reduce((s, l, i) => (i === idx ? s : s + (l.amount || 0)), 0);
                            const remaining = Math.max(0, order.c_charge_balance - others);
                            const fill = cap != null ? Math.min(cap, remaining) : remaining;
                            updateLine(idx, { amount: fill });
                          }}
                        />
                      </div>
                      {lines.length > 1 && (
                        <Button size="sm" className="shrink-0" startIcon={<Trash2 size={14} />} onClick={() => removeLine(idx)} />
                      )}
                    </div>
                    {over && cap != null && (
                      <span className="text-xs text-danger">{t('repair.walletInsufficient', { balance: fmtCurrency(cap) })}</span>
                    )}
                    {line.method === 'TRANSFER' && (
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col">
                          <label className="form-label text-xs">{t('repair.bankAccount')}</label>
                          <BranchPaymentAccountField
                            active={line.method === 'TRANSFER'}
                            onResolve={(id) => updateLine(idx, { bank_account_id: id })}
                          />
                        </div>
                        <div className="flex flex-col">
                          <label className="form-label text-xs">{t('repair.reference')}</label>
                          <Input
                            value={line.reference}
                            onChange={(e) => updateLine(idx, { reference: e.target.value })}
                            className="w-full"
                            placeholder={t('repair.referencePlaceholder')}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <Button size="sm" variant="outline" startIcon={<Plus size={14} />} onClick={addLine} className="self-start">
                {t('repair.addPayment')}
              </Button>
            </div>

            {/* Running total vs charge balance */}
            <div className="flex items-center justify-between mt-4 px-3 py-2 rounded-lg border border-line bg-surface-soft">
              <span className="text-sm text-subtle">{t('repair.totalPayment')}</span>
              <span className="text-sm font-medium tabular-nums">{fmtCurrency(totalPay)}</span>
            </div>
            {totalPay > 0 && remainingAfter > 0 && (
              <span className="block text-xs text-subtle mt-1">{t('repair.remainingAfter', { amount: fmtCurrency(remainingAfter) })}</span>
            )}
            {remainingAfter < 0 && (
              <span className="block text-xs text-subtle mt-1">{t('repair.overpayRefund', { amount: fmtCurrency(-remainingAfter) })}</span>
            )}

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
            { label: t('repair.totalPayment'), value: fmtCurrency(totalPay), emphasis: true },
            // One row per tender line — how the payment was split.
            ...lines.map(l => ({ label: t(`repair.method_${l.method}`), value: fmtCurrency(l.amount) })),
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

/* ────────────────────────────────────────────────────────────────────────────
 * Mark completed (MARK_COMPLETED) — the technician's verdict. "Completed" = the
 * result is decided (an unfixable device is still completed). Result dropdown is
 * fed from v_ref_repair_results (never hardcoded). Work note optional. Moves the
 * sub_state IN_PROGRESS → AWAITING_PAYMENT (or READY_FOR_RETURN if already paid).
 * ──────────────────────────────────────────────────────────────────────────── */

interface RefRepairResult { result: RepairResult; sort_order: number }

export function RepairMarkCompletedModal({
  open, onClose, order, onDone,
}: {
  open: boolean; onClose: () => void; order: RepairOrder; onDone: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [result, setResult] = useState<RepairResult | null>(null);
  const [workNote, setWorkNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const { data: results } = useQuery({
    queryKey: ['ref-repair-results'],
    queryFn: () => apiClient.get<RefRepairResult[]>('/v_ref_repair_results?order=sort_order'),
    staleTime: 60 * 60 * 1000,
  });

  useEffect(() => {
    if (open) { setResult(null); setWorkNote(order.work_note ?? ''); setBusy(false); setErrorMessage(''); }
  }, [open, order]);

  const canSubmit = !busy && !!result;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErrorMessage('');
    try {
      await apiClient.rpc('fn_inv_repair_mark_completed', {
        p_repair_order_id: order.repair_order_id,
        p_result: result,
        p_work_note: workNote.trim() || null,
      });
      onDone(); onClose();
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('repair.markCompletedDone')}</span></div> });
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="30rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('repair.markCompletedTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>
      <div className="modal-content">
        <RepairTargetBox order={order} subtitle={t('repair.markCompletedHint')} />
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('repair.result')} <span className="text-danger">*</span></label>
            <Select
              options={(results ?? []).map(r => ({ value: r.result, label: t(`repair.result_${r.result}`) }))}
              value={result}
              onChange={(val) => setResult((val as RepairResult) || null)}
              placeholder={t('repair.selectResult')}
              showChevron
              searchable={false}
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('repair.workNote')}</label>
            <TextArea value={workNote} onChange={(e) => setWorkNote(e.target.value)} rows={2} />
          </div>
        </div>
        {errorMessage && (
          <div className="alert alert-danger mt-4 animate-pop-in"><XCircle size={16} /><span>{errorMessage}</span></div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={submit} disabled={!canSubmit}>{busy ? t('common.loading') : t('repair.confirmMarkCompleted')}</Button>
      </div>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Undo completion (UNCOMPLETE) — reopen a completed repair so the result can be
 * changed (wrong verdict / wrong order). Reason ≥ 3 chars. Not tied to money —
 * a fully-paid repair can still be reopened. Clears completed_at/result.
 * ──────────────────────────────────────────────────────────────────────────── */

export function RepairUncompleteModal({
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
      await apiClient.rpc('fn_inv_repair_uncomplete', {
        p_repair_order_id: order.repair_order_id,
        p_reason: reason.trim(),
      });
      onDone(); onClose();
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('repair.uncompleteDone')}</span></div> });
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('repair.uncompleteTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>
      <div className="modal-content">
        <RepairTargetBox order={order} subtitle={
          order.result ? `${t('repair.result')}: ${t(`repair.result_${order.result}`)}` : t('repair.uncompleteHint')
        } />
        <div className="flex flex-col">
          <label className="form-label">{t('repair.uncompleteReason')} <span className="text-danger">*</span></label>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t('repair.uncompleteReasonPlaceholder')} />
        </div>
        {errorMessage && (
          <div className="alert alert-danger mt-4 animate-pop-in"><XCircle size={16} /><span>{errorMessage}</span></div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={submit} disabled={!canSubmit}>{busy ? t('common.loading') : t('repair.confirmUncomplete')}</Button>
      </div>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pickup window (PICKUP_SET) — days the customer has to collect after the repair
 * is completed. Editable only while DRAFT (the number is printed on the signed
 * intake doc). 1–365. Prefilled from the order's current pickup_days (default 45).
 * ──────────────────────────────────────────────────────────────────────────── */

export function RepairPickupSetModal({
  open, onClose, order, onDone,
}: {
  open: boolean; onClose: () => void; order: RepairOrder; onDone: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open) {
      setDays(order.pickup_days != null ? String(order.pickup_days) : '');
      setNote(''); setBusy(false); setErrorMessage('');
    }
  }, [open, order]);

  const daysNum = Number(days) || 0;
  const canSubmit = !busy && daysNum >= 1 && daysNum <= 365;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErrorMessage('');
    try {
      await apiClient.rpc('fn_inv_repair_pickup_set', {
        p_repair_order_id: order.repair_order_id,
        p_pickup_days: daysNum,
        p_note: note.trim() || null,
      });
      onDone(); onClose();
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('repair.pickupSetDone')}</span></div> });
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('repair.pickupSetTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>
      <div className="modal-content">
        <RepairTargetBox order={order} subtitle={t('repair.pickupSetHint')} />
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('repair.pickupDays')} <span className="text-danger">*</span></label>
            <div style={{ width: '10rem' }}>
              <MaskedInput
                mask="number"
                decimalScale={0}
                value={days}
                onChange={(raw) => setDays(raw)}
                placeholder="45"
                className="w-full"
              />
            </div>
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('repair.pickupNote')}</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="w-full" />
          </div>
        </div>
        {errorMessage && (
          <div className="alert alert-danger mt-4 animate-pop-in"><XCircle size={16} /><span>{errorMessage}</span></div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={submit} disabled={!canSubmit}>{busy ? t('common.loading') : t('repair.confirmPickupSet')}</Button>
      </div>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Add note (fn_repair_note_add) — a free note logged to the timeline (e.g.
 * "called the customer"). No status/money effect. Note ≥ 3 chars.
 * ──────────────────────────────────────────────────────────────────────────── */

export function RepairNoteAddModal({
  open, onClose, order, onDone,
}: {
  open: boolean; onClose: () => void; order: RepairOrder; onDone: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => { if (open) { setNote(''); setBusy(false); setErrorMessage(''); } }, [open]);

  const canSubmit = !busy && note.trim().length >= 3;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErrorMessage('');
    try {
      await apiClient.rpc('fn_repair_note_add', {
        p_repair_order_id: order.repair_order_id,
        p_note: note.trim(),
      });
      onDone(); onClose();
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('repair.noteAddDone')}</span></div> });
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('repair.noteAddTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>
      <div className="modal-content">
        <RepairTargetBox order={order} subtitle={t('repair.noteAddHint')} />
        <div className="flex flex-col">
          <label className="form-label">{t('repair.note')}</label>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={t('repair.noteAddPlaceholder')} />
        </div>
        {errorMessage && (
          <div className="alert alert-danger mt-4 animate-pop-in"><XCircle size={16} /><span>{errorMessage}</span></div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={submit} disabled={!canSubmit}>{busy ? t('common.loading') : t('repair.confirmNoteAdd')}</Button>
      </div>
    </Modal>
  );
}
