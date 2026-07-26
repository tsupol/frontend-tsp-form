import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, Input, Button, Modal, TextArea, DataTable, PopOver, Tooltip, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, RotateCcw, CheckCircle, XCircle, AlertTriangle, ImageOff, ChevronDown, Pencil, Search, SlidersHorizontal } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { fmtCurrency } from '../../lib/format';
import { codeDisplay } from './inventoryUtils';
import { useAuth } from '../../contexts/AuthContext';
import { BranchPinInput } from '../../components/BranchPinInput';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { normalizeKey } from '../../lib/mediaPath';
import { MediaLightbox } from '../../components/MediaLightbox';
import { ImeiInput } from '../../components/ImeiInput';
import { OwnerBadge } from '../../components/OwnerBadge';
import type { OwnerType } from '../../lib/ownerTypes';

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
  owner_type: OwnerType | null;
  owner_id: number | null;
  owner_name: string | null;
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
    variant_name: string | null;
    product_display_name: string | null;
    item_condition: string | null;
    asset_match_result: string | null;
  } | null;
}

// Condition photos (entity_media PO_LINE / BUYBACK_CONDITION) as server-rendered
// on v_buyback_detail.lines[].condition_photos. Private — paths resolve via
// presigned URL. Replaces the dropped legacy `images` jsonb (mig 103).
interface ConditionPhoto {
  media_id: number;
  sort_order: number;
  usage_type: string;
  access_level: string;
  paths: { original?: string; sm?: string; md?: string; lg?: string } | null;
}

interface BuybackDetailLine {
  po_line_id: number;
  qty: number;
  note: string | null;
  model_id: number;
  sku_code: string;
  unit_cost: number;
  brand_name: string;
  line_total: number;
  model_name: string;
  variant_id: number;
  family_name: string;
  variant_name: string;
  product_display_name: string | null;
  buyback_price: number | null;
  final_asset_id: number | null;
  item_condition: string | null;
  matched_asset_id: number | null;
  asset_match_result: string | null;
  condition_snapshot: Record<string, unknown> | null;
  condition_photos: ConditionPhoto[] | null;
  warranty_expired_date: string | null;
  asset_intake_status: string | null;
  attempted_identifiers_json: { type: string; value: string }[] | null;
}

export interface BuybackDetail extends Omit<BuybackListItem, 'id' | 'total_price' | 'product_summary'> {
  po_id: number;
  notes: string | null;
  approved_by: number | null;
  // Reason readback (codes-only; UI translates). Null until rejected/cancelled.
  rejected_by: number | null;
  rejection_reason_code: string | null;
  cancelled_by: number | null;
  cancel_reason_code: string | null;
  lines: BuybackDetailLine[];
}

interface Branch {
  id: number;
  name: string;
}

// fn_buyback_available_actions — contract_version: 2 (2026-06-26).
// Two-flag contract: render IFF is_permitted, disable IFF NOT is_enabled.
interface BuybackAction {
  action_code: string;
  rpc_name: string;
  category: string;
  is_permitted: boolean;
  is_enabled: boolean;
  is_available: boolean; // deprecated alias (= is_enabled) this release
  blocking_reason: string | null;
  needs_reason: boolean;
  reason_group: 'CANCEL' | 'REJECT' | null;
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
  contract_version: number;
  validate_ready: boolean | null;
  validate_failing_checks: string[] | null;
  actions: BuybackAction[];
}

// Modal-driven actions (those that open a form/confirm). Catalog actions
// without a modal (edit/validate) are rendered disabled-with-hint.
type BuybackActionKind = 'submit' | 'revert' | 'approve' | 'reject' | 'cancel' | 'cancelApproved';

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
  label: string; // Thai debug label — UI translates `code`, does not echo this
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
  BUYBACK_CANCEL: 'danger',
  BUYBACK_CANCEL_APPROVED: 'danger',
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
  onCancel: () => void;
  onCancelApproved: () => void;
  onUpdateNote: () => void;
  validateFailingChecks: string[];
}

// Render IFF is_permitted (callers already filter on this); disable IFF NOT
// is_enabled; show blocking_reason as a tooltip when disabled.
function renderBuybackActionButton(a: BuybackAction, h: ActionHandlers): React.ReactNode {
  const label = h.t(`buybackAction.${a.action_code}`, { defaultValue: a.action_code });
  const onClick: Record<string, () => void> = {
    BUYBACK_SUBMIT: h.onSubmit,
    BUYBACK_APPROVE: h.onApprove,
    BUYBACK_REJECT: h.onReject,
    BUYBACK_REVERT_DRAFT: h.onRevert,
    BUYBACK_CONFIRM_INTAKE: h.onIntake,
    BUYBACK_CANCEL: h.onCancel,
    BUYBACK_CANCEL_APPROVED: h.onCancelApproved,
    BUYBACK_UPDATE_NOTE: h.onUpdateNote,
  };
  const handler = onClick[a.action_code];
  // UPDATE_*/VALIDATE are catalog entries the FE doesn't open a modal for.
  // Render them disabled with a hint, like AssetsPage does for not-yet-wired
  // actions.
  const wired = !!handler;

  const lines: React.ReactNode[] = [<div key="l" className="font-medium">{label}</div>];
  if (!wired) {
    lines.push(
      <div key="nw" className="text-xs opacity-90">
        {h.t('buyback.actionNotWired', { defaultValue: 'Not a user button — runs automatically' })}
      </div>,
    );
  }
  if (!a.is_enabled && a.blocking_reason) {
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

  const color = h.primary && a.is_enabled && wired ? PRIMARY_COLOR[a.action_code] : undefined;

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
        disabled={!a.is_enabled || !wired}
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
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  const extraFilterCount = (filterStatus ? 1 : 0) + (filterBranchId !== null ? 1 : 0);

  useEffect(() => {
    const tm = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(tm);
  }, [search]);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  const { data: listData, isFetching } = useQuery({
    queryKey: ['buyback-orders', filterStatus, filterBranchId, debouncedSearch, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_buyback_list?order=created_at.desc';
      if (filterStatus) url += `&status=eq.${filterStatus}`;
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (debouncedSearch) {
        const term = encodeURIComponent(debouncedSearch);
        url += `&or=(po_no.ilike.*${term}*,supplier_name.ilike.*${term}*)`;
      }
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

  useEffect(() => { setPageIndex(0); }, [filterStatus, filterBranchId, debouncedSearch]);

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
              <div className="flex-none p-2 border-b border-line">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('common.search')}
                      size="sm"
                      startIcon={<Search size={16} />}
                      className="w-full"
                    />
                  </div>
                  <div className="shrink-0">
                    <PopOver
                      isOpen={filterOpen}
                      onClose={() => setFilterOpen(false)}
                      placement="bottom"
                      align="end"
                      maxWidth="300px"
                      trigger={
                        <div className="relative inline-flex">
                          <Button
                            variant="outline"
                            size="sm"
                            startIcon={<SlidersHorizontal size={16} />}
                            onClick={() => setFilterOpen(!filterOpen)}
                          />
                          {extraFilterCount > 0 && (
                            <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none pointer-events-none">
                              {extraFilterCount}
                            </span>
                          )}
                        </div>
                      }
                    >
                      <div className="flex flex-col gap-3 p-3">
                        <div className="text-xs font-medium text-subtle uppercase tracking-wide">{t('common.filters')}</div>
                        <Select
                          options={BUYBACK_STATUS_VALUES.map((v) => ({ value: v, label: t(`buyback.status_${v}`) }))}
                          value={filterStatus}
                          onChange={(val) => setFilterStatus((val as string) || null)}
                          placeholder={t('buyback.allStatuses')}
                          size="sm"
                          showChevron
                          clearable
                        />
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
                    </PopOver>
                  </div>
                </div>
              </div>

              <DataTable<BuybackListItem>
                data={list}
                getRowProps={(row) => ({
                  'data-state': row.original.id === selectedId ? 'selected' : undefined,
                })}
                renderRow={(row) => {
                  const order = row.original;
                  const ps = order.product_summary;
                  const productLine = ps
                    ? ps.product_display_name ?? [ps.brand_name, ps.model_name].filter(Boolean).join(' ')
                    : null;
                  return (
                    <button
                      key={order.id}
                      className="w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors cursor-pointer"
                      onClick={() => { setSelectedId(order.id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-medium text-xs truncate">{codeDisplay(order.code_display, order.po_no)}</span>
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
                          <OwnerBadge size="xs" ownerType={order.owner_type} ownerName={order.owner_name} />
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

export function BuybackDetailPanel({
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
  const [actionModal, setActionModal] = useState<BuybackActionKind | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [noteEditOpen, setNoteEditOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
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

  // Two-flag contract: render IFF is_permitted (hide actions that aren't this
  // role's — e.g. branch never sees Approve/Reject). Among permitted, keep
  // disabled-with-tooltip for the not-right-now ones. Catalog order, then sort.
  const allActions = (actionsResp?.actions ?? [])
    .filter(a => a.is_permitted)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  // Per-status primaries — the obvious quick buttons. Everything else goes in More.
  const PRIMARY_BY_STATUS: Record<string, string[]> = {
    DRAFT:            ['BUYBACK_SUBMIT'],
    PENDING_APPROVAL: ['BUYBACK_APPROVE', 'BUYBACK_REJECT'],
    APPROVED:         ['BUYBACK_CONFIRM_INTAKE', 'BUYBACK_CANCEL_APPROVED'],
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
          <OwnerBadge size="xs" ownerType={detail.owner_type} ownerName={detail.owner_name} />
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
        {detail.cancelled_at && <span>{t('buyback.cancelled', { defaultValue: 'Cancelled' })}: <DateTime value={detail.cancelled_at} /></span>}
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

      {/* Reject / cancel reason readback (codes-only; UI translates). */}
      {detail.status === 'REJECTED' && detail.rejection_reason_code && (
        <div className="flex-none px-4 py-2 border-b border-line">
          <div className={`alert ${detail.rejection_reason_code === 'AUTO_REJECT' ? 'alert-warning' : 'alert-danger'} text-xs`}>
            <XCircle size={14} />
            <span>
              {t('buyback.rejectedReason', { defaultValue: 'Rejected' })}:{' '}
              {t(`buyback.reason.${detail.rejection_reason_code}`, { defaultValue: detail.rejection_reason_code })}
            </span>
          </div>
        </div>
      )}
      {detail.status === 'CANCELLED' && detail.cancel_reason_code && (
        <div className="flex-none px-4 py-2 border-b border-line">
          <div className="alert alert-danger text-xs">
            <XCircle size={14} />
            <span>
              {t('buyback.cancelledReason', { defaultValue: 'Cancelled' })}:{' '}
              {t(`buyback.reason.${detail.cancel_reason_code}`, { defaultValue: detail.cancel_reason_code })}
            </span>
          </div>
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
          <div key={line.po_line_id} className="px-4 py-3.5 border-b border-line flex flex-col gap-3.5">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {line.product_display_name ?? [line.brand_name, line.model_name].filter(Boolean).join(' ')}
                </div>
                <div className="text-xs text-subtle truncate">
                  {line.product_display_name ? line.sku_code : `${line.variant_name} · ${line.sku_code}`}
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
              <div className="rounded-md bg-surface border border-line px-3 py-3">
                <div className="text-xs text-subtle mb-2.5">{t('buyback.conditionSnapshot', { defaultValue: 'Condition' })}</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
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
                      <div key={k} className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-subtle truncate">{label}</span>
                        <span className="font-medium break-words">{display}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Condition photos (entity_media, private — presigned). */}
            {line.condition_photos && line.condition_photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {line.condition_photos.map((photo) => (
                  <ConditionPhotoThumb
                    key={photo.media_id}
                    photo={photo}
                    onPreview={setLightboxKey}
                  />
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
              color="primary"
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
            onCancel: () => setActionModal('cancel'),
            onCancelApproved: () => setActionModal('cancelApproved'),
            onUpdateNote: () => setNoteEditOpen(true),
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
                                onCancel: () => setActionModal('cancel'),
                                onCancelApproved: () => setActionModal('cancelApproved'),
                                onUpdateNote: () => setNoteEditOpen(true),
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
            : actionModal === 'cancel' ? t('buyback.cancelSuccess', { defaultValue: 'Buyback cancelled' })
            : actionModal === 'cancelApproved' ? t('buyback.cancelSuccess', { defaultValue: 'Buyback cancelled' })
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

      <BuybackNoteEditModal
        open={noteEditOpen}
        onClose={() => setNoteEditOpen(false)}
        detail={detail}
        totalPrice={totalPrice}
        t={t}
        onSuccess={() => {
          setNoteEditOpen(false);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('buyback.noteUpdated', { defaultValue: 'Note updated' })}</span>
              </div>
            ),
          });
        }}
      />

      <MediaLightbox
        open={lightboxKey != null}
        onClose={() => setLightboxKey(null)}
        mediaKey={lightboxKey}
        alt="Condition photo"
      />
    </div>
  );
}

// Single condition photo thumbnail — presigns the private key for display and
// for the lightbox. Prefers a smaller variant for the thumb when present;
// current rows are single-file (storage in `original`).
function ConditionPhotoThumb({
  photo,
  onPreview,
}: {
  photo: ConditionPhoto;
  onPreview: (key: string) => void;
}) {
  const p = photo.paths ?? {};
  const thumbRaw = p.sm || p.md || p.original || p.lg || null;
  const fullRaw = p.original || p.lg || p.md || p.sm || null;
  const { url } = useMediaUrl(thumbRaw ? normalizeKey(thumbRaw) : null);
  return (
    <button
      type="button"
      onClick={() => fullRaw && onPreview(normalizeKey(fullRaw))}
      className="block w-20 h-20 rounded-md border border-line overflow-hidden bg-surface hover:opacity-80 cursor-zoom-in p-0"
      aria-label="Preview condition photo"
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-subtle">
          <ImageOff size={20} />
        </div>
      )}
    </button>
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
                    {line.product_display_name ?? [line.brand_name, line.model_name, line.variant_name].filter(Boolean).join(' · ')}
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
// Action Modal (submit, revert, approve, reject, cancel, cancel_approved)
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
  action: BuybackActionKind | null;
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

  // reject → REJECT group; cancel / cancelApproved → CANCEL group.
  const reasonGroup: 'REJECT' | 'CANCEL' | null =
    action === 'reject' ? 'REJECT'
    : action === 'cancel' || action === 'cancelApproved' ? 'CANCEL'
    : null;

  // Lazy-load the matching reason group only when a reason is needed. UI
  // translates `code`; the Thai `label` is not echoed as canonical.
  const { data: reasons = [] } = useQuery({
    queryKey: ['buyback-reasons', reasonGroup],
    queryFn: () => apiClient.get<BuybackReason[]>(
      `/v_buyback_reasons?reason_group=eq.${reasonGroup}&is_active=eq.true`,
    ),
    enabled: open && reasonGroup !== null,
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

  const titleMap: Record<BuybackActionKind, string> = {
    submit: t('buyback.submit'),
    revert: t('buyback.revertDraft'),
    approve: t('buyback.approve'),
    reject: t('buyback.reject'),
    cancel: t('buyback.cancel', { defaultValue: 'Cancel buyback' }),
    cancelApproved: t('buyback.cancelApproved', { defaultValue: 'Cancel approved buyback' }),
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
      if (action === 'cancel') {
        return apiClient.rpc('fn_inv_buyback_cancel', {
          p_po_id: detail.po_id,
          p_reason_id: reasonId,
          p_note: note.trim() || null,
          p_branch_id: null,
        });
      }
      if (action === 'cancelApproved') {
        return apiClient.rpc('fn_inv_buyback_cancel_approved', {
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

  const isSubmit = action === 'submit';
  const isDanger = action === 'reject' || action === 'cancel' || action === 'cancelApproved';
  const needsReason = reasonGroup !== null;
  // Submit requires at least one identifier (Serial is always allowed; IMEI when applicable).
  const submitValid = !isSubmit || imei.trim().length > 0 || serial.trim().length > 0;
  const reasonValid = !needsReason || reasonId !== null;
  const canSubmit = submitValid && reasonValid && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{action ? titleMap[action] : ''}</h2>
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
                  <label className="form-label">{t('asset.imei', { defaultValue: 'IMEI' })}</label>
                  <ImeiInput
                    value={imei}
                    onChange={setImei}
                    placeholder={t('buyback.imeiPlaceholder', { defaultValue: '15-digit IMEI (optional)' })}
                    className="w-full"
                    autoFocus
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('asset.serialNo', { defaultValue: 'Serial No.' })}</label>
                  <Input
                    value={serial}
                    onChange={(e) => setSerial(e.target.value)}
                    placeholder={t('buyback.serialPlaceholder', { defaultValue: 'Serial number (optional)' })}
                    className="w-full"
                  />
                </div>
              </>
            )}

            {action === 'cancelApproved' && (
              <div className="alert alert-warning">
                <AlertTriangle size={16} />
                <span>{t('buyback.cancelApprovedHint', { defaultValue: 'Cancels an approved buyback the customer never brought in. No stock has moved yet. Company-level action.' })}</span>
              </div>
            )}

            {needsReason && (
              <div className="flex flex-col">
                <label className="form-label">
                  {(action === 'cancel' || action === 'cancelApproved')
                    ? t('buyback.cancelReason', { defaultValue: 'Cancel reason' })
                    : t('buyback.rejectReason', { defaultValue: 'Reject reason' })} *
                </label>
                <Select
                  options={reasons.map(r => ({
                    value: String(r.id),
                    label: t(`buyback.reason.${r.code}`, { defaultValue: r.code }),
                  }))}
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
            color={isDanger ? 'danger' : 'primary'}
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
          >
            {mutation.isPending ? t('common.loading') : (action ? titleMap[action] : '')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Note Edit Modal — approver edits the request note while it awaits decision.
// PENDING_APPROVAL only; permission surfaced via BUYBACK_UPDATE_NOTE action
// (mig 885). Backend keeps the old note when a blank is sent, so we require a
// non-empty, changed value.
// ============================================================================

function BuybackNoteEditModal({
  open,
  onClose,
  detail,
  totalPrice,
  t,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  detail: BuybackDetail;
  totalPrice: number;
  t: ReturnType<typeof useTranslation>['t'];
  onSuccess: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setNote(detail.notes ?? '');
      setError('');
    }
  }, [open, detail.notes]);

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_inv_buyback_update_note', {
      p_po_id: detail.po_id,
      p_note: note.trim(),
    }),
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

  const trimmed = note.trim();
  const changed = trimmed.length > 0 && trimmed !== (detail.notes ?? '').trim();
  const canSave = changed && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('buyback.editNote', { defaultValue: 'Edit note' })}</h2>
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
            <div className="flex flex-col">
              <label className="form-label">{t('buyback.note')}</label>
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('buyback.notePlaceholder')}
                rows={4}
                autoFocus
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose} disabled={mutation.isPending}>{t('common.cancel')}</Button>
          <Button color="primary" onClick={() => mutation.mutate()} disabled={!canSave}>
            {mutation.isPending ? t('common.loading') : t('common.save', { defaultValue: 'Save' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
