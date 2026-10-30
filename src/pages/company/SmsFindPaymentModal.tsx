// "หารายการ" — from one SMS in the inbox, find the line it is the slip of
// (doc 154 §1536, doc 155 §1b, fn_payment_search_for_sms).
//
// Same search shape as the passbook's, the other way round: lines of the
// phone's account around the SMS's day, 100% match first. An SMS with no line
// at all is money that moved without being recorded — the hint says to record
// it first and come back. Ticking anything but a single 100% match asks first.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from 'tsp-form';
import { Link2, Smartphone } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import {
  LinkedResultLine, PaymentCandidateList, SmsFilterRow, SmsParseBadge, SmsParsedSummary, SmsText,
} from '../../components/SmsLinkParts';
import { fmtCurrency } from '../../lib/format';
import { translateApiError } from '../../lib/apiErrors';
import {
  DEFAULT_SMS_FILTERS, confirmNeeded, linkConfirmMessage, linkSms, linkedToFromError, paymentKey, usePaymentSearchForSms, usePresetPick,
  useSmsLinkInvalidate, type LinkConfirm, type SmsLinkResult, type SmsSearchFilters,
} from '../../lib/smsLink';
import type { SmsMessage } from './smsRelayTypes';

interface Props {
  open: boolean;
  message: SmsMessage | null;
  onClose: () => void;
}

export function SmsFindPaymentModal({ open, message: messageProp, onClose }: Props) {
  const { t } = useTranslation();
  const invalidate = useSmsLinkInvalidate();

  const lastMessage = useRef(messageProp);
  if (messageProp) lastMessage.current = messageProp;
  const message = messageProp ?? lastMessage.current;

  const [view, setView] = useState<'search' | 'confirm' | 'done'>('search');
  const [filters, setFilters] = useState<SmsSearchFilters>(DEFAULT_SMS_FILTERS);
  const [confirm, setConfirm] = useState<LinkConfirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [linked, setLinked] = useState<SmsLinkResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const { search, isFetching, isLoading, error: searchError } = usePaymentSearchForSms(
    message?.message_id ?? null, filters, open && view !== 'done',
  );
  const results = search?.results ?? [];
  // The reading of this SMS (mig 1537) — from the search once it has run, else the inbox row's own columns.
  const parsed = search?.sms.parsed ?? (message?.parse_status ? {
    status: message.parse_status, direction: message.direction, amount: message.parsed_amount,
    balance_after: message.balance_after, our_account_last4: message.our_account_last4,
    counter_account_last4: message.counter_account_last4, counter_role: message.counter_role,
    bank_time: message.bank_time, pattern_code: message.pattern_code, suspect_reason: message.suspect_reason,
  } : null);
  const pick = usePresetPick(results, paymentKey);
  const picked = pick.pickedRow;
  const { reset: resetPick } = pick;

  useEffect(() => {
    if (!open) return;
    setView('search'); setFilters(DEFAULT_SMS_FILTERS); setConfirm(null); setBusy(false); setError('');
    setLinked(null); setConfirmClose(false); resetPick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, messageProp?.message_id]);

  const dirty = view === 'confirm' || (view === 'search' && pick.byHand);
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const doLink = async (move: boolean) => {
    if (!message || !picked) return;
    setBusy(true);
    setError('');
    try {
      const res = await linkSms({
        smsMessageId: message.message_id, paymentTable: picked.payment_table, paymentId: picked.payment_id, move,
      });
      setLinked(res);
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

  const submit = () => {
    if (!picked) return;
    // From this side a picked line that already has an SMS can't take another:
    // the backend answers PAYMENT_ALREADY_LINKED, so say it here instead.
    if (picked.linked_to) { setError(t('smsLink.lineHasSmsUnlinkFirst')); return; }
    const need = confirmNeeded(
      { ...picked, linked_to: null, direction_matches: picked.flow_matches },
      { amount: picked.amount, flow: picked.flow, smsDirection: parsed?.direction ?? null },
    );
    if (need) { setConfirm(need); setView('confirm'); return; }
    void doLink(false);
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="40rem" width="100%" ariaLabel={t('smsLink.findTitle')}>
        <div className="modal-header">
          <h2 className="modal-title">{t('smsLink.findTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'done' && linked ? (
          <ActionDoneView
            headline={t('smsLink.linkedDone')}
            tone={linked.amount_matches ? 'success' : 'warning'}
            contractCode={linked.doc_code ?? ''}
            detailRows={[
              { label: t('smsLink.lineAmount'), value: fmtCurrency(linked.line_amount) },
              { label: t('smsLink.smsAmount'), value: linked.sms_amount == null ? t('smsLink.matchUnreadable') : fmtCurrency(linked.sms_amount) },
              { label: t('smsLink.result'), value: <LinkedResultLine result={linked} />, emphasis: true },
            ]}
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content flex flex-col gap-3 min-w-0">
              {message && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs text-subtle flex items-center gap-1.5 flex-wrap">
                    <Smartphone size={12} />{message.source_label}
                    <span>·</span><DateTime value={message.received_at} showTime />
                    <SmsParseBadge status={parsed?.status} reason={parsed?.suspect_reason} />
                  </div>
                  <SmsText text={message.sms_text} smsAmount={parsed?.amount} match={parsed?.amount != null ? 'EXACT' : undefined} />
                  <SmsParsedSummary parsed={parsed} />
                </div>
              )}
              <SmsFilterRow
                filters={filters}
                onChange={f => { setFilters(f); setConfirm(null); setView('search'); }}
                allAccountsLabel={t('smsLink.allAccounts')}
              />
              {search && search.sms.account_key == null && (
                <div className="alert alert-info"><span>{t('smsLink.phoneNoAccount')}</span></div>
              )}
              {searchError ? (
                <div className="alert alert-danger"><span>{translateApiError(searchError, t)}</span></div>
              ) : (
                <div className={`${isFetching ? 'opacity-60' : ''} transition-opacity`}>
                  <PaymentCandidateList
                    results={results}
                    smsDirection={parsed?.direction}
                    smsAccountLast4={parsed?.our_account_last4}
                    pickedKey={picked ? paymentKey(picked) : null}
                    onPick={k => { pick.pick(k); setConfirm(null); setError(''); setView('search'); }}
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
                  <Button color="warning" startIcon={<Link2 size={15} />} onClick={() => { void doLink(confirm?.kind === 'move'); }} disabled={busy}>
                    {t('smsLink.confirmAttach')}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
                  <Button color="primary" startIcon={<Link2 size={15} />} onClick={submit} disabled={busy || !picked}>
                    {t('smsLink.attachToLine')}
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
