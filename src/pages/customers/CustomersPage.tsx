import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, Button, Input, InputDatePicker, Select,
  Badge, Drawer, Modal, MobileHeader, FormErrorMessage, useSnackbarContext,
  type ColumnDef, type RowExpansionState, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Calendar, CheckCircle, XCircle, Trash2, Star } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { toLocalDateStr, parseLocalDate } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { ContractDetailPanel } from '../contracts/ContractDetailPanel';

// ── Types ────────────────────────────────────────────────────────────────────

interface Customer {
  id: number;
  id_type: string;
  id_number: string;
  prefix: string | null;
  first_name: string;
  last_name: string;
  full_name: string;
  tel: string | null;
  tel2: string | null;
  date_of_birth: string | null;
  address: string | null;
  company_id: number;
  branch_id: number;
  google_map: string | null;
  facebook: string | null;
  line_id: string | null;
  is_active: boolean;
  source: string | null;
  created_at: string;
  holding_id: number;
}

interface CustomerAddress {
  id: number;
  customer_id: number;
  address_type: string;
  address_line1: string;
  address_line2: string | null;
  soi: string | null;
  road: string | null;
  sub_district: string;
  district: string;
  province: string;
  postal_code: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface CustomerContact {
  id: number;
  customer_id: number;
  contact_type: string;
  value: string;
  label: string | null;
  is_primary: boolean;
  note: string | null;
  created_at: string;
}

interface CustomerReference {
  id: number;
  customer_id: number;
  name: string;
  last_name: string | null;
  tel: string | null;
  relation: string | null;
  facebook: string | null;
  line_id: string | null;
  is_active: boolean;
  created_at: string;
}

interface ContractSummary {
  id: number;
  code_display: string;
  state: string;
  branch_name: string | null;
}

interface PostalLookup {
  postal_code: string;
  sub_district: string;
  district: string;
  province: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const stateColor = (state: string) => {
  switch (state) {
    case 'ACTIVE': return 'success';
    case 'COMPLETED': return 'info';
    case 'TERMINATED': case 'VOIDED': return 'danger';
    case 'DRAFT': return 'default';
    default: return 'warning';
  }
};

const CONTACT_TYPES = ['MOBILE', 'HOME', 'WORK', 'LINE', 'FACEBOOK', 'OTHER'];

// ── Component ────────────────────────────────────────────────────────────────

export function CustomersPage() {
  const { t } = useTranslation();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search.trim()); setPageIndex(0); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // ── List query ──
  const buildEndpoint = () => {
    const params: string[] = ['order=full_name.asc'];
    if (debouncedSearch.length >= 2) {
      params.push(`or=(full_name.ilike.*${debouncedSearch}*,id_number.ilike.*${debouncedSearch}*,tel.ilike.*${debouncedSearch}*)`);
    }
    return `/v_customers?${params.join('&')}`;
  };

  const { data: customersData, isFetching } = useQuery({
    queryKey: ['customers', debouncedSearch, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<Customer>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });
  const customers = customersData?.data ?? [];
  const totalCount = customersData?.totalCount ?? 0;

  // ── Columns ──
  const columns: ColumnDef<Customer>[] = useMemo(() => [
    {
      accessorKey: 'full_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('customer.name')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-sm font-medium">{row.original.full_name}</div>
          {row.original.tel && <div className="text-xs text-control-label">{row.original.tel}</div>}
        </div>
      ),
    },
    {
      accessorKey: 'id_number',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('customer.idNumber')} />,
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.id_number}</span>,
      className: 'max-md:hidden',
    },
    {
      accessorKey: 'tel',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('customer.phone')} />,
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.tel ?? '—'}</span>,
      className: 'max-lg:hidden',
    },
    {
      accessorKey: 'date_of_birth',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('customer.dateOfBirth')} />,
      cell: ({ row }) => row.original.date_of_birth
        ? <DateTime value={row.original.date_of_birth} showTime={false} className="text-xs text-control-label" />
        : <span className="text-xs text-control-label">—</span>,
      className: 'w-28 max-lg:hidden',
    },
    {
      accessorKey: 'is_active',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approval.status')} />,
      cell: ({ row }) => (
        <Badge size="sm" color={row.original.is_active ? 'success' : 'default'}>
          {row.original.is_active ? t('customer.active') : t('customer.inactive')}
        </Badge>
      ),
      className: 'w-20 max-md:hidden',
    },
  ], [t]);

  // ── Row click ──
  const handleRowExpansion = (updater: RowExpansionState | ((prev: RowExpansionState) => RowExpansionState)) => {
    const next = typeof updater === 'function' ? updater({}) : updater;
    const clickedId = Object.keys(next).find(k => next[k]);
    if (clickedId) {
      const row = customers[Number(clickedId)];
      if (row) setSelectedCustomer(row);
    }
  };

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title">{t('customer.title')}</div>
        <div className="mobile-header-end w-12" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('customer.title')}</h1>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 pb-4 flex-none">
          <div className="w-full max-w-72 min-w-0">
            <Input
              size="sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('customer.search')}
              className="w-full"
            />
          </div>
        </div>

        {/* Desktop table */}
        <DataTable<Customer>
          data={customers}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          expandOnRowClick
          getRowCanExpand={() => true}
          renderExpandedRow={() => null}
          rowExpansion={{}}
          onRowExpansionChange={handleRowExpansion}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[15, 25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
          tableClassName="[&_tbody_tr]:cursor-pointer"
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={<div className="p-8 text-center text-control-label">{t('customer.noCustomers')}</div>}
        />

        {/* Mobile cards */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {customers.length === 0 ? (
              <div className="p-8 text-center text-control-label">{t('customer.noCustomers')}</div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {customers.map(c => (
                  <div
                    key={c.id}
                    className="px-1 py-3 cursor-pointer active:bg-surface-hover"
                    onClick={() => setSelectedCustomer(c)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{c.full_name}</span>
                      {!c.is_active && <Badge size="sm" color="default">{t('customer.inactive')}</Badge>}
                    </div>
                    <div className="text-xs text-control-label mt-0.5 tabular-nums">
                      {c.id_number} · {c.tel ?? '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Detail Drawer */}
      <CustomerDrawer
        customer={selectedCustomer}
        open={!!selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
        onUpdated={(updated) => setSelectedCustomer(updated)}
      />
    </>
  );
}

// ── Customer Detail Drawer ──────────────────────────────────────────────────

function CustomerDrawer({ customer, open, onClose, onUpdated }: {
  customer: Customer | null;
  open: boolean;
  onClose: () => void;
  onUpdated: (c: Customer) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const customerId = customer?.id;

  // ── Sub-queries ──
  const { data: addresses = [] } = useQuery({
    queryKey: ['customer-addresses', customerId],
    queryFn: () => apiClient.get<CustomerAddress[]>(`/v_customer_addresses?customer_id=eq.${customerId}&order=address_type`),
    enabled: !!customerId,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ['customer-contacts', customerId],
    queryFn: () => apiClient.get<CustomerContact[]>(`/v_customer_contacts?customer_id=eq.${customerId}&order=is_primary.desc,contact_type`),
    enabled: !!customerId,
  });

  const { data: references = [] } = useQuery({
    queryKey: ['customer-references', customerId],
    queryFn: () => apiClient.get<CustomerReference[]>(`/v_customer_references?customer_id=eq.${customerId}&is_active=is.true`),
    enabled: !!customerId,
  });

  const { data: contracts = [] } = useQuery({
    queryKey: ['customer-contracts', customerId],
    queryFn: () => apiClient.get<ContractSummary[]>(`/v_contracts?customer_id=eq.${customerId}&select=id,code_display,state,branch_name&order=id.desc&limit=20`),
    enabled: !!customerId,
  });

  // ── Contract modal ──
  const [contractModalId, setContractModalId] = useState<number | null>(null);

  // ── Section states ──
  const [editingInfo, setEditingInfo] = useState(false);
  const [editingAddress, setEditingAddress] = useState<string | null>(null); // address_type or null
  const [addingContact, setAddingContact] = useState(false);
  const [addingReference, setAddingReference] = useState(false);

  // Reset edit states when customer changes
  useEffect(() => {
    setEditingInfo(false);
    setEditingAddress(null);
    setAddingContact(false);
    setAddingReference(false);
  }, [customerId]);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['customers'] });
    queryClient.invalidateQueries({ queryKey: ['customer-addresses', customerId] });
    queryClient.invalidateQueries({ queryKey: ['customer-contacts', customerId] });
    queryClient.invalidateQueries({ queryKey: ['customer-references', customerId] });
  };

  const homeAddress = addresses.find(a => a.address_type === 'HOME');
  const workAddress = addresses.find(a => a.address_type === 'WORK');

  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel={customer?.full_name ?? ''}>
      <div className="drawer-header">
        <h2 className="drawer-title">{customer?.full_name}</h2>
        <button className="drawer-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="drawer-content">
        {customer && (
          <div className="space-y-5">
            {/* Basic Info */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-control-label uppercase tracking-wider">{t('customer.basicInfo')}</h3>
                <button className="text-primary text-xs cursor-pointer hover:underline" onClick={() => setEditingInfo(!editingInfo)}>
                  {editingInfo ? t('common.cancel') : t('common.edit')}
                </button>
              </div>
              {editingInfo ? (
                <BasicInfoForm customer={customer} onSuccess={(updated) => {
                  setEditingInfo(false);
                  onUpdated(updated);
                  refreshAll();
                  addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('customer.saveSuccess')}</span></div> });
                }} />
              ) : (
                <div className="space-y-1.5 text-sm">
                  <DetailRow label={t('customer.idType')} value={customer.id_type} />
                  <DetailRow label={t('customer.idNumber')} value={customer.id_number} mono />
                  <DetailRow label={t('customer.prefix')} value={customer.prefix ?? '—'} />
                  <DetailRow label={t('customer.firstName')} value={customer.first_name} />
                  <DetailRow label={t('customer.lastName')} value={customer.last_name} />
                  <DetailRow label={t('customer.phone')} value={customer.tel ?? '—'} mono />
                  {customer.tel2 && <DetailRow label={`${t('customer.phone')} 2`} value={customer.tel2} mono />}
                  <DetailRow label={t('customer.dateOfBirth')}>
                    {customer.date_of_birth ? <DateTime value={customer.date_of_birth} showTime={false} /> : <span>—</span>}
                  </DetailRow>
                  {customer.facebook && <DetailRow label={t('customer.facebook')} value={customer.facebook} />}
                  {customer.line_id && <DetailRow label={t('customer.lineId')} value={customer.line_id} />}
                </div>
              )}
            </section>

            <hr className="border-line" />

            {/* Addresses */}
            <section>
              <h3 className="text-xs font-semibold text-control-label uppercase tracking-wider mb-2">{t('customer.addresses')}</h3>

              {/* Current address */}
              <AddressCard
                label={t('customer.addressHome')}
                address={homeAddress}
                editing={editingAddress === 'HOME'}
                onEdit={() => setEditingAddress(editingAddress === 'HOME' ? null : 'HOME')}
                customerId={customer.id}
                addressType="HOME"
                onSaved={() => {
                  setEditingAddress(null);
                  refreshAll();
                  addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('customer.addressSaved')}</span></div> });
                }}
              />

              {/* Work address */}
              <AddressCard
                label={t('customer.addressWork')}
                address={workAddress}
                editing={editingAddress === 'WORK'}
                onEdit={() => setEditingAddress(editingAddress === 'WORK' ? null : 'WORK')}
                customerId={customer.id}
                addressType="WORK"
                onSaved={() => {
                  setEditingAddress(null);
                  refreshAll();
                  addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('customer.addressSaved')}</span></div> });
                }}
              />
            </section>

            <hr className="border-line" />

            {/* Contacts */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-control-label uppercase tracking-wider">{t('customer.contacts')}</h3>
                <button className="text-primary text-xs cursor-pointer hover:underline" onClick={() => setAddingContact(!addingContact)}>
                  {addingContact ? t('common.cancel') : t('customer.addContact')}
                </button>
              </div>
              {addingContact && (
                <ContactForm customerId={customer.id} onSuccess={() => {
                  setAddingContact(false);
                  refreshAll();
                  addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('customer.contactSaved')}</span></div> });
                }} />
              )}
              {contacts.length === 0 && !addingContact ? (
                <div className="text-sm text-control-label py-2">{t('customer.noContacts')}</div>
              ) : (
                <div className="space-y-1">
                  {contacts.map(c => (
                    <ContactRow key={c.id} contact={c} onDeleted={() => {
                      refreshAll();
                      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('customer.contactDeleted')}</span></div> });
                    }} />
                  ))}
                </div>
              )}
            </section>

            <hr className="border-line" />

            {/* References */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-control-label uppercase tracking-wider">{t('customer.references')}</h3>
                <button className="text-primary text-xs cursor-pointer hover:underline" onClick={() => setAddingReference(!addingReference)}>
                  {addingReference ? t('common.cancel') : t('customer.addReference')}
                </button>
              </div>
              {addingReference && (
                <ReferenceForm customerId={customer.id} onSuccess={() => {
                  setAddingReference(false);
                  refreshAll();
                  addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('customer.referenceSaved')}</span></div> });
                }} />
              )}
              {references.length === 0 && !addingReference ? (
                <div className="text-sm text-control-label py-2">{t('customer.noReferences')}</div>
              ) : (
                <div className="space-y-1">
                  {references.map(r => (
                    <div key={r.id} className="text-sm py-1.5 flex items-center justify-between">
                      <div>
                        <span className="font-medium">{r.name} {r.last_name}</span>
                        {r.relation && <span className="text-control-label ml-1">({r.relation})</span>}
                      </div>
                      <span className="text-xs tabular-nums text-control-label">{r.tel}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <hr className="border-line" />

            {/* Related Contracts */}
            <section>
              <h3 className="text-xs font-semibold text-control-label uppercase tracking-wider mb-2">{t('customer.relatedContracts')}</h3>
              {contracts.length === 0 ? (
                <div className="text-sm text-control-label py-2">{t('customer.noContracts')}</div>
              ) : (
                <div className="space-y-1">
                  {contracts.map(c => (
                    <div
                      key={c.id}
                      className="block py-2 px-2 -mx-2 rounded-md hover:bg-surface-hover transition-colors cursor-pointer"
                      onClick={() => setContractModalId(c.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-primary">{c.code_display}</span>
                        <Badge size="xs" color={stateColor(c.state)}>{c.state}</Badge>
                      </div>
                      {c.branch_name && <div className="text-xs text-control-label mt-0.5">{c.branch_name}</div>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Contract detail modal */}
      <Modal open={!!contractModalId} onClose={() => setContractModalId(null)} maxWidth="56rem" width="100%">
        <div className="h-[80dvh] flex flex-col">
          {contractModalId && (
            <ContractDetailPanel contractId={contractModalId} isMobile={false} />
          )}
        </div>
      </Modal>
    </Drawer>
  );
}

// ── Basic Info Form ─────────────────────────────────────────────────────────

function BasicInfoForm({ customer, onSuccess }: { customer: Customer; onSuccess: (c: Customer) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    prefix: customer.prefix ?? '',
    first_name: customer.first_name,
    last_name: customer.last_name,
    tel: customer.tel ?? '',
    tel2: customer.tel2 ?? '',
    date_of_birth: customer.date_of_birth ?? '',
    facebook: customer.facebook ?? '',
    line_id: customer.line_id ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!form.first_name.trim() || !form.last_name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_customer_register_or_update', {
        p_id_type: customer.id_type,
        p_id_number: customer.id_number,
        p_prefix: form.prefix || null,
        p_first_name: form.first_name.trim(),
        p_last_name: form.last_name.trim(),
        p_tel: form.tel.trim() || null,
        p_tel2: form.tel2.trim() || null,
        p_date_of_birth: form.date_of_birth || null,
        p_facebook: form.facebook.trim() || null,
        p_line_id: form.line_id.trim() || null,
      });
      onSuccess({ ...customer, ...form, full_name: `${form.first_name} ${form.last_name}` });
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const prefixOptions = [
    { value: '', label: '—' },
    { value: 'นาย', label: 'นาย' },
    { value: 'นาง', label: 'นาง' },
    { value: 'นางสาว', label: 'นางสาว' },
  ];

  return (
    <div className="space-y-3">
      {error && <div className="alert alert-danger text-xs"><XCircle size={14} /><span>{error}</span></div>}
      <div className="form-grid">
        <div className="flex flex-col">
          <label className="form-label">{t('customer.prefix')}</label>
          <Select size="sm" options={prefixOptions} value={form.prefix} onChange={v => set('prefix', (v as string) ?? '')} showChevron searchable={false} />
        </div>
        <div className="flex gap-3">
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.firstName')} *</label>
            <Input size="sm" value={form.first_name} onChange={e => set('first_name', e.target.value)} className="w-full" />
          </div>
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.lastName')} *</label>
            <Input size="sm" value={form.last_name} onChange={e => set('last_name', e.target.value)} className="w-full" />
          </div>
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('customer.phone')}</label>
          <Input size="sm" value={form.tel} onChange={e => set('tel', e.target.value)} className="w-full" />
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('customer.dateOfBirth')}</label>
          <InputDatePicker
            size="sm"
            value={parseLocalDate(form.date_of_birth)}
            onChange={v => set('date_of_birth', toLocalDateStr(v))}
            endIcon={<Calendar size={14} />}
          />
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('customer.facebook')}</label>
          <Input size="sm" value={form.facebook} onChange={e => set('facebook', e.target.value)} className="w-full" />
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('customer.lineId')}</label>
          <Input size="sm" value={form.line_id} onChange={e => set('line_id', e.target.value)} className="w-full" />
        </div>
      </div>
      <Button size="sm" color="primary" onClick={handleSave} disabled={saving}>
        {saving ? t('common.loading') : t('common.save')}
      </Button>
    </div>
  );
}

// ── Address Card ────────────────────────────────────────────────────────────

function AddressCard({ label, address, editing, onEdit, customerId, addressType, onSaved }: {
  label: string;
  address: CustomerAddress | undefined;
  editing: boolean;
  onEdit: () => void;
  customerId: number;
  addressType: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium">{label}</span>
        <button className="text-primary text-xs cursor-pointer hover:underline" onClick={onEdit}>
          {editing ? t('common.cancel') : t('customer.editAddress')}
        </button>
      </div>
      {editing ? (
        <AddressForm customerId={customerId} addressType={addressType} existing={address} onSuccess={onSaved} />
      ) : address ? (
        <div className="text-sm text-control-label space-y-0.5 px-3 py-2 rounded-md bg-surface border border-line">
          <div>{address.address_line1}</div>
          {address.address_line2 && <div>{address.address_line2}</div>}
          {address.soi && <div>{t('customer.soi')} {address.soi}</div>}
          {address.road && <div>{t('customer.road')} {address.road}</div>}
          <div>{address.sub_district}, {address.district}, {address.province} {address.postal_code}</div>
        </div>
      ) : (
        <div className="text-sm text-control-label py-2">—</div>
      )}
    </div>
  );
}

// ── Address Form ────────────────────────────────────────────────────────────

function AddressForm({ customerId, addressType, existing, onSuccess }: {
  customerId: number;
  addressType: string;
  existing?: CustomerAddress;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();

  const { register, handleSubmit, formState: { errors }, watch, setValue } = useForm({
    defaultValues: {
      address_line1: existing?.address_line1 ?? '',
      address_line2: existing?.address_line2 ?? '',
      soi: existing?.soi ?? '',
      road: existing?.road ?? '',
      postal_code: existing?.postal_code ?? '',
      sub_district: existing?.sub_district ?? '',
      district: existing?.district ?? '',
      province: existing?.province ?? '',
    },
  });

  // Register fields managed by Select/auto-fill so they're always in form data
  register('sub_district', { required: t('common.required') });
  register('district', { required: t('common.required') });
  register('province', { required: t('common.required') });

  const postalCode = watch('postal_code');
  const [postalResults, setPostalResults] = useState<PostalLookup[]>([]);
  const [apiError, setApiError] = useState('');
  const [saving, setSaving] = useState(false);

  // Postal code lookup — auto-fill helper
  useEffect(() => {
    if (postalCode.length === 5) {
      apiClient.get<PostalLookup[]>(`/v_postal_lookup?postal_code=eq.${postalCode}`)
        .then(setPostalResults)
        .catch(() => setPostalResults([]));
    } else {
      setPostalResults([]);
    }
  }, [postalCode]);

  const subDistrictOptions = useMemo(
    () => postalResults.map(p => ({ value: p.sub_district, label: p.sub_district })),
    [postalResults],
  );

  const handleSubDistrictSelect = (val: string | string[] | null) => {
    const sub = val as string;
    const match = postalResults.find(p => p.sub_district === sub);
    if (match) {
      setValue('sub_district', match.sub_district, { shouldDirty: true });
      setValue('district', match.district, { shouldDirty: true });
      setValue('province', match.province, { shouldDirty: true });
    }
  };

  const onSubmit = async (data: Record<string, string>) => {
    setSaving(true);
    setApiError('');
    try {
      await apiClient.rpc('fn_customer_address_upsert', {
        p_customer_id: customerId,
        p_address_type: addressType,
        p_address_line1: data.address_line1.trim(),
        p_address_line2: data.address_line2.trim() || null,
        p_soi: data.soi.trim() || null,
        p_road: data.road.trim() || null,
        p_sub_district: data.sub_district.trim(),
        p_district: data.district.trim(),
        p_province: data.province.trim(),
        p_postal_code: data.postal_code.trim(),
      });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setApiError(translated || err.message);
      } else setApiError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      {apiError && <div className="alert alert-danger text-xs"><XCircle size={14} /><span>{apiError}</span></div>}
      <div className="form-grid">
        <div className="flex flex-col">
          <label className="form-label">{t('customer.addressLine1')} *</label>
          <Input size="sm" className="w-full" {...register('address_line1', { required: t('common.required') })} />
          <FormErrorMessage error={errors.address_line1} />
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('customer.addressLine2')}</label>
          <Input size="sm" className="w-full" {...register('address_line2')} />
        </div>
        <div className="flex gap-3">
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.soi')}</label>
            <Input size="sm" className="w-full" {...register('soi')} />
          </div>
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.road')}</label>
            <Input size="sm" className="w-full" {...register('road')} />
          </div>
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('customer.postalCode')} *</label>
          <Input size="sm" className="w-full" maxLength={5} {...register('postal_code', { required: t('common.required') })} />
          <FormErrorMessage error={errors.postal_code} />
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('customer.subDistrict')} *</label>
          {postalResults.length > 0 ? (
            <Select
              size="sm"
              options={subDistrictOptions}
              value={watch('sub_district')}
              onChange={handleSubDistrictSelect}
              placeholder={t('customer.selectSubDistrict')}
              showChevron
            />
          ) : (
            <Input size="sm" className="w-full" value={watch('sub_district')} onChange={e => setValue('sub_district', e.target.value, { shouldValidate: true })} />
          )}
          <FormErrorMessage error={errors.sub_district} />
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('customer.district')} *</label>
          <Input size="sm" className="w-full" disabled={postalResults.length > 0} value={watch('district')} onChange={e => setValue('district', e.target.value, { shouldValidate: true })} />
          <FormErrorMessage error={errors.district} />
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('customer.province')} *</label>
          <Input size="sm" className="w-full" disabled={postalResults.length > 0} value={watch('province')} onChange={e => setValue('province', e.target.value, { shouldValidate: true })} />
          <FormErrorMessage error={errors.province} />
        </div>
      </div>
      <Button size="sm" color="primary" type="submit" disabled={saving}>
        {saving ? t('common.loading') : t('common.save')}
      </Button>
    </form>
  );
}

// ── Contact Form ────────────────────────────────────────────────────────────

function ContactForm({ customerId, onSuccess }: { customerId: number; onSuccess: () => void }) {
  const { t } = useTranslation();
  const [contactType, setContactType] = useState('MOBILE');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const typeOptions = CONTACT_TYPES.map(ct => ({ value: ct, label: ct }));

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_customer_contact_upsert', {
        p_customer_id: customerId,
        p_contact_type: contactType,
        p_value: value.trim(),
        p_label: label.trim() || null,
        p_is_primary: isPrimary,
        p_note: null,
      });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 mb-3 p-3 rounded-md border border-line">
      {error && <div className="alert alert-danger text-xs"><XCircle size={14} /><span>{error}</span></div>}
      <div className="form-grid">
        <div className="flex gap-3">
          <div className="flex flex-col" style={{ width: '8rem' }}>
            <label className="form-label">{t('customer.contactType')}</label>
            <Select size="sm" options={typeOptions} value={contactType} onChange={v => setContactType(v as string)} showChevron searchable={false} />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{t('customer.contactValue')} *</label>
            <Input size="sm" value={value} onChange={e => setValue(e.target.value)} className="w-full" placeholder="095-xxx-xxxx" />
          </div>
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('customer.contactLabel')}</label>
          <Input size="sm" value={label} onChange={e => setLabel(e.target.value)} className="w-full" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} />
          {t('customer.contactPrimary')}
        </label>
        <Button color="primary" size="sm" onClick={handleSave} disabled={saving || !value.trim()}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

// ── Contact Row ─────────────────────────────────────────────────────────────

function ContactRow({ contact, onDeleted }: { contact: CustomerContact; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.rpc('fn_customer_contact_delete', { p_id: contact.id });
      onDeleted();
    } catch {
      // silently fail
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <div className="flex items-center gap-2">
        {contact.is_primary && <Star size={12} className="text-warning fill-warning" />}
        <Badge size="xs" color="info">{contact.contact_type}</Badge>
        <span className="tabular-nums">{contact.value}</span>
        {contact.label && <span className="text-control-label text-xs">({contact.label})</span>}
      </div>
      <button
        className="p-1 rounded hover:bg-surface-hover cursor-pointer text-control-label hover:text-danger"
        onClick={handleDelete}
        disabled={deleting}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── Reference Form ──────────────────────────────────────────────────────────

function ReferenceForm({ customerId, onSuccess }: { customerId: number; onSuccess: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [tel, setTel] = useState('');
  const [relation, setRelation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_customer_reference_add', {
        p_customer_id: customerId,
        p_name: name.trim(),
        p_last_name: lastName.trim() || null,
        p_tel: tel.trim() || null,
        p_relation: relation.trim() || null,
        p_facebook: null,
        p_line_id: null,
      });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 mb-3 p-3 rounded-md border border-line">
      {error && <div className="alert alert-danger text-xs"><XCircle size={14} /><span>{error}</span></div>}
      <div className="form-grid">
        <div className="flex gap-3">
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.refName')} *</label>
            <Input size="sm" value={name} onChange={e => setName(e.target.value)} className="w-full" />
          </div>
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.refLastName')}</label>
            <Input size="sm" value={lastName} onChange={e => setLastName(e.target.value)} className="w-full" />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.refTel')}</label>
            <Input size="sm" value={tel} onChange={e => setTel(e.target.value)} className="w-full" />
          </div>
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.refRelation')}</label>
            <Input size="sm" value={relation} onChange={e => setRelation(e.target.value)} className="w-full" />
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button color="primary" size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

// ── Detail Row ──────────────────────────────────────────────────────────────

function DetailRow({ label, value, mono, children }: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-control-label shrink-0">{label}</span>
      {children ?? <span className={`text-right ${mono ? 'tabular-nums' : ''}`}>{value}</span>}
    </div>
  );
}
