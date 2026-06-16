import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Modal, Input, MaskedInput, useSnackbarContext,
} from 'tsp-form';
import { useEffect } from 'react';
import {
  CheckCircle, XCircle, Pencil, Ban, AlertTriangle, X,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { normalizeKey } from '../../lib/mediaPath';
import { MediaLightbox, MediaThumbButton } from '../../components/MediaLightbox';
import { beMediaDelete } from '../../lib/beMedia';
import type { ExpenseEntry, EditAmountResponse, VoidResponse } from './branchExpenseTypes';

interface Props {
  entryId: number;
  onClosed?: () => void;
}

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

  const canManage = role === 'BRANCH_MANAGER' && entry !== null && entry !== undefined && !entry.is_voided
    && user?.branch_id === entry.branch_id;

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
            <div className="text-base font-semibold truncate">{entry.category_name_th}</div>
            <div className="text-xs text-subtle truncate">
              <DateTime value={entry.expense_date} showTime={false} />
              {' · '}{entry.branch_code} · {entry.branch_name}
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
              <div>
                <span className={`font-semibold text-base ${entry.is_voided ? 'line-through text-subtle' : ''}`}>
                  ฿{fmtCurrency(entry.current_amount)}
                </span>
                {entry.adjustment_count > 0 && (
                  <div className="text-xs text-subtle mt-0.5">
                    {t('branchExpense.originalWas')}: ฿{fmtCurrency(entry.original_amount)}
                    {' · '}
                    {t('branchExpense.adjustments', { count: entry.adjustment_count })}
                  </div>
                )}
              </div>
            } />
            <DetailRow label={t('branchExpense.vendor')} value={entry.vendor ?? '—'} />
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
                      alt={`${entry.category_name_th} receipt ${i + 1}`}
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
              {t('branchExpense.editAmount')}
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

      <EditAmountModal
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

function EditAmountModal({
  open, entry, onClose, onSaved,
}: { open: boolean; entry: ExpenseEntry; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<EditAmountResponse | null>(null);

  useEffect(() => {
    if (open) {
      setView('form');
      setAmount(String(entry.current_amount));
      setReason('');
      setError(null);
      setBusy(false);
      setResult(null);
    }
  }, [open, entry]);

  const isDirty = amount !== String(entry.current_amount) || reason !== '';
  const handleClose = () => {
    if (view === 'done') { onClose(); return; }
    if (isDirty && !busy) { setConfirm(true); return; }
    onClose();
  };

  const submit = async () => {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError(t('branchExpense.errAmountPositive')); return; }
    if (!reason.trim()) { setError(t('branchExpense.errReasonRequired')); return; }
    setBusy(true);
    try {
      const r = await apiClient.rpc<EditAmountResponse>('fn_branch_expense_edit_amount', {
        p_id: entry.id,
        p_new_amount: amt,
        p_reason: reason.trim(),
      });
      setResult(r);
      setView('done');
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('branchExpense.amountEdited')}</span>
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
            {view === 'done' ? t('branchExpense.amountEdited') : t('branchExpense.editAmount')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>
        {view === 'done' && result ? (
          <>
            <div className="modal-content">
              <div className="text-center py-4">
                <CheckCircle size={40} className="text-success mx-auto mb-3" />
                <div className="text-sm">
                  ฿{fmtCurrency(result.previous_amount)} → ฿{fmtCurrency(result.new_amount)}
                </div>
                <div className="text-xs text-subtle mt-1">
                  {t('branchExpense.delta')}: {result.delta >= 0 ? '+' : ''}฿{fmtCurrency(result.delta)}
                </div>
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
                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.newAmount')} (THB)</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={2}
                    value={amount}
                    onChange={(raw) => setAmount(raw)}
                    className="w-full"
                  />
                  <span className="text-xs text-subtle mt-1">
                    {t('branchExpense.currentAmount')}: ฿{fmtCurrency(entry.current_amount)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('branchExpense.reason')}</label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('branchExpense.reasonPlaceholder')}
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
              <Button color="primary" onClick={submit} disabled={busy}>
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
  const [result, setResult] = useState<VoidResponse | null>(null);

  useEffect(() => {
    if (open) {
      setView('form');
      setReason('');
      setError(null);
      setBusy(false);
      setResult(null);
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
      const r = await apiClient.rpc<VoidResponse>('fn_branch_expense_void', {
        p_id: entry.id,
        p_reason: reason.trim(),
      });
      if (r.deleted_keys && r.deleted_keys.length > 0) {
        beMediaDelete(r.deleted_keys).catch(() => { /* sweeper backstop */ });
      }
      setResult(r);
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
        {view === 'done' && result ? (
          <>
            <div className="modal-content">
              <div className="text-center py-4">
                <Ban size={40} className="text-danger mx-auto mb-3" />
                <div className="text-sm">{t('branchExpense.voidedRowCount', { count: result.rows_voided })}</div>
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
