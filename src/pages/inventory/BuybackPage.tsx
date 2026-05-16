import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, Button, Modal, TextArea, DataTable, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, RotateCcw, CheckCircle, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { BranchPinInput } from '../../components/BranchPinInput';
import { ActionDoneView } from '../contracts/ActionDoneView';

// ============================================================================
// Types — uses dedicated v_buyback_list / v_buyback_detail views
// (not the generic v_purchase_orders / v_po_lines)
// ============================================================================

interface BuybackListItem {
  id: number; // po_id
  po_no: string;
  code_display: string | null;
  holding_id: number;
  company_id: number;
  company_name: string;
  branch_id: number | null;
  branch_name: string | null;
  status: string;
  supplier_name: string;
  c_total_lines: number;
  c_completed_intakes: number;
  auto_reject_after: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  created_by: number | null;
  created_at: string;
  total_price: number;
  product_summary: {
    brand_name: string | null;
    model_name: string | null;
    item_condition: string | null;
    asset_match_result: string | null;
  } | null;
}

interface BuybackDetailLine {
  po_line_id: number;
  qty: number;
  note: string | null;
  images: unknown[];
  model_id: number;
  sku_code: string;
  unit_cost: number;
  brand_name: string;
  line_total: number;
  model_name: string;
  variant_id: number;
  family_name: string;
  variant_name: string;
  buyback_price: number | null;
  final_asset_id: number | null;
  item_condition: string | null;
  matched_asset_id: number | null;
  asset_match_result: string | null;
  condition_snapshot: Record<string, unknown> | null;
  asset_intake_status: string | null;
  attempted_identifiers_json: { type: string; value: string }[] | null;
}

interface BuybackDetail extends Omit<BuybackListItem, 'id' | 'total_price' | 'product_summary'> {
  po_id: number;
  notes: string | null;
  approved_by: number | null;
  lines: BuybackDetailLine[];
}

interface Branch {
  id: number;
  name: string;
}

// ============================================================================
// Status display
// ============================================================================

const BUYBACK_STATUS_COLOR: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  DRAFT: 'default',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

const BUYBACK_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const ASSET_MATCH_COLOR: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  MATCHED: 'success',
  NO_MATCH: 'warning',
  CONFLICT: 'danger',
};

const INTAKE_STATUS_COLOR: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  PENDING: 'warning',
  COMPLETED: 'success',
  FAILED: 'danger',
};

// ============================================================================
// Component
// ============================================================================

export function BuybackPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();

  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  const navigate = useNavigate();
  const { poId: poIdParam } = useParams<{ poId?: string }>();
  const selectedId = poIdParam ? Number(poIdParam) : null;
  const setSelectedId = (id: number | null) => {
    if (id) navigate(`/admin/inventory/buyback/${id}`, { replace: true });
    else navigate('/admin/inventory/buyback', { replace: true });
  };

  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(defaultBranchId);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  const { data: listData, isFetching } = useQuery({
    queryKey: ['buyback-orders', filterStatus, filterBranchId, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_buyback_list?order=created_at.desc';
      if (filterStatus) url += `&status=eq.${filterStatus}`;
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      return apiClient.getPaginated<BuybackListItem>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;

  const { data: detail, isFetching: detailFetching } = useQuery({
    queryKey: ['buyback-detail', selectedId],
    queryFn: async () => {
      const rows = await apiClient.get<BuybackDetail[]>(`/v_buyback_detail?po_id=eq.${selectedId}&limit=1`);
      return rows[0] ?? null;
    },
    enabled: !!selectedId,
    placeholderData: keepPreviousData,
  });

  useEffect(() => { setPageIndex(0); }, [filterStatus, filterBranchId]);

  const selectedListItem = list.find(o => o.id === selectedId) ?? null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['buyback-orders'] });
    queryClient.invalidateQueries({ queryKey: ['buyback-detail'] });
  };

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={goBack}>
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('nav.buyback') : selectedListItem?.po_no ?? ''}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.buyback')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              <div className="flex-none flex flex-col gap-2 p-2 border-b border-line">
                <div className="flex gap-2 w-full">
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={BUYBACK_STATUS_OPTIONS}
                      value={filterStatus}
                      onChange={(val) => setFilterStatus((val as string) || null)}
                      placeholder={t('buyback.allStatuses')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={branchOptions}
                      value={filterBranchId !== null ? String(filterBranchId) : null}
                      onChange={(val) => setFilterBranchId(val ? Number(val) : null)}
                      placeholder={t('inventory.allBranches')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                </div>
              </div>

              <DataTable<BuybackListItem>
                data={list}
                renderRow={(row) => {
                  const order = row.original;
                  const isSelected = order.id === selectedId;
                  const ps = order.product_summary;
                  const productLine = ps
                    ? [ps.brand_name, ps.model_name].filter(Boolean).join(' ')
                    : null;
                  return (
                    <button
                      key={order.id}
                      className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => { setSelectedId(order.id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-medium text-sm truncate">{order.po_no}</span>
                        </div>
                        <div className="text-xs text-subtle truncate">{order.supplier_name}</div>
                        {productLine && (
                          <div className="text-xs text-subtle truncate mt-0.5">
                            {productLine}{ps?.item_condition ? ` · ${ps.item_condition}` : ''}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1 -ml-0.5">
                          <Badge size="xs" color={BUYBACK_STATUS_COLOR[order.status] ?? 'default'}>
                            {t(`buyback.status_${order.status}`, order.status)}
                          </Badge>
                          {ps?.asset_match_result && (
                            <Badge size="xs" color={ASSET_MATCH_COLOR[ps.asset_match_result] ?? 'default'}>
                              {ps.asset_match_result}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium tabular-nums">{fmtCurrency(order.total_price)}</div>
                        <div className="text-xs text-subtle">
                          <DateTime value={order.created_at} /> ({order.c_total_lines})
                        </div>
                        {order.branch_name && (
                          <div className="text-[11px] text-subtle mt-0.5 truncate">{order.branch_name}</div>
                        )}
                      </div>
                    </button>
                  );
                }}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[10, 15, 20, 30]}
                rowCount={totalCount}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={<div className="p-8 text-center text-subtler">{t('common.noData')}</div>}
              />
            </PageNavPanel>

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 flex flex-col'}>
              {selectedListItem && detail ? (
                <BuybackDetailPanel
                  detail={detail}
                  loading={detailFetching}
                  isMobile={isMobile}
                  t={t}
                  onRefresh={invalidate}
                  addSnackbar={addSnackbar}
                />
              ) : selectedListItem ? (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  <div className="text-center">
                    <RotateCcw size={32} className="mx-auto mb-2 opacity-40" />
                    {t('buyback.selectToView')}
                  </div>
                </div>
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}

// ============================================================================
// Detail panel
// ============================================================================

function BuybackDetailPanel({
  detail,
  loading,
  isMobile,
  t,
  onRefresh,
  addSnackbar,
}: {
  detail: BuybackDetail;
  loading: boolean;
  isMobile: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  onRefresh: () => void;
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const [actionModal, setActionModal] = useState<'submit' | 'revert' | 'approve' | 'reject' | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);

  const lines = detail.lines ?? [];
  const totalPrice = lines.reduce((sum, l) => sum + (l.buyback_price ?? l.unit_cost), 0);

  const canSubmit = detail.status === 'DRAFT';
  const canRevert = detail.status === 'PENDING_APPROVAL';
  const canDecide = detail.status === 'PENDING_APPROVAL';
  const canIntake = detail.status === 'APPROVED';

  return (
    <div className="relative flex flex-col h-full">
      {loading && (
        <div className="absolute inset-0 bg-bg/50 z-10 flex items-center justify-center animate-fade-in">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{detail.po_no}</span>
          <CopyButton value={detail.po_no} />
          <Badge size="xs" color={BUYBACK_STATUS_COLOR[detail.status] ?? 'default'}>
            {t(`buyback.status_${detail.status}`, detail.status)}
          </Badge>
        </div>
      )}

      <div className="flex-none grid grid-cols-3 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs text-subtle">{t('buyback.seller')}</div>
          <div className="font-semibold text-sm truncate">{detail.supplier_name}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('buyback.totalItems')}</div>
          <div className="font-semibold text-sm tabular-nums">{detail.c_total_lines}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('buyback.totalAmount')}</div>
          <div className="font-semibold text-sm tabular-nums">{fmtCurrency(totalPrice)}</div>
        </div>
      </div>

      {/* Timestamps */}
      <div className="flex-none px-4 py-2 border-b border-line flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle">
        <span>{t('buyback.created')}: <DateTime value={detail.created_at} /></span>
        {detail.submitted_at && <span>{t('buyback.submitted')}: <DateTime value={detail.submitted_at} /></span>}
        {detail.approved_at && <span>{t('buyback.approved')}: <DateTime value={detail.approved_at} /></span>}
        {detail.rejected_at && <span>{t('buyback.rejected')}: <DateTime value={detail.rejected_at} /></span>}
      </div>

      {detail.notes && (
        <div className="flex-none px-4 py-2 border-b border-line text-xs text-subtle whitespace-pre-line">
          {detail.notes}
        </div>
      )}

      {/* Lines */}
      <div className="flex-1 overflow-auto better-scroll">
        <div className="px-4 pt-3 pb-1">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
            {t('buyback.items')} ({lines.length})
          </h3>
        </div>
        {lines.length === 0 && !loading && (
          <div className="p-8 text-center text-subtler">{t('common.noData')}</div>
        )}
        {lines.map((line) => (
          <div key={line.po_line_id} className="px-4 py-2.5 border-b border-line flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {[line.brand_name, line.model_name].filter(Boolean).join(' ')}
              </div>
              <div className="text-xs text-subtle truncate">
                {line.variant_name} · {line.sku_code}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {line.item_condition && (
                  <Badge size="xs" color="default">{line.item_condition}</Badge>
                )}
                {line.asset_match_result && (
                  <Badge size="xs" color={ASSET_MATCH_COLOR[line.asset_match_result] ?? 'default'}>
                    {line.asset_match_result}
                  </Badge>
                )}
                {line.asset_intake_status && (
                  <Badge size="xs" color={INTAKE_STATUS_COLOR[line.asset_intake_status] ?? 'default'}>
                    {line.asset_intake_status}
                  </Badge>
                )}
              </div>
              {line.attempted_identifiers_json && line.attempted_identifiers_json.length > 0 && (
                <div className="text-xs text-fg/50 font-mono mt-1 truncate">
                  {line.attempted_identifiers_json.map(id => id.value).join(', ')}
                </div>
              )}
              {line.note && <div className="text-xs text-fg/50 mt-0.5 italic">{line.note}</div>}
            </div>
            <div className="text-right shrink-0">
              {line.buyback_price !== null && (
                <div className="text-sm font-medium tabular-nums">{fmtCurrency(line.buyback_price)}</div>
              )}
              {line.buyback_price !== line.unit_cost && (
                <div className="text-xs text-subtle tabular-nums">cost: {fmtCurrency(line.unit_cost)}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      {(canSubmit || canRevert || canDecide || canIntake) && (
        <div className="flex-none px-4 py-3 border-t border-line flex gap-2">
          {canSubmit && (
            <Button color="primary" className="flex-1" onClick={() => setActionModal('submit')}>
              {t('buyback.submit')}
            </Button>
          )}
          {canRevert && (
            <Button className="flex-1" onClick={() => setActionModal('revert')}>
              {t('buyback.revertDraft')}
            </Button>
          )}
          {canDecide && (
            <>
              <Button color="primary" className="flex-1" onClick={() => setActionModal('approve')}>
                {t('buyback.approve')}
              </Button>
              <Button className="flex-1" onClick={() => setActionModal('reject')}>
                {t('buyback.reject')}
              </Button>
            </>
          )}
          {canIntake && (
            <Button
              color="primary"
              className="flex-1"
              onClick={() => setIntakeOpen(true)}
            >
              {t('buyback.confirmIntake')}
            </Button>
          )}
        </div>
      )}

      <BuybackActionModal
        open={!!actionModal}
        action={actionModal}
        onClose={() => setActionModal(null)}
        detail={detail}
        totalPrice={totalPrice}
        t={t}
        onSuccess={() => {
          const msg = actionModal === 'submit' ? t('buyback.submitSuccess')
            : actionModal === 'approve' ? t('buyback.approveSuccess')
            : actionModal === 'reject' ? t('buyback.rejectSuccess')
            : t('buyback.revertSuccess');
          setActionModal(null);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{msg}</span>
              </div>
            ),
          });
        }}
      />

      <BuybackIntakeModal
        open={intakeOpen}
        onClose={() => { setIntakeOpen(false); onRefresh(); }}
        detail={detail}
      />
    </div>
  );
}

// ============================================================================
// Confirm Intake Modal (PIN + done view)
// ============================================================================

interface BuybackIntakeResult {
  asset_id: number;
  asset_code: string;
  bucket: string;
  match_result: 'NO_MATCH' | 'MATCH_REACQUIRABLE' | string;
  txn_id: number;
}

function BuybackIntakeModal({
  open,
  onClose,
  detail,
}: {
  open: boolean;
  onClose: () => void;
  detail: BuybackDetail;
}) {
  const { t } = useTranslation();
  // BUYBACK is always single-line per the flow spec — take the first line
  const line = detail.lines?.[0] ?? null;
  const [view, setView] = useState<'form' | 'done'>('form');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<BuybackIntakeResult | null>(null);

  useEffect(() => {
    if (open) {
      setView('form');
      setPin('');
      setError('');
      setResult(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!line) throw new Error('No line');
      return apiClient.rpc<BuybackIntakeResult>('fn_inv_buyback_confirm_intake', {
        p_po_line_id: line.po_line_id,
        p_pin: pin,
        p_dedupe_key: `buyback-intake-${line.po_line_id}-${Date.now()}`,
        p_branch_id: null,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setView('done');
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  const canSubmit = !!line && pin.length === 6 && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done'
              ? t('buyback.intakeDoneTitle', { defaultValue: 'Asset taken into stock' })
              : t('buyback.confirmIntake', { defaultValue: 'Confirm intake' })}
          </h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        {view === 'done' && result && (
          <ActionDoneView
            headline={
              result.match_result === 'MATCH_REACQUIRABLE'
                ? t('buyback.intakeDoneReacquired', { defaultValue: 'Asset re-acquired' })
                : t('buyback.intakeDoneNew', { defaultValue: 'Asset registered' })
            }
            contractCode={result.asset_code}
            tone="success"
            detailRows={[
              { label: t('buyback.intakeBucket', { defaultValue: 'Bucket' }), value: result.bucket, emphasis: true },
              {
                label: t('buyback.intakeMatchResult', { defaultValue: 'Match' }),
                value: result.match_result === 'MATCH_REACQUIRABLE'
                  ? t('buyback.intakeMatchReacquired', { defaultValue: 'Re-acquired (was previously ours)' })
                  : t('buyback.intakeMatchNew', { defaultValue: 'New to system' }),
              },
            ]}
            onClose={onClose}
          />
        )}
        {view === 'form' && <>
          <div className="modal-content">
            {error && (
              <div className="alert alert-danger mb-4 animate-pop-in">
                <XCircle size={16} />
                <span>{error}</span>
              </div>
            )}
            {!line ? (
              <div className="alert alert-warning">
                <span>{t('buyback.intakeNoLine', { defaultValue: 'No line to intake.' })}</span>
              </div>
            ) : (
              <>
                <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{detail.po_no}</div>
                  <div className="text-xs text-subtle">
                    {[line.brand_name, line.model_name, line.variant_name].filter(Boolean).join(' · ')}
                  </div>
                  <div className="text-xs text-subtle tabular-nums mt-1">
                    {fmtCurrency(line.buyback_price ?? line.unit_cost)}
                  </div>
                </div>
                <p className="text-sm text-subtle mb-4">
                  {t('buyback.intakeHint', {
                    defaultValue: 'Confirms the buyback, registers the asset into stock at this branch, and locks the buyback record.',
                  })}
                </p>
                <BranchPinInput value={pin} onChange={setPin} required />
              </>
            )}
          </div>
          <div className="modal-footer">
            <Button onClick={onClose} disabled={mutation.isPending}>{t('common.cancel')}</Button>
            <Button
              color="primary"
              onClick={() => mutation.mutate()}
              disabled={!canSubmit}
            >
              {mutation.isPending ? t('common.loading') : t('buyback.confirmIntake', { defaultValue: 'Confirm intake' })}
            </Button>
          </div>
        </>}
      </div>
    </Modal>
  );
}

// ============================================================================
// Action Modal (submit, revert, approve, reject)
// ============================================================================

function BuybackActionModal({
  open,
  action,
  onClose,
  detail,
  totalPrice,
  t,
  onSuccess,
}: {
  open: boolean;
  action: 'submit' | 'revert' | 'approve' | 'reject' | null;
  onClose: () => void;
  detail: BuybackDetail;
  totalPrice: number;
  t: ReturnType<typeof useTranslation>['t'];
  onSuccess: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setNote(''); setError(''); }
  }, [open]);

  const rpcMap: Record<string, string> = {
    submit: 'fn_inv_buyback_submit',
    revert: 'fn_inv_buyback_revert_draft',
    approve: 'fn_inv_buyback_approve',
    reject: 'fn_inv_buyback_reject',
  };

  const titleMap: Record<string, string> = {
    submit: t('buyback.submit'),
    revert: t('buyback.revertDraft'),
    approve: t('buyback.approve'),
    reject: t('buyback.reject'),
  };

  const mutation = useMutation({
    mutationFn: () => {
      if (!action) return Promise.reject(new Error('No action'));
      const params: Record<string, unknown> = { p_po_id: detail.po_id };
      if (action !== 'submit') {
        params.p_note = note || null;
      }
      return apiClient.rpc(rpcMap[action], params);
    },
    onSuccess,
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  if (!action) return null;

  const showNote = action !== 'submit';

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{titleMap[action]}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">{detail.po_no}</div>
            <div className="text-xs text-subtle">{detail.supplier_name}</div>
            <div className="text-xs text-subtle">{detail.c_total_lines} {t('buyback.items')} · {fmtCurrency(totalPrice)}</div>
          </div>
          {showNote && (
            <div className="form-grid gap-4">
              <div className="flex flex-col">
                <label className="form-label">{t('buyback.note')}</label>
                <TextArea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('buyback.notePlaceholder')}
                  rows={3}
                />
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color={action === 'reject' ? undefined : 'primary'}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : titleMap[action]}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
