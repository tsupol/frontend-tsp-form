// Close the fund's day (work order 2026-10-11 A3 · UI_SUMMARY/148 §8).
//
// Opened from the pre-close check once it says the day can close. Shows what
// is about to be locked — the day, how many bills and fund documents, both
// axis totals — and takes an optional note. All figures come from the check
// the user just ran; nothing is added up here.
//
// A refusal carries the same codes as the check (params.blockers = the whole
// list), so it is drawn by the same FundDayCloseBlockers the page uses (rule
// M4), in the band between content and footer.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, TextArea } from 'tsp-form';
import { AlertTriangle, CalendarClock, Lock } from 'lucide-react';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView, type ActionDoneDetailRow } from '../contracts/ActionDoneView';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency, formatDateTime } from '../../lib/format';
import { FundDayCloseBlockers } from './FundDayCloseBlockers';
import { blockersFromError } from './fundDayCloseUtils';
import { useFundDayCloseCreate } from './useFundDay';
import type {
  FundDayCloseBlocker, FundDayCloseCheck, FundDayCloseCreateResult,
} from './fundDayTypes';

interface FundDayCloseModalProps {
  open: boolean;
  companyId: number | null;
  date: string;
  /** The check the user just ran for `date` — the source of every figure shown. */
  check: FundDayCloseCheck | null;
  onClose: () => void;
  /** A blocker's "go to that day", or the done view's "close the next day". */
  onGoToDate: (date: string) => void;
  onShowAccount: (accountKey: string) => void;
  onReload: () => void;
}

export function FundDayCloseModal({
  open, companyId, date, check, onClose, onGoToDate, onShowAccount, onReload,
}: FundDayCloseModalProps) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<FundDayCloseCreateResult | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<FundDayCloseBlocker[] | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const createMutation = useFundDayCloseCreate(companyId);

  useEffect(() => {
    if (open) {
      setView('form');
      setResult(null);
      setNote('');
      setError(null);
      setBlockers(null);
      setConfirmClose(false);
    }
  }, [open, date]);

  const isDirty = note.trim().length > 0;
  const fmtDate = (d: string | null | undefined) => (d ? formatDateTime(d, i18n.language, false) : '—');

  const forceClose = () => {
    setConfirmClose(false);
    onClose();
  };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  // A blocker's own button leaves the modal for the page — the note is
  // abandoned on purpose, the day cannot close until the blocker is fixed.
  const leaveThen = (fn: () => void) => () => { forceClose(); fn(); };

  const handleSubmit = async () => {
    setError(null);
    setBlockers(null);
    try {
      const closed = await createMutation.mutateAsync({ date, note: note.trim() ? note.trim() : null });
      setResult(closed);
      setView('done');
    } catch (err) {
      const list = blockersFromError(err);
      if (list) setBlockers(list);
      else setError(translateApiError(err, t));
    }
  };

  const detailRows: ActionDoneDetailRow[] = result ? [
    { label: t('fundDay.close.version'), value: t('fundDay.close.versionShort', { version: result.version }) },
    { label: t('fundDay.close.billCount'), value: result.bill_count },
    { label: t('fundDay.close.fundDocCount'), value: result.fund_doc_count },
    { label: t('fundDay.categoryNet'), value: fmtCurrency(result.category_net) },
    { label: t('fundDay.moneyNet'), value: fmtCurrency(result.money_net), emphasis: true },
    {
      label: t('fundDay.close.reconState'),
      value: result.recon_ok ? t('fundDay.close.reconOk') : t('fundDay.close.closedWithDiff'),
    },
  ] : [];

  const nextDate = result?.next_unclosed_date ?? null;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="34rem" width="100%" ariaLabel={t('fundDay.close.confirmTitle')}>
        {view === 'form' ? (
          <>
            <div className="modal-header">
              <h2 className="modal-title">{t('fundDay.close.confirmTitle')}</h2>
              <button type="button" className="modal-close-btn" onClick={handleClose}>{'×'}</button>
            </div>
            <div className="modal-content min-w-0">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
                <div className="font-medium text-sm">{fmtDate(date)}</div>
                <div className="text-xs text-subtle">{t('fundDay.close.lockHint')}</div>
              </div>

              {check && (
                <div className="flex flex-col gap-1.5 text-sm mb-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-subtle">{t('fundDay.close.billCount')}</span>
                    <span className="tabular-nums">{check.bill_count}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-subtle">{t('fundDay.close.fundDocCount')}</span>
                    <span className="tabular-nums">{check.fund_doc_count}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-subtle">{t('fundDay.categoryNet')}</span>
                    <span className="tabular-nums">{fmtCurrency(check.category_net)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-subtle">{t('fundDay.moneyNet')}</span>
                    <span className="tabular-nums font-medium">{fmtCurrency(check.money_net)}</span>
                  </div>
                </div>
              )}

              {check && !check.balanced && (
                <div className="alert alert-warning mb-3">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{t('fundDay.notBalanced')}</span>
                </div>
              )}

              {/* A recorded difference does not stop the close (owner ข9) —
                  it is said here so nobody closes past it unknowingly. */}
              {check && !check.recon_ok && (
                <div className="alert alert-warning mb-3">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{t('fundDay.close.reconWarning')}</span>
                </div>
              )}

              <div className="flex flex-col">
                <label className="form-label" htmlFor="fund-day-close-note">
                  {t('fundDay.close.noteLabel')}
                </label>
                <TextArea
                  id="fund-day-close-note"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            {blockers && (
              <div className="px-4 py-3 border-t border-line shrink-0 max-h-[40vh] overflow-auto better-scroll" role="alert">
                <div className="text-sm font-medium mb-2">{t('fundDay.close.cannotCloseYet')}</div>
                <FundDayCloseBlockers
                  blockers={blockers}
                  onGoToDate={(d) => leaveThen(() => onGoToDate(d))()}
                  onShowAccount={(k) => leaveThen(() => onShowAccount(k))()}
                  onReload={leaveThen(onReload)}
                />
              </div>
            )}
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                startIcon={<Lock size={16} />}
                disabled={createMutation.isPending || !!blockers}
                onClick={handleSubmit}
              >
                {t('fundDay.close.closeButton')}
              </Button>
            </div>
          </>
        ) : (
          <ActionDoneView
            headline={t('fundDay.close.doneHeadline')}
            contractCode={fmtDate(result?.close_date ?? date)}
            detailRows={detailRows}
            secondaryAction={nextDate ? {
              label: t('fundDay.close.closeNext', { date: fmtDate(nextDate) }),
              startIcon: <CalendarClock size={16} />,
              onClick: () => { forceClose(); onGoToDate(nextDate); },
            } : undefined}
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
