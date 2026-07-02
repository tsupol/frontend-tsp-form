import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Modal, Input, MaskedInput, InputDatePicker, useSnackbarContext,
} from 'tsp-form';
import {
  CheckCircle, XCircle, Pencil, Ban, AlertTriangle, X, Calendar, Keyboard,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency, toLocalDateStr, parseLocalDate, makeDatePickerFormat } from '../../lib/format';
import { normalizeKey } from '../../lib/mediaPath';
import { MediaLightbox, MediaThumbButton } from '../../components/MediaLightbox';
import { PaymentMethodChips } from './PaymentMethodChips';
import type {
  ExpenseEntry, DetailsUpdateResponse, VoidResponse, ExpensePaymentMethod,
} from './branchExpenseTypes';
import { EXPENSE_PAYMENT_METHODS } from './branchExpenseTypes';

interface Props {
  entryId: number;
  onClosed?: () => void;
}

// Company users manage any branch in their company; branch_manager only their own.
const COMPANY_MANAGE_ROLES = ['COMPANY_ADMIN', 'COMPANY_ACCOUNTANT'];

export function ExpenseDetailPanel({ entryId, onClosed }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const role = user?.role_code ?? '';

  const [editOpen, setEditOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);

  const { data: entry, isLoading } = useQuery({
    queryKey: ['branch-expense', 'entry', entryId],
    queryFn: async () => {
      const rows = await apiClient.get<ExpenseEntry[]>(
        `/v_branch_expense_entries?id=eq.${entryId}&limit=1`
      );
      return rows[0] ?? null;
    },
  });

  const canManage = entry != null && !entry.is_voided && (
    COMPANY_MANAGE_ROLES.includes(role)
    || (role === 'BRANCH_MANAGER' && user?.branch_id === entry.branch_id)
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['branch-expense'] });
  };

  if (isLoading || !entry) {
    return (
      <div className="flex-1 h-full flex items-center justify-center text-subtle p-8">
        {isLoading ? t('common.loading') : t('branchExpense.notFound')}
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Header */}
        <div className="flex-none border-b border-line px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {entry.code_display && (
              <div className="text-xs font-mono text-subtler truncate">{entry.code_display}</div>
            )}
            <div className="text-base font-semibold truncate">{entry.item_name_th}</div>
            <div className="text-xs text-subtle truncate">
              {entry.category_name_th}
              {' · '}<DateTime value={entry.expense_date} showTime={false} />
              {' · '}{entry.branch_code}
            </div>
          </div>
          {onClosed && (
            <button
              type="button"
              onClick={onClosed}
              className="w-8 h-8 rounded-md hover:bg-surface-hover cursor-pointer bg-transparent border-none flex items-center justify-center text-subtle hover:text-fg"
              aria-label={t('common.close')}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto better-scroll p-4 flex flex-col gap-4">
          {entry.is_voided && (
            <div className="alert alert-warning">
              <Ban size={16} />
              <div>
                <div className="alert-title">{t('branchExpense.voided')}</div>
                {entry.voided_reason && (
                  <div className="alert-description">{entry.voided_reason}</div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <DetailRow label={t('branchExpense.amount')} value={
              <span className={`font-semibold text-base ${entry.is_voided ? 'line-through text-subtle' : ''}`}>
                ฿{fmtCurrency(entry.amount)}
              </span>
            } />
            <DetailRow label={t('branchExpense.paymentMethod')} value={
              entry.payment_method
                ? t(`branchExpense.paymentMethod_${entry.payment_method}`, { defaultValue: entry.payment_method_name_th ?? entry.payment_method })
                : '—'
            } />
            <DetailRow label={t('branchExpense.payeeName')} value={entry.payee_name ?? '—'} />
            <DetailRow label={t('branchExpense.vendor')} value={entry.vendor ?? '—'} />
            {entry.receipt_no && (
              <DetailRow label={t('branchExpense.receiptNo')} value={entry.receipt_no} />
            )}
            {entry.item_old_code && (
              <DetailRow label={t('branchExpense.oldCodeLabel')} value={entry.item_old_code} />
            )}
            {entry.note && (
              <div className="col-span-2">
                <DetailRow label={t('branchExpense.note')} value={entry.note} />
              </div>
            )}
            <DetailRow label={t('branchExpense.recordedBy')} value={
              <>
                <span>{entry.recorded_by_username ?? '—'}</span>
                <div className="text-xs text-subtle mt-0.5">
                  <DateTime value={entry.recorded_at} />
                </div>
              </>
            } />
          </div>

          {!entry.is_voided && entry.images && entry.images.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-subtle mb-2">
                {t('branchExpense.photos')}
              </div>
              <div className="flex flex-wrap gap-2">
                {entry.images.map((img, i) => {
                  const thumbKey = img.thumb || img.lg;
                  const lgKey = img.lg || img.thumb;
                  if (!thumbKey || !lgKey) return null;
                  return (
                    <MediaThumbButton
                      key={i}
                      mediaKey={normalizeKey(thumbKey)}
                      alt={`${entry.item_name_th} receipt ${i + 1}`}
                      className="w-24 h-24 rounded-md overflow-hidden border border-line cursor-zoom-in hover:opacity-80 transition-opacity bg-surface-muted"
                      onClick={() => setLightboxKey(normalizeKey(lgKey))}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Sticky action footer — matches ICloud pattern */}
        {canManage && (
          <div className="flex-none border-t border-line p-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              startIcon={<Pencil size={14} />}
              onClick={() => setEditOpen(true)}
            >
              {t('branchExpense.editEntry')}
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              startIcon={<Ban size={14} className="text-danger" />}
              onClick={() => setVoidOpen(true)}
            >
              {t('branchExpense.void')}
            </Button>
          </div>
        )}
      </div>

      <EditEntryModal
        open={editOpen}
        entry={entry}
        onClose={() => setEditOpen(false)}
        onSaved={() => { setEditOpen(false); refresh(); }}
      />

      <VoidModal
        open={voidOpen}
        entry={entry}
        onClose={() => setVoidOpen(false)}
        onSaved={() => { setVoidOpen(false); refresh(); }}
      />

      <MediaLightbox
        open={lightboxKey !== null}
        onClose={() => setLightboxKey(null)}
        mediaKey={lightboxKey}
        alt={t('branchExpense.photoView')}
      />
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-subtle mb-0.5">{label}</div>
      <div>{value}</div>
    </div>
  );
}

// Edit-in-place: amount + all descriptive fields overwrite via
// fn_branch_expense_details_update. Category/item are NOT editable (void + record
// again per doc 80 §Mistake 2). Only changed fields are sent (partial update).
function EditEntryModal({
  open, entry, onClose, onSaved,
}: { open: boolean; entry: ExpenseEntry; onClose: () => void; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod | ''>('');
  const [vendor, setVendor] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [note, setNote] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const pmValue: ExpensePaymentMethod | '' =
    entry.payment_method && (EXPENSE_PAYMENT_METHODS as readonly string[]).includes(entry.payment_method)
      ? entry.payment_method as ExpensePaymentMethod
      : '';

  useEffect(() => {
    if (open) {
      setView('form');
      setAmount(String(entry.amount));
      setExpenseDate(entry.expense_date);
      setPaymentMethod(pmValue);
      setVendor(entry.vendor ?? '');
      setPayeeName(entry.payee_name ?? '');
      setReceiptNo(entry.receipt_no ?? '');
      setNote(entry.note ?? '');
      setError(null);
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry]);

  const isDirty =
    amount !== String(entry.amount)
    || expenseDate !== entry.expense_date
    || paymentMethod !== pmValue
    || vendor !== (entry.vendor ?? '')
    || payeeName !== (entry.payee_name ?? '')
    || receiptNo !== (entry.receipt_no ?? '')
    || note !== (entry.note ?? '');

  const handleClose = () => {
    if (view === 'done') { onClose(); return; }
    if (isDirty && !busy) { setConfirm(true); return; }
    onClose();
  };

  const submit = async () => {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError(t('branchExpense.errAmountPositive')); return; }
    setBusy(true);
    try {
      // Partial: send only fields that changed. Blanked text fields send '' to clear.
      const patch: Record<string, unknown> = { p_id: entry.id };
      if (amt !== entry.amount) patch.p_amount = amt;
      if (expenseDate !== entry.expense_date) patch.p_expense_date = expenseDate;
      if (paymentMethod !== pmValue) patch.p_payment_method = paymentMethod || null;
      if (vendor !== (entry.vendor ?? '')) patch.p_vendor = vendor.trim();
      if (payeeName !== (entry.payee_name ?? '')) patch.p_payee_name = payeeName.trim();
      if (receiptNo !== (entry.receipt_no ?? '')) patch.p_receipt_no = receiptNo.trim();
      if (note !== (entry.note ?? '')) patch.p_note = note.trim();

      await apiClient.rpc<DetailsUpdateResponse>('fn_branch_expense_details_update', patch);
      setView('done');
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('branchExpense.entryUpdated')}</span>
          </div>
        ),
        duration: 2500,
      });
    } catch (e) {
      if (e instanceof ApiError) {
        const translated = (e.messageKey ? t(e.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (e.code ? t(e.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || e.message);
      } else if (e instanceof Error) setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const dpFormat = makeDatePickerFormat(i18n.language);

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done' ? t('branchExpense.entryUpdated') : t('branchExpense.editEntry')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>
        {view === 'done' ? (
          <>
            <div className="modal-content">
              <div className="text-center py-6">
                <CheckCircle size={40} className="text-success mx-auto mb-3" />
                <div className="text-lg font-semibold tabular-nums">฿{fmtCurrency(Number(amount))}</div>
                <div className="text-sm text-subtle mt-1">{entry.item_name_th}</div>
              </div>
            </div>
            <div className="modal-footer">
              <Button color="primary" onClick={onSaved}>{t('common.done')}</Button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-content">
              {/* item/category are locked — shown for context, not editable */}
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
                <div className="font-medium text-sm">{entry.item_name_th}</div>
                <div className="text-xs text-subtle">{entry.category_name_th}</div>
              </div>
              <div className="form-grid">
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
                  <Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} className="w-full" placeholder={t('branchExpense.payeeNamePlaceholder')} />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.vendor')}</label>
                  <Input value={vendor} onChange={(e) => setVendor(e.target.value)} className="w-full" placeholder={t('branchExpense.vendorPlaceholder')} />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.receiptNo')}</label>
                  <Input value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} className="w-full" placeholder={t('branchExpense.receiptNoPlaceholder')} />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.note')}</label>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} className="w-full" placeholder={t('branchExpense.notePlaceholder')} />
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
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={submit} disabled={busy || !isDirty}>
                {busy ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </>
        )}
      </Modal>
      <Modal open={confirm} onClose={() => setConfirm(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={() => { setConfirm(false); onClose(); }}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}

function VoidModal({
  open, entry, onClose, onSaved,
}: { open: boolean; entry: ExpenseEntry; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (open) {
      setView('form');
      setReason('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const isDirty = reason !== '';
  const handleClose = () => {
    if (view === 'done') { onClose(); return; }
    if (isDirty && !busy) { setConfirm(true); return; }
    onClose();
  };

  const submit = async () => {
    setError(null);
    if (!reason.trim()) { setError(t('branchExpense.errReasonRequired')); return; }
    setBusy(true);
    try {
      await apiClient.rpc<VoidResponse>('fn_branch_expense_void', {
        p_id: entry.id,
        p_reason: reason.trim(),
      });
      setView('done');
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('branchExpense.voided')}</span>
          </div>
        ),
        duration: 2500,
      });
    } catch (e) {
      if (e instanceof ApiError) {
        const translated = (e.messageKey ? t(e.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (e.code ? t(e.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || e.message);
      } else if (e instanceof Error) setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done' ? t('branchExpense.voided') : t('branchExpense.voidEntry')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>
        {view === 'done' ? (
          <>
            <div className="modal-content">
              <div className="text-center py-4">
                <Ban size={40} className="text-danger mx-auto mb-3" />
                <div className="text-sm">{t('branchExpense.voided')}</div>
              </div>
            </div>
            <div className="modal-footer">
              <Button color="primary" onClick={onSaved}>{t('common.done')}</Button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-content">
              <div className="form-grid">
                <div className="alert alert-warning">
                  <AlertTriangle size={16} />
                  <span>{t('branchExpense.voidWarning')}</span>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.reason')}</label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('branchExpense.voidReasonPlaceholder')}
                    className="w-full"
                  />
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
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={submit} disabled={busy}>
                {busy ? t('common.saving') : t('branchExpense.confirmVoid')}
              </Button>
            </div>
          </>
        )}
      </Modal>
      <Modal open={confirm} onClose={() => setConfirm(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={() => { setConfirm(false); onClose(); }}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
