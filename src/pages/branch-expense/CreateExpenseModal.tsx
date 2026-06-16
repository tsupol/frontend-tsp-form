import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal, Button, Input, Select, InputDatePicker, MaskedInput, ImageUploader,
  useSnackbarContext,
  type UploadedImage,
} from 'tsp-form';
import { Calendar, Keyboard, CheckCircle, XCircle, X, Plus } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  toLocalDateStr, parseLocalDate, makeDatePickerFormat,
} from '../../lib/format';
import {
  uploadBranchExpenseSlip, beMediaDelete,
  BRANCH_EXPENSE_SLIP_RESIZE, BRANCH_EXPENSE_SLIP_MAX,
  type BranchExpenseImage,
} from '../../lib/beMedia';
import type { ExpenseCategory, ExpenseEntry, AttachResponse } from './branchExpenseTypes';

interface CreateExpenseModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  categories: ExpenseCategory[];
}

type Phase = 'form' | 'attach' | 'done';

export function CreateExpenseModal({ open, onClose, onSaved, categories }: CreateExpenseModalProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();

  const [phase, setPhase] = useState<Phase>('form');
  const [categoryId, setCategoryId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [vendor, setVendor] = useState('');
  const [note, setNote] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => toLocalDateStr(new Date()));
  const [isTyping, setIsTyping] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<UploadedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [savedEntry, setSavedEntry] = useState<ExpenseEntry | null>(null);

  useEffect(() => {
    if (open) {
      setPhase('form');
      setCategoryId('');
      setAmount('');
      setVendor('');
      setNote('');
      setExpenseDate(toLocalDateStr(new Date()));
      setPendingPhotos([]);
      setError(null);
      setBusy(false);
      setSavedEntry(null);
    }
  }, [open]);

  const isDirty = categoryId !== '' || amount !== '' || vendor !== '' || note !== '' || pendingPhotos.length > 0;

  const handleClose = () => {
    if (phase === 'done') { onClose(); return; }
    if (isDirty && !busy) { setConfirmDiscard(true); return; }
    onClose();
  };

  const forceClose = () => { setConfirmDiscard(false); onClose(); };

  const submit = async () => {
    setError(null);
    if (!categoryId) { setError(t('branchExpense.errCategoryRequired')); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError(t('branchExpense.errAmountPositive')); return; }

    setBusy(true);
    try {
      // STEP 1 — create the entry (no images yet — expense_id needed for keys)
      const created = await apiClient.rpc<ExpenseEntry>('fn_branch_expense_create', {
        p_branch_id: user?.branch_id,
        p_category_id: Number(categoryId),
        p_amount: amt,
        p_expense_date: expenseDate,
        p_vendor: vendor.trim() || null,
        p_note: note.trim() || null,
        p_images: [],
      });

      // STEP 2 — if photos, upload to be-media (one POST per size per photo)
      // then attach via fn_branch_expense_photos_attach
      if (pendingPhotos.length > 0) {
        setPhase('attach');
        const gallery: BranchExpenseImage[] = [];
        for (const img of pendingPhotos) {
          const slot = await uploadBranchExpenseSlip(created.id, img);
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

      setSavedEntry(created);
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

  const categoryOptions = categories.map(c => ({ value: String(c.id), label: c.name_th }));
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
                  ฿{fmtCurrency(savedEntry.current_amount)}
                </div>
                <div className="text-sm text-subtle">
                  {categories.find(c => c.id === savedEntry.category_id)?.name_th
                    ?? `#${savedEntry.category_id}`}
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
                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.category')}</label>
                  <Select
                    options={categoryOptions}
                    value={categoryId || null}
                    onChange={(v) => setCategoryId((v as string) ?? '')}
                    placeholder={t('branchExpense.pickCategory')}
                    showChevron
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
                  />
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
                  <label className="form-label">{t('branchExpense.vendor')}</label>
                  <Input
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    placeholder={t('branchExpense.vendorPlaceholder')}
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
