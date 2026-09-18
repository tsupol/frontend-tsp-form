// Write the counted figures for one day (UI_SUMMARY/148 §4).
//
// The parent collects the counted in/out per account on the page itself, then
// opens this to confirm. Two things the backend enforces and the modal asks for
// up front so a save is not wasted:
//   - an account whose counted figure differs from the system figure needs a
//     note (>= 3 characters)
//   - re-saving an account that already has a reconciliation needs an edit
//     reason, which becomes a new version (nothing is overwritten)

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, TextArea } from 'tsp-form';
import { fmtCurrency } from '../../lib/format';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView, type ActionDoneDetailRow } from '../contracts/ActionDoneView';
import { translateApiError } from '../../lib/apiErrors';
import { useFundReconSave } from './useFundDay';
import type { FundDayAccount, FundReconSaveResult } from './fundDayTypes';

export interface FundReconDraft {
  account: FundDayAccount;
  counted_in: number;
  counted_out: number;
  note: string;
}

interface FundReconSaveModalProps {
  open: boolean;
  companyId: number | null;
  date: string;
  /** The accounts the user filled in, already filtered to the reconcilable ones. */
  drafts: FundReconDraft[];
  onClose: () => void;
  /** Called after a successful save so the page can clear its inputs. */
  onSaved: () => void;
}

export function FundReconSaveModal({
  open, companyId, date, drafts, onClose, onSaved,
}: FundReconSaveModalProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<FundReconSaveResult | null>(null);
  const [editReason, setEditReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const saveMutation = useFundReconSave(companyId);

  // Re-seed on open rather than on remount — a changing key would remount the
  // panel already open and kill the transition.
  useEffect(() => {
    if (open) {
      setView('form');
      setResult(null);
      setEditReason('');
      setError(null);
      setConfirmClose(false);
    }
  }, [open, date]);

  // An account that already carries a recon is being re-saved, so the backend
  // will demand a reason. Ask before sending instead of after the 400.
  const needsEditReason = drafts.some(d => d.account.recon !== null);
  const reasonMissing = needsEditReason && editReason.trim().length < 3;
  const isDirty = editReason.trim().length > 0;

  const forceClose = () => {
    setConfirmClose(false);
    onClose();
  };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleSubmit = async () => {
    setError(null);
    try {
      const saved = await saveMutation.mutateAsync({
        date,
        accounts: drafts.map(d => ({
          account_key: d.account.account_key,
          counted_in: d.counted_in,
          counted_out: d.counted_out,
          note: d.note.trim() ? d.note.trim() : null,
        })),
        editReason: needsEditReason ? editReason.trim() : null,
      });
      setResult(saved);
      setView('done');
      onSaved();
    } catch (err) {
      setError(translateApiError(err, t));
    }
  };

  const detailRows: ActionDoneDetailRow[] = (result?.saved ?? []).map(row => ({
    label: row.account_key,
    value: t('fundDay.savedRow', {
      version: row.version,
      in: fmtCurrency(row.counted_in),
      out: fmtCurrency(row.counted_out),
    }),
  }));

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="34rem" width="100%" ariaLabel={t('fundDay.saveTitle')}>
        {view === 'form' ? (
          <>
            <div className="modal-header">
              <h2 className="modal-title">{t('fundDay.saveTitle')}</h2>
              <button type="button" className="modal-close-btn" onClick={handleClose}>{'×'}</button>
            </div>
            <div className="modal-content min-w-0">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
                <div className="font-medium text-sm">{t('fundDay.saveForDate', { date })}</div>
                <div className="text-xs text-subtle">
                  {t('fundDay.saveAccountCount', { count: drafts.length })}
                </div>
              </div>

              <div className="flex flex-col gap-2 mb-4">
                {drafts.map(d => {
                  const diffIn = d.counted_in - d.account.in_amount;
                  const diffOut = d.counted_out - d.account.out_amount;
                  return (
                    <div key={d.account.account_key} className="border border-line rounded-md px-3 py-2">
                      <div className="font-medium text-sm">
                        {d.account.bank_name ?? d.account.account_key}
                      </div>
                      {d.account.account_number && (
                        <div className="text-xs text-subtle">{d.account.account_number}</div>
                      )}
                      <div className="mt-1 text-sm tabular-nums flex flex-wrap gap-x-4 gap-y-0.5">
                        <span>
                          {t('fundDay.countedIn')}: {fmtCurrency(d.counted_in)}
                          {diffIn !== 0 && (
                            <span className="text-warning-fg ml-1">
                              ({diffIn > 0 ? '+' : '−'}{fmtCurrency(Math.abs(diffIn))})
                            </span>
                          )}
                        </span>
                        <span>
                          {t('fundDay.countedOut')}: {fmtCurrency(d.counted_out)}
                          {diffOut !== 0 && (
                            <span className="text-warning-fg ml-1">
                              ({diffOut > 0 ? '+' : '−'}{fmtCurrency(Math.abs(diffOut))})
                            </span>
                          )}
                        </span>
                      </div>
                      {d.note.trim() && (
                        <div className="mt-1 text-xs text-subtle">{d.note.trim()}</div>
                      )}
                      {d.account.recon && (
                        <div className="mt-1 text-xs text-info-fg">
                          {t('fundDay.willBeVersion', { version: d.account.recon.version + 1 })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {needsEditReason && (
                <div className="flex flex-col">
                  <label className="form-label" htmlFor="fund-edit-reason">
                    {t('fundDay.editReason')}
                  </label>
                  <TextArea
                    id="fund-edit-reason"
                    value={editReason}
                    onChange={e => setEditReason(e.target.value)}
                    rows={3}
                    placeholder={t('fundDay.editReasonPlaceholder')}
                  />
                  <div className="text-xs text-subtle mt-1">{t('fundDay.editReasonHint')}</div>
                </div>
              )}
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                disabled={drafts.length === 0 || reasonMissing || saveMutation.isPending}
                onClick={handleSubmit}
              >
                {t('fundDay.saveSubmit')}
              </Button>
            </div>
          </>
        ) : (
          <ActionDoneView
            headline={t('fundDay.saveDoneHeadline')}
            contractCode={date}
            detailRows={detailRows}
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
