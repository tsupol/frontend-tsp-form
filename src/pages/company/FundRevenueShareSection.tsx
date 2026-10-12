import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, DataTable, MaskedInput, Modal, TextArea, type ColumnDef,
} from 'tsp-form';
import { Pencil } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { translateApiError } from '../../lib/apiErrors';
import { useFormSnapshot } from '../../hooks/useFormSnapshot';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';

// ── Fund revenue share (mig 1431) ─────────────────────────────────────────────
// The % of collected installments (not late fees, not deposits) the fund
// company keeps. Since mig 1441 the backend books it the moment an installment
// is collected — the company's book gets its share, the fund's book the rest —
// with no document, no bundle and no payout. A contract freezes the value in
// force on the day it opens, which is why the edit modal says the change
// reaches only contracts opened after saving.
//
// Only holding admin / SYSTEM_DEV may write (the backend refuses everyone else
// with PERMISSION_DENIED); fund users see the panel read-only. Operating
// companies have no row in the view, so the section renders nothing for them.

interface FundRevenueShareRow {
  company_id: number;
  company_name: string;
  share_pct: number;
  config_id: number | null;
  set_at: string | null;
  set_by_user_id: number | null;
  /** Null when the setter is outside what this user may see (a holding user read by a company user). */
  set_by_username: string | null;
  note: string | null;
  calc_enabled: boolean;
  holding_id: number;
}

interface FundRevenueShareLogRow {
  config_id: number;
  company_id: number;
  share_pct: number;
  note: string | null;
  set_at: string;
  set_by_user_id: number | null;
  set_by_username: string | null;
}

interface FundRevenueShareSetResult {
  config_id: number;
  share_pct: number;
  previous_share_pct: number;
  calc_enabled: boolean;
}

const WRITER_ROLES = ['HOLDING_ADMIN', 'SYSTEM_DEV'];

const fmtPct = (v: number | null | undefined) =>
  `${Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

export function FundRevenueShareSection({ companyId }: { companyId: number }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data: row = null } = useQuery({
    queryKey: ['fund-revenue-share', companyId],
    queryFn: async () => {
      const rows = await apiClient.get<FundRevenueShareRow[]>(
        `/v_fund_revenue_share_config?company_id=eq.${companyId}`,
      );
      return rows[0] ?? null;
    },
  });

  const { data: log = [], isLoading: logLoading } = useQuery({
    queryKey: ['fund-revenue-share-log', companyId],
    queryFn: () => apiClient.get<FundRevenueShareLogRow[]>(
      `/v_fund_revenue_share_config_log?company_id=eq.${companyId}&order=config_id.desc`,
    ),
    enabled: !!row,
  });

  const canEdit = WRITER_ROLES.includes(user?.role_code ?? '');

  const columns = useMemo<ColumnDef<FundRevenueShareLogRow>[]>(() => [
    {
      id: 'set_at',
      header: () => <span className="text-xs">{t('settings.config.fundShareColDate')}</span>,
      cell: ({ row: r }) => <DateTime value={r.original.set_at} showTime className="text-sm tabular-nums whitespace-nowrap" />,
      enableSorting: false,
      className: 'w-44',
    },
    {
      id: 'share_pct',
      header: () => <span className="text-xs">{t('settings.config.fundShareColPct')}</span>,
      cell: ({ row: r }) => <span className="text-sm font-medium tabular-nums">{fmtPct(r.original.share_pct)}</span>,
      enableSorting: false,
      className: 'w-20',
    },
    {
      id: 'set_by',
      header: () => <span className="text-xs">{t('settings.config.fundShareColBy')}</span>,
      cell: ({ row: r }) => <span className="text-sm">{r.original.set_by_username ?? '—'}</span>,
      enableSorting: false,
      className: 'w-40',
    },
    {
      id: 'note',
      header: () => <span className="text-xs">{t('settings.config.fundShareColNote')}</span>,
      cell: ({ row: r }) => <span className="text-sm text-subtle">{r.original.note || '—'}</span>,
      enableSorting: false,
    },
  ], [t]);

  // Not a fund company (or not visible to this user): nothing to show.
  if (!row) return null;

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ['fund-revenue-share', companyId] });
    queryClient.invalidateQueries({ queryKey: ['fund-revenue-share-log', companyId] });
  };

  return (
    <>
      <hr className="border-line mt-6 mb-6" />
      <div>
        <h4 className="text-sm font-semibold text-fg uppercase tracking-wider mb-1">{t('settings.config.fundShareTitle')}</h4>
        <p className="text-xs text-subtle mb-3">{t('settings.config.fundShareHint')}</p>

        <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-3 rounded-md border border-line">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-3xl font-semibold tabular-nums leading-none">{fmtPct(row.share_pct)}</span>
            </div>
            <div className="text-xs text-subtle">
              {row.set_at ? (
                <>
                  {t('settings.config.fundShareSetBy')} {row.set_by_username ?? '—'}
                  {' · '}
                  <DateTime value={row.set_at} showTime />
                </>
              ) : (
                t('settings.config.fundShareNeverSet')
              )}
            </div>
            {row.note && (
              <div className="text-xs text-subtle">
                {t('settings.config.fundShareNote')}: {row.note}
              </div>
            )}
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" startIcon={<Pencil size={14} />} onClick={() => setEditOpen(true)}>
              {t('settings.config.fundShareEdit')}
            </Button>
          )}
        </div>

        <h5 className="text-xs font-semibold text-subtle uppercase tracking-wider mt-4 mb-2">{t('settings.config.fundShareHistory')}</h5>
        <DataTable<FundRevenueShareLogRow>
          outlined
          data={log}
          columns={columns}
          noResults={
            <div className="p-4 text-center text-subtler text-sm">
              {logLoading ? t('common.loading') : t('settings.config.fundShareHistoryEmpty')}
            </div>
          }
        />
      </div>

      <FundRevenueShareModal
        open={editOpen}
        row={row}
        onClose={() => setEditOpen(false)}
        onSaved={refetch}
      />
    </>
  );
}

// ── Edit modal ────────────────────────────────────────────────────────────────
// Write-modal checklist: always mounted, form/done views, ActionDoneView on
// success (previous → new %), one handleClose guarding a dirty form, the submit
// error in a ModalErrorBand between content and footer. The 0–100 / 2-decimal
// rule is the backend's: Save is only held back on an empty field, every other
// rejection is shown as the backend's own message.

function FundRevenueShareModal({ open, row, onClose, onSaved }: {
  open: boolean;
  row: FundRevenueShareRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [pctStr, setPctStr] = useState('');
  const [note, setNote] = useState('');
  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<FundRevenueShareSetResult | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  // Keep rendering the last row through the close animation.
  const [lastRow, setLastRow] = useState<FundRevenueShareRow | null>(null);
  if (row && row !== lastRow) setLastRow(row);
  const r = row ?? lastRow;

  const snapshot = useFormSnapshot({ pctStr, note });

  useEffect(() => {
    if (open) {
      setPctStr(row ? String(row.share_pct) : '');
      setNote('');
      setView('form');
      setResult(null);
      setError('');
      setConfirmClose(false);
      snapshot.resetNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.company_id]);

  const canSave = !saving && pctStr.trim() !== '';

  const handleSubmit = async () => {
    if (!r || !canSave) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiClient.rpc<FundRevenueShareSetResult>('fn_fund_revenue_share_set', {
        p_company_id: r.company_id,
        p_share_pct: Number(pctStr),
        p_note: note.trim() || null,
      });
      setResult(res);
      setView('done');
      snapshot.reset();
      onSaved();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (snapshot.isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%" ariaLabel={t('settings.config.fundShareEditTitle')}>
        <div className="modal-header">
          <h2 className="modal-title">{t('settings.config.fundShareEditTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
        </div>
        {view === 'form' && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{r?.company_name}</div>
                  <div className="text-xs text-subtle tabular-nums">
                    {t('settings.config.fundShareCurrent')} {fmtPct(r?.share_pct)}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('settings.config.fundShareNew')}</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={2}
                    suffix="%"
                    value={pctStr}
                    onChange={(raw) => setPctStr(raw)}
                    disabled={saving}
                  />
                  <span className="text-xs text-subtler mt-1">{t('settings.config.fundShareFieldHint')}</span>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('settings.config.fundShareNote')}</label>
                  <TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    disabled={saving}
                  />
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={handleSubmit} disabled={!canSave}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </>
        )}
        {view === 'done' && result && r && (
          <ActionDoneView
            headline={t('settings.config.fundShareSaved')}
            contractCode={r.company_name}
            detailRows={[
              { label: t('settings.config.fundSharePrevious'), value: fmtPct(result.previous_share_pct) },
              { label: t('settings.config.fundShareNew'), value: fmtPct(result.share_pct), emphasis: true },
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
          <Button variant="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
