// Put money in, take money out, or record what the fund spent.
//
// All three are the same shape and the same pair of calls: issue the document,
// then confirm the money actually moved. Two steps because a document on its own
// is an intention — the books only shift on the confirmation, so a transfer that
// was never made cannot quietly change a balance.
//
// The three differ in what they touch and who may do them:
//
//   Top-up      holding puts capital in        → the fund book rises
//   Withdrawal  either side takes its surplus  → that side's book falls, and the
//                                                backend refuses more than is
//                                                there
//   Expense     the fund paid someone outside  → the fund book falls, always;
//                                                never the company book, and a
//                                                payee name is required
//
// The withdrawal ceiling is read from the book, never worked out here: the
// backend enforces its own figure and a second guess would disagree with it.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal, Button, Input, InputDatePicker, MaskedInput, RadioGroup, Select, TextArea,
} from 'tsp-form';
import { Keyboard } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency, makeDatePickerFormat, parseLocalDate, toLocalDateStr } from '../../lib/format';
import { useFundBookInvalidate, useFundExpenseCategories } from './useFundBook';
import { useFundSourceAccounts } from '../fund-bills/useFundBills';
import type {
  FundBook,
  FundMovementConfirmResult,
  FundMovementCreateResult,
  FundMovementPurpose,
} from './fundBookTypes';

function parseTypedDate(raw: string): Date | null {
  if (raw.length !== 8) return null;
  const day = parseInt(raw.slice(0, 2), 10);
  const month = parseInt(raw.slice(2, 4), 10);
  let year = parseInt(raw.slice(4, 8), 10);
  if (year > 2400) year -= 543;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

interface FundMovementModalProps {
  open: boolean;
  purpose: FundMovementPurpose;
  companyId: number | null;
  /** Both books, so the withdrawal ceiling can be shown for the side picked. */
  books: FundBook[];
  onClose: () => void;
}

export function FundMovementModal({
  open, purpose, companyId, books, onClose,
}: FundMovementModalProps) {
  const { t, i18n } = useTranslation();
  const invalidate = useFundBookInvalidate();
  const categories = useFundExpenseCategories(open && purpose === 'FUND_EXPENSE' ? companyId : null);
  const accounts = useFundSourceAccounts(open ? companyId : null);

  const today = toLocalDateStr(new Date());

  const [view, setView] = useState<'form' | 'done'>('form');
  // Whose money moves. A top-up is always holding's capital; an expense always
  // comes out of the fund book; only a withdrawal has a real choice.
  const [ownerType, setOwnerType] = useState<'HOLDING' | 'COMPANY'>('HOLDING');
  const [amount, setAmount] = useState('');
  const [paidDate, setPaidDate] = useState(today);
  const [typing, setTyping] = useState(false);
  const [method, setMethod] = useState('TRANSFER');
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FundMovementConfirmResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setOwnerType('HOLDING');
    setAmount('');
    setPaidDate(toLocalDateStr(new Date()));
    setTyping(false);
    setMethod('TRANSFER');
    setAccountId('');
    setReference('');
    setPayeeName('');
    setCategoryId('');
    setReceiptNo('');
    setNote('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open, purpose]);

  const isExpense = purpose === 'FUND_EXPENSE';
  const isWithdraw = purpose === 'FUND_WITHDRAW';

  /** Which book this movement lands in, given the side picked. */
  const book = useMemo(
    () => books.find(b => b.book_type === (ownerType === 'COMPANY' && isWithdraw ? 'COMPANY' : 'FUND')) ?? null,
    [books, ownerType, isWithdraw],
  );

  const amountValue = Number(amount);
  const futureDate = !!paidDate && paidDate > today;
  /** A withdrawal above what the book holds is refused, so say so before submit. */
  const overCeiling = isWithdraw && !!book && amountValue > book.can_withdraw;

  const dirty = !!amount || !!reference.trim() || !!payeeName.trim()
    || !!receiptNo.trim() || !!note.trim() || !!categoryId || paidDate !== today;

  const canSubmit = amountValue > 0
    && !futureDate
    && !overCeiling
    && (!isExpense || payeeName.trim().length > 0);

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const accountOptions = accounts.map(a => ({
    value: String(a.id),
    label: `${a.bank_name} · ${a.account_number_display ?? a.account_number ?? ''}`,
  }));

  const categoryOptions = categories.map(c => ({ value: String(c.id), label: c.name_th }));

  const title = t(`fundBook.movement_${purpose}`);

  /**
   * Issue the document, then confirm it in the same press.
   *
   * The two calls are separate on purpose in the backend, but the person here
   * has already made the transfer — they are recording it, not planning it — so
   * splitting the press would leave an unconfirmed document behind every time
   * someone closed the modal. If the confirmation fails the document survives as
   * a draft and the error says so, which is the honest outcome rather than a
   * silent rollback the backend never promised.
   */
  const handleSubmit = async () => {
    if (companyId == null || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const created = await apiClient.rpc<FundMovementCreateResult>('fn_fund_movement_create', {
        p_company_id: companyId,
        p_purpose: purpose,
        p_owner_type: isExpense ? 'HOLDING' : ownerType,
        p_amount: amountValue,
        p_note: note.trim() || null,
        p_payee_name: isExpense ? payeeName.trim() : null,
        p_category_id: isExpense && categoryId ? Number(categoryId) : null,
        p_receipt_no: isExpense && receiptNo.trim() ? receiptNo.trim() : null,
      });

      const confirmed = await apiClient.rpc<FundMovementConfirmResult>('fn_fund_movement_confirm', {
        p_bill_id: created.bill_id,
        p_paid_date: paidDate,
        p_method: method,
        p_bank_account_id: accountId ? Number(accountId) : null,
        p_reference: reference.trim() || null,
        p_note: note.trim() || null,
      });

      setResult(confirmed);
      setView('done');
      invalidate();
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
      // The document may already exist as a draft, so refresh either way.
      invalidate();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%" ariaLabel={title}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              {book && (
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{book.title}</div>
                  <div className="text-xs text-subtle mt-0.5">
                    {t('fundBook.balance')}: {fmtCurrency(book.balance)}
                    {isWithdraw && <> · {t('fundBook.canWithdraw')}: {fmtCurrency(book.can_withdraw)}</>}
                  </div>
                </div>
              )}

              {isExpense && (
                <div className="mt-3 alert alert-info">
                  <span>{t('fundBook.expenseHitsFundBook')}</span>
                </div>
              )}

              <div className="form-grid mt-4">
                {/* Only a withdrawal has two sides to choose between. */}
                {isWithdraw && (
                  <div className="flex flex-col">
                    <label className="form-label">{t('fundBook.whoseMoney')}</label>
                    <RadioGroup
                      name="fund-movement-owner"
                      value={ownerType}
                      onChange={v => setOwnerType(v as 'HOLDING' | 'COMPANY')}
                      options={[
                        { value: 'HOLDING', label: t('fundBook.owner_HOLDING') },
                        { value: 'COMPANY', label: t('fundBook.owner_COMPANY') },
                      ]}
                    />
                  </div>
                )}

                <div className="flex flex-col">
                  <label className="form-label">{t('fundBook.amountRequired')}</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={2}
                    value={amount}
                    onChange={raw => setAmount(raw)}
                    className="w-full"
                    error={overCeiling}
                  />
                  {overCeiling && book && (
                    <span className="text-xs text-danger-fg mt-1">
                      {t('fundBook.overCeiling', { amount: fmtCurrency(book.can_withdraw) })}
                    </span>
                  )}
                </div>

                {isExpense && (
                  <>
                    <div className="flex flex-col">
                      <label className="form-label">{t('fundBook.payeeRequired')}</label>
                      <Input
                        value={payeeName}
                        onChange={e => setPayeeName(e.target.value)}
                        className="w-full"
                        placeholder={t('fundBook.payeePlaceholder')}
                      />
                    </div>

                    <div className="flex flex-col">
                      <label className="form-label">{t('fundBook.category')}</label>
                      <Select
                        options={categoryOptions}
                        value={categoryId || null}
                        onChange={v => setCategoryId((v as string) ?? '')}
                        placeholder={categoryOptions.length === 0
                          ? t('fundBook.noCategoriesYet')
                          : t('fundBook.categoryPlaceholder')}
                        clearable
                      />
                    </div>

                    <div className="flex flex-col">
                      <label className="form-label">{t('fundBook.receiptNo')}</label>
                      <Input
                        value={receiptNo}
                        onChange={e => setReceiptNo(e.target.value)}
                        className="w-full"
                      />
                    </div>
                  </>
                )}

                <div className="flex flex-col">
                  <label className="form-label">{t('fundBook.movedOnRequired')}</label>
                  <InputDatePicker
                    value={parseLocalDate(paidDate)}
                    onChange={v => setPaidDate(toLocalDateStr(v))}
                    dateFormat={makeDatePickerFormat(i18n.language)}
                    locale={i18n.language}
                    calendar="gregorian"
                    typingMode={typing}
                    onTypingModeChange={setTyping}
                    typingMask="##/##/####"
                    typingPlaceholder="DD/MM/YYYY"
                    parseTypedDate={parseTypedDate}
                    endIcon={<Keyboard size={16} />}
                    onEndIconClick={() => setTyping(v => !v)}
                    error={futureDate}
                  />
                  {futureDate && (
                    <span className="text-xs text-danger-fg mt-1">{t('fundBook.dateFuture')}</span>
                  )}
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fundBook.method')}</label>
                  <RadioGroup
                    name="fund-movement-method"
                    value={method}
                    onChange={v => setMethod(v as string)}
                    options={[
                      { value: 'TRANSFER', label: t('fundBook.method_TRANSFER') },
                      { value: 'CASH', label: t('fundBook.method_CASH') },
                    ]}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fundBook.bankAccount')}</label>
                  <Select
                    options={accountOptions}
                    value={accountId || null}
                    onChange={v => setAccountId((v as string) ?? '')}
                    placeholder={t('fundBook.bankAccountPlaceholder')}
                    clearable
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fundBook.reference')}</label>
                  <Input
                    value={reference}
                    onChange={e => setReference(e.target.value)}
                    className="w-full"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fundBook.note')}</label>
                  <TextArea value={note} onChange={e => setNote(e.target.value)} rows={2} />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleSubmit} disabled={saving || !canSubmit}>
                {t('common.save')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t(`fundBook.done_${purpose}`)}
            contractCode={result.bill_code}
            detailRows={[
              { label: t('fundBook.amount'), value: fmtCurrency(result.amount) },
              { label: t('fundBook.movedOn'), value: paidDate },
              ...(result.book
                ? [{
                    label: t('fundBook.balanceAfter'),
                    value: fmtCurrency(result.book.balance),
                    emphasis: true,
                  }]
                : []),
            ]}
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        maxWidth="24rem"
        width="100%"
        ariaLabel={t('common.unsavedChanges')}
      >
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
