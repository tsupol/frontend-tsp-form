// The pieces of "attach a bank SMS to a line" (mig 1536, doc 155 §1b), shared by
// every place that does it:
//   - the passbook line window             (PassbookSmsModal)
//   - the SMS inbox "find the line" window (SmsFindPaymentModal)
//   - the done view of every fund money window, right after it saved (SmsAttachInline)
//
// The search is the backend's: results arrive ordered (100% match first, then
// newest) and are shown in that order. A single 100% match is ticked in advance.
// Ticking anything else asks first, because the backend will record the line as
// "amount does not match" (⚠ in the passbook); an SMS already on another line
// asks "move it here?".

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, LabeledCheckbox, RadioCircle } from 'tsp-form';
import { AlertTriangle, CheckCircle2, Landmark, Link2, MessageSquareText, Smartphone } from 'lucide-react';
import { DateTime } from './DateTime';
import { fmtCurrency, formatRelativeAgo } from '../lib/format';
import { translateApiError } from '../lib/apiErrors';
import { useMyPermissions } from '../hooks/useMyPermissions';
import {
  DEFAULT_SMS_FILTERS, confirmNeeded, linkConfirmMessage, linkSms, linkedToFromError, paymentKey, splitSmsAmounts,
  useSmsLinkInvalidate, useSmsSearchForPayment, usePresetPick,
  type LinkConfirm, type PaymentCandidate, type SmsCandidate, type SmsHours, type SmsLinkResult,
  type SmsMatch, type SmsPaymentTable, type SmsSearchFilters, type SmsSearchWindow,
} from '../lib/smsLink';

// ── Filters ──────────────────────────────────────────────────────────────────

export function SmsFilterRow({ filters, onChange, allAccountsLabel }: {
  filters: SmsSearchFilters;
  onChange: (next: SmsSearchFilters) => void;
  /** "every account of the fund" from a line, "every account" from an SMS. */
  allAccountsLabel: string;
}) {
  const { t } = useTranslation();
  const hours: { value: SmsHours; label: string }[] = [
    { value: 24, label: t('smsLink.hours24') },
    { value: 48, label: t('smsLink.hours48') },
    { value: null, label: t('smsLink.hoursAll') },
  ];
  return (
    <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
      <LabeledCheckbox
        label={t('smsLink.unlinkedOnly')}
        checked={filters.unlinkedOnly}
        onChange={e => onChange({ ...filters, unlinkedOnly: e.target.checked })}
      />
      <div className="btn-group">
        {hours.map(h => (
          <Button
            key={String(h.value)}
            size="sm"
            variant={filters.hours === h.value ? 'solid' : 'outline'}
            color={filters.hours === h.value ? 'primary' : 'default'}
            onClick={() => onChange({ ...filters, hours: h.value })}
          >
            {h.label}
          </Button>
        ))}
      </div>
      <LabeledCheckbox
        label={allAccountsLabel}
        checked={filters.allAccounts}
        onChange={e => onChange({ ...filters, allAccounts: e.target.checked })}
      />
    </div>
  );
}

/** "Nothing in the last 24 h — showing around the line's own day instead." */
export function SmsWindowNote({ window: w }: { window: SmsSearchWindow | undefined }) {
  const { t } = useTranslation();
  if (!w?.shifted) return null;
  return (
    <div className="alert alert-info">
      <span>
        {t('smsLink.windowShifted', { hours: w.hours ?? '' })}{' '}
        {w.from && <DateTime value={w.from} showTime={false} />} – {w.to && <DateTime value={w.to} showTime={false} />}
      </span>
    </div>
  );
}

// ── Match + text ─────────────────────────────────────────────────────────────

export function SmsMatchBadge({ match, diff }: { match: SmsMatch; diff: number | null }) {
  const { t } = useTranslation();
  if (match === 'EXACT') return <Badge size="sm" color="success">{t('smsLink.matchExact')}</Badge>;
  if (match === 'NEAR') return <Badge size="sm" color="warning">{t('smsLink.matchNear', { diff: fmtCurrency(diff) })}</Badge>;
  if (match === 'UNREADABLE') return <Badge size="sm" color="default">{t('smsLink.matchUnreadable')}</Badge>;
  return <Badge size="sm" color="default">{t('smsLink.matchNone')}</Badge>;
}

/** The SMS exactly as received, with the amount that matters marked. */
export function SmsText({ text, lineAmount, smsAmount, match }: {
  text: string;
  /** The line's amount: an equal figure in the text is marked as the match. */
  lineAmount?: number | null;
  /** For a near match: the figure the backend compared, marked as "close". */
  smsAmount?: number | null;
  match?: SmsMatch;
}) {
  return (
    <p className="text-sm whitespace-pre-wrap break-words rounded-md bg-surface border border-line px-3 py-2 m-0">
      {splitSmsAmounts(text).map((part, i) => {
        if (part.amount != null && lineAmount != null && part.amount === lineAmount) {
          return <mark key={i} className="bg-success-soft text-success-fg font-semibold rounded px-0.5">{part.text}</mark>;
        }
        if (part.amount != null && match === 'NEAR' && smsAmount != null && part.amount === smsAmount) {
          return <mark key={i} className="bg-warning-soft text-warning-fg font-semibold rounded px-0.5">{part.text}</mark>;
        }
        return <span key={i}>{part.text}</span>;
      })}
    </p>
  );
}

function When({ iso }: { iso: string }) {
  const { i18n } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5">
      <DateTime value={iso} showTime />
      <span className="text-subtler">· {formatRelativeAgo(iso, i18n.language).rel}</span>
    </span>
  );
}

function PickRow({ selected, dim, onPick, children }: {
  selected: boolean;
  dim: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`w-full text-left flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors ${
        selected ? 'border-primary bg-primary-soft' : 'border-line bg-bg hover:bg-surface-hover'
      }`}
    >
      <RadioCircle checked={selected} className="mt-0.5" />
      <div className={`flex-1 min-w-0 flex flex-col gap-1.5 ${dim && !selected ? 'opacity-60' : ''}`}>{children}</div>
    </button>
  );
}

// ── Lists ────────────────────────────────────────────────────────────────────

export function SmsCandidateList({ results, lineAmount, pickedId, onPick, loading }: {
  results: SmsCandidate[];
  lineAmount: number | null;
  pickedId: number | null;
  onPick: (id: number) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-6 text-center">
        <MessageSquareText size={24} className="text-subtler" />
        <p className="text-sm text-subtle m-0">{loading ? t('common.loading') : t('smsLink.noSms')}</p>
        {!loading && <p className="text-xs text-subtler m-0">{t('smsLink.noSmsHint')}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {results.map(r => (
        <PickRow
          key={r.sms_message_id}
          selected={pickedId === r.sms_message_id}
          dim={r.match === '' || r.match === 'UNREADABLE' || r.linked_to != null}
          onPick={() => onPick(r.sms_message_id)}
        >
          <div className="flex items-center gap-2 flex-wrap text-xs text-subtle">
            <SmsMatchBadge match={r.match} diff={r.diff} />
            <When iso={r.received_at} />
            {r.source_label && (
              <span className="inline-flex items-center gap-1"><Smartphone size={11} />{r.source_label}</span>
            )}
          </div>
          <SmsText text={r.sms_text} lineAmount={lineAmount} smsAmount={r.sms_amount} match={r.match} />
          {r.linked_to && (
            <span className="text-xs text-warning-fg inline-flex items-center gap-1">
              <Link2 size={12} />{t('smsLink.linkedTo', { doc: r.linked_to.doc_code ?? `#${r.linked_to.payment_id}` })}
            </span>
          )}
        </PickRow>
      ))}
    </div>
  );
}

export function PaymentCandidateList({ results, pickedKey, onPick, loading }: {
  results: PaymentCandidate[];
  pickedKey: string | null;
  onPick: (key: string) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-6 text-center">
        <Landmark size={24} className="text-subtler" />
        <p className="text-sm text-subtle m-0">{loading ? t('common.loading') : t('smsLink.noLines')}</p>
        {!loading && <p className="text-xs text-subtler m-0">{t('smsLink.noLinesHint')}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {results.map(r => {
        const key = paymentKey(r);
        return (
          <PickRow
            key={key}
            selected={pickedKey === key}
            dim={r.match === '' || r.match === 'UNREADABLE' || r.linked_to != null}
            onPick={() => onPick(key)}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{r.doc_code ?? `#${r.payment_id}`}</span>
              <SmsMatchBadge match={r.match} diff={r.diff} />
              <span className="flex-1" />
              <span className={`text-sm tabular-nums font-medium ${r.flow === 'IN' ? 'text-success-fg' : 'text-danger-fg'}`}>
                {r.flow === 'IN' ? '+' : '−'}{fmtCurrency(r.amount)}
              </span>
            </div>
            <div className="text-xs text-subtle flex items-center gap-1.5 flex-wrap">
              <DateTime value={r.money_date} showTime={false} />
              {r.party && <span>· {r.party}</span>}
              {(r.account_name || r.account_key) && <span>· {r.account_name ?? r.account_key}</span>}
            </div>
            {r.linked_to && (
              <span className="text-xs text-warning-fg inline-flex items-center gap-1">
                <Link2 size={12} />{t('smsLink.lineHasSms')}
              </span>
            )}
          </PickRow>
        );
      })}
    </div>
  );
}

// ── Confirm ──────────────────────────────────────────────────────────────────

/** One line under a done link: matched, or flagged with the difference. */
export function LinkedResultLine({ result }: { result: SmsLinkResult }) {
  const { t } = useTranslation();
  if (result.amount_matches) {
    return (
      <span className="inline-flex items-center gap-1.5 text-success-fg">
        <CheckCircle2 size={14} />{t('smsLink.resultMatch')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-warning-fg">
      <AlertTriangle size={14} />
      {result.sms_amount == null
        ? t('smsLink.resultUnreadable')
        : t('smsLink.resultMismatch', { diff: fmtCurrency(result.diff) })}
    </span>
  );
}

// ── Inline, inside a money window's done view ───────────────────────────────

/**
 * "Attach the bank's SMS" right after a payment, capital movement, expense,
 * clawback or credit note was saved — the moment the SMS has just arrived.
 * Optional: the done view's own Done button still closes the window.
 * Renders nothing without SMS.LINK, or when the save moved no money through a
 * bank (payment_id null).
 */
export function SmsAttachInline({ paymentId, paymentTable = 'sale.fund_bill_payment' }: {
  paymentId: number | null | undefined;
  paymentTable?: SmsPaymentTable;
}) {
  const { t } = useTranslation();
  const { hasPermission } = useMyPermissions();
  const invalidate = useSmsLinkInvalidate();
  const enabled = hasPermission('SMS.LINK') && paymentId != null;

  const [filters, setFilters] = useState<SmsSearchFilters>(DEFAULT_SMS_FILTERS);
  const line = paymentId != null ? { paymentTable, paymentId } : null;
  const { search, isFetching, isLoading, error: searchError } = useSmsSearchForPayment(line, filters, enabled);
  const results = search?.results ?? [];
  const pick = usePresetPick(results, r => String(r.sms_message_id));

  const [confirm, setConfirm] = useState<LinkConfirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [linked, setLinked] = useState<SmsLinkResult | null>(null);
  const [linkedSms, setLinkedSms] = useState<SmsCandidate | null>(null);

  // A new payment is a new search.
  useEffect(() => {
    setFilters(DEFAULT_SMS_FILTERS); pick.reset(); setConfirm(null); setError(''); setLinked(null); setLinkedSms(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId]);

  if (!enabled) return null;

  const lineAmount = search?.line.amount ?? null;
  const picked = pick.pickedRow;

  const doLink = async (move: boolean) => {
    if (!picked || paymentId == null) return;
    setBusy(true);
    setError('');
    try {
      const res = await linkSms({ smsMessageId: picked.sms_message_id, paymentTable, paymentId, move });
      setLinked(res);
      setLinkedSms(picked);
      setConfirm(null);
      invalidate();
    } catch (err) {
      const movedFrom = linkedToFromError(err);
      if (movedFrom && !move) { setConfirm({ kind: 'move', fromDoc: movedFrom.doc_code }); return; }
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!picked || lineAmount == null) return;
    const need = confirmNeeded(picked, lineAmount);
    if (need) { setConfirm(need); return; }
    void doLink(false);
  };

  return (
    <div className="rounded-md border border-line overflow-hidden">
      {/* The button sits in the header so it stays in view above a long list. */}
      <div className="px-3 py-2 bg-surface-shallow text-sm font-medium flex items-center gap-2">
        <MessageSquareText size={14} className="text-subtle" />
        {t('smsLink.inlineTitle')}
        <span className="text-xs text-subtle font-normal">{t('smsLink.optional')}</span>
        <span className="flex-1" />
        {!linked && !confirm && (
          <Button size="sm" color="primary" startIcon={<Link2 size={14} />} disabled={!picked || busy} onClick={submit}>
            {t('smsLink.attach')}
          </Button>
        )}
      </div>
      <div className="p-3 flex flex-col gap-3">
        {linked ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('smsLink.linkedDone')}</span>
            {linkedSms && <SmsText text={linkedSms.sms_text} lineAmount={lineAmount} smsAmount={linkedSms.sms_amount} match={linkedSms.match} />}
            <span className="text-sm"><LinkedResultLine result={linked} /></span>
          </div>
        ) : (
          <>
            <SmsFilterRow filters={filters} onChange={f => { setFilters(f); setConfirm(null); }} allAccountsLabel={t('smsLink.allFundAccounts')} />
            <SmsWindowNote window={search?.window} />
            {confirm && (
              <div className="alert alert-warning">
                <div className="flex flex-col gap-2">
                  <span>{linkConfirmMessage(confirm, t)}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>{t('common.cancel')}</Button>
                    <Button size="sm" color="warning" onClick={() => { void doLink(confirm.kind === 'move' || picked?.linked_to != null); }} disabled={busy}>
                      {t('smsLink.confirmAttach')}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {error && <div className="alert alert-danger"><span>{error}</span></div>}
            {searchError ? (
              <div className="alert alert-danger"><span>{translateApiError(searchError, t)}</span></div>
            ) : (
              <div className={`max-h-80 overflow-y-auto better-scroll ${isFetching ? 'opacity-60' : ''} transition-opacity`}>
                <SmsCandidateList
                  results={results}
                  lineAmount={lineAmount}
                  pickedId={picked?.sms_message_id ?? null}
                  onPick={id => { pick.pick(String(id)); setConfirm(null); }}
                  loading={isLoading}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
