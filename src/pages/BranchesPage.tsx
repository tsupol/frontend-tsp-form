import { useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader,
  Input, Badge, Modal, Button, Select, PopOver,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Plus, Pencil, Power, Search, SlidersHorizontal } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface Branch {
  id: number;
  company_id: number;
  code: string;
  name: string;
  branch_type: 'INTERNAL' | 'EXTERNAL' | 'DEAL_PARTNER';
  is_active: boolean;
  address: string | null;
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
  const [modalData, setModalData] = useState<Record<string, unknown>>({});
  const [modalError, setModalError] = useState('');
  const [modalSaving, setModalSaving] = useState(false);

  const { data: branches = [], isFetching, isLoading } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name'),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['branches-companies'],
    queryFn: () => apiClient.get<Company[]>('/v_companies?order=name&select=id,name'),
  });

  const companyMap = useMemo(() => new Map(companies.map(c => [c.id, c.name])), [companies]);

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
    setModalData({ company_id: companies[0]?.id ?? '', code: '', name: '', branch_type: 'INTERNAL', address: '' });
    setModalError('');
    setModalOpen(true);
  };

  const openEdit = (b: Branch) => {
    setModalMode('edit');
    setModalData({ id: b.id, company_id: b.company_id, code: b.code, name: b.name, branch_type: b.branch_type, address: b.address ?? '', is_active: b.is_active });
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
          p_address: (modalData.address as string) || null,
        });
      } else {
        await apiClient.rpc('fn_branch_update', {
          p_branch_id: modalData.id,
          p_name: modalData.name,
          p_address: (modalData.address as string) || null,
        });
        // Change type if different
        const orig = branches.find(b => b.id === modalData.id);
        if (orig && orig.branch_type !== modalData.branch_type) {
          await apiClient.rpc('fn_branch_change_type', {
            p_branch_id: modalData.id,
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

  // ── Columns ──

  const columns: ColumnDef<Branch>[] = [
    {
      accessorKey: 'code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('org.code')} />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
      className: 'w-[15%] min-w-24',
    },
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('org.name')} />,
      cell: ({ row }) => <span className="text-sm">{row.original.name}</span>,
      className: 'w-[30%] min-w-40',
    },
    {
      accessorKey: 'branch_type',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('org.branchTypeLabel')} />,
      cell: ({ row }) => (
        <Badge size="sm" color={BRANCH_TYPE_COLORS[row.original.branch_type] ?? 'default'}>
          {t(`org.branchType.${row.original.branch_type}`)}
        </Badge>
      ),
      className: 'w-[15%] min-w-28',
    },
    {
      accessorKey: 'address',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('org.address')} />,
      cell: ({ row }) => <span className="text-xs text-subtle truncate">{row.original.address ?? '—'}</span>,
      className: 'w-[25%] min-w-32',
    },
    {
      id: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('common.status')} />,
      cell: ({ row }) => row.original.is_active
        ? <Badge size="sm" color="success">{t('common.active')}</Badge>
        : <Badge size="sm" color="default">{t('common.inactive')}</Badge>,
      className: 'w-[10%] min-w-20',
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <button
          className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); openEdit(row.original); }}
          aria-label={t('common.edit')}
        >
          <Pencil size={14} className="opacity-50" />
        </button>
      ),
      enableSorting: false,
      className: 'w-10',
    },
  ];

  const activeFilterCount = (filterType ? 1 : 0) + (filterCompany ? 1 : 0);

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
          <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-primary" onClick={openCreate}>
            <Plus size={20} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('branches.title')}</h1>
            <p className="text-sm text-fg/60 mt-1">{t('branches.description')}</p>
          </div>
          <Button size="sm" color="primary" startIcon={<Plus size={16} />} onClick={openCreate}>
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
                  <Button variant="outline" size="sm" className="relative btn-icon-sm" onClick={() => setFilterOpen(!filterOpen)}>
                    <SlidersHorizontal size={16} />
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>
                }
              >
                <div className="flex flex-col gap-3 p-3">
                  <div className="text-xs font-medium text-muted uppercase tracking-wide">{t('common.filters')}</div>
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
                  <div className="text-xs font-medium text-muted uppercase tracking-wide mt-1">{t('common.sortBy')}</div>
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
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={<div className="p-8 text-center text-control-label">{isLoading ? t('common.loading') : t('common.noData')}</div>}
        />

        {/* Mobile cards */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60' : ''}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-control-label">{isLoading ? t('common.loading') : t('common.noData')}</div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {paginated.map(b => (
                  <div key={b.id} className="px-4 py-3 cursor-pointer active:bg-surface-hover" onClick={() => openEdit(b)}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{b.name}</span>
                      <span className="text-xs text-subtle font-mono">{b.code}</span>
                      <Badge size="sm" color={BRANCH_TYPE_COLORS[b.branch_type] ?? 'default'}>
                        {t(`org.branchType.${b.branch_type}`)}
                      </Badge>
                      {!b.is_active && <Badge size="sm" color="default">{t('common.inactive')}</Badge>}
                    </div>
                    {b.address && <div className="text-xs text-subtle mt-0.5 truncate">{b.address}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {totalCount > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(totalCount / pageSize)}
              onPageChange={(p) => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[25, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
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
                  onChange={(val) => setModalData(d => ({ ...d, company_id: Number(val) }))}
                  options={companies.map(c => ({ value: String(c.id), label: c.name }))}
                  size="md"
                />
              </div>
            )}
            {modalMode === 'create' && (
              <div className="flex flex-col">
                <label className="form-label">{t('org.code')}</label>
                <Input value={(modalData.code as string) ?? ''} onChange={(e) => setModalData(d => ({ ...d, code: e.target.value }))} placeholder={t('org.codePlaceholder')} size="md" className="w-full" />
              </div>
            )}
            <div className="flex flex-col">
              <label className="form-label">{t('org.name')}</label>
              <Input value={(modalData.name as string) ?? ''} onChange={(e) => setModalData(d => ({ ...d, name: e.target.value }))} size="md" className="w-full" />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('org.branchTypeLabel')}</label>
              <Select
                value={modalData.branch_type as string}
                onChange={(val) => setModalData(d => ({ ...d, branch_type: val as string }))}
                options={BRANCH_TYPE_OPTIONS.map(bt => ({ value: bt, label: t(`org.branchType.${bt}`) }))}
                size="md"
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('org.address')}</label>
              <Input value={(modalData.address as string) ?? ''} onChange={(e) => setModalData(d => ({ ...d, address: e.target.value }))} size="md" className="w-full" />
            </div>
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
