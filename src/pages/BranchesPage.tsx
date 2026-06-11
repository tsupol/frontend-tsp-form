import { useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, MobileHeader,
  Input, Badge, Modal, Button, Select, PopOver,
  type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, ExternalLink, Plus, Pencil, Power, Search, SlidersHorizontal } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { PhoneInput } from '../components/PhoneInput';

// ── Types ────────────────────────────────────────────────────────────────────

interface Branch {
  id: number;
  company_id: number;
  code: string;
  name: string;
  branch_type: 'INTERNAL' | 'EXTERNAL' | 'DEAL_PARTNER';
  is_active: boolean;
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
  branch_type: 'INTERNAL' | 'EXTERNAL' | 'DEAL_PARTNER';
  address: string;
  phone: string;
  branch_lat: string;
  branch_lng: string;
  line_id: string;
  google_map_url: string;
  facebook_url: string;
  is_active?: boolean;
}

const EMPTY_EDIT: BranchEditModel = {
  name: '', branch_type: 'INTERNAL', address: '', phone: '',
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
    key: 'name' | 'address' | 'phone' | 'line_id' | 'google_map_url' | 'facebook_url',
    rpcKey: string,
  ) => {
    const before = (orig[key] as string | null | undefined) ?? '';
    const after = next[key] ?? '';
    if (before === after) return;
    patch[rpcKey] = after;
  };
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
}

const BRANCH_TYPE_OPTIONS = ['INTERNAL', 'EXTERNAL', 'DEAL_PARTNER'] as const;
const BRANCH_TYPE_COLORS = { INTERNAL: 'info', EXTERNAL: 'warning', DEAL_PARTNER: 'secondary' } as const;

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
    queryFn: () => apiClient.get<Company[]>('/v_companies?order=name&select=id,name'),
  });

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
    setModalData({
      ...EMPTY_EDIT,
      company_id: companies[0]?.id,
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
          p_address: modalData.address || null,
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
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
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
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
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
                options={BRANCH_TYPE_OPTIONS.map(bt => ({ value: bt, label: t(`org.branchType.${bt}`) }))}
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
                    options={BRANCH_TYPE_OPTIONS.map(bt => ({ value: bt, label: t(`org.branchType.${bt}`) }))}
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
                className="flex items-start gap-3 px-3 py-2.5 border-b border-line hover:bg-surface-hover transition-colors cursor-pointer"
                onClick={() => openEdit(b)}
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-sm font-medium truncate">{b.name}</span>
                    <span className="text-[11px] text-subtle font-mono">{b.code}</span>
                    <Badge size="sm" color={BRANCH_TYPE_COLORS[b.branch_type] ?? 'default'}>
                      {t(`org.branchType.${b.branch_type}`)}
                    </Badge>
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
                  onChange={(val) => updateField('company_id', Number(val))}
                  options={companies.map(c => ({ value: String(c.id), label: c.name }))}
                  size="md"
                />
              </div>
            )}
            {modalMode === 'create' && (
              <div className="flex flex-col">
                <label className="form-label">{t('org.code')}</label>
                <Input value={modalData.code ?? ''} onChange={(e) => updateField('code', e.target.value)} placeholder={t('org.codePlaceholder')} size="md" className="w-full" />
              </div>
            )}
            <div className="flex flex-col">
              <label className="form-label">{t('org.name')}</label>
              <Input value={modalData.name} onChange={(e) => updateField('name', e.target.value)} size="md" className="w-full" />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('org.branchTypeLabel')}</label>
              <Select
                value={modalData.branch_type}
                onChange={(val) => updateField('branch_type', val as BranchEditModel['branch_type'])}
                options={BRANCH_TYPE_OPTIONS.map(bt => ({ value: bt, label: t(`org.branchType.${bt}`) }))}
                size="md"
              />
            </div>
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

            {modalError && <div className="alert alert-danger"><div className="alert-description">{modalError}</div></div>}
          </div>
        </div>
        <div className="modal-footer">
          {modalMode === 'edit' && modalData.is_active !== false && (
            <Button variant="ghost" color="danger" size="sm" startIcon={<Power size={14} />} onClick={handleDeactivate} disabled={modalSaving} className="mr-auto">
              {t('org.deactivate')}
            </Button>
          )}
          <Button variant="ghost" onClick={closeModal} disabled={modalSaving}>{t('common.cancel')}</Button>
          <Button color="primary" onClick={handleSave} disabled={modalSaving}>{modalSaving ? t('common.saving') : t('common.save')}</Button>
        </div>
      </Modal>
    </>
  );
}
