import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, Input, Button, Modal, TextArea, DataTable, PopOver, Tooltip, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, RotateCcw, CheckCircle, XCircle, AlertTriangle, ImageOff, ChevronDown, Pencil } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { fmtCurrency } from '../../lib/format';
import { codeDisplay } from './inventoryUtils';
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
  is_auto_rejected: boolean;
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

// fn_buyback_available_actions response (mig 114, 2026-05-27).
interface BuybackAction {
  action_code: string;
  rpc_name: string;
  category: string;
  is_available: boolean;
  blocking_reason: string | null;
  require_pin: boolean;
  sort_order: number;
  target_line_id: number | null;
}
interface BuybackActionsResponse {
  po_id: number;
  po_type: string;
  status: string;
  branch_id: number | null;
  auto_reject_after: string | null;
  auto_rejected: boolean;
  validate_ready: boolean | null;
  validate_failing_checks: string[];
  actions: BuybackAction[];
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

const BUYBACK_STATUS_VALUES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'] as const;

// Backend codes from v_ref_asset_match_results:
//   NO_MATCH / MATCH_REACQUIRABLE / MATCH_CONFLICT
const ASSET_MATCH_COLOR: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  NO_MATCH: 'default',
  MATCH_REACQUIRABLE: 'info',
  MATCH_CONFLICT: 'danger',
};


interface BuybackReason {
  id: number;
  code: string;
  label: string;
  reason_group: 'REJECT' | 'CANCEL';
  is_active: boolean;
}

const INTAKE_STATUS_COLOR: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  PENDING: 'warning',
  COMPLETED: 'success',
  FAILED: 'danger',
};

// Per-action color when used as a quick primary. Reject is danger; everything
// else is the default primary blue (or neutral if not a primary).
const PRIMARY_COLOR: Record<string, 'primary' | 'danger'> = {
  BUYBACK_SUBMIT: 'primary',
  BUYBACK_APPROVE: 'primary',
  BUYBACK_REJECT: 'danger',
  BUYBACK_CONFIRM_INTAKE: 'primary',
  BUYBACK_REVERT_DRAFT: 'primary',
};

// Section grouping in the More menu (option B: Edit / Lifecycle / System).
// Override the backend's `category` for VALIDATE which arrives as LIFECYCLE
// but reads better under its own "System" header since it's an FE-driven check.
const CATEGORY_OVERRIDE: Record<string, string> = {
  BUYBACK_VALIDATE: 'SYSTEM',
};
const CATEGORY_ORDER = ['EDIT', 'LIFECYCLE', 'SYSTEM'];

interface ActionHandlers {
  primary: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  onSubmit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRevert: () => void;
  onIntake: () => void;
  validateFailingChecks: string[];
}

function renderBuybackActionButton(a: BuybackAction, h: ActionHandlers): React.ReactNode {
  const label = h.t(`buybackAction.${a.action_code}`, { defaultValue: a.action_code });
  const onClick: Record<string, () => void> = {
    BUYBACK_SUBMIT: h.onSubmit,
    BUYBACK_APPROVE: h.onApprove,
    BUYBACK_REJECT: h.onReject,
    BUYBACK_REVERT_DRAFT: h.onRevert,
    BUYBACK_CONFIRM_INTAKE: h.onIntake,
  };
  const handler = onClick[a.action_code];
  // UPDATE_LINE / VALIDATE are catalog entries the FE doesn't open a modal for.
  // Render them disabled with a wrench-style hint, like AssetsPage does for
  // not-yet-wired actions.
  const wired = !!handler;

  const lines: React.ReactNode[] = [<div key="l" className="font-medium">{label}</div>];
  if (!wired) {
    lines.push(
      <div key="nw" className="text-xs opacity-90">
        {h.t('buyback.actionNotWired', { defaultValue: 'Not a user button — runs automatically' })}
      </div>,
    );
  }
  if (!a.is_available && a.blocking_reason) {
    let reason: string;
    if (a.blocking_reason === 'validate_failed' && h.validateFailingChecks.length > 0) {
      reason = h.t('buyback.submitNotReady', {
        defaultValue: 'Not ready: {{checks}}',
        checks: h.validateFailingChecks.join(', '),
      });
    } else {
      reason = h.t(`buyback.blocking.${a.blocking_reason}`, {
        defaultValue: a.blocking_reason,
      });
    }
    lines.push(<div key="r" className="text-xs opacity-90">{reason}</div>);
  }

  const color = h.primary && a.is_available && wired ? PRIMARY_COLOR[a.action_code] : undefined;

  return (
    <Tooltip
      key={a.action_code}
      content={lines.length === 1 ? lines[0] : <div className="flex flex-col gap-0.5">{lines}</div>}
      placement="top"
    >
      <Button
        size="sm"
        variant={h.primary ? undefined : 'outline'}
        color={color}
        disabled={!a.is_available || !wired}
        onClick={handler}
      >
        {label}
      </Button>
    </Tooltip>
  );
}

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
    queryClient.invalidateQueries({ queryKey: ['buyback-actions'] });
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
                {isRoot ? t('nav.buyback') : codeDisplay(selectedListItem?.code_display, selectedListItem?.po_no)}
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
                      options={branchOptions}
                      value={filterBranchId !== null ? String(filterBranchId) : null}
                      onChange={(val) => setFilterBranchId(val ? Number(val) : null)}
                      placeholder={t('inventory.allBranches')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={BUYBACK_STATUS_VALUES.map((v) => ({ value: v, label: t(`buyback.status_${v}`) }))}
                      value={filterStatus}
                      onChange={(val) => setFilterStatus((val as string) || null)}
                      placeholder={t('buyback.allStatuses')}
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
                        isSelected ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => { setSelectedId(order.id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-medium text-sm truncate">{codeDisplay(order.code_display, order.po_no)}</span>
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
                          {order.is_auto_rejected && (
                            <Badge size="xs" color="danger">
                              {t('buyback.autoRejected', { defaultValue: 'Auto-rejected' })}
                            </Badge>
                          )}
                          {ps?.asset_match_result && (
                            <Badge size="xs" color={ASSET_MATCH_COLOR[ps.asset_match_result] ?? 'default'}>
                              {t(`buyback.assetMatch.${ps.asset_match_result}`, { defaultValue: ps.asset_match_result })}
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

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
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
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  const lines = detail.lines ?? [];
  const totalPrice = lines.reduce((sum, l) => sum + (l.buyback_price ?? l.unit_cost), 0);

  // Backend-driven action catalog (mig 114, 2026-05-27). Pattern mirrors
  // AssetsPage: show every action returned, primaries as quick buttons,
  // everything else in More. Disabled buttons get a tooltip with the reason.
  const { data: actionsResp } = useQuery({
    queryKey: ['buyback-actions', detail.po_id],
    queryFn: () => apiClient.rpc<BuybackActionsResponse>('fn_buyback_available_actions', {
      p_po_id: detail.po_id,
    }),
    staleTime: 30 * 1000,
  });

  // All actions in catalog order, then sort_order. We do NOT filter
  // permission_denied — disabled-with-tooltip is the convention.
  const allActions = (actionsResp?.actions ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  // Per-status primaries — the obvious quick buttons. Everything else goes in More.
  const PRIMARY_BY_STATUS: Record<string, string[]> = {
    DRAFT:            ['BUYBACK_SUBMIT'],
    PENDING_APPROVAL: ['BUYBACK_APPROVE', 'BUYBACK_REJECT'],
    APPROVED:         ['BUYBACK_CONFIRM_INTAKE'],
    REJECTED:         ['BUYBACK_REVERT_DRAFT'],
  };
  const primaryCodes = PRIMARY_BY_STATUS[detail.status] ?? [];
  const primarySet = new Set(primaryCodes);
  const primaryActions = primaryCodes
    .map(c => allActions.find(a => a.action_code === c))
    .filter((a): a is BuybackAction => !!a);
  const secondaryActions = allActions.filter(a => !primarySet.has(a.action_code));

  const intakeAction = allActions.find(a => a.action_code === 'BUYBACK_CONFIRM_INTAKE');

  // Group secondaries by category (with override) → Edit / Lifecycle / System.
  const groupedSecondary = secondaryActions.reduce<Record<string, BuybackAction[]>>((acc, a) => {
    const cat = CATEGORY_OVERRIDE[a.action_code] ?? a.category;
    (acc[cat] ||= []).push(a);
    return acc;
  }, {});
  const sortedCategories = Object.keys(groupedSecondary).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return (
    <div className="relative flex flex-col h-full min-w-0 overflow-hidden">
      {loading && (
        <div className="absolute inset-0 bg-bg/50 z-10 flex items-center justify-center animate-fade-in">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{codeDisplay(detail.code_display, detail.po_no)}</span>
          <CopyButton value={codeDisplay(detail.code_display, detail.po_no)} />
          <Badge size="xs" color={BUYBACK_STATUS_COLOR[detail.status] ?? 'default'}>
            {t(`buyback.status_${detail.status}`, detail.status)}
          </Badge>
          {detail.is_auto_rejected && (
            <Badge size="xs" color="danger">
              {t('buyback.autoRejected', { defaultValue: 'Auto-rejected' })}
            </Badge>
          )}
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

      {/* Auto-reject countdown */}
      {detail.status === 'PENDING_APPROVAL' && detail.auto_reject_after && (
        <div className="flex-none px-4 py-2 border-b border-line flex items-center gap-2 text-xs">
          <AlertTriangle size={14} className="text-warning shrink-0" />
          <span className="text-warning">
            {t('buyback.autoRejectAt', { defaultValue: 'Auto-rejects' })}: <DateTime value={detail.auto_reject_after} showTime />
          </span>
        </div>
      )}

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
          <div key={line.po_line_id} className="px-4 py-2.5 border-b border-line flex flex-col gap-2">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {[line.brand_name, line.model_name].filter(Boolean).join(' ')}
                </div>
                <div className="text-xs text-subtle truncate">
                  {line.variant_name} · {line.sku_code}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {line.item_condition && (
                    <Badge size="xs" color="default">
                      {t(`buyback.grade.${line.item_condition}`, { defaultValue: line.item_condition })}
                    </Badge>
                  )}
                  {line.asset_match_result && (
                    <Badge size="xs" color={ASSET_MATCH_COLOR[line.asset_match_result] ?? 'default'}>
                      {t(`buyback.assetMatch.${line.asset_match_result}`, { defaultValue: line.asset_match_result })}
                    </Badge>
                  )}
                  {line.asset_intake_status && (
                    <Badge size="xs" color={INTAKE_STATUS_COLOR[line.asset_intake_status] ?? 'default'}>
                      {t(`buyback.intake.${line.asset_intake_status}`, { defaultValue: line.asset_intake_status })}
                    </Badge>
                  )}
                </div>
                {line.attempted_identifiers_json && line.attempted_identifiers_json.length > 0 && (
                  <div className="text-xs text-fg/50 font-mono mt-1 truncate">
                    {line.attempted_identifiers_json.map(id => `${id.type}: ${id.value}`).join(' · ')}
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

            {/* Condition snapshot */}
            {line.condition_snapshot && Object.keys(line.condition_snapshot).length > 0 && (
              <div className="rounded-md bg-surface border border-line px-3 py-2">
                <div className="text-xs text-subtle mb-1">{t('buyback.conditionSnapshot', { defaultValue: 'Condition' })}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {Object.entries(line.condition_snapshot).map(([k, v]) => {
                    const label = t(`buyback.field.${k}`, { defaultValue: k });
                    const rawValue = v == null ? '' : String(v);
                    let display: string;
                    if (rawValue === '') {
                      display = '—';
                    } else if (/^\d+$/.test(rawValue)) {
                      // Numeric: battery health is a 1–100 percentage; suffix it.
                      const n = parseInt(rawValue, 10);
                      display = k === 'BATTERY_HEALTH' && n >= 1 && n <= 100 ? `${rawValue}%` : rawValue;
                    } else {
                      display = t(`buyback.condition.${rawValue}`, { defaultValue: rawValue });
                    }
                    return (
                      <div key={k} className="flex gap-1 min-w-0">
                        <span className="text-subtle truncate">{label}:</span>
                        <span className="font-medium truncate">{display}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Photos */}
            {Array.isArray(line.images) && line.images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(line.images as Array<{ url?: string; label?: string }>).map((img, i) => (
                  img?.url ? (
                    <a
                      key={i}
                      href={img.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-20 h-20 rounded-md border border-line overflow-hidden bg-surface hover:opacity-80"
                      title={img.label ?? ''}
                    >
                      <img src={img.url} alt={img.label ?? `photo ${i + 1}`} className="w-full h-full object-cover" />
                    </a>
                  ) : (
                    <div key={i} className="w-20 h-20 rounded-md border border-line flex items-center justify-center bg-surface text-subtle">
                      <ImageOff size={20} />
                    </div>
                  )
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Action buttons — backend-driven (mig 114). Show every action in the
          catalog: primaries as quick buttons, the rest in More. Disabled
          buttons get a tooltip with the blocking reason. */}
      {allActions.length > 0 && (
        <div className="flex-none px-4 py-3 border-t border-line flex flex-wrap gap-2">
          {/* DRAFT only — extra non-RPC affordance to resume editing in the wizard. */}
          {detail.status === 'DRAFT' && (
            <Button
              size="sm"
              variant="outline"
              startIcon={<Pencil size={14} />}
              onClick={() => navigate(`/admin/inventory/buyback/new/${detail.po_id}`)}
            >
              {t('buyback.continueDraft', { defaultValue: 'Continue draft' })}
            </Button>
          )}

          {primaryActions.map(a => renderBuybackActionButton(a, {
            primary: true,
            t,
            onSubmit: () => setActionModal('submit'),
            onApprove: () => setActionModal('approve'),
            onReject: () => setActionModal('reject'),
            onRevert: () => setActionModal('revert'),
            onIntake: () => setIntakeOpen(true),
            validateFailingChecks: actionsResp?.validate_failing_checks ?? [],
          }))}

          {secondaryActions.length > 0 && (
            <>
              <Button
                ref={moreTriggerRef}
                size="sm"
                variant="outline"
                endIcon={<ChevronDown size={14} />}
                onClick={() => setMoreOpen(v => !v)}
              >
                {t('contract.moreActions', { defaultValue: 'More' })}
              </Button>
              <PopOver
                isOpen={moreOpen}
                onClose={() => setMoreOpen(false)}
                triggerRef={moreTriggerRef}
                placement="top"
                align="end"
                maxWidth="28rem"
              >
                <div className="flex flex-col gap-3 p-3">
                  {sortedCategories.map(cat => {
                    const items = groupedSecondary[cat];
                    if (!items?.length) return null;
                    return (
                      <div key={cat} className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                          {t(`buyback.category.${cat}`, { defaultValue: cat })}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {items.map(a => (
                            <div key={a.action_code} onClick={() => setMoreOpen(false)}>
                              {renderBuybackActionButton(a, {
                                primary: false,
                                t,
                                onSubmit: () => setActionModal('submit'),
                                onApprove: () => setActionModal('approve'),
                                onReject: () => setActionModal('reject'),
                                onRevert: () => setActionModal('revert'),
                                onIntake: () => setIntakeOpen(true),
                                validateFailingChecks: actionsResp?.validate_failing_checks ?? [],
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </PopOver>
            </>
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
        targetLineId={intakeAction?.target_line_id ?? null}
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
  targetLineId,
}: {
  open: boolean;
  onClose: () => void;
  detail: BuybackDetail;
  targetLineId: number | null;
}) {
  const { t } = useTranslation();
  // Prefer the backend-resolved target line; fall back to lines[0] (buybacks
  // are SINGLE_ITEM so they coincide, but target_line_id is the authoritative
  // pick from fn_buyback_available_actions).
  const line = (targetLineId != null
    ? detail.lines?.find(l => l.po_line_id === targetLineId)
    : detail.lines?.[0]) ?? null;
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
                  <div className="font-medium text-sm">{codeDisplay(detail.code_display, detail.po_no)}</div>
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
  const line = detail.lines?.[0] ?? null;
  const [note, setNote] = useState('');
  const [imei, setImei] = useState('');
  const [serial, setSerial] = useState('');
  const [reasonId, setReasonId] = useState<number | null>(null);
  const [error, setError] = useState('');

  // Lazy-load reject reasons only when the reject modal opens
  const { data: rejectReasons = [] } = useQuery({
    queryKey: ['buyback-reject-reasons'],
    queryFn: () => apiClient.get<BuybackReason[]>(
      '/v_ref_buyback_reasons?reason_group=eq.REJECT&is_active=is.true',
    ),
    enabled: open && action === 'reject',
    staleTime: 30 * 60 * 1000,
  });

  useEffect(() => {
    if (open) {
      setNote('');
      setError('');
      setReasonId(null);
      // Pre-fill any previously attempted identifiers so re-submit isn't a re-type
      const existing = line?.attempted_identifiers_json ?? [];
      setImei(existing.find(i => i.type === 'IMEI')?.value ?? '');
      setSerial(existing.find(i => i.type === 'SERIAL_NO')?.value ?? '');
    }
  }, [open, action, line]);

  const titleMap: Record<string, string> = {
    submit: t('buyback.submit'),
    revert: t('buyback.revertDraft'),
    approve: t('buyback.approve'),
    reject: t('buyback.reject'),
  };

  const mutation = useMutation({
    mutationFn: () => {
      if (!action) return Promise.reject(new Error('No action'));
      if (action === 'submit') {
        if (!line) return Promise.reject(new Error('No line'));
        const identifiers: { type: string; value: string }[] = [];
        if (imei.trim()) identifiers.push({ type: 'IMEI', value: imei.trim() });
        if (serial.trim()) identifiers.push({ type: 'SERIAL_NO', value: serial.trim() });
        return apiClient.rpc('fn_inv_buyback_submit', {
          p_po_id: detail.po_id,
          p_identifiers: [{ line_id: line.po_line_id, identifiers }],
          p_branch_id: null,
        });
      }
      if (action === 'reject') {
        return apiClient.rpc('fn_inv_buyback_reject', {
          p_po_id: detail.po_id,
          p_reason_id: reasonId,
          p_note: note.trim() || null,
        });
      }
      if (action === 'approve') {
        return apiClient.rpc('fn_inv_buyback_approve', {
          p_po_id: detail.po_id,
          p_note: note.trim() || null,
        });
      }
      // revert
      return apiClient.rpc('fn_inv_buyback_revert_draft', {
        p_po_id: detail.po_id,
        p_note: note.trim() || null,
        p_branch_id: null,
      });
    },
    onSuccess,
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

  if (!action) return null;

  const isSubmit = action === 'submit';
  const isReject = action === 'reject';
  // Submit requires at least one identifier (Serial is always allowed; IMEI when applicable).
  const submitValid = !isSubmit || imei.trim().length > 0 || serial.trim().length > 0;
  const rejectValid = !isReject || reasonId !== null;
  const canSubmit = submitValid && rejectValid && !mutation.isPending;

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
            <div className="font-medium text-sm">{codeDisplay(detail.code_display, detail.po_no)}</div>
            <div className="text-xs text-subtle">{detail.supplier_name}</div>
            <div className="text-xs text-subtle">{detail.c_total_lines} {t('buyback.items')} · {fmtCurrency(totalPrice)}</div>
          </div>

          <div className="form-grid gap-4">
            {isSubmit && (
              <>
                <div className="alert alert-info">
                  <span>{t('buyback.submitIdentifierHint', { defaultValue: 'Scan IMEI / Serial. At least one is required. Backend will reject duplicates or invalid IMEI checksums.' })}</span>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">IMEI</label>
                  <Input
                    value={imei}
                    onChange={(e) => setImei(e.target.value)}
                    placeholder={t('buyback.imeiPlaceholder', { defaultValue: '15-digit IMEI (optional)' })}
                    className="w-full"
                    autoFocus
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">Serial No.</label>
                  <Input
                    value={serial}
                    onChange={(e) => setSerial(e.target.value)}
                    placeholder={t('buyback.serialPlaceholder', { defaultValue: 'Serial number (optional)' })}
                    className="w-full"
                  />
                </div>
              </>
            )}

            {isReject && (
              <div className="flex flex-col">
                <label className="form-label">{t('buyback.rejectReason', { defaultValue: 'Reject reason' })} *</label>
                <Select
                  options={rejectReasons.map(r => ({ value: String(r.id), label: r.label }))}
                  value={reasonId !== null ? String(reasonId) : null}
                  onChange={(val) => setReasonId(val ? Number(val) : null)}
                  placeholder={t('buyback.selectReason', { defaultValue: 'Select reason' })}
                  showChevron
                />
              </div>
            )}

            {!isSubmit && (
              <div className="flex flex-col">
                <label className="form-label">{t('buyback.note')}</label>
                <TextArea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('buyback.notePlaceholder')}
                  rows={3}
                />
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose} disabled={mutation.isPending}>{t('common.cancel')}</Button>
          <Button
            color={isReject ? 'danger' : 'primary'}
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
          >
            {mutation.isPending ? t('common.loading') : titleMap[action]}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
