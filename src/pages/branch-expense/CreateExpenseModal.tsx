import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal, Button, Input, Select, InputDatePicker, MaskedInput,
  useSnackbarContext,
  type SelectItem,
} from 'tsp-form';
import { Calendar, Keyboard, CheckCircle } from 'lucide-react';
import { MultiImageUploader } from '../../components/MultiImageUploader';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { fmtCurrency } from '../../lib/format';
import { apiClient, ApiError } from '../../lib/api';
import {
  toLocalDateStr, parseLocalDate, makeDatePickerFormat,
} from '../../lib/format';
import {
  uploadBranchExpenseSlipFromFile, beMediaDelete,
  BRANCH_EXPENSE_SLIP_MAX,
  type BranchExpenseImage,
} from '../../lib/beMedia';
import { PaymentMethodChips } from './PaymentMethodChips';
import type { ExpenseItem, ExpenseEntry, AttachResponse, ExpensePaymentMethod } from './branchExpenseTypes';
import { translateApiError } from '../../lib/apiErrors';

interface BranchOption { id: number; code: string; name: string }

interface CreateExpenseModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  items: ExpenseItem[];
  // Company users pick a branch; branch users have it implied (pass fixedBranchId).
  branches?: BranchOption[];
  fixedBranchId?: number | null;
}

type Phase = 'form' | 'attach' | 'done';

export function CreateExpenseModal({ open, onClose, onSaved, items, branches, fixedBranchId }: CreateExpenseModalProps) {
  const { t, i18n } = useTranslation();
  const { addSnackbar } = useSnackbarContext();

  const [phase, setPhase] = useState<Phase>('form');
  const [branchId, setBranchId] = useState<string>('');
  const [itemId, setItemId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod | ''>('');
  const [vendor, setVendor] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [note, setNote] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => toLocalDateStr(new Date()));
  const [isTyping, setIsTyping] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [savedEntry, setSavedEntry] = useState<ExpenseEntry | null>(null);

  const needsBranch = !fixedBranchId && (branches?.length ?? 0) > 0;

  useEffect(() => {
    if (open) {
      setPhase('form');
      setBranchId(fixedBranchId ? String(fixedBranchId) : '');
      setItemId('');
      setAmount('');
      setPaymentMethod('');
      setVendor('');
      setPayeeName('');
      setReceiptNo('');
      setNote('');
      setExpenseDate(toLocalDateStr(new Date()));
      setPendingPhotos([]);
      setError(null);
      setBusy(false);
      setSavedEntry(null);
    }
  }, [open, fixedBranchId]);

  const selectedItem = useMemo(() => items.find(i => String(i.item_id) === itemId) ?? null, [items, itemId]);

  // Grouped options: a group header per category, items under it. Select renders
  // the group labels natively and keeps a header only when it has visible children.
  const itemOptions = useMemo<SelectItem[]>(() => {
    const out: SelectItem[] = [];
    let lastCat: number | null = null;
    for (const it of items) {
      if (it.category_id !== lastCat) {
        out.push({ type: 'group', label: it.category_name_th });
        lastCat = it.category_id;
      }
      out.push({ value: String(it.item_id), label: it.item_name_th });
    }
    return out;
  }, [items]);

  const isDirty = itemId !== '' || amount !== '' || vendor !== '' || payeeName !== ''
    || receiptNo !== '' || note !== '' || pendingPhotos.length > 0;

  const handleClose = () => {
    if (phase === 'done') { onClose(); return; }
    if (isDirty && !busy) { setConfirmDiscard(true); return; }
    onClose();
  };

  const forceClose = () => { setConfirmDiscard(false); onClose(); };

  const effectiveBranchId = fixedBranchId ?? (branchId ? Number(branchId) : null);

  const submit = async () => {
    setError(null);
    if (!effectiveBranchId) { setError(t('branchExpense.errBranchRequired')); return; }
    if (!itemId) { setError(t('branchExpense.errItemRequired')); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError(t('branchExpense.errAmountPositive')); return; }

    setBusy(true);
    try {
      // STEP 1 — create the entry (no images yet — expense_id needed for keys)
      const created = await apiClient.rpc<ExpenseEntry>('fn_branch_expense_create', {
        p_branch_id: effectiveBranchId,
        p_item_id: Number(itemId),
        p_amount: amt,
        p_expense_date: expenseDate,
        p_payment_method: paymentMethod || null,
        p_vendor: vendor.trim() || null,
        p_payee_name: payeeName.trim() || null,
        p_receipt_no: receiptNo.trim() || null,
        p_note: note.trim() || null,
        p_images: [],
      });

      // STEP 2 — if photos, upload to be-media (one POST per size per photo)
      // then attach via fn_branch_expense_photos_attach
      if (pendingPhotos.length > 0) {
        setPhase('attach');
        const gallery: BranchExpenseImage[] = [];
        for (let i = 0; i < pendingPhotos.length; i++) {
          const slot = await uploadBranchExpenseSlipFromFile(created.id, i, pendingPhotos[i]);
          gallery.push(slot);
        }
        const attach = await apiClient.rpc<AttachResponse>('fn_branch_expense_photos_attach', {
          p_id: created.id,
          p_images: gallery,
        });
        // Defensive: drop any keys the attach RPC reported as superseded.
        if (attach.deleted_keys && attach.deleted_keys.length > 0) {
          beMediaDelete(attach.deleted_keys).catch(() => { /* sweeper backstop */ });
        }
      }

      // Enrich the create result with the picked item's display names for the
      // done screen (the create RPC returns ids only).
      setSavedEntry({
        ...created,
        item_name_th: selectedItem?.item_name_th ?? created.item_name_th,
        category_name_th: selectedItem?.category_name_th ?? created.category_name_th,
      });
      setPhase('done');
      onSaved();
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('branchExpense.entrySaved')}</span>
          </div>
        ),
        duration: 2500,
      });
    } catch (e) {
      setPhase('form');
      if (e instanceof ApiError) {
        const translated = translateApiError(e, t);
        setError(translated || e.message);
      } else if (e instanceof Error) {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const branchOptions = (branches ?? []).map(b => ({ value: String(b.id), label: `${b.code} · ${b.name}` }));
  const dpFormat = makeDatePickerFormat(i18n.language);

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="36rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {phase === 'done' ? t('branchExpense.entrySaved') : t('branchExpense.recordExpense')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>

        {phase === 'done' && savedEntry ? (
          <>
            <div className="modal-content">
              <div className="flex flex-col items-center gap-3 py-4">
                <CheckCircle size={40} className="text-success" />
                <div className="text-2xl font-semibold tabular-nums">
                  ฿{fmtCurrency(savedEntry.amount)}
                </div>
                <div className="text-sm text-subtle text-center">
                  {savedEntry.item_name_th ?? `#${savedEntry.item_id}`}
                  {savedEntry.category_name_th && (
                    <span className="text-subtler"> · {savedEntry.category_name_th}</span>
                  )}
                </div>
                <div className="text-xs text-subtle">
                  {savedEntry.expense_date}
                  {savedEntry.image_count > 0 && ` · ${savedEntry.image_count} ${t('branchExpense.photos').toLowerCase()}`}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <Button color="primary" onClick={onClose}>{t('common.done')}</Button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-content">
              <div className="form-grid">
                {/* Branch — company users only */}
                {needsBranch && (
                  <div className="flex flex-col">
                    <label className="form-label">{t('branchExpense.branch')}</label>
                    <Select
                      options={branchOptions}
                      value={branchId || null}
                      onChange={(v) => setBranchId((v as string) ?? '')}
                      placeholder={t('branchExpense.pickBranch')}
                      showChevron
                    />
                  </div>
                )}

                {/* Item picker — grouped by category (Select renders group
                    headers natively), searchable across item + category. */}
                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.item')}</label>
                  <Select
                    options={itemOptions}
                    value={itemId || null}
                    onChange={(v) => setItemId((v as string) ?? '')}
                    placeholder={t('branchExpense.pickItem')}
                    showChevron
                    renderOption={(opt, { selected }) => {
                      const it = items.find(i => String(i.item_id) === opt.value);
                      return (
                        <div className="flex items-center justify-between gap-2 min-w-0 w-full">
                          <span className={`truncate ${selected ? 'font-medium' : ''}`}>{opt.label}</span>
                          {it?.old_code && (
                            <span className="text-[11px] text-subtler shrink-0">{t('branchExpense.oldCode', { code: it.old_code })}</span>
                          )}
                        </div>
                      );
                    }}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.amount')} (THB)</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={2}
                    value={amount}
                    onChange={(raw) => setAmount(raw)}
                    className="w-full"
                    inputMode="decimal"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.paymentMethod')}</label>
                  <PaymentMethodChips value={paymentMethod} onChange={setPaymentMethod} disabled={busy} />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.date')}</label>
                  <InputDatePicker
                    dateFormat={dpFormat}
                    locale={i18n.language}
                    calendar="gregorian"
                    value={parseLocalDate(expenseDate)}
                    onChange={(d) => setExpenseDate(toLocalDateStr(d))}
                    endIcon={isTyping ? <Keyboard size={16} /> : <Calendar size={14} />}
                    onEndIconClick={() => setIsTyping(v => !v)}
                    typingMode={isTyping}
                    onTypingModeChange={setIsTyping}
                    typingMask="##/##/####"
                    typingPlaceholder="DD/MM/YYYY"
                    parseTypedDate={(raw) => {
                      if (raw.length !== 8) return null;
                      const day = parseInt(raw.slice(0, 2), 10);
                      const month = parseInt(raw.slice(2, 4), 10);
                      let year = parseInt(raw.slice(4, 8), 10);
                      if (year > 2400) year -= 543;
                      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                      const d = new Date(year, month - 1, day);
                      if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                      return d;
                    }}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.payeeName')}</label>
                  <Input
                    value={payeeName}
                    onChange={(e) => setPayeeName(e.target.value)}
                    placeholder={t('branchExpense.payeeNamePlaceholder')}
                    className="w-full"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.vendor')}</label>
                  <Input
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    placeholder={t('branchExpense.vendorPlaceholder')}
                    className="w-full"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.receiptNo')}</label>
                  <Input
                    value={receiptNo}
                    onChange={(e) => setReceiptNo(e.target.value)}
                    placeholder={t('branchExpense.receiptNoPlaceholder')}
                    className="w-full"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.note')}</label>
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('branchExpense.notePlaceholder')}
                    className="w-full"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">
                    {t('branchExpense.photos')}
                    <span className="text-xs text-subtle ml-1">
                      ({pendingPhotos.length}/{BRANCH_EXPENSE_SLIP_MAX})
                    </span>
                  </label>
                  {/* Photos are staged locally and uploaded only after the entry
                      row exists (be-media keys embed the expense id), so every
                      item here is `staged` and removal is immediate. */}
                  <MultiImageUploader
                    items={pendingPhotos.map((file, i) => ({
                      kind: 'staged' as const,
                      id: String(i),
                      file,
                    }))}
                    onAdd={(files) => setPendingPhotos(prev =>
                      [...prev, ...files].slice(0, BRANCH_EXPENSE_SLIP_MAX))}
                    onRemove={(item) => setPendingPhotos(prev =>
                      prev.filter((_, i) => String(i) !== item.id))}
                    max={BRANCH_EXPENSE_SLIP_MAX}
                    disabled={busy}
                    busyLabel={phase === 'attach' ? t('branchExpense.uploadingPhotos') : undefined}
                    onError={setError}
                  />
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button color="primary" onClick={submit} disabled={busy}>
                {phase === 'attach' ? t('branchExpense.uploadingPhotos') : busy ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirmDiscard} onClose={() => setConfirmDiscard(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
