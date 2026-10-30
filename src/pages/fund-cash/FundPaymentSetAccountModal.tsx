// "แก้บัญชีของรายการ" — say which of the fund's accounts a transfer really went
// through (doc 155 §1b, fn_fund_payment_set_account).
//
// For a line recorded against the wrong account (found when its SMS turned up
// under "every account"), or one in the "no account named" group. Only a
// transfer of a fund document can be moved, only to one of the fund's own
// accounts, and the reason is required — it stays in the document's history.
// Both passbooks rework their balances on their own. A day already closed is
// refused by the backend (FUND.STATE.DAY_ALREADY_CLOSED); there is no amend path yet.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Select, TextArea } from 'tsp-form';
import { Landmark } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fundAccountLabel } from '../../hooks/useFundAccountChoice';
import { useFundSourceAccounts } from '../fund-bills/useFundBills';
import { useSmsLinkInvalidate } from '../../lib/smsLink';
import type { FundPassbookLine } from './useFundCash';

interface SetAccountResult {
  payment_id: number;
  bill_code?: string;
  from_bank_account_id?: number | null;
  bank_account_id: number;
  changed: boolean;
}

interface Props {
  open: boolean;
  line: FundPassbookLine | null;
  companyId: number | null;
  onClose: () => void;
}

export function FundPaymentSetAccountModal({ open, line: lineProp, companyId, onClose }: Props) {
  const { t } = useTranslation();
  const invalidate = useSmsLinkInvalidate();
  const { accounts, isLoading } = useFundSourceAccounts(companyId);

  const lastLine = useRef(lineProp);
  if (lineProp) lastLine.current = lineProp;
  const line = lineProp ?? lastLine.current;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SetAccountResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form'); setAccountId(''); setReason(''); setBusy(false); setError(''); setResult(null); setConfirmClose(false);
  }, [open, lineProp?.payment_id]);

  // The account the line sits in now (null in the "no account named" group).
  const currentId = line?.is_unassigned ? null : line?.company_bank_account_id ?? null;
  const usual = t('fundAccount.usual');
  const options = accounts
    .filter(a => a.id !== currentId)
    .map(a => ({ value: String(a.id), label: fundAccountLabel(a, usual) }));
  const nameOf = (id: number | null | undefined) => {
    const a = accounts.find(x => x.id === id);
    return a ? fundAccountLabel(a, usual) : t('fundPassbook.unassigned');
  };

  const dirty = !!accountId || !!reason.trim();
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'form' && dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (!line?.payment_id || !accountId || !reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.rpc<SetAccountResult>('fn_fund_payment_set_account', {
        p_payment_id: line.payment_id,
        p_bank_account_id: Number(accountId),
        p_reason: reason.trim(),
      });
      setResult(res);
      setView('done');
      invalidate();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%" ariaLabel={t('fundPassbook.setAccount.title')}>
        <div className="modal-header">
          <h2 className="modal-title">{t('fundPassbook.setAccount.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'done' && result ? (
          <ActionDoneView
            headline={result.changed ? t('fundPassbook.setAccount.done') : t('fundPassbook.setAccount.unchanged')}
            contractCode={result.bill_code ?? line?.doc_code ?? ''}
            detailRows={[
              { label: t('fundPassbook.setAccount.from'), value: nameOf(result.from_bank_account_id ?? currentId) },
              { label: t('fundPassbook.setAccount.to'), value: nameOf(result.bank_account_id), emphasis: true },
              { label: t('fundPassbook.setAccount.reason'), value: reason.trim() },
            ]}
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content">
              {line && (
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{line.doc_code ?? '—'}</div>
                  <div className="text-xs text-subtle mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <DateTime value={line.money_date} showTime={false} />
                    <span>· {line.item_kind_name ?? line.item_kind}</span>
                    <span className="tabular-nums">· {line.direction === 'IN' ? '+' : '−'}{fmtCurrency(line.amount)}</span>
                  </div>
                  <div className="text-xs text-subtle mt-1 inline-flex items-center gap-1">
                    <Landmark size={12} />
                    {t('fundPassbook.setAccount.now')}: {line.is_unassigned ? t('fundPassbook.unassigned') : (line.account_name ?? line.account_number ?? line.account_key)}
                  </div>
                </div>
              )}
              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('fundPassbook.setAccount.to')} *</label>
                  <Select
                    options={options}
                    value={accountId || null}
                    onChange={v => setAccountId((v as string) ?? '')}
                    placeholder={isLoading ? t('common.loading') : t('fundAccount.placeholder')}
                    disabled={busy}
                    showChevron
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('fundPassbook.setAccount.reason')} *</label>
                  <TextArea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={2}
                    placeholder={t('fundPassbook.setAccount.reasonPlaceholder')}
                    disabled={busy}
                  />
                </div>
              </div>
              <p className="text-xs text-subtle m-0">{t('fundPassbook.setAccount.hint')}</p>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={() => { void submit(); }} disabled={busy || !accountId || !reason.trim()}>
                {t('fundPassbook.setAccount.submit')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%" ariaLabel={t('common.unsavedChanges')}>
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
