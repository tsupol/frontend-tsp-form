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

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Modal, Select, Input, useSnackbarContext } from 'tsp-form';
import {
  Send, Check, X, Clock, Pencil, ExternalLink, Loader2, XCircle, CheckCircle, AlertTriangle,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { FlagPair } from './ccBadges';
import {
  ccKeys, useFlagLevels, tradeTargets, tradeOffer, tradeRespond, tradeCancel,
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
  /** Jump to a contract in the detail panel (mobile-aware handled by parent). */
  onOpenContract: (contractId: number) => void;
}

export function TransferView({ onOpenContract }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: flagLevels } = useFlagLevels();
  const [box, setBox] = useState<Box>('inbox');
  const [offerOpen, setOfferOpen] = useState(false);

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
  const inboxCount = inbox.data?.length ?? 0;
  const outboxCount = outbox.data?.length ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* Box sub-tabs + offer button. No top border — the parent view-tab
          strip already draws the divider; a second one here double-lines. */}
      <div className="flex-none px-4 flex items-center gap-2 border-b border-line">
        <div className="flex">
          <button
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
              box === 'inbox' ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
            }`}
            onClick={() => setBox('inbox')}
          >
            <span className="inline-flex items-center gap-1.5">
              {t('callCenter.transfer.inbox')}
              {inboxCount > 0 && <Badge size="xs" color="warning">{inboxCount}</Badge>}
            </span>
          </button>
          <button
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
              box === 'outbox' ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
            }`}
            onClick={() => setBox('outbox')}
          >
            <span className="inline-flex items-center gap-1.5">
              {t('callCenter.transfer.outbox')}
              {outboxCount > 0 && <Badge size="xs" color="default">{outboxCount}</Badge>}
            </span>
          </button>
        </div>
        <div className="ml-auto">
          <Button size="sm" variant="outline" startIcon={<Send size={14} />} onClick={() => setOfferOpen(true)}>
            {t('callCenter.transfer.offerButton')}
          </Button>
        </div>
      </div>

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
          <div className="divide-y divide-line">
            {rows.map(row => (
              <TradeCard
                key={row.trade_id}
                row={row}
                box={box}
                levels={flagLevels}
                onOpenContract={onOpenContract}
                onChanged={invalidateAll}
              />
            ))}
          </div>
        )}
      </div>

      <OfferModal
        open={offerOpen}
        onClose={() => setOfferOpen(false)}
        onSuccess={() => { setOfferOpen(false); setBox('outbox'); invalidateAll(); }}
      />
    </div>
  );
}

// ── One offer card ────────────────────────────────────────────────────────────

function TradeCard({ row, box, levels, onOpenContract, onChanged }: {
  row: TradeRow | TradeInboxRow;
  box: Box;
  levels: FlagLevelRef[] | undefined;
  onOpenContract: (contractId: number) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [busy, setBusy] = useState<'accept' | 'reject' | 'cancel' | null>(null);
  const [error, setError] = useState('');

  const editedBeforeOffer = box === 'inbox' && (row as TradeInboxRow).summary_edited_before_offer;

  const run = async (kind: 'accept' | 'reject' | 'cancel', fn: () => Promise<unknown>, successKey: string) => {
    setBusy(kind);
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
        ? ((err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
            || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '')
            || err.message)
        : String(err);
      setError(msg);
      setBusy(null);
    }
  };

  return (
    <div className="px-4 py-3">
      {/* Header — contract + counterparty + pending days */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="font-medium text-sm truncate bg-transparent border-none p-0 cursor-pointer text-primary-fg hover:underline inline-flex items-center gap-1"
              onClick={() => onOpenContract(row.contract_id)}
            >
              {row.contract_code_display}
              <ExternalLink size={12} className="shrink-0" />
            </button>
            <span className="text-xs text-subtle truncate">{row.customer_name}</span>
          </div>
          <div className="text-xs text-subtle mt-0.5">
            {box === 'inbox' ? t('callCenter.transfer.fromLabel') : t('callCenter.transfer.toLabel')}{' '}
            <span className="font-medium">{row.counterparty_username ?? `#${row.counterparty_user_id}`}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {row.overdue_amount > 0 && (
            <div className="text-sm font-medium">฿{fmtCurrency(row.overdue_amount)}</div>
          )}
          <div className="text-[11px] text-subtle inline-flex items-center gap-1 mt-0.5">
            <Clock size={11} />
            {t('callCenter.transfer.pendingDays', { count: row.pending_days })}
          </div>
        </div>
      </div>

      {/* Debt + flag pair — anti-dump: show both flags + divergence */}
      <div className="flex items-center gap-3 flex-wrap mt-2 text-xs">
        <span className="text-subtle">
          {t('callCenter.transfer.overdue', { count: row.overdue_count })} · {t('callCenter.overdueDays', { n: row.overdue_days })}
        </span>
        <FlagPair
          auto={row.auto_flag_level}
          manual={row.manual_flag_level}
          divergent={row.flag_divergent}
          levels={levels}
        />
        {row.is_paused && <Badge size="xs" color="warning">{t('callCenter.skipReason.PAUSED')}</Badge>}
      </div>

      {/* Divergence warning — read the history before accepting */}
      {row.flag_divergent && box === 'inbox' && (
        <div className="alert alert-warning mt-2">
          <AlertTriangle size={16} />
          <span>{t('callCenter.transfer.divergentWarning')}</span>
        </div>
      )}

      {/* Summary — another channel where a bad contract gets hidden */}
      {row.summary && (
        <div className="mt-2 text-xs bg-surface rounded px-2 py-1.5">
          <div className="whitespace-pre-wrap break-words">{row.summary}</div>
          <div className="text-[11px] text-subtle mt-1 flex items-center gap-2 flex-wrap">
            {row.summary_at && <DateTime value={row.summary_at} />}
            {editedBeforeOffer && (
              <span className="inline-flex items-center gap-1 text-warning-fg">
                <Pencil size={11} />
                {t('callCenter.transfer.summaryEditedBeforeOffer')}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Offer note */}
      {row.note && (
        <div className="mt-2 text-xs text-subtle italic">“{row.note}”</div>
      )}

      {error && (
        <div className="alert alert-danger mt-2"><XCircle size={16} /><span>{error}</span></div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3">
        {box === 'inbox' ? (
          <>
            <Button
              size="sm"
              color="primary"
              disabled={busy !== null}
              startIcon={busy === 'accept' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              onClick={() => run('accept', () => tradeRespond(row.trade_id, true), 'callCenter.transfer.acceptSuccess')}
            >
              {t('callCenter.transfer.accept')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              color="danger"
              disabled={busy !== null}
              startIcon={busy === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
              onClick={() => run('reject', () => tradeRespond(row.trade_id, false), 'callCenter.transfer.rejectSuccess')}
            >
              {t('callCenter.transfer.reject')}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            color="danger"
            disabled={busy !== null}
            startIcon={busy === 'cancel' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
            onClick={() => run('cancel', () => tradeCancel(row.trade_id), 'callCenter.transfer.cancelSuccess')}
          >
            {t('callCenter.transfer.cancel')}
          </Button>
        )}
      </div>
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
        ? ((err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
            || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '')
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
