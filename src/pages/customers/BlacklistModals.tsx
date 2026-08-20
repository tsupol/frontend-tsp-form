import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Select, TextArea } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';

// ============================================================================
// Blacklist add / lift — the one pair of modals behind every entry point
// (customer detail, contract detail, the Company > Blacklist list).
//
// Both writes take a reason CODE from the ref table plus a free-text note the
// DB requires to be >= 10 characters (BLACKLIST.VALIDATION.NOTE_TOO_SHORT,
// 422). The counter under the field is the FE mirror of that server rule —
// it exists so the user sees the requirement before submitting, not so the FE
// owns it; the button stays disabled until the note is long enough and the
// server still rejects a short one independently.
//
// Permission lives with the caller: ADD is COMPANY_ADMIN + BRANCH_MANAGER,
// LIFT is COMPANY_ADMIN only. Callers hide the button via can('BLACKLIST.LIFT')
// rather than checking role_code — a BM who reaches lift gets
// SALE.AUTH.PERMISSION_DENIED from the server.
// Spec: UI_FEEDBACK/2026-08-20_IMPLEMENT_blacklist_management.md
// ============================================================================

/** DB-enforced floor on the explanation note. */
export const BLACKLIST_NOTE_MIN = 10;

interface ReasonOption {
  kind: 'ADD' | 'LIFT';
  code: string;
  name_th: string;
  name_en: string;
  sort_order: number;
}

interface AddResult {
  id: number;
  customer_id: number;
  reason_code: string;
  blacklist_type: string;
}

interface LiftResult {
  id: number;
  lifted: boolean;
  reason_code: string;
}

/** Reason list for one kind, labelled in the active language. */
function useReasonOptions(kind: 'ADD' | 'LIFT') {
  const { i18n } = useTranslation();
  const { data = [] } = useQuery({
    queryKey: ['blacklist-reasons'],
    queryFn: () => apiClient.get<ReasonOption[]>('/v_ref_blacklist_reasons?order=kind,sort_order'),
    staleTime: 60 * 60 * 1000, // a ref table — refetching it per modal open is waste
  });
  return useMemo(
    () => data
      .filter((r) => r.kind === kind)
      .map((r) => ({ value: r.code, label: i18n.language === 'th' ? r.name_th : r.name_en })),
    [data, kind, i18n.language],
  );
}

/** Invalidate everything that renders a blacklist flag, from either entry point. */
function useBlacklistInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['blacklist'] });
    queryClient.invalidateQueries({ queryKey: ['customers'] });
    queryClient.invalidateQueries({ queryKey: ['customer'] });
    queryClient.invalidateQueries({ queryKey: ['contract-detail'] });
    queryClient.invalidateQueries({ queryKey: ['contracts'] });
    // the contract's customers tab renders a per-person badge off this one
    queryClient.invalidateQueries({ queryKey: ['contract-customers'] });
  };
}

// ── Add ─────────────────────────────────────────────────────────────────────

export interface AddToBlacklistModalProps {
  open: boolean;
  onClose: () => void;
  /** Null is tolerated so the host never conditionally mounts the Modal. */
  customer: { id: number; full_name: string } | null;
  /** Optional contract that prompted the blacklisting. */
  refContractId?: number | null;
}

export function AddToBlacklistModal({ open, onClose, customer, refContractId }: AddToBlacklistModalProps) {
  const { t } = useTranslation();
  const reasonOptions = useReasonOptions('ADD');
  const invalidate = useBlacklistInvalidation();

  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<AddResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // The parent clears its selection on close, so hold the last customer to keep
  // the body rendered through the exit transition.
  const [lastCustomer, setLastCustomer] = useState(customer);
  if (customer && customer !== lastCustomer) setLastCustomer(customer);
  const shown = customer ?? lastCustomer;

  useEffect(() => {
    if (open) {
      setReasonCode('');
      setNote('');
      setError('');
      setView('form');
      setResult(null);
      setConfirmClose(false);
    }
  }, [open]);

  const isDirty = reasonCode !== '' || note !== '';
  const canSubmit = !busy && reasonCode !== '' && note.trim().length >= BLACKLIST_NOTE_MIN;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done' || !isDirty) { forceClose(); return; }
    setConfirmClose(true);
  };

  const handleSubmit = async () => {
    if (!shown || !canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.rpc<AddResult>('fn_blacklist_add', {
        p_customer_id: shown.id,
        p_reason_code: reasonCode,
        p_note: note.trim(),
        p_ref_contract_id: refContractId ?? null,
      });
      setResult(res);
      invalidate();
      setView('done');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(translateApiError(err, t) || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const reasonLabel = reasonOptions.find((o) => o.value === result?.reason_code)?.label ?? result?.reason_code ?? '';

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('blacklist.add.title')}</h2>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{shown?.full_name ?? '—'}</div>
                </div>

                <div className="alert alert-warning">
                  <div><div className="alert-description">{t('blacklist.add.effectWarning')}</div></div>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('blacklist.reasonCode')} *</label>
                  <Select
                    options={reasonOptions}
                    value={reasonCode || null}
                    onChange={(v) => setReasonCode((v as string) ?? '')}
                    placeholder={t('blacklist.reasonCodePlaceholder')}
                    searchable={false}
                  />
                </div>

                <NoteField value={note} onChange={setNote} placeholder={t('blacklist.add.notePlaceholder')} />
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={handleSubmit} disabled={!canSubmit}>
                {busy ? t('common.saving') : t('blacklist.add.confirm')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            tone="warning"
            headline={t('blacklist.add.doneHeadline')}
            contractCode={shown?.full_name ?? ''}
            detailRows={[
              { label: t('blacklist.reasonCode'), value: reasonLabel },
              { label: t('blacklist.note'), value: note.trim() },
            ]}
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

// ── Lift ────────────────────────────────────────────────────────────────────

export interface LiftBlacklistModalProps {
  open: boolean;
  onClose: () => void;
  /** The active blacklist row to lift — `active_blacklist_id` on the customer. */
  entry: { blacklistId: number; customerName: string } | null;
}

export function LiftBlacklistModal({ open, onClose, entry }: LiftBlacklistModalProps) {
  const { t } = useTranslation();
  const reasonOptions = useReasonOptions('LIFT');
  const invalidate = useBlacklistInvalidation();

  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<LiftResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const [lastEntry, setLastEntry] = useState(entry);
  if (entry && entry !== lastEntry) setLastEntry(entry);
  const shown = entry ?? lastEntry;

  useEffect(() => {
    if (open) {
      setReasonCode('');
      setNote('');
      setError('');
      setView('form');
      setResult(null);
      setConfirmClose(false);
    }
  }, [open]);

  const isDirty = reasonCode !== '' || note !== '';
  const canSubmit = !busy && reasonCode !== '' && note.trim().length >= BLACKLIST_NOTE_MIN;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done' || !isDirty) { forceClose(); return; }
    setConfirmClose(true);
  };

  const handleSubmit = async () => {
    if (!shown || !canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.rpc<LiftResult>('fn_blacklist_lift', {
        p_blacklist_id: shown.blacklistId,
        p_reason_code: reasonCode,
        p_note: note.trim(),
      });
      setResult(res);
      invalidate();
      setView('done');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(translateApiError(err, t) || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const reasonLabel = reasonOptions.find((o) => o.value === result?.reason_code)?.label ?? result?.reason_code ?? '';

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('blacklist.lift.title')}</h2>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{shown?.customerName ?? '—'}</div>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('blacklist.reasonCode')} *</label>
                  <Select
                    options={reasonOptions}
                    value={reasonCode || null}
                    onChange={(v) => setReasonCode((v as string) ?? '')}
                    placeholder={t('blacklist.reasonCodePlaceholder')}
                    searchable={false}
                  />
                </div>

                <NoteField value={note} onChange={setNote} placeholder={t('blacklist.lift.notePlaceholder')} />
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleSubmit} disabled={!canSubmit}>
                {busy ? t('common.saving') : t('blacklist.lift.confirm')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            headline={t('blacklist.lift.doneHeadline')}
            contractCode={shown?.customerName ?? ''}
            detailRows={[
              { label: t('blacklist.reasonCode'), value: reasonLabel },
              { label: t('blacklist.note'), value: note.trim() },
            ]}
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

// ── Shared note field ───────────────────────────────────────────────────────

/** Note + live character counter. Counts trimmed length — trailing spaces don't
 *  satisfy the server either. */
function NoteField({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const { t } = useTranslation();
  const len = value.trim().length;
  const short = len < BLACKLIST_NOTE_MIN;
  return (
    <div className="flex flex-col">
      <label className="form-label">{t('blacklist.note')} *</label>
      <TextArea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} />
      <div className={`text-xs mt-1 ${short ? 'text-subtle' : 'text-success'}`}>
        {t('blacklist.noteMinHint', { count: BLACKLIST_NOTE_MIN, current: len })}
      </div>
    </div>
  );
}
