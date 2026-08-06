import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  PageNav, PageNavPanel, MobileHeader, DataTable,
  Badge, Select, Button, useSnackbarContext,
} from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Package, ExternalLink, ArrowRight, XCircle } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { fmtCurrency } from '../../lib/format';
import { codeDisplay } from './inventoryUtils';
import { SellOutCancelModal, SellOutCommitModal, SellOutEditDraftModal, useSellRequestActions, sellRequestActionsKey } from './SellOutActionModals';
import { SellOutConditionPhotos } from './SellOutPhotos';

// ============================================================================
// Asset-sale ledger (ประวัติการขาย asset) — unified list of every asset sale:
//   • SELL_OUT      — fraud-controlled outright sale (request → approve → commit)
//   • B2B_EXTERNAL  — sale to an EXTERNAL partner branch (atomic, JOURNAL)
// One view (v_asset_sell_requests) drives both; sale_type distinguishes them.
// Auto-scoped by the caller (branch → own branch, company → all branches).
// Spec: UI_SUMMARY/124_ASSET_SELL_OUT_FLOW.md §4, 63_ASSET_SELL_B2B_FLOW.md.
// ============================================================================

type SaleType = 'SELL_OUT' | 'B2B_EXTERNAL';
type SaleStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'COMPLETED'
  | 'REJECTED' | 'CANCELLED' | 'REVERSED';

export interface AssetSaleRow {
  id: number;
  code: string;
  code_display: string;
  status: SaleStatus;
  sale_type: SaleType;
  needs_approval: boolean;
  asset_id: number;
  asset_code: string;
  external_ref: string | null;
  serial_no: string | null;
  condition_grade: string;
  product_name: string;
  origin_bucket: string;
  buyer_branch_id: number | null;
  buyer_branch_name: string | null;
  supplier_name: string | null;
  supplier_ref: string | null;
  counterparty: string | null;
  proposed_price: number;
  cost_basis: number | null;
  catalog_cost: number | null;
  note: string | null;
  bill_id: number | null;
  bill_type: string | null;
  bill_code: string | null;
  bill_status: string | null;
  bill_voided: boolean | null;
  counted_in_daily: boolean;
  requested_by_name: string | null;
  created_at: string;
  approved_by_name: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  reject_note: string | null;
  cancelled_at: string | null;
  cancel_note: string | null;
  completed_at: string | null;
  reversed_at: string | null;
  branch_id: number;
  branch_name: string;
}

// ── status / sale-type presentation ──
const saleStatusColor = (s: SaleStatus): 'warning' | 'info' | 'success' | 'danger' | 'default' => {
  switch (s) {
    case 'DRAFT': return 'default';
    case 'PENDING_APPROVAL': return 'warning';
    case 'APPROVED': return 'info';
    case 'COMPLETED': return 'success';
    case 'REJECTED':
    case 'CANCELLED':
    case 'REVERSED': return 'danger';
    default: return 'default';
  }
};
const saleTypeColor = (s: SaleType): 'primary' | 'secondary' => (s === 'SELL_OUT' ? 'primary' : 'secondary');

export function AssetSalesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const navigate = useNavigate();
  const { saleId: saleIdParam } = useParams<{ saleId?: string }>();
  const selectedId = saleIdParam ? Number(saleIdParam) : null;

  const [saleTypeFilter, setSaleTypeFilter] = useState<SaleType | ''>('');
  const [statusFilter, setStatusFilter] = useState<SaleStatus | ''>('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => { setPageIndex(0); }, [saleTypeFilter, statusFilter]);

  const setSelectedId = (id: number | null) => {
    navigate(id ? `/admin/inventory/asset-sales/${id}` : '/admin/inventory/asset-sales', { replace: true });
  };

  const queryUrl = useMemo(() => {
    const params: string[] = ['order=created_at.desc'];
    if (saleTypeFilter) params.push(`sale_type=eq.${saleTypeFilter}`);
    if (statusFilter) params.push(`status=eq.${statusFilter}`);
    return `/v_asset_sell_requests?${params.join('&')}`;
  }, [saleTypeFilter, statusFilter]);

  const { data, isFetching } = useQuery({
    queryKey: ['asset-sales', saleTypeFilter, statusFilter, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<AssetSaleRow>(queryUrl, { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  // Fallback fetch so a deep-linked id not on the current page still resolves.
  const { data: detailFallback } = useQuery({
    queryKey: ['asset-sale-fallback', selectedId],
    queryFn: () => apiClient.get<AssetSaleRow[]>(`/v_asset_sell_requests?id=eq.${selectedId}`).then(r => r[0] ?? null),
    enabled: !!selectedId && !rows.find(r => r.id === selectedId),
  });
  const selectedRow = rows.find(r => r.id === selectedId) ?? detailFallback ?? null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['asset-sales'] });
    queryClient.invalidateQueries({ queryKey: ['asset-sale-fallback'] });
    queryClient.invalidateQueries({ queryKey: ['asset-sale-detail'] });
  };

  const saleTypeOptions = [
    { value: 'SELL_OUT', label: t('assetSales.type_SELL_OUT') },
    { value: 'B2B_EXTERNAL', label: t('assetSales.type_B2B_EXTERNAL') },
  ];
  const statusOptions: { value: SaleStatus; label: string }[] = [
    { value: 'DRAFT', label: t('assetSales.status_DRAFT') },
    { value: 'PENDING_APPROVAL', label: t('assetSales.status_PENDING_APPROVAL') },
    { value: 'APPROVED', label: t('assetSales.status_APPROVED') },
    { value: 'COMPLETED', label: t('assetSales.status_COMPLETED') },
    { value: 'REJECTED', label: t('assetSales.status_REJECTED') },
    { value: 'CANCELLED', label: t('assetSales.status_CANCELLED') },
    { value: 'REVERSED', label: t('assetSales.status_REVERSED') },
  ];

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => {
        const select = (row: AssetSaleRow) => { setSelectedId(row.id); if (isMobile) goTo('detail'); };

        return (
          <>
            {isMobile && (
              <MobileHeader className="mobile-header-bordered">
                <div className="mobile-header-start">
                  {isRoot ? (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      aria-label="Open menu"
                      onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                    >
                      <ArrowRightFromLine size={18} />
                    </button>
                  ) : (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      onClick={goBack}
                    >
                      <ArrowLeft size={20} />
                    </button>
                  )}
                </div>
                <div className="mobile-header-title mobile-header-title-truncate">
                  {isRoot ? t('assetSales.title') : (selectedRow?.code_display ?? t('assetSales.detail'))}
                </div>
                <div className="mobile-header-end w-12" />
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('assetSales.title')}</h1>
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              {/* ── List rail ── */}
              <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
                <div className="flex-none flex items-center gap-2 p-2 border-b border-line">
                  <div className="flex-1 min-w-0">
                    <Select
                      options={saleTypeOptions}
                      value={saleTypeFilter || null}
                      onChange={(v) => setSaleTypeFilter((v as SaleType) ?? '')}
                      placeholder={t('assetSales.allTypes')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Select
                      options={statusOptions}
                      value={statusFilter || null}
                      onChange={(v) => setStatusFilter((v as SaleStatus) ?? '')}
                      placeholder={t('assetSales.allStatuses')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                </div>

                <DataTable<AssetSaleRow>
                  data={rows}
                  getRowProps={(row) => ({
                    'data-state': row.original.id === selectedId ? 'selected' : undefined,
                  })}
                  renderRow={(row) => {
                    const r = row.original;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className="w-full text-left px-4 py-3 flex flex-col gap-1 transition-colors cursor-pointer"
                        onClick={() => select(r)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium truncate">{r.code_display}</span>
                          <Badge size="xs" color={saleTypeColor(r.sale_type)}>{t(`assetSales.type_${r.sale_type}`)}</Badge>
                          <Badge size="xs" color={saleStatusColor(r.status)}>{t(`assetSales.status_${r.status}`)}</Badge>
                          <span className="ml-auto text-sm font-medium tabular-nums shrink-0">{fmtCurrency(r.proposed_price)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-subtle min-w-0">
                          <span className="truncate">
                            {r.product_name}
                            {r.counterparty ? ` · ${r.counterparty}` : ''}
                          </span>
                          <span className="ml-auto shrink-0"><DateTime value={r.created_at} showTime={false} /></span>
                        </div>
                        {r.bill_voided && (
                          <div className="text-xs text-danger">{t('assetSales.billVoided')}</div>
                        )}
                      </button>
                    );
                  }}
                  enablePagination
                  pageIndex={pageIndex}
                  pageSize={pageSize}
                  pageSizeOptions={[15, 25, 50]}
                  rowCount={totalCount}
                  onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                  className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                  noResults={<div className="p-8 text-center text-subtler">{t('common.noData')}</div>}
                />
              </PageNavPanel>

              {/* ── Detail panel ── */}
              <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
                {selectedRow ? (
                  <AssetSaleDetailPanel
                    row={selectedRow}
                    isMobile={isMobile}
                    onRefresh={refresh}
                    addSnackbar={addSnackbar}
                  />
                ) : (
                  <div className="flex-1 h-full flex items-center justify-center text-subtler">
                    <div className="text-center">
                      <Package size={32} className="mx-auto mb-2 opacity-40" />
                      {t('assetSales.selectToView')}
                    </div>
                  </div>
                )}
              </PageNavPanel>
            </div>
          </>
        );
      }}
    </PageNav>
  );
}

// ============================================================================
// Detail panel — one sale + condition photos + timeline + status actions.
// SELL_OUT actions (branch): cancel (PENDING_APPROVAL / APPROVED), ยืนยันขาย
// (APPROVED → Screen D commit). B2B_EXTERNAL is always COMPLETED — view-only
// here (its cancel lives on the sell flow).
// ============================================================================

function AssetSaleDetailPanel({
  row,
  isMobile,
  onRefresh,
  addSnackbar,
}: {
  row: AssetSaleRow;
  isMobile: boolean;
  onRefresh: () => void;
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const isSellOut = row.sale_type === 'SELL_OUT';

  // Backend-driven button gating — which actions this user can take on this
  // request. Never infer from status; each action carries its own is_available.
  const { can } = useSellRequestActions(isSellOut ? row.id : null);
  const canEdit = can('EDIT');
  const canSubmit = can('SUBMIT');
  const canCancel = can('CANCEL');
  const canCommit = can('COMMIT');
  const canUploadPhoto = can('UPLOAD_PHOTO'); // photos editable while this holds

  // Refresh the ledger AND re-evaluate the action set after any lifecycle change.
  const refreshAll = () => {
    onRefresh();
    queryClient.invalidateQueries({ queryKey: sellRequestActionsKey(row.id) });
  };

  // Submit a resumed DRAFT for approval — locks the asset, freezes photos.
  const submitMutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_asset_sell_request_submit', {
      p_request_id: row.id,
      p_branch_id: row.branch_id,
    }),
    onSuccess: () => {
      refreshAll();
      addSnackbar({ message: <div className="alert alert-success"><span>{t('assetSales.submittedMsg', { defaultValue: 'Submitted for approval' })}</span></div> });
    },
    onError: (err) => setSubmitError(translateApiError(err, t)),
  });

  return (
    <div className="relative flex flex-col h-full min-w-0 overflow-hidden">
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{row.code_display}</span>
          <CopyButton value={row.code_display} />
          <Badge size="xs" color={saleTypeColor(row.sale_type)}>{t(`assetSales.type_${row.sale_type}`)}</Badge>
          <Badge size="xs" color={saleStatusColor(row.status)}>{t(`assetSales.status_${row.status}`)}</Badge>
        </div>
      )}

      <div className="flex-1 overflow-auto better-scroll">
        {/* Price summary band */}
        <div className="grid grid-cols-3 gap-3 px-4 py-3 border-b border-line bg-surface">
          <Field label={t('assetSales.proposedPrice')} value={fmtCurrency(row.proposed_price)} emphasis />
          <Field label={t('assetSales.cost')} value={fmtCurrency(row.cost_basis)} />
          <Field label={t('assetSales.catalog')} value={fmtCurrency(row.catalog_cost)} />
        </div>

        {/* Asset */}
        <section className="px-4 py-2.5 border-b border-line">
          <SectionLabel>{t('assetSales.asset')}</SectionLabel>
          <button
            type="button"
            onClick={() => navigate(`/admin/inventory/assets/${row.asset_id}`)}
            className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
          >
            {codeDisplay(null, row.asset_code)}
            <ExternalLink size={12} />
          </button>
          <div className="text-sm mt-0.5">{row.product_name}</div>
          <div className="text-xs text-subtle mt-0.5">
            {row.serial_no && <>SN: {row.serial_no}</>}
            {row.external_ref && <> · EXT: {row.external_ref}</>}
          </div>
        </section>

        {/* Counterparty */}
        <section className="px-4 py-2.5 border-b border-line">
          <SectionLabel>{t('assetSales.counterparty')}</SectionLabel>
          <div className="text-sm">{row.counterparty ?? '—'}</div>
          {row.supplier_ref && <div className="text-xs text-subtle mt-0.5">{t('assetSales.supplierRef')}: {row.supplier_ref}</div>}
          <div className="text-xs text-subtle mt-0.5">{row.branch_name}</div>
        </section>

        {/* Bill link */}
        {row.bill_id && (
          <section className="px-4 py-2.5 border-b border-line">
            <SectionLabel>{t('assetSales.bill')}</SectionLabel>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate(`/admin/accounting/bills/${row.bill_id}`)}
                className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
              >
                {row.bill_code ?? `#${row.bill_id}`}
                <ExternalLink size={12} />
              </button>
              {row.bill_status && (
                <Badge size="xs" color={row.bill_voided ? 'danger' : 'default'}>{row.bill_status}</Badge>
              )}
              {!row.counted_in_daily && (
                <span className="text-xs text-subtle">{t('assetSales.notInDaily')}</span>
              )}
            </div>
          </section>
        )}

        {/* Note */}
        {row.note && (
          <section className="px-4 py-2.5 border-b border-line">
            <SectionLabel>{t('assetSales.note')}</SectionLabel>
            <div className="text-sm text-subtle whitespace-pre-wrap">{row.note}</div>
          </section>
        )}

        {/* Condition photos — editable (add / QR / remove) only while a SELL_OUT
            request is DRAFT; read-only otherwise (BE freezes on submit). The
            shared component returns null when read-only with no photos → the
            section collapses to empty and `empty:hidden` drops its border. */}
        <section className="px-4 py-2.5 border-b border-line empty:hidden">
          <SellOutConditionPhotos
            requestId={row.id}
            code={row.code_display}
            editable={canUploadPhoto}
            compact
          />
        </section>

        {/* Timeline */}
        <section className="px-4 py-2.5 border-b border-line">
          <SectionLabel>{t('assetSales.timeline')}</SectionLabel>
          <div className="flex flex-col gap-1.5 text-xs">
            <TimelineRow label={t('assetSales.requestedBy')} name={row.requested_by_name} at={row.created_at} />
            {row.approved_at && <TimelineRow label={t('assetSales.approvedBy')} name={row.approved_by_name} at={row.approved_at} />}
            {row.rejected_at && <TimelineRow label={t('assetSales.rejected')} name={null} at={row.rejected_at} note={row.reject_note} />}
            {row.cancelled_at && <TimelineRow label={t('assetSales.cancelled')} name={null} at={row.cancelled_at} note={row.cancel_note} />}
            {row.completed_at && <TimelineRow label={t('assetSales.completed')} name={null} at={row.completed_at} />}
            {row.reversed_at && <TimelineRow label={t('assetSales.reversed')} name={null} at={row.reversed_at} />}
          </div>
        </section>
      </div>

      {/* Actions — driven off the evaluator (can(...)), not status. */}
      {(canEdit || canSubmit || canCommit || canCancel) && (
        <div className="flex-none border-t border-line px-4 py-3 flex flex-col gap-2">
          {canSubmit && (
            <div className="alert alert-info">
              <span>{t('sellOut.draftHint', { defaultValue: 'Attach condition photos, then submit for approval. The device is not locked until you submit.' })}</span>
            </div>
          )}
          {submitError && (
            <div className="alert alert-danger">
              <XCircle size={16} />
              <span>{submitError}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            {canSubmit && (
              <Button
                color="primary"
                size="sm"
                onClick={() => { setSubmitError(''); submitMutation.mutate(); }}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? t('common.loading') : t('sellOut.submitForApproval', { defaultValue: 'Submit for approval' })}
              </Button>
            )}
            {canCommit && (
              <Button color="primary" size="sm" onClick={() => setCommitOpen(true)}>
                {t('assetSales.confirmSale')}
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                {t('assetSales.editDraft', { defaultValue: 'Edit draft' })}
              </Button>
            )}
            {canCancel && (
              <Button variant="outline" color="danger" size="sm" onClick={() => setCancelOpen(true)}>
                {canEdit ? t('sellOut.cancelDraft', { defaultValue: 'Discard draft' }) : t('assetSales.cancelRequest')}
              </Button>
            )}
          </div>
        </div>
      )}

      <SellOutEditDraftModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        requestId={row.id}
        code={row.code_display}
        branchId={row.branch_id}
        initial={{
          proposed_price: row.proposed_price,
          note: row.note,
          supplier_name: row.supplier_name,
          supplier_ref: row.supplier_ref,
        }}
        suggestedPrice={row.cost_basis ?? row.catalog_cost ?? null}
        onSaved={() => { setEditOpen(false); refreshAll(); }}
      />

      <SellOutCancelModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        requestId={row.id}
        code={row.code_display}
        branchId={row.branch_id}
        onCancelled={() => {
          setCancelOpen(false);
          refreshAll();
          addSnackbar({ message: <div className="alert alert-success"><span>{t('assetSales.cancelledMsg')}</span></div> });
        }}
      />

      <SellOutCommitModal
        open={commitOpen}
        onClose={() => setCommitOpen(false)}
        requestId={row.id}
        code={row.code_display}
        branchId={row.branch_id}
        approvedPrice={row.proposed_price}
        onCommitted={() => {
          // Refresh the ledger behind the modal only — the modal stays open on
          // its success step (bill code + Download/Print) until the user closes it.
          refreshAll();
        }}
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1.5">{children}</div>;
}

function Field({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <div className="text-xs text-subtle">{label}</div>
      <div className={`tabular-nums ${emphasis ? 'text-sm font-semibold' : 'text-sm'}`}>{value}</div>
    </div>
  );
}

function TimelineRow({ label, name, at, note }: { label: string; name?: string | null; at: string; note?: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <ArrowRight size={12} className="text-subtle mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-subtle">{label}{name ? ` · ${name}` : ''}</span>
          <DateTime value={at} className="text-right shrink-0" />
        </div>
        {note && <div className="text-subtler italic mt-0.5">{note}</div>}
      </div>
    </div>
  );
}
