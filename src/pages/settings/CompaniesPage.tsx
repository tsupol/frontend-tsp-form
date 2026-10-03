import { useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, MobileHeader,
  Input, Badge, Modal, Button, Select,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Plus, Pencil, Power, Tag } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { useAuth } from '../../contexts/AuthContext';
import { useCompanyTypes } from '../../hooks/useCompanyTypes';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';

interface Company {
  id: number;
  holding_id: number;
  holding_name: string;
  code: string;
  name: string;
  is_active: boolean;
  /** mig 1257 — OPERATING / FINANCIER. Read from v_ref_company_types, never hardcoded. */
  company_type: string | null;
  company_type_name: string | null;
}

export function CompaniesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // fn_company_set_type needs COMPANY.CREATE, held by HOLDING_ADMIN. Role here
  // only hides the button; the backend still refuses anyone else.
  const canSetType = ['HOLDING_ADMIN', 'SYSTEM_DEV'].includes(user?.role_code ?? '');
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [modalData, setModalData] = useState<Record<string, unknown>>({});
  const [modalError, setModalError] = useState('');
  const [modalSaving, setModalSaving] = useState(false);

  // Change-type modal (item ค) — separate from the create/edit modal because
  // fn_company_set_type is its own RPC with its own failure (COMPANY_TYPE_LOCKED)
  // and its own success payload (old_type → company_type).
  const [typeTarget, setTypeTarget] = useState<Company | null>(null);
  const [typeValue, setTypeValue] = useState('');
  const [typeError, setTypeError] = useState('');
  const [typeSaving, setTypeSaving] = useState(false);
  const [typeView, setTypeView] = useState<'form' | 'done'>('form');
  const [typeResult, setTypeResult] = useState<{ old_type: string; company_type: string; changed: boolean } | null>(null);

  const { options: companyTypeOptions, typeName, defaultType } = useCompanyTypes();

  const { data: companies = [], isFetching, isLoading } = useQuery({
    queryKey: ['settings-companies'],
    queryFn: () => apiClient.get<Company[]>('/v_companies?order=holding_name,name'),
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return companies;
    const term = search.trim().toLowerCase();
    return companies.filter(c =>
      c.name.toLowerCase().includes(term) ||
      c.code.toLowerCase().includes(term) ||
      c.holding_name.toLowerCase().includes(term)
    );
  }, [companies, search]);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value), 300);
  };

  const openCreate = () => {
    setModalMode('create');
    setModalData({ code: '', name: '', company_type: defaultType });
    setModalError('');
    setModalOpen(true);
  };

  const openEdit = (c: Company) => {
    setModalMode('edit');
    setModalData({ id: c.id, code: c.code, name: c.name, is_active: c.is_active, holding_name: c.holding_name, company_type: c.company_type });
    setModalError('');
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setModalError(''); };

  const handleSave = async () => {
    setModalError('');
    setModalSaving(true);
    try {
      if (modalMode === 'create') {
        await apiClient.rpc('fn_company_create', {
          p_code: modalData.code,
          p_name: modalData.name,
          p_company_type: modalData.company_type,
        });
      } else {
        await apiClient.rpc('fn_company_update', { p_company_id: modalData.id, p_name: modalData.name });
      }
      queryClient.invalidateQueries({ queryKey: ['settings-companies'] });
      closeModal();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setModalError(translated || err.message);
      } else setModalError(String(err));
    } finally { setModalSaving(false); }
  };

  const handleDeactivate = async () => {
    setModalError('');
    setModalSaving(true);
    try {
      await apiClient.rpc('fn_company_deactivate', { p_company_id: modalData.id });
      queryClient.invalidateQueries({ queryKey: ['settings-companies'] });
      closeModal();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setModalError(translated || err.message);
      } else setModalError(String(err));
    } finally { setModalSaving(false); }
  };

  // ── Change company type (item ค) ──────────────────────────────────────────
  const openChangeType = (c: Company) => {
    setTypeTarget(c);
    setTypeValue(c.company_type ?? defaultType);
    setTypeError('');
    setTypeView('form');
    setTypeResult(null);
  };

  const closeChangeType = () => { setTypeTarget(null); setTypeError(''); };

  const handleChangeTypeClose = () => {
    // Nothing is typed here — one Select — so a dirty guard would only nag.
    // Once the RPC has run the form is gone anyway.
    closeChangeType();
  };

  const handleSetType = async () => {
    if (!typeTarget) return;
    setTypeError('');
    setTypeSaving(true);
    try {
      const res = await apiClient.rpc<{ old_type: string; company_type: string; changed: boolean }>(
        'fn_company_set_type',
        { p_company_id: typeTarget.id, p_company_type: typeValue },
      );
      setTypeResult(res);
      setTypeView('done');
      queryClient.invalidateQueries({ queryKey: ['settings-companies'] });
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setTypeError(translated || err.message);
      } else setTypeError(String(err));
    } finally { setTypeSaving(false); }
  };

  const columns: ColumnDef<Company>[] = [
    {
      accessorKey: 'code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('org.code')} />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
      className: 'w-[15%] min-w-24',
    },
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('org.name')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      className: 'w-[28%] min-w-40',
    },
    {
      accessorKey: 'holding_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.holding')} />,
      cell: ({ row }) => <span className="text-sm text-subtle">{row.original.holding_name}</span>,
      className: 'w-[18%] min-w-28',
    },
    {
      id: 'company_type',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('org.companyType')} />,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm truncate">
            {/* v_companies ships a Thai name_th; the ref view is what decides the
                label per language, so resolve through the hook and fall back to
                the view's own name only while the ref view is still loading. */}
            {typeName(row.original.company_type) || row.original.company_type_name || '—'}
          </span>
          {canSetType && (
            <button
              type="button"
              className="shrink-0 p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer bg-transparent border-none"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); openChangeType(row.original); }}
              aria-label={t('org.changeCompanyType')}
            >
              <Tag size={13} className="opacity-50" />
            </button>
          )}
        </div>
      ),
      enableSorting: false,
      className: 'w-[20%] min-w-32',
    },
    {
      id: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('common.status')} />,
      cell: ({ row }) => row.original.is_active
        ? <Badge size="sm" color="success">{t('common.active')}</Badge>
        : <Badge size="sm" color="default">{t('common.inactive')}</Badge>,
      className: 'w-[12%] min-w-20',
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
        <div className="mobile-header-title mobile-header-title-truncate">{t('settings.companies')}</div>
        <div className="mobile-header-end">
          <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-primary-fg" onClick={openCreate}>
            <Plus size={20} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('settings.companies')}</h1>
            <p className="text-sm text-subtle mt-1">{t('settings.companiesDesc')}</p>
          </div>
          <Button size="sm" color="primary" startIcon={<Plus size={16} />} onClick={openCreate}>
            {t('org.addCompany')}
          </Button>
        </div>

        <div className="flex-none pb-4">
          <div className="w-full max-w-56 min-w-0">
            <Input placeholder={t('common.search')} value={searchInput} onChange={(e) => handleSearch(e.target.value)} size="sm" className="w-full" />
          </div>
        </div>

        <DataTable<Company>
          outlined
          data={filtered}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={<div className="p-8 text-center text-subtle">{isLoading ? t('common.loading') : t('common.noData')}</div>}
        />

        {/* Mobile cards */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60' : ''}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-subtle">{isLoading ? t('common.loading') : t('common.noData')}</div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {filtered.map(c => (
                  <div key={c.id} className="px-4 py-3 cursor-pointer active:bg-surface-hover" onClick={() => openEdit(c)}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{c.name}</span>
                      <span className="text-xs text-subtle font-mono">{c.code}</span>
                      {!c.is_active && <Badge size="sm" color="default">{t('common.inactive')}</Badge>}
                    </div>
                    <div className="text-xs text-subtle mt-0.5">
                      {c.holding_name}
                      {(typeName(c.company_type) || c.company_type_name) && (
                        <> · {typeName(c.company_type) || c.company_type_name}</>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal */}
      <Modal open={modalOpen} onClose={closeModal} maxWidth="28rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{modalMode === 'create' ? t('org.createCompany') : t('org.editCompany')}</h2>
        </div>
        <div className="modal-content">
          <div className="form-grid">
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
            {/* Company type — options come from v_ref_company_types, never a
                literal list. Create only: after creation it changes through
                fn_company_set_type, which enforces the empty-company rule. */}
            {modalMode === 'create' ? (
              <div className="flex flex-col">
                <label className="form-label">{t('org.companyTypeLabel')}</label>
                <Select
                  value={(modalData.company_type as string) || null}
                  onChange={(val) => setModalData(d => ({ ...d, company_type: val as string }))}
                  options={companyTypeOptions}
                  size="md"
                  searchable={false}
                />
              </div>
            ) : (
              <div className="flex flex-col">
                <label className="form-label">{t('org.companyTypeLabel')}</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{typeName(modalData.company_type as string) || '—'}</span>
                  {canSetType && (
                    <Button
                      variant="outline"
                      size="sm"
                      startIcon={<Tag size={14} />}
                      onClick={() => {
                        const target = companies.find(c => c.id === modalData.id);
                        if (target) { closeModal(); openChangeType(target); }
                      }}
                    >
                      {t('org.changeCompanyType')}
                    </Button>
                  )}
                </div>
              </div>
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
          <Button color="primary" onClick={handleSave} disabled={modalSaving}>{modalSaving ? t('common.saving') : t('common.save')}</Button>
        </div>
      </Modal>

      {/* Change company type — HOLDING_ADMIN only. The RPC locks the type once
          the company owns branches / devices / contracts, and the refusal names
          the counts, so the error band is the whole explanation. */}
      <Modal open={!!typeTarget} onClose={handleChangeTypeClose} maxWidth="26rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('org.changeCompanyTypeTitle')}</h2>
        </div>
        {typeView === 'done' && typeResult ? (
          <ActionDoneView
            headline={typeResult.changed ? t('org.companyTypeChanged') : t('org.companyTypeUnchanged')}
            contractCode={typeTarget?.name ?? ''}
            tone={typeResult.changed ? 'success' : 'neutral'}
            detailRows={[
              { label: t('org.companyTypeFrom'), value: typeName(typeResult.old_type) || typeResult.old_type },
              { label: t('org.companyTypeTo'), value: typeName(typeResult.company_type) || typeResult.company_type, emphasis: true },
            ]}
            onClose={closeChangeType}
          />
        ) : (
          <>
            <div className="modal-content">
              <div className="form-grid">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{typeTarget?.name}</div>
                  <div className="text-xs text-subtle font-mono">{typeTarget?.code}</div>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('org.companyTypeLabel')}</label>
                  <Select
                    value={typeValue || null}
                    onChange={(val) => setTypeValue(val as string)}
                    options={companyTypeOptions}
                    size="md"
                    searchable={false}
                  />
                  <div className="text-xs text-subtle mt-1">{t('org.changeCompanyTypeHint')}</div>
                </div>
              </div>
            </div>
            <ModalErrorBand message={typeError} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleChangeTypeClose} disabled={typeSaving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleSetType} disabled={typeSaving || !typeValue}>
                {typeSaving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
