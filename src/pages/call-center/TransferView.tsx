// Transfer (การโอนสัญญา) — owner-to-peer contract handoff within a branch.
// Third view of the call-center page, alongside My Focus / My Book.
//
// Two boxes:
//   Inbox  (v_trade_inbox)  — offers sent TO me: accept / reject.
//   Outbox (v_trade_outbox) — offers I sent: cancel while still pending.
//
// The offer button lives on the contract detail's own actions; here we surface
// the pending offers and let the collector act on them. An offer can also be
// started from this view via the "offer" modal (recipient picker + note).
//
// Anti-dump rules (doc §10.4): the inbox MUST make a "dumped bad contract"
// visible — show the flag pair + divergence, the summary with its timestamp,
// and summary_edited_before_offer as a plain fact (never labelled "suspicious").
// Offers never expire; pending_days is informational, not a countdown (§10.5).

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Modal, Select, Input, useSnackbarContext } from 'tsp-form';
import {
  Send, Check, X, Clock, Pencil, ExternalLink, Loader2, XCircle, CheckCircle, AlertTriangle,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { FlagPair } from './ccBadges';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { translateApiError } from '../../lib/apiErrors';
import {
  ccKeys, useFlagLevels, overdueColor, tradeTargets, tradeOffer, tradeRespond, tradeCancel,
  type TradeRow, type TradeInboxRow, type FlagLevelRef, type BookRow,
} from './callCenterApi';

type Box = 'inbox' | 'outbox';

// Two-line dropdown option: bold primary line + muted secondary line. The
// `primary`/`secondary` fields are attached to the option objects we build for
// the contract + recipient selects. Falls back to `label` if they're absent.
function renderTwoLineOption(opt: { label: string; primary?: string; secondary?: string | null }) {
  const primary = opt.primary ?? opt.label;
  return (
    <div className="flex flex-col min-w-0 leading-tight py-0.5">
      <span className="truncate">{primary}</span>
      {opt.secondary && <span className="text-xs text-subtle truncate">{opt.secondary}</span>}
    </div>
  );
}

interface Props {
  /** Active box — the tab strip is rendered by the parent (full-width). */
  box: Box;
  /** Offer modal open state, controlled by the parent's toolbar button. */
  offerOpen: boolean;
  onOfferClose: () => void;
  /** Report inbox/outbox counts up so the parent's tab badges stay in sync. */
  onCounts: (c: { inbox: number; outbox: number }) => void;
  /** Currently-selected trade (for row highlight). */
  selectedTradeId: number | null;
  /** Select an offer — the parent renders its detail on the right. */
  onSelectOffer: (offer: TradeRow | TradeInboxRow) => void;
}

export function TransferView({ box, offerOpen, onOfferClose, onCounts, selectedTradeId, onSelectOffer }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: flagLevels } = useFlagLevels();

  const inbox = useQuery({
    queryKey: ccKeys.tradeInbox,
    queryFn: () => apiClient.get<TradeInboxRow[]>('/v_trade_inbox?order=offered_at.desc'),
    refetchInterval: 60_000,
  });
  const outbox = useQuery({
    queryKey: ccKeys.tradeOutbox,
    queryFn: () => apiClient.get<TradeRow[]>('/v_trade_outbox?order=offered_at.desc'),
    refetchInterval: 60_000,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ccKeys.tradeInbox });
    queryClient.invalidateQueries({ queryKey: ccKeys.tradeOutbox });
    queryClient.invalidateQueries({ queryKey: ['cc', 'book'] });
    queryClient.invalidateQueries({ queryKey: ['cc', 'focus-count'] });
  };

  const active = box === 'inbox' ? inbox : outbox;
  const rows = active.data ?? [];

  // Report counts up so the parent's box-tab badges stay in sync.
  const inboxCount = inbox.data?.length ?? 0;
  const outboxCount = outbox.data?.length ?? 0;
  useEffect(() => {
    onCounts({ inbox: inboxCount, outbox: outboxCount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxCount, outboxCount]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-auto better-scroll">
        {active.isError ? (
          <div className="p-4">
            <div className="alert alert-danger"><XCircle size={18} /><span>{t('common.error')}</span></div>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-subtler text-sm">
            {box === 'inbox' ? t('callCenter.transfer.inboxEmpty') : t('callCenter.transfer.outboxEmpty')}
          </div>
        ) : (
          <div className="border-b border-line">
            {rows.map(row => (
              <button
                key={row.trade_id}
                type="button"
                className={`block w-full text-left border-t border-line transition-colors cursor-pointer ${
                  selectedTradeId === row.trade_id ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                }`}
                onClick={() => onSelectOffer(row)}
              >
                <TradeCard row={row} box={box} levels={flagLevels} />
              </button>
            ))}
          </div>
        )}
      </div>

      <OfferModal
        open={offerOpen}
        onClose={onOfferClose}
        onSuccess={() => { onOfferClose(); invalidateAll(); }}
      />
    </div>
  );
}

// ── One offer card (list preview — click to open full detail on the right) ─────

function TradeCard({ row, box, levels }: {
  row: TradeRow | TradeInboxRow;
  box: Box;
  levels: FlagLevelRef[] | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate text-primary-fg">{row.contract_code_display}</span>
            <span className="text-xs text-subtle truncate">{row.customer_name}</span>
          </div>
          <div className="text-xs text-subtle mt-0.5">
            {box === 'inbox' ? t('callCenter.transfer.fromLabel') : t('callCenter.transfer.toLabel')}{' '}
            <span className="font-medium">{row.counterparty_username ?? `#${row.counterparty_user_id}`}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {row.overdue_amount > 0 && (
            <div className="text-sm font-medium tabular-nums">฿{fmtCurrency(row.overdue_amount)}</div>
          )}
          <div className="text-[11px] text-subtle inline-flex items-center gap-1 mt-0.5">
            <Clock size={11} />
            {t('callCenter.transfer.pendingDays', { count: row.pending_days })}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-xs">
        <span className="text-subtle">{t('callCenter.overdueDays', { n: row.overdue_days })}</span>
        <FlagPair auto={row.auto_flag_level} manual={row.manual_flag_level} divergent={row.flag_divergent} levels={levels} compact />
        {box === 'inbox' && (row as TradeInboxRow).summary_edited_before_offer && (
          <Pencil size={12} className="text-warning-fg shrink-0" />
        )}
      </div>
    </div>
  );
}

// ── Offer detail (right panel) — full offer + accept/reject/cancel ─────────────

export function TransferOfferDetail({ offer, box, onChanged }: {
  offer: TradeRow | TradeInboxRow;
  box: Box;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { data: levels } = useFlagLevels();
  const { addSnackbar } = useSnackbarContext();
  const [busy, setBusy] = useState<'accept' | 'reject' | 'cancel' | null>(null);
  const [confirm, setConfirm] = useState<'accept' | 'reject' | 'cancel' | null>(null);
  const [error, setError] = useState('');

  const editedBeforeOffer = box === 'inbox' && (offer as TradeInboxRow).summary_edited_before_offer;

  const run = async (kind: 'accept' | 'reject' | 'cancel', fn: () => Promise<unknown>, successKey: string) => {
    setBusy(kind);
    setConfirm(null);
    setError('');
    try {
      await fn();
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t(successKey)}</span></div>,
        type: 'success',
      });
      onChanged();
    } catch (err) {
      const msg = err instanceof ApiError
        ? (translateApiError(err, t)
            || err.message)
        : String(err);
      setError(msg);
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-auto better-scroll p-4 flex flex-col gap-4">
        {/* Contract + counterparty */}
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to={`/admin/contracts/search/${offer.contract_id}`}
              className="text-base font-semibold text-primary-fg hover:underline inline-flex items-center gap-1"
            >
              {offer.contract_code_display}
              <ExternalLink size={14} className="shrink-0" />
            </Link>
            <span className="text-sm text-subtle">{offer.customer_name}</span>
          </div>
          <div className="text-sm text-subtle mt-1">
            {box === 'inbox' ? t('callCenter.transfer.fromLabel') : t('callCenter.transfer.toLabel')}{' '}
            <span className="font-medium text-fg">{offer.counterparty_username ?? `#${offer.counterparty_user_id}`}</span>
            {' · '}
            <span className="inline-flex items-center gap-1"><Clock size={12} />{t('callCenter.transfer.pendingDays', { count: offer.pending_days })}</span>
          </div>
        </div>

        {/* Money */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-subtle">{t('callCenter.outstanding')}</div>
            <div className="font-medium tabular-nums">฿{fmtCurrency(offer.outstanding)}</div>
          </div>
          <div>
            <div className="text-xs text-subtle">{t('callCenter.overdueAmount')}</div>
            <div className="font-medium tabular-nums">
              ฿{fmtCurrency(offer.overdue_amount)}
              <span className="text-subtle text-xs ml-1">({t('callCenter.transfer.overdue', { count: offer.overdue_count })})</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-subtle">{t('callCenter.overdueDaysShort', { n: offer.overdue_days })}</div>
            <div><Badge size="sm" color={overdueColor(offer.overdue_days)}>{t('callCenter.overdueDays', { n: offer.overdue_days })}</Badge></div>
          </div>
        </div>

        {/* Flags — anti-dump: read before accepting */}
        <div className="flex items-center gap-3 flex-wrap">
          <FlagPair auto={offer.auto_flag_level} manual={offer.manual_flag_level} divergent={offer.flag_divergent} levels={levels} showLabels />
          {offer.is_paused && <Badge size="sm" color="warning">{t('callCenter.skipReason.PAUSED')}</Badge>}
        </div>
        {offer.flag_divergent && box === 'inbox' && (
          <div className="alert alert-warning">
            <AlertTriangle size={16} />
            <span>{t('callCenter.transfer.divergentWarning')}</span>
          </div>
        )}

        {/* Summary + edited-before-offer fact */}
        {offer.summary ? (
          <div className="text-sm bg-surface rounded-md border border-line px-3 py-2.5">
            <div className="text-xs text-subtle mb-1">{t('callCenter.summary')}</div>
            <div className="whitespace-pre-wrap break-words">{offer.summary}</div>
            <div className="text-[11px] text-subtle mt-1.5 flex items-center gap-2 flex-wrap">
              {offer.summary_at && <DateTime value={offer.summary_at} />}
              {editedBeforeOffer && (
                <span className="inline-flex items-center gap-1 text-warning-fg">
                  <Pencil size={11} />{t('callCenter.transfer.summaryEditedBeforeOffer')}
                </span>
              )}
            </div>
          </div>
        ) : null}

        {/* Offer note */}
        {offer.note && (
          <div className="text-sm text-subtle italic">“{offer.note}”</div>
        )}

        {error && <div className="alert alert-danger"><XCircle size={16} /><span>{error}</span></div>}
      </div>

      {/* Action footer — pinned bottom-right. Each opens a confirm first. */}
      <div className="flex-none border-t border-line p-4 flex justify-end gap-2">
        {box === 'inbox' ? (
          <>
            <Button
              variant="outline"
              color="danger"
              disabled={busy !== null}
              startIcon={busy === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
              onClick={() => setConfirm('reject')}
            >
              {t('callCenter.transfer.reject')}
            </Button>
            <Button
              color="primary"
              disabled={busy !== null}
              startIcon={busy === 'accept' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              onClick={() => setConfirm('accept')}
            >
              {t('callCenter.transfer.accept')}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            color="danger"
            disabled={busy !== null}
            startIcon={busy === 'cancel' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
            onClick={() => setConfirm('cancel')}
          >
            {t('callCenter.transfer.cancel')}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        pending={busy !== null}
        title={confirm ? t(`callCenter.transfer.confirm.${confirm}Title`) : ''}
        message={confirm ? t(`callCenter.transfer.confirm.${confirm}Body`, { contract: offer.contract_code_display }) : ''}
        confirmLabel={confirm ? t(`callCenter.transfer.${confirm}`) : undefined}
        color={confirm === 'accept' ? 'primary' : 'danger'}
        onConfirm={() => {
          if (confirm === 'accept') run('accept', () => tradeRespond(offer.trade_id, true), 'callCenter.transfer.acceptSuccess');
          else if (confirm === 'reject') run('reject', () => tradeRespond(offer.trade_id, false), 'callCenter.transfer.rejectSuccess');
          else if (confirm === 'cancel') run('cancel', () => tradeCancel(offer.trade_id), 'callCenter.transfer.cancelSuccess');
        }}
      />
    </div>
  );
}

// ── Offer modal — recipient picker + note ─────────────────────────────────────

function OfferModal({ open, onClose, onSuccess }: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [contractId, setContractId] = useState('');
  const [contractSearch, setContractSearch] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const targets = useQuery({
    queryKey: ccKeys.tradeTargets,
    queryFn: tradeTargets,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  // Offerable contracts = the collector's own book (you can only offer what you
  // own). Fetch once, filter client-side by the typed text — a book is bounded.
  const book = useQuery({
    queryKey: ['cc', 'trade', 'offerable-book'],
    queryFn: () => apiClient.get<BookRow[]>(
      '/v_my_book?select=contract_id,contract_code_display,customer_name,overdue_amount&order=work_priority.desc&limit=500',
    ),
    enabled: open,
    staleTime: 60 * 1000,
  });

  const reset = () => {
    setContractId(''); setContractSearch(''); setToUserId('');
    setNote(''); setError(''); setSubmitting(false);
  };
  const handleClose = () => { reset(); onClose(); };

  // Two-line options: primary line + muted secondary line. `label` stays a
  // plain single line for the collapsed (selected) display; `renderOption`
  // draws both rows in the dropdown. The secondary text is carried in a
  // value→sub map since tsp-form's Option has no sublabel field.
  const contractOptions = useMemo(() => {
    const q = contractSearch.trim().toLowerCase();
    const rows = q
      ? (book.data ?? []).filter(r =>
          r.contract_code_display.toLowerCase().includes(q)
          || (r.customer_name ?? '').toLowerCase().includes(q))
      : (book.data ?? []);
    return rows.slice(0, 50).map(r => ({
      value: String(r.contract_id),
      label: `${r.contract_code_display} · ${r.customer_name ?? '—'}`,
      primary: r.contract_code_display,
      secondary: r.customer_name ?? '—',
    }));
  }, [book.data, contractSearch]);

  // Recipient options — real name on top (what a human recognizes), username
  // below. The RPC only returns valid targets (active, same branch, not self).
  const targetOptions = (targets.data ?? []).map(tt => {
    const name = tt.full_name?.trim();
    return {
      value: String(tt.user_id),
      label: name ? `${name} · ${tt.username}` : tt.username,
      primary: name || tt.username,
      secondary: name ? tt.username : null,
    };
  });

  const handleSubmit = async () => {
    const cid = parseInt(contractId, 10);
    if (!cid || !toUserId) { setError(t('callCenter.transfer.offerMissing')); return; }
    setSubmitting(true);
    setError('');
    try {
      await tradeOffer(cid, parseInt(toUserId, 10), note.trim() || null);
      reset();
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError
        ? (translateApiError(err, t)
            || err.message)
        : String(err);
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('callCenter.transfer.offerTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-3"><XCircle size={16} /><span>{error}</span></div>
        )}
        {targets.data && targets.data.length === 0 && (
          <div className="alert alert-warning mb-3"><XCircle size={16} /><span>{t('callCenter.transfer.noTargets')}</span></div>
        )}
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('callCenter.transfer.contractLabel')} *</label>
            <Select
              options={contractOptions}
              value={contractId}
              onChange={v => setContractId((v as string) || '')}
              placeholder={t('callCenter.transfer.contractPlaceholder')}
              showChevron
              searchable
              onSearchChange={setContractSearch}
              filterOptions={false}
              renderOption={renderTwoLineOption}
              disabled={book.isLoading}
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('callCenter.transfer.recipientLabel')} *</label>
            <Select
              options={targetOptions}
              value={toUserId}
              onChange={v => setToUserId((v as string) || '')}
              placeholder={t('callCenter.transfer.recipientPlaceholder')}
              searchable
              showChevron
              renderOption={renderTwoLineOption}
              disabled={targets.isLoading || targetOptions.length === 0}
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('callCenter.transfer.noteLabel')}</label>
            <Input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t('callCenter.transfer.notePlaceholder')}
              className="w-full"
            />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
        <Button
          color="primary"
          onClick={handleSubmit}
          disabled={submitting || !contractId || !toUserId}
          startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        >
          {t('callCenter.transfer.offerConfirm')}
        </Button>
      </div>
    </Modal>
  );
}
