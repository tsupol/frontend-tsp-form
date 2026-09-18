// Build one shop's payout: pick which waiting settlements go on it.
//
// Only rows the backend calls `is_payable` can be ticked. Every other row shows
// why not, and where the reason is fixable from here — "not checked yet" — the
// fix is a button on the row itself, so finance never has to leave and come
// back. The totals shown are the rows' own `net_amount`, which is what the
// document will carry.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PageNav, PageNavPanel, DataTable, MobileHeader, Badge, Button, Checkbox, Modal, TextArea,
} from 'tsp-form';
import { ArrowLeft, AlertTriangle, CheckCircle, ExternalLink, Loader2 } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency } from '../../lib/format';
import { usePayoutCandidates, usePayoutCandidateBranches, usePartnerPayoutInvalidate } from './usePartnerPayouts';
import type { PayoutCandidate, PayoutCreateResult } from './partnerPayoutTypes';

export function PartnerPayoutBuildPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { branchId: branchIdParam } = useParams<{ branchId: string }>();
  const branchId = branchIdParam ? Number(branchIdParam) : null;
  const invalidate = usePartnerPayoutInvalidate();

  const candidates = usePayoutCandidates(branchId);
  const branches = usePayoutCandidateBranches();
  const branchRow = branches.rows.find(b => b.branch_id === branchId) ?? null;

  const [selected, setSelected] = useState<number[]>([]);
  const [ticking, setTicking] = useState<number | null>(null);
  const [tickError, setTickError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<PayoutCreateResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const rows = candidates.rows;
  const payableIds = useMemo(
    () => rows.filter(r => r.is_payable).map(r => r.settlement_id),
    [rows],
  );

  // A row can stop being payable underneath us (someone else put it on their
  // own draft), so the selection is filtered against what is still payable
  // rather than trusted from the last render.
  useEffect(() => {
    setSelected(prev => prev.filter(id => payableIds.includes(id)));
  }, [payableIds]);

  const selectedTotal = rows
    .filter(r => selected.includes(r.settlement_id))
    .reduce((sum, r) => sum + (r.net_amount ?? 0), 0);

  const allPayableSelected = payableIds.length > 0 && payableIds.every(id => selected.includes(id));

  const toggle = (id: number) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  /** Tick "checked" right on the row that is blocked for want of it. */
  const handleTick = async (row: PayoutCandidate) => {
    setTicking(row.settlement_id);
    setTickError(null);
    try {
      await apiClient.rpc('fn_partner_settlement_finance_check', {
        p_settlement_id: row.settlement_id,
        p_checked: true,
      });
      invalidate();
      await candidates.refetch();
    } catch (err) {
      setTickError(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setTicking(null);
    }
  };

  const forceClose = () => {
    setConfirmOpen(false);
    setConfirmClose(false);
    setNote('');
    setError(null);
    setView('form');
  };

  const handleCloseConfirm = () => {
    if (view === 'done') { forceClose(); return; }
    if (note.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleCreate = async () => {
    if (branchId == null || selected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<PayoutCreateResult>('fn_partner_payout_create', {
        p_branch_id: branchId,
        p_settlement_ids: selected,
        p_note: note.trim() || null,
      });
      setResult(res);
      setView('done');
      invalidate();
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setSaving(false);
    }
  };

  const reasonText = (row: PayoutCandidate) => {
    if (!row.payout_blocking_reason) return '';
    return t(`partnerPayout.blocking_${row.payout_blocking_reason}`, {
      defaultValue: row.payout_blocking_reason,
    });
  };

  return (
    <PageNav panels={['list']} className="h-dvh overflow-hidden">
      {({ isMobile }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                <button
                  className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                  onClick={() => navigate('/admin/partner-payouts')}
                >
                  <ArrowLeft size={20} />
                </button>
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {branchRow?.branch_name ?? t('partnerPayout.buildTitle')}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                startIcon={<ArrowLeft size={16} />}
                onClick={() => navigate('/admin/partner-payouts')}
              />
              <h1 className="heading-2 shrink-0">{t('partnerPayout.buildTitle')}</h1>
              <span className="text-sm text-subtle truncate">{branchRow?.branch_name ?? ''}</span>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 flex flex-col">
              {/* A shop with no account on file cannot be paid at all — say so
                  once at the top, with the way to fix it. */}
              {branchRow && !branchRow.has_payout_account && (
                <div className="flex-none p-2 border-b border-line">
                  <div className="alert alert-warning">
                    <AlertTriangle size={16} className="shrink-0" />
                    <span className="flex-1 min-w-0">{t('partnerPayout.noPayoutAccountDetail')}</span>
                    <button
                      type="button"
                      onClick={() => navigate('/admin/pricing/deal-partner-rates')}
                      className="shrink-0 text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer text-sm"
                    >
                      {t('partnerPayout.openConditions')}
                      <ExternalLink size={12} />
                    </button>
                  </div>
                </div>
              )}

              {branchRow && branchRow.draft_payout_count > 0 && (
                <div className="flex-none p-2 border-b border-line">
                  <div className="alert alert-info">
                    <span className="flex-1 min-w-0">
                      {t('partnerPayout.draftExistsHint', { count: branchRow.draft_payout_count })}
                    </span>
                  </div>
                </div>
              )}

              {tickError && (
                <div className="flex-none p-2 border-b border-line">
                  <div className="alert alert-danger">
                    <AlertTriangle size={16} className="shrink-0" />
                    <span className="flex-1 min-w-0">{tickError}</span>
                  </div>
                </div>
              )}

              <div className="flex-none flex items-center gap-2 p-2 border-b border-line">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={payableIds.length === 0}
                  onClick={() => setSelected(allPayableSelected ? [] : payableIds)}
                >
                  {allPayableSelected ? t('partnerPayout.clearSelection') : t('partnerPayout.selectAllReady')}
                </Button>
                <span className="text-sm text-subtle">
                  {t('partnerPayout.selectedCount', { count: selected.length })}
                </span>
                <span className="flex-1" />
                <span className="text-sm font-medium tabular-nums">{fmtCurrency(selectedTotal)}</span>
              </div>

              <DataTable<PayoutCandidate>
                data={rows}
                renderRow={row => {
                  const r = row.original;
                  const checked = selected.includes(r.settlement_id);
                  return (
                    <div className="px-4 py-2.5 flex items-start gap-3">
                      <div className="pt-0.5 shrink-0">
                        <Checkbox
                          checked={checked}
                          disabled={!r.is_payable}
                          onChange={() => toggle(r.settlement_id)}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{r.settlement_code}</span>
                          {r.finance_checked_at && (
                            <Badge color="success" size="sm">{t('partnerPayout.checked')}</Badge>
                          )}
                          <span className="flex-1" />
                          <span className="text-sm tabular-nums font-medium shrink-0">
                            {fmtCurrency(r.net_amount)}
                          </span>
                        </div>
                        <div className="text-sm mt-0.5 truncate">
                          {r.contract_code} · {r.customer_name ?? '—'}
                        </div>
                        <div className="text-xs text-subtle mt-0.5">
                          {t('partnerPayout.submittedAt')}: <DateTime value={r.close_submitted_at} showTime />
                        </div>

                        {/* Not payable — say why, and offer the fix when the fix
                            is a click rather than a trip to another screen. */}
                        {!r.is_payable && r.payout_blocking_reason && (
                          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-warning-fg inline-flex items-center gap-1">
                              <AlertTriangle size={13} className="shrink-0" />
                              {reasonText(r)}
                            </span>
                            {r.payout_blocking_reason === 'not_checked' && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={ticking === r.settlement_id}
                                startIcon={
                                  ticking === r.settlement_id
                                    ? <Loader2 size={14} className="animate-spin" />
                                    : <CheckCircle size={14} className="text-success" />
                                }
                                onClick={() => handleTick(r)}
                              >
                                {t('partnerPayout.tickChecked')}
                              </Button>
                            )}
                            {r.payout_blocking_reason === 'no_payout_account' && (
                              <button
                                type="button"
                                onClick={() => navigate('/admin/pricing/deal-partner-rates')}
                                className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                              >
                                {t('partnerPayout.openConditions')}
                                <ExternalLink size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }}
                className={`flex-1 min-h-0 panel-datatable ${candidates.isFetching ? 'opacity-60' : ''} transition-opacity`}
                noResults={
                  <div className="p-8 text-center text-subtler">{t('partnerPayout.candidatesEmpty')}</div>
                }
              />

              <div className="flex-none border-t border-line px-4 py-3 flex items-center gap-3">
                <span className="text-sm text-subtle">
                  {t('partnerPayout.selectedTotal')}
                </span>
                <span className="text-base font-semibold tabular-nums">{fmtCurrency(selectedTotal)}</span>
                <span className="flex-1" />
                <Button
                  color="primary"
                  disabled={selected.length === 0}
                  onClick={() => { setView('form'); setError(null); setConfirmOpen(true); }}
                >
                  {t('partnerPayout.createPayout')}
                </Button>
              </div>
            </PageNavPanel>
          </div>

          <Modal
            open={confirmOpen}
            onClose={handleCloseConfirm}
            maxWidth="30rem"
            width="100%"
            ariaLabel={t('partnerPayout.createPayout')}
          >
            <div className="modal-header">
              <h2 className="modal-title">{t('partnerPayout.createPayout')}</h2>
              <button type="button" className="modal-close-btn" onClick={handleCloseConfirm}>&times;</button>
            </div>

            {view === 'form' ? (
              <>
                <div className="modal-content">
                  <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                    <div className="font-medium text-sm">{branchRow?.branch_name ?? ''}</div>
                    <div className="text-xs text-subtle mt-0.5">
                      {t('partnerPayout.settlementCount', { count: selected.length })} · {fmtCurrency(selectedTotal)}
                    </div>
                  </div>

                  <div className="form-grid mt-4">
                    <div className="flex flex-col">
                      <label className="form-label">{t('partnerPayout.note')}</label>
                      <TextArea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        rows={2}
                        placeholder={t('partnerPayout.notePlaceholder')}
                      />
                    </div>
                  </div>
                </div>

                <ModalErrorBand message={error} onDismiss={() => setError(null)} />

                <div className="modal-footer">
                  <Button variant="ghost" onClick={handleCloseConfirm} disabled={saving}>
                    {t('common.cancel')}
                  </Button>
                  <Button color="primary" onClick={handleCreate} disabled={saving || selected.length === 0}>
                    {t('partnerPayout.createPayout')}
                  </Button>
                </div>
              </>
            ) : result && (
              <ActionDoneView
                headline={t('partnerPayout.createdHeadline')}
                contractCode={result.payout_code}
                detailRows={[
                  { label: t('partnerPayout.shop'), value: branchRow?.branch_name ?? '' },
                  { label: t('partnerPayout.settlements'), value: String(result.settlement_count) },
                  { label: t('partnerPayout.netAmount'), value: fmtCurrency(result.net_amount), emphasis: true },
                ]}
                onClose={() => {
                  forceClose();
                  navigate(`/admin/partner-payouts/${result.payout_id}`);
                }}
              />
            )}
          </Modal>

          <Modal
            open={confirmClose}
            onClose={() => setConfirmClose(false)}
            maxWidth="24rem"
            width="100%"
            ariaLabel={t('common.unsavedChanges')}
          >
            <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
            <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
            </div>
          </Modal>
        </>
      )}
    </PageNav>
  );
}
