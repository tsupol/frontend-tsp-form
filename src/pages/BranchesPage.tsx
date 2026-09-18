import { useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, MobileHeader,
  Input, Badge, Modal, Button, Select, PopOver, LabeledCheckbox,
  type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, ExternalLink, Plus, Pencil, Power, Search, SlidersHorizontal } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { PhoneInput } from '../components/PhoneInput';
import { translateApiError } from '../lib/apiErrors';
import { useCompanyTypes } from '../hooks/useCompanyTypes';
import { ModalErrorBand } from '../components/ModalErrorBand';

// ── Types ────────────────────────────────────────────────────────────────────

interface Branch {
  id: number;
  company_id: number;
  code: string;
  name: string;
  /** Codes come from v_ref_company_types.allowed_branch_types — not a fixed union. */
  branch_type: string;
  is_active: boolean;
  /** mig 1257 — the type of the company this branch belongs to. */
  company_type: string | null;
  address: string | null;
  phone: string | null;
  branch_lat: number | null;
  branch_lng: number | null;
  line_id: string | null;
  google_map_url: string | null;
  facebook_url: string | null;
}

interface BranchEditModel {
  id?: number;
  company_id?: number;
  code?: string;
  name: string;
  branch_type: string;
  address: string;
  /** mig 1269 — sent as p_is_company_warehouse on create. Create-only. */
  is_company_warehouse: boolean;
  phone: string;
  branch_lat: string;
  branch_lng: string;
  line_id: string;
  google_map_url: string;
  facebook_url: string;
  is_active?: boolean;
}

const EMPTY_EDIT: BranchEditModel = {
  name: '', branch_type: '', address: '', phone: '',
  is_company_warehouse: false,
  branch_lat: '', branch_lng: '', line_id: '',
  google_map_url: '', facebook_url: '',
};

// Cheap sanity check for the preview affordance — show the open-in-new-tab
// icon only when the field looks like an actual http(s) URL. Avoids dangling
// the icon on partial typing or blank values.
function isPreviewableUrl(v: string): boolean {
  return /^https?:\/\/\S+/i.test(v.trim());
}

// Compute the COALESCE patch per fn_branch_update semantics:
//   - field unchanged → omit (don't send) → null at the RPC layer → no-touch
//   - field cleared by user (originally non-empty, now '') → send '' → clear
//   - field has a new value → send the string → set
// Numeric lat/lng get parsed to float; non-numeric blank stays as omitted.
function buildUpdatePatch(
  orig: Branch,
  next: BranchEditModel,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { p_branch_id: orig.id };
  const strField = (
    key: 'code' | 'name' | 'address' | 'phone' | 'line_id' | 'google_map_url' | 'facebook_url',
    rpcKey: string,
  ) => {
    const before = (orig[key] as string | null | undefined) ?? '';
    const after = next[key] ?? '';
    if (before === after) return;
    patch[rpcKey] = after;
  };
  strField('code', 'p_code');
  strField('name', 'p_name');
  strField('address', 'p_address');
  strField('phone', 'p_phone');
  strField('line_id', 'p_line_id');
  strField('google_map_url', 'p_google_map_url');
  strField('facebook_url', 'p_facebook_url');

  const parseNum = (v: string): number | null => {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const beforeLat = orig.branch_lat ?? null;
  const afterLat = parseNum(next.branch_lat);
  if (beforeLat !== afterLat) patch.p_lat = afterLat;
  const beforeLng = orig.branch_lng ?? null;
  const afterLng = parseNum(next.branch_lng);
  if (beforeLng !== afterLng) patch.p_lng = afterLng;

  return patch;
}

interface Company {
  id: number;
  name: string;
  company_type: string | null;
}

// Filter-bar options only: the branch types that exist anywhere in the system,
// derived from the ref view so a new type appears without touching this file.
// The CREATE/EDIT form never uses this list — it uses the selected company's
// own allowed_branch_types (mig 1257).
const BRANCH_TYPE_COLORS: Record<string, 'info' | 'warning' | 'secondary'> =
  { INTERNAL: 'info', EXTERNAL: 'warning', DEAL_PARTNER: 'secondary' };

// ── Component ────────────────────────────────────────────────────────────────

export function BranchesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const role = user?.role_code ?? '';
  const isHoldingLevel = ['HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role);
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [modalData, setModalData] = useState<BranchEditModel>(EMPTY_EDIT);
  const [modalOrig, setModalOrig] = useState<Branch | null>(null);
  const [modalError, setModalError] = useState('');
  const [modalSaving, setModalSaving] = useState(false);

  const updateField = <K extends keyof BranchEditModel>(key: K, val: BranchEditModel[K]) => {
    setModalData(d => ({ ...d, [key]: val }));
  };

  const { data: branches = [], isFetching, isLoading } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name'),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['branches-companies'],
    queryFn: () => apiClient.get<Company[]>('/v_companies?order=name&select=id,name,company_type'),
  });

  // v_branches does NOT expose is_company_warehouse (checked live on DEV,
  // 2026-09-18: column does not exist). The flag lives on
  // v_deal_partner_warehouses, so read the warehouse branch ids from there and
  // badge the list rows with it.
  const { data: warehouseRows = [] } = useQuery({
    queryKey: ['branches-warehouses'],
    queryFn: () => apiClient.get<{ branch_id: number; is_company_warehouse: boolean }[]>(
      '/v_deal_partner_warehouses?select=branch_id,is_company_warehouse',
    ),
  });
  const warehouseIds = useMemo(
    () => new Set(warehouseRows.filter(r => r.is_company_warehouse).map(r => r.branch_id)),
    [warehouseRows],
  );

  const { types: companyTypes, allowedBranchTypes, canHoldMoney, typeName } = useCompanyTypes();

  // Every branch type any company type allows — the filter bar's option list.
  // Derived from the ref view so the filter never disagrees with what can be
  // created. Order follows the ref view's own sort_order.
  const allBranchTypes = useMemo(() => {
    const seen: string[] = [];
    for (const ct of companyTypes) {
      for (const bt of ct.allowed_branch_types) if (!seen.includes(bt)) seen.push(bt);
    }
    return seen;
  }, [companyTypes]);

  // The company the modal is pointed at decides which branch types are on offer
  // and whether the warehouse tick is mandatory. On create that is the Select;
  // on edit it is the branch's own company.
  const modalCompany = companies.find(c => c.id === modalData.company_id);
  const modalCompanyType = modalMode === 'edit'
    ? (modalOrig?.company_type ?? modalCompany?.company_type ?? null)
    : (modalCompany?.company_type ?? null);
  const modalBranchTypes = allowedBranchTypes(modalCompanyType);
  const modalIsFundCompany = canHoldMoney(modalCompanyType);
  // The tick only exists for internal branches (WAREHOUSE_BRANCH_TYPE otherwise),
  // and under a fund company an internal branch has to be the warehouse.
  const warehouseApplies = modalMode === 'create' && modalData.branch_type === 'INTERNAL';
  const warehouseRequired = warehouseApplies && modalIsFundCompany;

  const filtered = useMemo(() => {
    let result = branches;
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      result = result.filter(b =>
        b.name.toLowerCase().includes(term) ||
        b.code.toLowerCase().includes(term) ||
        (b.address ?? '').toLowerCase().includes(term)
      );
    }
    if (filterType) {
      result = result.filter(b => b.branch_type === filterType);
    }
    if (filterCompany) {
      result = result.filter(b => b.company_id === Number(filterCompany));
    }
    return result;
  }, [branches, search, filterType, filterCompany]);

  const totalCount = filtered.length;
  const paginated = filtered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setSearch(value); setPageIndex(0); }, 300);
  };

  // ── Modal ──

  const openCreate = () => {
    setModalMode('create');
    setModalOrig(null);
    const firstCompany = companies[0];
    setModalData({
      ...EMPTY_EDIT,
      company_id: firstCompany?.id,
      branch_type: allowedBranchTypes(firstCompany?.company_type)[0] ?? '',
      code: '',
    });
    setModalError('');
    setModalOpen(true);
  };

  const openEdit = (b: Branch) => {
    setModalMode('edit');
    setModalOrig(b);
    setModalData({
      id: b.id,
      company_id: b.company_id,
      code: b.code,
      name: b.name,
      branch_type: b.branch_type,
      is_company_warehouse: false,
      address: b.address ?? '',
      phone: b.phone ?? '',
      branch_lat: b.branch_lat != null ? String(b.branch_lat) : '',
      branch_lng: b.branch_lng != null ? String(b.branch_lng) : '',
      line_id: b.line_id ?? '',
      google_map_url: b.google_map_url ?? '',
      facebook_url: b.facebook_url ?? '',
      is_active: b.is_active,
    });
    setModalError('');
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setModalError(''); };

  const handleSave = async () => {
    setModalError('');
    setModalSaving(true);
    try {
      if (modalMode === 'create') {
        await apiClient.rpc('fn_branch_create', {
          p_company_id: modalData.company_id,
          p_code: modalData.code,
          p_name: modalData.name,
          p_branch_type: modalData.branch_type,
          // An explicit null hits branches.address NOT NULL and returns a raw
          // Postgres 23502 (verified on DEV 2026-09-18); omitting the param lets
          // the RPC default it. So only send it when the user typed something.
          ...(modalData.address ? { p_address: modalData.address } : {}),
          // mig 1269 — only meaningful for an internal branch; sending true on
          // any other type is refused with WAREHOUSE_BRANCH_TYPE.
          p_is_company_warehouse: modalData.branch_type === 'INTERNAL' && modalData.is_company_warehouse,
        });
      } else if (modalOrig) {
        const patch = buildUpdatePatch(modalOrig, modalData);
        // Only call the update RPC if something actually changed.
        if (Object.keys(patch).length > 1) {
          await apiClient.rpc('fn_branch_update', patch);
        }
        if (modalOrig.branch_type !== modalData.branch_type) {
          await apiClient.rpc('fn_branch_change_type', {
            p_branch_id: modalOrig.id,
            p_branch_type: modalData.branch_type,
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ['branches-list'] });
      closeModal();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setModalError(translated || err.message);
      } else setModalError(String(err));
    } finally { setModalSaving(false); }
  };

  const handleDeactivate = async () => {
    if (!modalData.id) return;
    setModalError('');
    setModalSaving(true);
    try {
      await apiClient.rpc('fn_branch_deactivate', { p_branch_id: modalData.id });
      queryClient.invalidateQueries({ queryKey: ['branches-list'] });
      closeModal();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setModalError(translated || err.message);
      } else setModalError(String(err));
    } finally { setModalSaving(false); }
  };

  const activeFilterCount = (filterType ? 1 : 0) + (filterCompany ? 1 : 0);

  // Resolve company name once per row so we don't keep doing array.find inside render.
  const companyById = useMemo(
    () => new Map(companies.map(c => [c.id, c.name])),
    [companies],
  );

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">{t('branches.title')}</div>
        <div className="mobile-header-end">
          <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-primary-fg" onClick={openCreate}>
            <Plus size={20} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('branches.title')}</h1>
            <p className="text-sm text-subtle mt-1">{t('branches.description')}</p>
          </div>
          <Button color="primary" startIcon={<Plus size={16} />} onClick={openCreate}>
            {t('org.addBranch')}
          </Button>
        </div>

        {/* Filters */}
        <div className="flex-none pb-4">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Input placeholder={t('common.search')} value={searchInput} onChange={(e) => handleSearch(e.target.value)} size="sm" startIcon={<Search size={16} />} className="w-full" />
            </div>
            {/* Company filter — visible ≥sm, holding-level+ only */}
            {isHoldingLevel && companies.length > 1 && (
              <div className="hidden sm:block flex-1 min-w-0">
                <Select
                  value={filterCompany || null}
                  onChange={(val) => { setFilterCompany((val as string) ?? ''); setPageIndex(0); }}
                  options={companies.map(c => ({ value: String(c.id), label: c.name }))}
                  placeholder={t('branches.allCompanies')}
                  size="sm"
                  showChevron
                  clearable
                  searchable={false}
                />
              </div>
            )}
            {/* Type filter — visible ≥md (or ≥sm if no company filter) */}
            <div className={`${isHoldingLevel && companies.length > 1 ? 'hidden md:block' : 'hidden sm:block'} flex-1 min-w-0`}>
              <Select
                value={filterType || null}
                onChange={(val) => { setFilterType((val as string) ?? ''); setPageIndex(0); }}
                options={allBranchTypes.map(bt => ({ value: bt, label: t(`org.branchType.${bt}`, { defaultValue: bt }) }))}
                placeholder={t('branches.allTypes')}
                size="sm"
                showChevron
                clearable
                searchable={false}
              />
            </div>
            {/* Filter/sort popover — visible <sm (or <md when company filter exists) */}
            <div className={isHoldingLevel && companies.length > 1 ? 'md:hidden shrink-0' : 'sm:hidden shrink-0'}>
              <PopOver
                isOpen={filterOpen}
                onClose={() => setFilterOpen(false)}
                placement="bottom"
                align="end"
                maxWidth="300px"
                maxHeight="400px"
                trigger={
                  <div className="relative inline-flex">
                    <Button
                      variant="outline"
                      size="sm"
                      startIcon={<SlidersHorizontal size={16} />}
                      onClick={() => setFilterOpen(!filterOpen)}
                    />
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none pointer-events-none">
                        {activeFilterCount}
                      </span>
                    )}
                  </div>
                }
              >
                <div className="flex flex-col gap-3 p-3">
                  <div className="text-xs font-medium text-subtle uppercase tracking-wide">{t('common.filters')}</div>
                  {isHoldingLevel && companies.length > 1 && (
                    <Select
                      options={companies.map(c => ({ value: String(c.id), label: c.name }))}
                      value={filterCompany || null}
                      onChange={(val) => { setFilterCompany((val as string) ?? ''); setPageIndex(0); }}
                      placeholder={t('branches.allCompanies')}
                      size="sm"
                      showChevron
                      clearable
                      searchable={false}
                    />
                  )}
                  <Select
                    options={allBranchTypes.map(bt => ({ value: bt, label: t(`org.branchType.${bt}`, { defaultValue: bt }) }))}
                    value={filterType || null}
                    onChange={(val) => { setFilterType((val as string) ?? ''); setPageIndex(0); }}
                    placeholder={t('branches.allTypes')}
                    size="sm"
                    showChevron
                    clearable
                    searchable={false}
                  />
                  <div className="text-xs font-medium text-subtle uppercase tracking-wide mt-1">{t('common.sortBy')}</div>
                  <Select
                    options={[
                      { value: 'code', label: t('org.code') },
                      { value: 'name', label: t('org.name') },
                    ]}
                    value={sorting[0]?.id ?? null}
                    onChange={(val) => {
                      if (val) setSorting([{ id: val as string, desc: sorting[0]?.desc ?? false }]);
                      else setSorting([]);
                      setPageIndex(0);
                    }}
                    placeholder={t('common.sortBy')}
                    size="sm"
                    showChevron
                    clearable
                    searchable={false}
                  />
                  {sorting.length > 0 && (
                    <Select
                      options={[
                        { value: 'asc', label: t('common.ascending') },
                        { value: 'desc', label: t('common.descending') },
                      ]}
                      value={sorting[0]?.desc ? 'desc' : 'asc'}
                      onChange={(val) => {
                        setSorting([{ id: sorting[0].id, desc: (val as string) === 'desc' }]);
                        setPageIndex(0);
                      }}
                      size="sm"
                      showChevron
                      searchable={false}
                    />
                  )}
                </div>
              </PopOver>
            </div>
          </div>
        </div>

        {/* Desktop DataTable */}
        <DataTable<Branch>
          data={paginated}
          sorting={sorting}
          onSortingChange={setSorting}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
          className={`flex-1 min-h-0 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={<div className="p-8 text-center text-subtle">{isLoading ? t('common.loading') : t('common.noData')}</div>}
          renderRow={(row) => {
            const b = row.original;
            const companyName = companyById.get(b.company_id);
            return (
              <div
                className="flex items-start gap-3 px-3 py-2.5 transition-colors cursor-pointer"
                onClick={() => openEdit(b)}
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-sm font-medium truncate">{b.name}</span>
                    <span className="text-[11px] text-subtle font-mono">{b.code}</span>
                    <Badge size="sm" color={BRANCH_TYPE_COLORS[b.branch_type] ?? 'default'}>
                      {t(`org.branchType.${b.branch_type}`, { defaultValue: b.branch_type })}
                    </Badge>
                    {warehouseIds.has(b.id) && (
                      <Badge size="sm" color="success">{t('org.warehouseBadge')}</Badge>
                    )}
                    {!b.is_active && (
                      <Badge size="sm" color="default">{t('common.inactive')}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-x-3 gap-y-0.5 text-[11px] text-subtle flex-wrap min-w-0">
                    {isHoldingLevel && companyName && (
                      <span className="truncate">{companyName}</span>
                    )}
                    {b.address && (
                      <span className="truncate">{b.address}</span>
                    )}
                    {b.phone && (
                      <span className="tabular-nums shrink-0">{b.phone}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer bg-transparent border-none"
                  onClick={(e) => { e.stopPropagation(); openEdit(b); }}
                  aria-label={t('common.edit')}
                >
                  <Pencil size={14} className="opacity-50" />
                </button>
              </div>
            );
          }}
        />
      </div>

      {/* Create/Edit Modal */}
      <Modal open={modalOpen} onClose={closeModal} maxWidth="28rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{modalMode === 'create' ? t('org.createBranch') : t('org.editBranch')}</h2>
        </div>
        <div className="modal-content">
          <div className="form-grid">
            {/* Company — create only */}
            {modalMode === 'create' && companies.length > 1 && (
              <div className="flex flex-col">
                <label className="form-label">{t('settings.company')}</label>
                <Select
                  value={String(modalData.company_id ?? '')}
                  onChange={(val) => {
                    const nextCompany = companies.find(c => c.id === Number(val));
                    const nextAllowed = allowedBranchTypes(nextCompany?.company_type);
                    // Switching company can make the chosen branch type illegal
                    // (a shop under an operating company, an internal branch
                    // under a fund). Re-seed instead of letting the RPC refuse.
                    setModalData(d => ({
                      ...d,
                      company_id: Number(val),
                      branch_type: nextAllowed.includes(d.branch_type) ? d.branch_type : (nextAllowed[0] ?? ''),
                      is_company_warehouse: false,
                    }));
                  }}
                  options={companies.map(c => ({ value: String(c.id), label: c.name }))}
                  size="md"
                />
                {modalCompanyType && (
                  <div className="text-xs text-subtle mt-1">{typeName(modalCompanyType)}</div>
                )}
              </div>
            )}
            <div className="flex flex-col">
              <label className="form-label">{t('org.code')}</label>
              <Input value={modalData.code ?? ''} onChange={(e) => updateField('code', e.target.value)} placeholder={t('org.codePlaceholder')} size="md" className="w-full" />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('org.name')}</label>
              <Input value={modalData.name} onChange={(e) => updateField('name', e.target.value)} size="md" className="w-full" />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('org.branchTypeLabel')}</label>
              {/* Options are this company's allowed_branch_types (mig 1257) —
                  a deal partner shop simply does not appear under an operating
                  company, so BRANCH_TYPE_NOT_ALLOWED_FOR_COMPANY_TYPE becomes
                  unreachable from the form. */}
              <Select
                value={modalData.branch_type || null}
                onChange={(val) => setModalData(d => ({
                  ...d,
                  branch_type: (val as string) ?? '',
                  // The tick only belongs to an internal branch.
                  is_company_warehouse: val === 'INTERNAL' ? d.is_company_warehouse : false,
                }))}
                options={modalBranchTypes.map(bt => ({ value: bt, label: t(`org.branchType.${bt}`, { defaultValue: bt }) }))}
                size="md"
                searchable={false}
              />
              {modalBranchTypes.length === 0 && modalCompanyType && (
                <div className="text-xs text-warning-fg mt-1">{t('org.noBranchTypeForCompany')}</div>
              )}
            </div>

            {/* Edit has no toggle — the flag moves through
                fn_deal_partner_warehouse_set on the deal-partner settings page,
                not fn_branch_update. Show it so the row is not a mystery. */}
            {modalMode === 'edit' && modalData.id != null && warehouseIds.has(modalData.id) && (
              <div className="flex flex-col">
                <label className="form-label">{t('org.isCompanyWarehouse')}</label>
                <Badge size="sm" color="success">{t('org.warehouseBadge')}</Badge>
              </div>
            )}

            {/* Company warehouse (mig 1269) — internal branches only, and an
                internal branch under a fund company HAS to be the warehouse. */}
            {warehouseApplies && (
              <div className="flex flex-col">
                <LabeledCheckbox
                  label={t('org.isCompanyWarehouse')}
                  checked={modalData.is_company_warehouse}
                  onChange={(e) => updateField('is_company_warehouse', e.target.checked)}
                />
                <div className="text-xs text-subtle mt-1">{t('org.isCompanyWarehouseHint')}</div>
                {warehouseRequired && !modalData.is_company_warehouse && (
                  <div className="text-xs text-warning-fg mt-1">{t('org.isCompanyWarehouseRequired')}</div>
                )}
              </div>
            )}
            <div className="flex flex-col">
              <label className="form-label">{t('org.address')}</label>
              <Input value={modalData.address} onChange={(e) => updateField('address', e.target.value)} size="md" className="w-full" />
            </div>

            {/* Edit-only fields — fn_branch_update accepts them; fn_branch_create
                does not. Hidden on create. */}
            {modalMode === 'edit' && (
              <>
                <div className="flex flex-col">
                  <label className="form-label">{t('branches.phone')}</label>
                  <PhoneInput value={modalData.phone} onChange={(raw) => updateField('phone', raw)} size="md" className="w-full" />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('branches.lineId')}</label>
                  <Input value={modalData.line_id} onChange={(e) => updateField('line_id', e.target.value)} size="md" className="w-full" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <label className="form-label">{t('branches.lat')}</label>
                    <Input value={modalData.branch_lat} onChange={(e) => updateField('branch_lat', e.target.value)} size="md" className="w-full" placeholder="13.7563" inputMode="decimal" />
                  </div>
                  <div className="flex flex-col">
                    <label className="form-label">{t('branches.lng')}</label>
                    <Input value={modalData.branch_lng} onChange={(e) => updateField('branch_lng', e.target.value)} size="md" className="w-full" placeholder="100.5018" inputMode="decimal" />
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('branches.googleMapUrl')}</label>
                  <Input
                    value={modalData.google_map_url}
                    onChange={(e) => updateField('google_map_url', e.target.value)}
                    size="md"
                    className="w-full"
                    placeholder="https://maps.app.goo.gl/..."
                    endIcon={isPreviewableUrl(modalData.google_map_url) ? <ExternalLink size={14} /> : undefined}
                    onEndIconClick={isPreviewableUrl(modalData.google_map_url)
                      ? () => window.open(modalData.google_map_url, '_blank', 'noopener,noreferrer')
                      : undefined}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('branches.facebookUrl')}</label>
                  <Input
                    value={modalData.facebook_url}
                    onChange={(e) => updateField('facebook_url', e.target.value)}
                    size="md"
                    className="w-full"
                    placeholder="https://facebook.com/..."
                    endIcon={isPreviewableUrl(modalData.facebook_url) ? <ExternalLink size={14} /> : undefined}
                    onEndIconClick={isPreviewableUrl(modalData.facebook_url)
                      ? () => window.open(modalData.facebook_url, '_blank', 'noopener,noreferrer')
                      : undefined}
                  />
                </div>
              </>
            )}

          </div>
        </div>
        <ModalErrorBand message={modalError} />
        <div className="modal-footer">
          {modalMode === 'edit' && modalData.is_active !== false && (
            <Button variant="ghost" color="danger" size="sm" startIcon={<Power size={14} />} onClick={handleDeactivate} disabled={modalSaving} className="mr-auto">
              {t('org.deactivate')}
            </Button>
          )}
          <Button variant="ghost" onClick={closeModal} disabled={modalSaving}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={handleSave}
            disabled={modalSaving || !modalData.branch_type || (warehouseRequired && !modalData.is_company_warehouse)}
          >
            {modalSaving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
