import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, Badge, Select, Input, Button, Modal, TextArea, NumberSpinner,
  DataTable, PopOver, Tooltip, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowLeft, ArrowRightFromLine, Boxes, Search, CheckCircle, XCircle, ChevronDown, Wrench, Plus, Trash2, ExternalLink,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { getBucketLabel, getBucketColor, fmtNum } from './inventoryUtils';

// ============================================================================
// Types — verified against live API 2026-05-08
// v_stock_lots: lot_id, holding_id, company_id, branch_id, lot_code,
//   current_bucket, qty_received, qty_on_hand, qty_consumed, unit_cost,
//   on_hand_value, is_closed, closed_at, variant_id, model_id,
//   variant_sku_code, variant_name, model_name, family_name, brand_name,
//   po_id, po_no, po_type, source_lot_id, created_by, created_at, updated_at.
//   NOT in view: owner_type, branch_name, is_contractable.
// fn_lot_available_actions response wraps actions[] with per-lot context:
//   lot_id, current_bucket, qty_on_hand, is_closed, owner_type, actions[].
// ============================================================================

interface Lot {
  lot_id: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  lot_code: string;
  current_bucket: string;
  qty_received: number;
  qty_on_hand: number;
  qty_consumed: number;
  unit_cost: number;
  on_hand_value: number;
  is_closed: boolean;
  closed_at: string | null;
  variant_id: number;
  model_id: number;
  variant_sku_code: string;
  variant_name: string;
  model_name: string;
  family_name: string;
  brand_name: string;
  po_id: number | null;
  po_no: string | null;
  po_type: string | null;
  source_lot_id: number | null;
  created_at: string;
  updated_at: string;
}

interface BackendLotAction {
  action_code: string;
  category: string;
  rpc_name: string;
  is_available: boolean;
  blocking_reason: string | null;
  require_pin: boolean;
  sort_order: number;
  target_bucket: string | null;
  bill_type: string | null;
  bill_purpose: string | null;
  creates_bill: boolean;
}

interface LotActionsResponse {
  lot_id: number;
  current_bucket: string;
  qty_on_hand: number;
  is_closed: boolean;
  owner_type: string;
  actions: BackendLotAction[];
}

interface Branch {
  id: number;
  name: string;
}

// ============================================================================
// Bucket filter options (lots are mostly On-Hand / Quarantined / In-Transit)
// ============================================================================

const BUCKET_OPTIONS = [
  { value: 'ON_HAND_AVAILABLE', label: 'Available' },
  { value: 'QUARANTINED', label: 'Quarantined' },
  { value: 'IN_TRANSIT_OUTBOUND', label: 'In Transit (Out)' },
  { value: 'IN_TRANSIT_INBOUND', label: 'In Transit (In)' },
  { value: 'INBOUND_APPROVED_AWAITING_BRANCH_CONFIRM', label: 'Inbound (Awaiting Confirm)' },
  { value: 'INBOUND_RECEIVED_UNREGISTERED', label: 'Inbound (Unregistered)' },
  { value: 'WRITTEN_OFF', label: 'Written off' },
];

// ============================================================================
// Wired actions catalog. Only LOT_CONVERT_TO_ASSET is fully wired today;
// others are surfaced (so users see what's available) but disabled with a
// "not yet wired in this page" tooltip and a Wrench icon.
// ============================================================================

type LotSimpleActionConfig = {
  rpc: string;
  color?: 'primary' | 'danger';
  successKey: string;
};

const SIMPLE_ACTIONS: Record<string, LotSimpleActionConfig> = {
  LOT_CONVERT_TO_ASSET: {
    rpc: 'fn_inv_convert_lot_to_asset',
    color: 'primary',
    successKey: 'success.convert_to_asset',
  },
  LOT_STOCK_ADJUST_LOSS: {
    rpc: 'fn_inv_stock_adjust_loss',
    color: 'danger',
    successKey: 'success.adjust_loss',
  },
};

// Up to 3 actions surfaced inline as primary; rest go behind "More".
const PRIMARY_BY_BUCKET: Record<string, string[]> = {
  ON_HAND_AVAILABLE: ['LOT_CONVERT_TO_ASSET', 'LOT_TRANSFER_CREATE'],
  INBOUND_APPROVED_AWAITING_BRANCH_CONFIRM: ['LOT_RECEIVE'],
  QUARANTINED: ['LOT_QUARANTINE_RELEASE'],
};

const CATEGORY_ORDER = ['INBOUND', 'CONVERSION', 'TRANSFER', 'BUCKET_MOVE', 'ADJUSTMENT', 'SALE', 'LIFECYCLE'];

// ============================================================================
// Component
// ============================================================================

export function LotsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();

  const navigate = useNavigate();
  const { lotId: lotIdParam } = useParams<{ lotId?: string }>();
  const selectedId = lotIdParam ? Number(lotIdParam) : null;
  const setSelectedId = (id: number | null) => {
    if (id) navigate(`/admin/inventory/lots/${id}`, { replace: true });
    else navigate('/admin/inventory/lots', { replace: true });
  };

  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterBucket, setFilterBucket] = useState<string | null>('ON_HAND_AVAILABLE');
  const [filterBranchId, setFilterBranchId] = useState<number | null>(defaultBranchId);
  const [filterPoType, setFilterPoType] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => {
    const tm = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(tm);
  }, [search]);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
  });

  const branchOptions = useMemo(
    () => (branches ?? []).map(b => ({ value: String(b.id), label: b.name })),
    [branches],
  );

  const { data: listData, isFetching } = useQuery({
    queryKey: ['lots', debouncedSearch, filterBucket, filterBranchId, filterPoType, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_stock_lots?order=created_at.desc';
      if (filterBucket) url += `&current_bucket=eq.${filterBucket}`;
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (filterPoType) url += `&po_type=eq.${filterPoType}`;
      if (debouncedSearch) {
        url += `&or=(lot_code.ilike.*${encodeURIComponent(debouncedSearch)}*,variant_sku_code.ilike.*${encodeURIComponent(debouncedSearch)}*,model_name.ilike.*${encodeURIComponent(debouncedSearch)}*,po_no.ilike.*${encodeURIComponent(debouncedSearch)}*)`;
      }
      return apiClient.getPaginated<Lot>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;

  useEffect(() => { setPageIndex(0); }, [debouncedSearch, filterBucket, filterBranchId, filterPoType]);

  // Detail uses the same view (no v_lot_detail exists). Fetch by id even if
  // not in the current page, so direct deep-link `/lots/123` still works.
  const { data: detail, isFetching: detailFetching } = useQuery({
    queryKey: ['lot-detail', selectedId],
    queryFn: () => apiClient.get<Lot[]>(`/v_stock_lots?lot_id=eq.${selectedId}`).then(rows => rows[0] ?? null),
    enabled: !!selectedId,
    placeholderData: keepPreviousData,
  });

  const selectedLot = list.find(l => l.lot_id === selectedId) ?? detail ?? null;
  const branchName = (id: number) => branches?.find(b => b.id === id)?.name ?? '';

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['lots'] });
    queryClient.invalidateQueries({ queryKey: ['lot-detail'] });
    queryClient.invalidateQueries({ queryKey: ['lot-actions'] });
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
                {isRoot ? t('nav.lots') : selectedLot?.lot_code ?? ''}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0 flex items-center gap-2">
                <Boxes size={18} />
                {t('nav.lots')}
              </h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              <div className="flex-none flex flex-col gap-2 p-2 border-b border-line">
                <div className="flex gap-2 w-full">
                  <div className="flex-[3] min-w-0">
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('lot.search')}
                      size="sm"
                      startIcon={<Search size={16} />}
                    />
                  </div>
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={BUCKET_OPTIONS}
                      value={filterBucket}
                      onChange={(val) => setFilterBucket((val as string) || null)}
                      placeholder={t('lot.allBuckets')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                </div>
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
                      options={[
                        { value: 'PURCHASE', label: 'Purchase' },
                        { value: 'BUYBACK', label: 'Buyback' },
                        { value: 'ADJUSTMENT', label: 'Adjustment' },
                        { value: 'DEAL_PARTNER', label: 'Deal Partner' },
                      ]}
                      value={filterPoType}
                      onChange={(val) => setFilterPoType((val as string) || null)}
                      placeholder={t('lot.allPoTypes')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                </div>
              </div>

              <DataTable<Lot>
                data={list}
                renderRow={(row) => {
                  const lot = row.original;
                  const isSelected = lot.lot_id === selectedId;
                  return (
                    <button
                      key={lot.lot_id}
                      className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-item-active-bg text-item-active-fg' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => { setSelectedId(lot.lot_id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-sm truncate">{lot.lot_code}</span>
                          <Badge size="xs" color={getBucketColor(lot.current_bucket)}>
                            {getBucketLabel(lot.current_bucket, t)}
                          </Badge>
                        </div>
                        <div className="text-xs text-subtle truncate mt-0.5">
                          {[lot.brand_name, lot.family_name, lot.model_name].filter(Boolean).join(' ')}
                        </div>
                        <div className="text-xs text-subtle truncate">
                          {lot.variant_name} · {lot.variant_sku_code}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium tabular-nums">
                          {fmtNum(lot.qty_on_hand)}<span className="text-subtle"> / {fmtNum(lot.qty_received)}</span>
                        </div>
                        <div className="text-xs text-subtle tabular-nums">{fmtCurrency(lot.on_hand_value)}</div>
                        <div className="text-xs text-subtle truncate">{branchName(lot.branch_id)}</div>
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
              {selectedLot ? (
                <LotDetailPanel
                  lot={selectedLot}
                  loading={detailFetching}
                  isMobile={isMobile}
                  branchName={branchName(selectedLot.branch_id)}
                  onRefresh={invalidate}
                  addSnackbar={addSnackbar}
                />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  <div className="text-center">
                    <Boxes size={32} className="mx-auto mb-2 opacity-40" />
                    {t('lot.selectToView')}
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

function LotDetailPanel({
  lot,
  loading,
  isMobile,
  branchName,
  onRefresh,
  addSnackbar,
}: {
  lot: Lot;
  loading: boolean;
  isMobile: boolean;
  branchName: string;
  onRefresh: () => void;
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const { t } = useTranslation();
  const [activeAction, setActiveAction] = useState<BackendLotAction | null>(null);

  const handleSuccess = (key: string) => {
    setActiveAction(null);
    onRefresh();
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <span>{t(key, { ns: 'lotActions', defaultValue: 'Action completed' })}</span>
        </div>
      ),
    });
  };

  return (
    <div className="relative flex flex-col h-full">
      {loading && (
        <div className="absolute inset-0 bg-bg/50 z-10 flex items-center justify-center animate-fade-in">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{lot.lot_code}</span>
          <Badge size="xs" color={getBucketColor(lot.current_bucket)}>
            {getBucketLabel(lot.current_bucket, t)}
          </Badge>
          {lot.is_closed && (
            <Badge size="xs" color="default">{t('lot.closed')}</Badge>
          )}
        </div>
      )}

      {/* Variant — primary identity */}
      <div className="flex-none px-4 py-3 border-b border-line">
        <div className="text-sm font-medium truncate">
          {[lot.brand_name, lot.family_name, lot.model_name].filter(Boolean).join(' ')}
        </div>
        <div className="text-xs text-subtle truncate mt-0.5">
          {lot.variant_name}
        </div>
        <div className="text-[11px] text-subtler font-mono truncate mt-0.5">
          {lot.variant_sku_code}
        </div>
      </div>

      {/* Quantity + value — two prominent stats */}
      <div className="flex-none grid grid-cols-2 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs text-subtle">{t('lot.onHand')}</div>
          <div className="font-semibold text-base tabular-nums">
            {fmtNum(lot.qty_on_hand)}
            <span className="text-subtle font-normal text-sm"> / {fmtNum(lot.qty_received)}</span>
          </div>
          <div className="text-xs text-subtle tabular-nums">
            {fmtCurrency(lot.on_hand_value)}
          </div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('lot.unitCost')}</div>
          <div className="font-semibold text-base tabular-nums">{fmtCurrency(lot.unit_cost)}</div>
          <div className="text-xs text-subtle">
            <span className="tabular-nums">{fmtNum(lot.qty_consumed)}</span> {t('lot.consumedSuffix')}
          </div>
        </div>
      </div>

      {/* Provenance — PO/Receipt cross-links with icon */}
      {lot.po_no && lot.po_id && (
        <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-2 text-sm">
          <span className="text-xs text-subtle shrink-0">{t('lot.from')}</span>
          <Badge size="xs" color="default">{lot.po_type}</Badge>
          <Link
            to={`/admin/inventory/po/${lot.po_id}`}
            className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
          >
            {lot.po_no}
            <ExternalLink size={12} />
          </Link>
        </div>
      )}

      {/* Branch + timestamps — quiet metadata footer */}
      <div className="flex-none px-4 py-2 border-b border-line flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
        <span><span className="text-subtler">{t('lot.branch')}:</span> {branchName || '—'}</span>
        <span><span className="text-subtler">{t('lot.created')}:</span> <DateTime value={lot.created_at} /></span>
        {lot.closed_at && (
          <span><span className="text-subtler">{t('lot.closedAt')}:</span> <DateTime value={lot.closed_at} /></span>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      <LotActionBar lot={lot} onPick={setActiveAction} />

      <LotActionModal
        open={!!activeAction}
        action={activeAction}
        onClose={() => setActiveAction(null)}
        lot={lot}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

// ============================================================================
// Action footer — backend-driven via fn_lot_available_actions
// ============================================================================

function LotActionBar({
  lot,
  onPick,
}: {
  lot: Lot;
  onPick: (action: BackendLotAction) => void;
}) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  const { data: actionsResp } = useQuery({
    queryKey: ['lot-actions', lot.lot_id],
    queryFn: () => apiClient.rpc<LotActionsResponse>('fn_lot_available_actions', {
      p_lot_id: lot.lot_id,
    }),
    staleTime: 30 * 1000,
  });

  const allActions = (actionsResp?.actions ?? [])
    .filter(a => a.blocking_reason !== 'permission_denied')
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  const primaryCodes = PRIMARY_BY_BUCKET[lot.current_bucket] ?? [];
  const primarySet = new Set(primaryCodes);
  const primaryActions = primaryCodes
    .map(c => allActions.find(a => a.action_code === c))
    .filter((a): a is BackendLotAction => !!a);
  const secondaryActions = allActions.filter(a => !primarySet.has(a.action_code));

  const groupedSecondary = secondaryActions.reduce<Record<string, BackendLotAction[]>>((acc, a) => {
    (acc[a.category] ||= []).push(a);
    return acc;
  }, {});
  const sortedCategories = Object.keys(groupedSecondary).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  if (allActions.length === 0) return null;

  const renderActionButton = (a: BackendLotAction, primary = false) => {
    const config = SIMPLE_ACTIONS[a.action_code];
    const wired = !!config;
    const label = t(a.action_code, { ns: 'lotActions', defaultValue: a.action_code });
    let endIcon: React.ReactNode = undefined;
    const lines: string[] = [label];
    if (!wired) {
      endIcon = <Wrench size={12} />;
      lines.push(t('notImplemented', { ns: 'lotActions', defaultValue: 'Not yet wired in this page' }));
    }
    if (!a.is_available && a.blocking_reason) {
      lines.push(t(`blockingReason.${a.blocking_reason}`, { ns: 'apiErrors', defaultValue: a.blocking_reason }));
    }
    const tooltipContent: React.ReactNode = lines.length === 1
      ? lines[0]
      : (
        <div className="flex flex-col gap-0.5">
          {lines.map((line, i) => (
            <div key={i} className={i === 0 ? 'font-medium' : 'text-xs opacity-90'}>{line}</div>
          ))}
        </div>
      );
    return (
      <Tooltip key={a.action_code} content={tooltipContent} placement="top">
        <Button
          variant={primary ? undefined : 'outline'}
          size="sm"
          color={primary && a.is_available && wired ? (config?.color ?? 'primary') : config?.color}
          disabled={!a.is_available || !wired}
          endIcon={endIcon}
          onClick={() => {
            onPick(a);
            setMoreOpen(false);
          }}
        >
          {label}
        </Button>
      </Tooltip>
    );
  };

  return (
    <div className="flex-none px-4 py-3 border-t border-line flex flex-wrap items-center gap-2">
      {primaryActions.map(a => renderActionButton(a, true))}
      {secondaryActions.length > 0 && (
        <Button
          ref={moreTriggerRef}
          variant="outline"
          size="sm"
          endIcon={<ChevronDown size={14} />}
          onClick={() => setMoreOpen(v => !v)}
        >
          {t('contract.moreActions', { defaultValue: 'More' })}
        </Button>
      )}
      <PopOver
        isOpen={moreOpen}
        onClose={() => setMoreOpen(false)}
        triggerRef={moreTriggerRef}
        placement="top"
        align="end"
        maxWidth="32rem"
        maxHeight="60vh"
      >
        <div className="flex flex-col gap-3 p-3">
          {sortedCategories.map(cat => {
            const actions = groupedSecondary[cat];
            if (!actions || actions.length === 0) return null;
            return (
              <div key={cat} className="flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                  {t(`category.${cat}`, { ns: 'lotActions', defaultValue: cat })}
                </div>
                <div className="flex flex-wrap gap-2">
                  {actions.map(a => renderActionButton(a))}
                </div>
              </div>
            );
          })}
        </div>
      </PopOver>
    </div>
  );
}

// ============================================================================
// Action modal — only LOT_CONVERT_TO_ASSET is wired today.
// fn_inv_convert_lot_to_asset signature (verified live 2026-05-08):
//   p_lot_id, p_variant_id, p_identifiers jsonb, p_condition_grade,
//   p_physical_color, p_dedupe_key, p_branch_id
// Each call converts ONE unit; lot.qty_on_hand -= 1.
// p_identifiers is the identifier set for that single unit (e.g. one phone
// has both IMEI and SERIAL_NO).
// ============================================================================

const IDENTIFIER_TYPE_OPTIONS = [
  { value: 'IMEI', label: 'IMEI' },
  { value: 'SERIAL_NO', label: 'Serial No.' },
  { value: 'MAC_ADDRESS', label: 'MAC' },
];

const CONDITION_OPTIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'REFURBISHED', label: 'Refurbished' },
  { value: 'USED_A', label: 'Used A' },
  { value: 'USED_B', label: 'Used B' },
];

interface IdRow {
  type: string;
  value: string;
}

interface AdjustReason {
  code: string;
  name_th: string;
  name_en: string;
  direction: string;
  sort_order: number;
}

function LotActionModal({
  open,
  action,
  onClose,
  lot,
  onSuccess,
}: {
  open: boolean;
  action: BackendLotAction | null;
  onClose: () => void;
  lot: Lot;
  onSuccess: (msgKey: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const config = action ? SIMPLE_ACTIONS[action.action_code] : null;
  const isThai = i18n.language === 'th';

  const isConvert = action?.action_code === 'LOT_CONVERT_TO_ASSET';
  const isAdjustLoss = action?.action_code === 'LOT_STOCK_ADJUST_LOSS';

  // Convert-specific state — inputs for one unit at a time.
  const [identifiers, setIdentifiers] = useState<IdRow[]>([{ type: 'SERIAL_NO', value: '' }]);
  const [conditionGrade, setConditionGrade] = useState<string>('NEW');
  const [physicalColor, setPhysicalColor] = useState('');

  // Adjust-loss state
  const [lossQty, setLossQty] = useState<number | ''>(1);
  const [reasonCode, setReasonCode] = useState<string>('');

  // Shared
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setIdentifiers([{ type: 'SERIAL_NO', value: '' }]);
      setConditionGrade('NEW');
      setPhysicalColor('');
      setLossQty(1);
      setReasonCode('');
      setNote('');
      setError('');
    }
  }, [open, action]);

  // Load adjustment reasons (LOSS + BOTH directions) only when relevant.
  const { data: reasons = [] } = useQuery({
    queryKey: ['adjustment-reasons', 'loss'],
    queryFn: () => apiClient.get<AdjustReason[]>(
      '/v_ref_adjustment_reasons?direction=in.(LOSS,BOTH)&is_active=is.true&order=sort_order',
    ),
    enabled: open && isAdjustLoss,
    staleTime: 60 * 60 * 1000,
  });

  const reasonOptions = useMemo(
    () => reasons.map(r => ({ value: r.code, label: isThai ? r.name_th : r.name_en })),
    [reasons, isThai],
  );

  const filledIds = identifiers.filter(i => i.type && i.value.trim());
  const lossQtyNum = typeof lossQty === 'number' ? lossQty : 0;

  const mutation = useMutation({
    mutationFn: () => {
      if (!action || !config) return Promise.reject(new Error('No action'));
      let params: Record<string, unknown>;

      if (action.action_code === 'LOT_CONVERT_TO_ASSET') {
        // PostgREST overload: send every key, null for blanks.
        params = {
          p_lot_id: lot.lot_id,
          p_variant_id: null,
          p_identifiers: filledIds.map(i => ({ type: i.type, value: i.value.trim() })),
          p_condition_grade: conditionGrade || null,
          p_physical_color: physicalColor.trim() || null,
          p_dedupe_key: `lot-convert-${lot.lot_id}-${Date.now()}`,
          p_branch_id: lot.branch_id,
        };
      } else if (action.action_code === 'LOT_STOCK_ADJUST_LOSS') {
        params = {
          p_lot_id: lot.lot_id,
          p_qty_loss: lossQtyNum,
          p_reason_code: reasonCode,
          p_note: note.trim() || null,
          p_dedupe_key: `lot-adjust-loss-${lot.lot_id}-${Date.now()}`,
          p_branch_id: lot.branch_id,
        };
      } else {
        return Promise.reject(new Error('Action not wired'));
      }

      return apiClient.rpc(config.rpc, params);
    },
    onSuccess: () => onSuccess(config!.successKey),
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated =
          (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') ||
          (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  const convertValid = isConvert && filledIds.length > 0 && !!conditionGrade;
  const lossValid = isAdjustLoss && lossQtyNum > 0 && lossQtyNum <= lot.qty_on_hand && !!reasonCode;
  const canSubmit = (convertValid || lossValid) && !mutation.isPending;
  const label = action ? t(action.action_code, { ns: 'lotActions', defaultValue: action.action_code }) : '';

  return (
    <Modal open={open && !!action && !!config} onClose={onClose} maxWidth="32rem" width="100%">
      {action && config ? (
        <div className="flex flex-col overflow-hidden">
          <div className="modal-header">
            <h2 className="modal-title">{label}</h2>
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
              <div className="font-medium text-sm">{lot.lot_code}</div>
              <div className="text-xs text-subtle truncate">
                {[lot.brand_name, lot.family_name, lot.model_name].filter(Boolean).join(' ')} · {lot.variant_name}
              </div>
              <div className="text-xs text-subtle tabular-nums">
                {t('lot.remaining')}: {fmtNum(lot.qty_on_hand)} {t('lot.units')}
              </div>
            </div>

            {isConvert && (
              <>
                <div className="mb-4 alert alert-info">
                  <span>{t('convert.oneUnitNote', { ns: 'lotActions', defaultValue: 'Each conversion registers one unit. Repeat for additional units.' })}</span>
                </div>

                <div className="form-grid gap-4">
                  <div className="flex flex-col">
                    <label className="form-label">
                      {t('convert.identifiers', { ns: 'lotActions', defaultValue: 'Identifiers' })} *
                    </label>
                    <div className="flex flex-col gap-2">
                      {identifiers.map((row, idx) => (
                        <div key={idx} className="flex gap-2">
                          <div className="w-32 shrink-0">
                            <Select
                              options={IDENTIFIER_TYPE_OPTIONS}
                              value={row.type}
                              onChange={(val) => setIdentifiers(prev => prev.map((r, i) => i === idx ? { ...r, type: (val as string) || '' } : r))}
                              showChevron
                            />
                          </div>
                          <Input
                            value={row.value}
                            onChange={(e) => setIdentifiers(prev => prev.map((r, i) => i === idx ? { ...r, value: e.target.value } : r))}
                            placeholder={row.type === 'IMEI' ? '15-digit IMEI' : t('convert.identifierValue', { ns: 'lotActions', defaultValue: 'Value' })}
                            className="w-full"
                          />
                          {identifiers.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              startIcon={<Trash2 size={14} />}
                              onClick={() => setIdentifiers(prev => prev.filter((_, i) => i !== idx))}
                            />
                          )}
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        startIcon={<Plus size={14} />}
                        onClick={() => setIdentifiers(prev => [...prev, { type: 'SERIAL_NO', value: '' }])}
                        className="self-start"
                      >
                        {t('convert.addIdentifier', { ns: 'lotActions', defaultValue: 'Add identifier' })}
                      </Button>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1 min-w-0 flex flex-col">
                      <label className="form-label">
                        {t('convert.conditionGrade', { ns: 'lotActions', defaultValue: 'Condition' })} *
                      </label>
                      <Select
                        options={CONDITION_OPTIONS}
                        value={conditionGrade}
                        onChange={(val) => setConditionGrade((val as string) || '')}
                        showChevron
                      />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col">
                      <label className="form-label">
                        {t('convert.physicalColor', { ns: 'lotActions', defaultValue: 'Physical color' })}
                      </label>
                      <Input
                        value={physicalColor}
                        onChange={(e) => setPhysicalColor(e.target.value)}
                        placeholder={t('convert.physicalColorPlaceholder', { ns: 'lotActions', defaultValue: 'Optional' })}
                        className="w-full"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <label className="form-label">{t('convert.note', { ns: 'lotActions', defaultValue: 'Note' })}</label>
                    <TextArea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                    />
                  </div>
                </div>
              </>
            )}

            {isAdjustLoss && (
              <div className="form-grid gap-4">
                <div className="flex gap-3">
                  <div className="shrink-0 flex flex-col">
                    <label className="form-label">
                      {t('adjustLoss.qty', { ns: 'lotActions', defaultValue: 'Qty to remove' })} *
                    </label>
                    <NumberSpinner
                      value={lossQty}
                      onChange={setLossQty}
                      min={1}
                      max={lot.qty_on_hand}
                    />
                    <div className="text-xs text-subtle mt-1 tabular-nums">
                      {t('lot.remaining')}: {fmtNum(lot.qty_on_hand)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col">
                    <label className="form-label">
                      {t('adjustLoss.reason', { ns: 'lotActions', defaultValue: 'Reason' })} *
                    </label>
                    <Select
                      options={reasonOptions}
                      value={reasonCode || null}
                      onChange={(v) => setReasonCode((v as string) || '')}
                      placeholder={t('adjustLoss.selectReason', { ns: 'lotActions', defaultValue: 'Select reason' })}
                      searchable
                      showChevron
                    />
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('adjustLoss.note', { ns: 'lotActions', defaultValue: 'Note' })}</label>
                  <TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder={t('adjustLoss.notePlaceholder', { ns: 'lotActions', defaultValue: 'Optional context for the adjustment' })}
                  />
                </div>
                <div className="alert alert-warning">
                  <span className="text-xs">{t('adjustLoss.note_no_journal', { ns: 'lotActions', defaultValue: 'This is a non-monetary stock correction. For losses that need to hit accounting, use Stock Loss (journal) instead.' })}</span>
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button
              color={config.color}
              onClick={() => mutation.mutate()}
              disabled={!canSubmit}
            >
              {mutation.isPending ? t('common.loading') : label}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
