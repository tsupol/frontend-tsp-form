import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal, Button, Input, Select, InputDatePicker, MaskedInput, ImageUploader,
  useSnackbarContext,
  type UploadedImage,
} from 'tsp-form';
import { Calendar, Keyboard, CheckCircle, XCircle, X, Plus, Search, ChevronRight } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';
import { apiClient, ApiError } from '../../lib/api';
import {
  toLocalDateStr, parseLocalDate, makeDatePickerFormat,
} from '../../lib/format';
import {
  uploadBranchExpenseSlip, beMediaDelete,
  BRANCH_EXPENSE_SLIP_RESIZE, BRANCH_EXPENSE_SLIP_MAX,
  type BranchExpenseImage,
} from '../../lib/beMedia';
import { PaymentMethodChips } from './PaymentMethodChips';
import type { ExpenseItem, ExpenseEntry, AttachResponse, ExpensePaymentMethod } from './branchExpenseTypes';

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
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod | ''>('');
  const [vendor, setVendor] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [note, setNote] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => toLocalDateStr(new Date()));
  const [isTyping, setIsTyping] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<UploadedImage[]>([]);
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
      setItemPickerOpen(false);
      setItemSearch('');
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
          const slot = await uploadBranchExpenseSlip(created.id, i, pendingPhotos[i]);
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
        const translated = (e.messageKey ? t(e.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (e.code ? t(e.code, { ns: 'apiErrors', defaultValue: '' }) : '');
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

                {/* Item picker — grouped by category, searchable */}
                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.item')}</label>
                  <button
                    type="button"
                    onClick={() => setItemPickerOpen(true)}
                    className="flex items-center justify-between gap-2 w-full px-3 h-10 rounded-md border border-line bg-surface text-left text-sm cursor-pointer hover:bg-surface-hover transition-colors"
                  >
                    {selectedItem ? (
                      <span className="min-w-0 truncate">
                        {selectedItem.item_name_th}
                        <span className="text-subtle"> · {selectedItem.category_name_th}</span>
                      </span>
                    ) : (
                      <span className="text-subtle">{t('branchExpense.pickItem')}</span>
                    )}
                    <ChevronRight size={16} className="shrink-0 text-subtle" />
                  </button>
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
                  <PaymentMethodChips value={paymentMethod} onChange={setPaymentMethod} />
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
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {pendingPhotos.map((p, i) => {
                      const preview = p.variants?.thumb?.preview
                        ?? p.variants?.lg?.preview
                        ?? p.preview
                        ?? '';
                      return (
                        <div
                          key={i}
                          className="h-24 rounded-md border border-line overflow-hidden bg-surface flex items-center justify-center gap-2 p-2 relative"
                        >
                          <img
                            src={preview}
                            alt=""
                            className="max-h-full w-auto object-contain block rounded"
                          />
                          <button
                            type="button"
                            onClick={() => setPendingPhotos(prev => prev.filter((_, j) => j !== i))}
                            disabled={busy}
                            aria-label={t('common.remove')}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-danger flex items-center justify-center cursor-pointer border-none"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })}
                    {pendingPhotos.length < BRANCH_EXPENSE_SLIP_MAX && (
                      <ImageUploader
                        multiple
                        sizes={BRANCH_EXPENSE_SLIP_RESIZE}
                        disabled={busy}
                        onUpload={(imgs) => {
                          setPendingPhotos(prev => [...prev, ...imgs].slice(0, BRANCH_EXPENSE_SLIP_MAX));
                        }}
                        className="!h-24 !border !border-dashed !border-line !rounded-md"
                        placeholder={
                          <div className="flex items-center justify-center text-subtle">
                            <Plus size={24} />
                          </div>
                        }
                      />
                    )}
                  </div>
                </div>

                {error && (
                  <div className="alert alert-danger">
                    <XCircle size={16} />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            </div>
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

      {/* Item picker — grouped accordion + search */}
      <ItemPickerModal
        open={itemPickerOpen}
        items={items}
        search={itemSearch}
        onSearchChange={setItemSearch}
        onPick={(id) => { setItemId(String(id)); setItemPickerOpen(false); }}
        onClose={() => setItemPickerOpen(false)}
      />

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

// ── Item picker (grouped by category, searchable) ────────────────────────────

function ItemPickerModal({ open, items, search, onSearchChange, onPick, onClose }: {
  open: boolean;
  items: ExpenseItem[];
  search: string;
  onSearchChange: (v: string) => void;
  onPick: (itemId: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? items.filter(i =>
          i.item_name_th.toLowerCase().includes(term)
          || i.category_name_th.toLowerCase().includes(term)
          || (i.old_code ?? '').toLowerCase().includes(term))
      : items;
    const byCat = new Map<number, { name: string; items: ExpenseItem[] }>();
    for (const it of filtered) {
      if (!byCat.has(it.category_id)) byCat.set(it.category_id, { name: it.category_name_th, items: [] });
      byCat.get(it.category_id)!.items.push(it);
    }
    return [...byCat.values()];
  }, [items, search]);

  return (
    <Modal open={open} onClose={onClose} maxWidth="30rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('branchExpense.pickItem')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>×</button>
      </div>
      <div className="modal-content">
        <div className="mb-3">
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('branchExpense.searchItemPlaceholder')}
            size="sm"
            className="w-full"
            startIcon={<Search size={14} />}
            autoFocus
          />
        </div>
        {groups.length === 0 ? (
          <div className="py-8 text-center text-subtler text-sm">{t('branchExpense.noItems')}</div>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((g, gi) => (
              <div key={gi}>
                <div className="text-xs font-semibold text-subtle uppercase tracking-wide mb-1.5">{g.name}</div>
                <div className="flex flex-col">
                  {g.items.map(it => (
                    <button
                      key={it.item_id}
                      type="button"
                      onClick={() => onPick(it.item_id)}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-left bg-transparent border-none cursor-pointer hover:bg-surface-hover rounded-md"
                    >
                      <span className="truncate">{it.item_name_th}</span>
                      {it.old_code && (
                        <span className="text-xs text-subtler shrink-0">{t('branchExpense.oldCode', { code: it.old_code })}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
