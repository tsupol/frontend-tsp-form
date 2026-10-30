// "SMS of this line" — opened from a passbook line (doc 155 §1b).
//
// A line without an SMS opens on the search: the bank SMS that could be its
// slip, 100% match first. A line that has one opens on that SMS, with the way to
// take it off (an SMS put on the wrong line is unlinked, then the right one is
// attached). Ticking anything but a single 100% match asks first: the backend
// records the line as "amount does not match" and the passbook shows ⚠.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, TextArea } from 'tsp-form';
import { AlertTriangle, Link2, Unlink } from 'lucide-react';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { DateTime } from '../../components/DateTime';
import { ActionDoneView } from '../contracts/ActionDoneView';
import {
  LinkedResultLine, SmsCandidateList, SmsFilterRow, SmsText, SmsWindowNote,
} from '../../components/SmsLinkParts';
import { fmtCurrency } from '../../lib/format';
import { translateApiError } from '../../lib/apiErrors';
import {
  DEFAULT_SMS_FILTERS, confirmNeeded, linkConfirmMessage, linkSms, linkedToFromError, unlinkSms,
  useSmsLinkInvalidate, useSmsSearchForPayment, usePresetPick,
  type LinkConfirm, type SmsCandidate, type SmsLinkResult, type SmsSearchFilters,
} from '../../lib/smsLink';
import type { FundPassbookLine } from './useFundCash';

type View = 'attached' | 'search' | 'confirm' | 'unlink' | 'done';

interface Props {
  open: boolean;
  line: FundPassbookLine | null;
  onClose: () => void;
}

export function PassbookSmsModal({ open, line: lineProp, onClose }: Props) {
  const { t } = useTranslation();
  const invalidate = useSmsLinkInvalidate();

  // The page clears the line on close; keep showing it while the panel fades.
  const lastLine = useRef(lineProp);
  if (lineProp) lastLine.current = lineProp;
  const line = lineProp ?? lastLine.current;

  const [view, setView] = useState<View>('search');
  const [filters, setFilters] = useState<SmsSearchFilters>(DEFAULT_SMS_FILTERS);
  const [confirm, setConfirm] = useState<LinkConfirm | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [linked, setLinked] = useState<SmsLinkResult | null>(null);
  // The attached SMS as it was picked — the list refreshes without it once linked.
  const [linkedSms, setLinkedSms] = useState<SmsCandidate | null>(null);
  const [doneKind, setDoneKind] = useState<'linked' | 'unlinked'>('linked');
  const [confirmClose, setConfirmClose] = useState(false);

  const hasSms = line?.sms_link_id != null;
  const searchOn = open && (view === 'search' || view === 'confirm');
  const lineRef = line?.payment_id != null ? { paymentTable: line.payment_table, paymentId: line.payment_id } : null;
  const { search, isFetching, isLoading, error: searchError } = useSmsSearchForPayment(lineRef, filters, searchOn);
  const results = search?.results ?? [];
  const pick = usePresetPick(results, r => String(r.sms_message_id));
  const picked = pick.pickedRow;
  const { reset: resetPick } = pick;

  useEffect(() => {
    if (!open) return;
    setView(lineProp?.sms_link_id != null ? 'attached' : 'search');
    setFilters(DEFAULT_SMS_FILTERS);
    setConfirm(null);
    setReason('');
    setBusy(false);
    setError('');
    setLinked(null);
    setLinkedSms(null);
    setConfirmClose(false);
    resetPick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lineProp?.payment_id]);

  const dirty = (view === 'search' && pick.byHand) || view === 'confirm' || (view === 'unlink' && !!reason.trim());
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const doLink = async (move: boolean) => {
    if (!line || line.payment_id == null || !picked) return;
    setBusy(true);
    setError('');
    try {
      const res = await linkSms({
        smsMessageId: picked.sms_message_id, paymentTable: line.payment_table, paymentId: line.payment_id, move,
      });
      setLinked(res);
      setLinkedSms(picked);
      setDoneKind('linked');
      setView('done');
      invalidate();
    } catch (err) {
      const onOther = linkedToFromError(err);
      if (onOther && !move) { setConfirm({ kind: 'move', fromDoc: onOther.doc_code }); setView('confirm'); return; }
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const submitLink = () => {
    if (!picked || !line) return;
    const need = confirmNeeded(picked, search?.line.amount ?? line.amount);
    if (need) { setConfirm(need); setView('confirm'); return; }
    void doLink(false);
  };

  const submitUnlink = async () => {
    if (!line?.sms_link_id) return;
    setBusy(true);
    setError('');
    try {
      await unlinkSms(line.sms_link_id, reason);
      setDoneKind('unlinked');
      setView('done');
      invalidate();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const target = line && (
    <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
      <div className="font-medium text-sm">{line.doc_code ?? '—'}</div>
      <div className="text-xs text-subtle mt-0.5 flex items-center gap-1.5 flex-wrap">
        <DateTime value={line.money_date} showTime={false} />
        <span>· {line.item_kind_name ?? line.item_kind}</span>
        <span className={`tabular-nums font-medium ${line.direction === 'IN' ? 'text-success-fg' : 'text-danger-fg'}`}>
          · {line.direction === 'IN' ? '+' : '−'}{fmtCurrency(line.amount)}
        </span>
        {line.account_number && <span>· {line.account_number}</span>}
      </div>
    </div>
  );

  const title = view === 'unlink' || (view === 'done' && doneKind === 'unlinked') ? t('smsLink.unlinkTitle')
    : view === 'attached' ? t('smsLink.attachedTitle')
    : t('smsLink.attachTitle');

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="40rem" width="100%" ariaLabel={title}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'done' ? (
          <ActionDoneView
            headline={doneKind === 'linked' ? t('smsLink.linkedDone') : t('smsLink.unlinkedDone')}
            tone={doneKind === 'linked' && linked && !linked.amount_matches ? 'warning' : 'success'}
            contractCode={line?.doc_code ?? ''}
            detailRows={doneKind === 'linked' && linked ? [
              { label: t('smsLink.lineAmount'), value: fmtCurrency(linked.line_amount) },
              { label: t('smsLink.smsAmount'), value: linked.sms_amount == null ? t('smsLink.matchUnreadable') : fmtCurrency(linked.sms_amount) },
              { label: t('smsLink.result'), value: <LinkedResultLine result={linked} />, emphasis: true },
              ...(linked.moved_from ? [{ label: t('smsLink.movedFrom'), value: t('smsLink.movedFromValue') }] : []),
            ] : []}
            extras={doneKind === 'linked' && linkedSms ? (
              <SmsText text={linkedSms.sms_text} lineAmount={linked?.line_amount ?? null} smsAmount={linkedSms.sms_amount} match={linkedSms.match} />
            ) : undefined}
            onClose={forceClose}
          />
        ) : view === 'attached' ? (
          <>
            <div className="modal-content flex flex-col gap-3">
              {target}
              {line?.sms_text != null && (
                <>
                  <div className="text-xs text-subtle">
                    {line.sms_received_at && <><span>{t('smsLink.received')} </span><DateTime value={line.sms_received_at} showTime /></>}
                  </div>
                  <SmsText text={line.sms_text} lineAmount={line.amount} smsAmount={line.sms_amount} match={line.sms_amount_matches ? 'EXACT' : 'NEAR'} />
                  {line.sms_amount_matches === false && (
                    <div className="alert alert-warning">
                      <AlertTriangle size={16} className="shrink-0" />
                      <span>
                        {line.sms_amount == null
                          ? t('smsLink.resultUnreadable')
                          : t('smsLink.attachedMismatch', { sms: fmtCurrency(line.sms_amount), line: fmtCurrency(line.amount), diff: fmtCurrency(line.sms_amount_diff) })}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose}>{t('common.close')}</Button>
              <Button variant="outline" color="danger" startIcon={<Unlink size={15} />} onClick={() => { setError(''); setView('unlink'); }}>
                {t('smsLink.unlink')}
              </Button>
            </div>
          </>
        ) : view === 'unlink' ? (
          <>
            <div className="modal-content flex flex-col gap-3">
              {target}
              <p className="text-sm text-subtle m-0">{t('smsLink.unlinkBody')}</p>
              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('smsLink.unlinkReason')}</label>
                  <TextArea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder={t('smsLink.unlinkReasonPlaceholder')} />
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={() => { setReason(''); setView('attached'); }} disabled={busy}>{t('common.back')}</Button>
              <Button color="danger" startIcon={<Unlink size={15} />} onClick={() => { void submitUnlink(); }} disabled={busy}>
                {t('smsLink.unlinkSubmit')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-content flex flex-col gap-3 min-w-0">
              {target}
              {hasSms && <div className="alert alert-info"><span>{t('smsLink.lineHasSms')}</span></div>}
              <SmsFilterRow
                filters={filters}
                onChange={f => { setFilters(f); setConfirm(null); setView('search'); }}
                allAccountsLabel={t('smsLink.allFundAccounts')}
              />
              <SmsWindowNote window={search?.window} />
              {searchError ? (
                <div className="alert alert-danger"><span>{translateApiError(searchError, t)}</span></div>
              ) : (
                <div className={`${isFetching ? 'opacity-60' : ''} transition-opacity`}>
                  <SmsCandidateList
                    results={results}
                    lineAmount={search?.line.amount ?? line?.amount ?? null}
                    pickedId={picked?.sms_message_id ?? null}
                    onPick={id => { pick.pick(String(id)); setConfirm(null); setView('search'); }}
                    loading={isLoading}
                  />
                </div>
              )}
            </div>
            <ModalErrorBand variant="warning" message={view === 'confirm' && confirm ? linkConfirmMessage(confirm, t) : null} />
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              {view === 'confirm' ? (
                <>
                  <Button variant="ghost" onClick={() => { setConfirm(null); setView('search'); }} disabled={busy}>{t('common.back')}</Button>
                  <Button
                    color="warning"
                    startIcon={<Link2 size={15} />}
                    onClick={() => { void doLink(confirm?.kind === 'move' || picked?.linked_to != null); }}
                    disabled={busy}
                  >
                    {t('smsLink.confirmAttach')}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
                  <Button color="primary" startIcon={<Link2 size={15} />} onClick={submitLink} disabled={busy || !picked}>
                    {t('smsLink.attach')}
                  </Button>
                </>
              )}
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
