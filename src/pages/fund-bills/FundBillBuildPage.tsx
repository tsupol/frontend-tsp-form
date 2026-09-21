// Build one shop's payout: pick which waiting requests go on it.
//
// Every row here is already payable — the queue view applies the same checks the
// create call does, so a request that is not ready simply is not listed. That is
// why there are no blocked rows and no per-row fixes on this page: why something
// is missing is answered on the settlement queue, which is where it is still
// sitting. The totals shown are the rows' own nets, which is what the document
// will carry.
//
// One document is one shop, enforced by the backend, so the shop is the route
// and the page never offers a way to mix two.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PageNav, PageNavPanel, DataTable, MobileHeader, Badge, Button, Checkbox, Modal, TextArea,
} from 'tsp-form';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency, formatEntityCode } from '../../lib/format';
import { useFundBillCandidates, useFundBillCandidateBranches, useFundBillInvalidate } from './useFundBills';
import type { FundBillCandidate, FundBillCreateResult } from './fundBillTypes';

export function FundBillBuildPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { branchId: branchIdParam } = useParams<{ branchId: string }>();
  const branchId = branchIdParam ? Number(branchIdParam) : null;
  const invalidate = useFundBillInvalidate();

  const candidates = useFundBillCandidates(branchId);
  const branches = useFundBillCandidateBranches();
  const branchRow = branches.rows.find(b => b.branch_id === branchId) ?? null;
  // Issuing the document empties this shop's queue row, so the name would vanish
  // from the success view that is still on screen. Hold the last one we saw.
  const lastBranchName = useRef('');
  if (branchRow?.branch_name) lastBranchName.current = branchRow.branch_name;
  const branchName = branchRow?.branch_name ?? lastBranchName.current;

  const [selected, setSelected] = useState<number[]>([]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<FundBillCreateResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const rows = candidates.rows;
  const allIds = useMemo(() => rows.map(r => r.settlement_id), [rows]);

  // A row can leave the queue underneath us (someone else put it on their own
  // draft), so the selection is filtered against what is still listed rather
  // than trusted from the last render.
  useEffect(() => {
    setSelected(prev => prev.filter(id => allIds.includes(id)));
  }, [allIds]);

  const selectedTotal = rows
    .filter(r => selected.includes(r.settlement_id))
    .reduce((sum, r) => sum + (r.net_amount ?? 0), 0);

  const allSelected = allIds.length > 0 && allIds.every(id => selected.includes(id));

  const toggle = (id: number) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
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
      const res = await apiClient.rpc<FundBillCreateResult>('fn_fund_bill_create', {
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

  return (
    <PageNav panels={['list']} className="h-dvh overflow-hidden">
      {({ isMobile }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                <button
                  className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                  onClick={() => navigate('/admin/fund-bills')}
                >
                  <ArrowLeft size={20} />
                </button>
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {branchName || t('fundBill.buildTitle')}
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
                onClick={() => navigate('/admin/fund-bills')}
              />
              <h1 className="heading-2 shrink-0">{t('fundBill.buildTitle')}</h1>
              <span className="text-sm text-subtle truncate">{branchName}</span>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 flex flex-col">
              {/* A request that is not ready never reaches this queue, so the way
               *  to find out why is a link to where it still sits. */}
              <div className="flex-none p-2 border-b border-line">
                <div className="alert alert-info">
                  <span className="flex-1 min-w-0">{t('fundBill.onlyReadyListed')}</span>
                  <button
                    type="button"
                    onClick={() => navigate('/admin/partner-settlements')}
                    className="shrink-0 text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer text-sm"
                  >
                    {t('fundBill.openSettlementQueue')}
                    <ExternalLink size={12} />
                  </button>
                </div>
              </div>

              <div className="flex-none flex items-center gap-2 p-2 border-b border-line">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={allIds.length === 0}
                  onClick={() => setSelected(allSelected ? [] : allIds)}
                >
                  {allSelected ? t('fundBill.clearSelection') : t('fundBill.selectAll')}
                </Button>
                <span className="text-sm text-subtle">
                  {t('fundBill.selectedCount', { count: selected.length })}
                </span>
                <span className="flex-1" />
                <span className="text-sm font-medium tabular-nums">{fmtCurrency(selectedTotal)}</span>
              </div>

              <DataTable<FundBillCandidate>
                data={rows}
                renderRow={row => {
                  const r = row.original;
                  const checked = selected.includes(r.settlement_id);
                  return (
                    <div className="px-4 py-2.5 flex items-start gap-3">
                      <div className="pt-0.5 shrink-0">
                        <Checkbox checked={checked} onChange={() => toggle(r.settlement_id)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{r.settlement_code}</span>
                          {r.finance_checked_at && (
                            <Badge color="success" size="sm">{t('fundBill.checked')}</Badge>
                          )}
                          <span className="flex-1" />
                          <span className="text-sm tabular-nums font-medium shrink-0">
                            {fmtCurrency(r.net_amount)}
                          </span>
                        </div>
                        <div className="text-sm mt-0.5 truncate">
                          {formatEntityCode(r.contract_code)}
                        </div>
                        <div className="text-xs text-subtle mt-0.5">
                          {t('fundBill.checkedAt')}:{' '}
                          <DateTime value={r.finance_checked_at} showTime />
                        </div>
                        <div className="text-xs text-subtle mt-0.5">
                          {t('fundBill.toBranch')} {fmtCurrency(r.total_to_branch)} ·{' '}
                          {t('fundBill.fromBranch')} {fmtCurrency(r.total_from_branch)}
                        </div>
                      </div>
                    </div>
                  );
                }}
                className={`flex-1 min-h-0 panel-datatable ${candidates.isFetching ? 'opacity-60' : ''} transition-opacity`}
                noResults={
                  <div className="p-8 text-center text-subtler">{t('fundBill.candidatesEmpty')}</div>
                }
              />

              <div className="flex-none border-t border-line px-4 py-3 flex items-center gap-3">
                <span className="text-sm text-subtle">{t('fundBill.selectedTotal')}</span>
                <span className="text-base font-semibold tabular-nums">{fmtCurrency(selectedTotal)}</span>
                <span className="flex-1" />
                <Button
                  color="primary"
                  disabled={selected.length === 0}
                  onClick={() => { setView('form'); setError(null); setConfirmOpen(true); }}
                >
                  {t('fundBill.createBill')}
                </Button>
              </div>
            </PageNavPanel>
          </div>

          <Modal
            open={confirmOpen}
            onClose={handleCloseConfirm}
            maxWidth="30rem"
            width="100%"
            ariaLabel={t('fundBill.createBill')}
          >
            <div className="modal-header">
              <h2 className="modal-title">{t('fundBill.createBill')}</h2>
              <button type="button" className="modal-close-btn" onClick={handleCloseConfirm}>&times;</button>
            </div>

            {view === 'form' ? (
              <>
                <div className="modal-content">
                  <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                    <div className="font-medium text-sm">{branchName}</div>
                    <div className="text-xs text-subtle mt-0.5">
                      {t('fundBill.settlementCount', { count: selected.length })} · {fmtCurrency(selectedTotal)}
                    </div>
                  </div>

                  {/* The company's own commission lines are added by the backend
                   *  as the document is built, so the total on screen is not the
                   *  whole document. Say it before the number surprises anyone. */}
                  <div className="mt-3 alert alert-info">
                    <span>{t('fundBill.createAddsCompanyLines')}</span>
                  </div>

                  <div className="form-grid mt-4">
                    <div className="flex flex-col">
                      <label className="form-label">{t('fundBill.note')}</label>
                      <TextArea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        rows={2}
                        placeholder={t('fundBill.notePlaceholder')}
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
                    {t('fundBill.createBill')}
                  </Button>
                </div>
              </>
            ) : result && (
              <ActionDoneView
                headline={t('fundBill.createdHeadline')}
                contractCode={result.bill_code}
                detailRows={[
                  { label: t('fundBill.shop'), value: branchName },
                  { label: t('fundBill.contractsOnDocument'), value: String(result.contract_count) },
                  { label: t('fundBill.netAmount'), value: fmtCurrency(result.net_amount), emphasis: true },
                ]}
                onClose={() => {
                  forceClose();
                  navigate(`/admin/fund-bills/${result.bill_id}`);
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
