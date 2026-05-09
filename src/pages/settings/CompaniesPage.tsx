import { useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, MobileHeader,
  Input, Badge, Modal, Button,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Plus, Pencil, Power } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';

interface Company {
  id: number;
  holding_id: number;
  holding_name: string;
  code: string;
  name: string;
  is_active: boolean;
}

export function CompaniesPage() {
  const { t } = useTranslation();
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
    setModalData({ code: '', name: '' });
    setModalError('');
    setModalOpen(true);
  };

  const openEdit = (c: Company) => {
    setModalMode('edit');
    setModalData({ id: c.id, code: c.code, name: c.name, is_active: c.is_active, holding_name: c.holding_name });
    setModalError('');
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setModalError(''); };

  const handleSave = async () => {
    setModalError('');
    setModalSaving(true);
    try {
      if (modalMode === 'create') {
        await apiClient.rpc('fn_company_create', { p_code: modalData.code, p_name: modalData.name });
      } else {
        await apiClient.rpc('fn_company_update', { p_company_id: modalData.id, p_name: modalData.name });
      }
      queryClient.invalidateQueries({ queryKey: ['settings-companies'] });
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
      await apiClient.rpc('fn_company_deactivate', { p_company_id: modalData.id });
      queryClient.invalidateQueries({ queryKey: ['settings-companies'] });
      closeModal();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setModalError(translated || err.message);
      } else setModalError(String(err));
    } finally { setModalSaving(false); }
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
      className: 'w-[35%] min-w-40',
    },
    {
      accessorKey: 'holding_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('settings.holding')} />,
      cell: ({ row }) => <span className="text-sm text-subtle">{row.original.holding_name}</span>,
      className: 'w-[25%] min-w-32',
    },
    {
      id: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('common.status')} />,
      cell: ({ row }) => row.original.is_active
        ? <Badge size="sm" color="success">{t('common.active')}</Badge>
        : <Badge size="sm" color="default">{t('common.inactive')}</Badge>,
      className: 'w-[15%] min-w-20',
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
          <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-primary" onClick={openCreate}>
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
                    <div className="text-xs text-subtle mt-0.5">{c.holding_name}</div>
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
