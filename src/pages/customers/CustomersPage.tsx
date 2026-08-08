import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTableFooter, Input, Select, Button, Badge,
  Modal, LabeledCheckbox, FormErrorMessage, useSnackbarContext,
} from 'tsp-form';
import { ArrowRightFromLine, ArrowLeft, Search, Users, CheckCircle, XCircle, Trash2, Star, Plus, Pencil, MapPin, UserPlus, ExternalLink } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { toLocalDateStr, parseLocalDate, formatTel, formatCid } from '../../lib/format';
import { SEARCH_MIN_CHARS, isSearchable, isBelowSearchMin } from '../../lib/searchKeyword';
import { DateTime } from '../../components/DateTime';
import { DatePicker } from '../../components/DatePicker';
import { PhoneInput } from '../../components/PhoneInput';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CustomerLoginCard, useInvalidateLoginInfo } from '../../components/CustomerLoginCard';
import { EditIdentityModal } from '../../components/EditIdentityModal';
import { ContractDetailPanel } from '../contracts/ContractDetailPanel';
import { useAuth } from '../../contexts/AuthContext';

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
  username: string | null;
  has_login: boolean;
  last_login_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
  is_currently_locked: boolean;
}

// Row shape from fn_customer_search — a subset of the view columns the list
// renders, plus a per-row total_count for pagination and a masked id_number.
interface CustomerSearchRow {
  id: number;
  full_name: string;
  first_name: string;
  last_name: string;
  prefix: string | null;
  tel: string | null;
  tel2: string | null;
  id_type: string;
  id_number: string; // masked, e.g. 1-****-****1-52-7
  username: string | null; // masked
  branch_id: number;
  is_active: boolean;
  match_field: string;
  relevance: number;
  total_count: number;
  contracts: { count: number; active_count: number; overdue_count: number; outstanding_total: number };
}

interface CustomerSearchResponse {
  customers: CustomerSearchRow[];
  count: number;
  query: string;
  limit: number;
  offset: number;
}

// The list renders either full view rows (browse) or masked search rows.
type CustomerListRow = Customer | CustomerSearchRow;

// A search row lacks the detail-panel fields (address, dob, raw id_number),
// so it must never be used as the detail source — guard on a browse-only field.
const isFullCustomer = (c: CustomerListRow): c is Customer => 'date_of_birth' in c;

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
  recipient_name?: string | null;
  recipient_tel?: string | null;
  note?: string | null;
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

const PREFIX_OPTIONS = [
  { value: '', label: '-' },
  { value: 'นาย', label: 'นาย' },
  { value: 'นาง', label: 'นาง' },
  { value: 'นางสาว', label: 'นางสาว' },
  { value: 'Mr.', label: 'Mr.' },
  { value: 'Mrs.', label: 'Mrs.' },
  { value: 'Ms.', label: 'Ms.' },
];

const formatAddress = (a: CustomerAddress): string => {
  const parts = [a.address_line1];
  if (a.address_line2) parts.push(a.address_line2);
  if (a.soi) parts.push(`ซ.${a.soi}`);
  if (a.road) parts.push(`ถ.${a.road}`);
  parts.push(`${a.sub_district}, ${a.district}, ${a.province} ${a.postal_code}`);
  return parts.join(', ');
};

// ── Main Page ────────────────────────────────────────────────────────────────

export function CustomersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { customerId: customerIdParam } = useParams<{ customerId?: string }>();
  const selectedId = customerIdParam ? Number(customerIdParam) : null;

  const setSelectedId = (id: number | null) => {
    if (id) navigate(`/admin/customers/${id}`, { replace: true });
    else navigate('/admin/customers', { replace: true });
  };

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  // Below SEARCH_MIN_CHARS we never reach the RPC — its trigram index doesn't
  // exist for shorter strings, so results are either wrong or slow. Filtered
  // before the debounce so nothing fires and gets discarded.
  useEffect(() => {
    const next = isSearchable(search) ? search.trim() : '';
    const timer = setTimeout(() => { setDebouncedSearch(next); setPageIndex(0); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // ── List query ──
  // No keyword → browse the raw view (full rows, ordered). With a keyword →
  // fn_customer_search (trigram-fuzzy on names, LIKE on id/tel). The RPC masks
  // id_number in results; the detail panel re-fetches the full row by id from
  // v_customers, so the unmasked value is never lost.
  const isSearching = isSearchable(debouncedSearch);
  const { data: customersData, isFetching } = useQuery({
    queryKey: ['customers', debouncedSearch, pageIndex, pageSize],
    queryFn: async (): Promise<{ data: CustomerListRow[]; totalCount: number }> => {
      if (isSearching) {
        const res = await apiClient.rpc<CustomerSearchResponse>('fn_customer_search', {
          p_query: debouncedSearch,
          p_limit: pageSize,
          p_offset: pageIndex * pageSize,
        });
        return { data: res.customers, totalCount: res.customers[0]?.total_count ?? res.count };
      }
      const page = await apiClient.getPaginated<Customer>(
        '/v_customers?order=full_name.asc',
        { page: pageIndex + 1, pageSize },
      );
      return { data: page.data, totalCount: page.totalCount };
    },
    placeholderData: keepPreviousData,
  });
  const customers = customersData?.data ?? [];
  const totalCount = customersData?.totalCount ?? 0;

  // Fallback fetch when deep-linked customer isn't in the current list page
  // Only a FULL row counts as "in list" — a masked search row still needs the
  // raw re-fetch for the detail panel.
  const inList = selectedId ? customers.some(c => c.id === selectedId && isFullCustomer(c)) : false;
  const { data: selectedFromApi } = useQuery({
    queryKey: ['customer', selectedId],
    queryFn: async () => {
      const rows = await apiClient.get<Customer[]>(`/v_customers?id=eq.${selectedId}`);
      return rows[0] ?? null;
    },
    enabled: !!selectedId && !inList,
  });

  return (
    <PageNav panels={['list', 'detail']} defaultPanel={selectedId ? 'detail' : 'list'} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => {
        // Only a full view row can drive the detail panel. A search row (masked,
        // partial) falls through to selectedFromApi, which re-fetches the raw row.
        const fromList = selectedId ? customers.find(c => c.id === selectedId) : null;
        const selected = (fromList && isFullCustomer(fromList) ? fromList : null) ?? selectedFromApi ?? null;
        const detailTitle = selected?.full_name ?? t('customer.title');

        const handleSelect = (c: CustomerListRow) => {
          if (c.id === selectedId) return;
          setSelectedId(c.id);
          if (isMobile) goTo('detail');
        };

        return (
          <>
            {/* ── Mobile Header ── */}
            {isMobile && (
              <MobileHeader className="mobile-header-bordered">
                <div className="mobile-header-start">
                  {isRoot ? (
                    <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
                      <ArrowRightFromLine size={18} />
                    </button>
                  ) : (
                    <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => { setSelectedId(null); goBack(); }}>
                      <ArrowLeft size={20} />
                    </button>
                  )}
                </div>
                <div className="mobile-header-title mobile-header-title-truncate">
                  {isRoot ? t('customer.title') : detailTitle}
                </div>
                <div className="mobile-header-end w-12" />
              </MobileHeader>
            )}

            {/* ── Desktop Header ── */}
            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line">
                <h1 className="heading-2">{t('customer.title')}</h1>
              </div>
            )}

            {/* ── Panels ── */}
            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              {/* ── List Panel ── */}
              <PageNavPanel id="list" className={isMobile ? '' : 'w-5/12 xl:w-4/12 border-r border-line flex flex-col'}>
                <div className="flex-none p-2 border-b border-line">
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t('customer.search')}
                    size="sm"
                    startIcon={<Search size={16} />}
                    endIcon={isBelowSearchMin(search)
                      ? <span className="text-[11px] whitespace-nowrap">
                          {t('common.searchMinCharsShort', { n: SEARCH_MIN_CHARS })}
                        </span>
                      : undefined}
                    className="w-full search-min-hint"
                  />
                </div>
                <div className={`data-table-content better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
                  {customers.length === 0 ? (
                    <div className="p-8 text-center text-subtler">{t('customer.noCustomers')}</div>
                  ) : (
                    <div className="flex flex-col">
                      {customers.map(c => (
                        <button
                          key={c.id}
                          className={`w-full text-left px-4 py-2.5 border-b border-line transition-colors cursor-pointer ${
                            c.id === selectedId ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                          }`}
                          onClick={() => handleSelect(c)}
                        >
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="font-medium text-sm truncate">{c.full_name}</span>
                            {!c.is_active && <Badge size="xs" color="default">{t('customer.inactive')}</Badge>}
                          </div>
                          <div className="text-xs text-subtle tabular-nums">
                            {/* search results return a pre-masked id_number
                                (1-****-****1-52-7); only run formatCid on the
                                raw 13-digit form from the browse view. */}
                            {c.id_number?.includes('*') ? c.id_number : formatCid(c.id_number)} · {formatTel(c.tel)}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {totalCount > 0 && (
                  <div className="flex-none border-t border-line p-2">
                    <DataTableFooter
                      currentPage={pageIndex + 1}
                      totalPages={Math.ceil(totalCount / pageSize) || 1}
                      onPageChange={(p) => setPageIndex(p - 1)}
                      pageSize={pageSize}
                      pageSizeOptions={[15, 25, 50]}
                      onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
                      totalRows={totalCount}
                    />
                  </div>
                )}
              </PageNavPanel>

              {/* ── Detail Panel ── */}
              <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
                {selectedId ? (
                  <CustomerDetail customerId={selectedId} customer={selected} />
                ) : (
                  <div className="flex-1 h-full flex items-center justify-center text-subtler">
                    <div className="text-center">
                      <Users size={32} className="mx-auto mb-2 opacity-40" />
                      <div>{t('customer.selectToView')}</div>
                    </div>
                  </div>
                )}
              </PageNavPanel>
            </div>
          </>
        );
      }}
    </PageNav>
  );
}

// ── Customer Detail ─────────────────────────────────────────────────────────

function CustomerDetail({ customerId, customer }: { customerId: number; customer: Customer | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  // Sub-queries
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

  const homeAddress = addresses.find(a => a.address_type === 'HOME');
  const workAddress = addresses.find(a => a.address_type === 'WORK');
  const shippingAddress = addresses.find(a => a.address_type === 'SHIPPING');

  // Modal states
  const [editInfoOpen, setEditInfoOpen] = useState(false);
  const [editAddressType, setEditAddressType] = useState<string | null>(null);
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [addReferenceOpen, setAddReferenceOpen] = useState(false);
  const [editReference, setEditReference] = useState<CustomerReference | null>(null);
  const [contractModalId, setContractModalId] = useState<number | null>(null);
  const [editIdentityOpen, setEditIdentityOpen] = useState(false);

  // Reset modals when customer changes
  useEffect(() => {
    setEditInfoOpen(false);
    setEditAddressType(null);
    setAddContactOpen(false);
    setAddReferenceOpen(false);
    setEditReference(null);
    setEditIdentityOpen(false);
  }, [customerId]);

  const invalidateLogin = useInvalidateLoginInfo();
  const { can } = useAuth();
  const canEditIdentity = can('CUSTOMER.UPDATE');

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['customers'] });
    queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
    queryClient.invalidateQueries({ queryKey: ['customer-addresses', customerId] });
    queryClient.invalidateQueries({ queryKey: ['customer-contacts', customerId] });
    queryClient.invalidateQueries({ queryKey: ['customer-references', customerId] });
  };

  const showSuccess = (msg: string) => {
    addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{msg}</span></div> });
  };

  if (!customer) return null;

  return (
    <div className="flex-1 overflow-auto better-scroll">
      <div className="px-4 md:px-6 py-4 max-w-2xl">
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{customer.full_name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge size="xs" color={customer.is_active ? 'success' : 'default'}>
                {customer.is_active ? t('customer.active') : t('customer.inactive')}
              </Badge>
              <span className="text-xs text-subtle tabular-nums">{customer.id_type}: {formatCid(customer.id_number)}</span>
              {canEditIdentity && (
                <button
                  type="button"
                  className="inline-flex items-center justify-center w-6 h-6 rounded cursor-pointer bg-transparent border-none text-subtle transition-colors hover:text-primary-fg hover:bg-surface-hover"
                  onClick={() => setEditIdentityOpen(true)}
                  title={t('customer.editIdentity.title')}
                  aria-label={t('customer.editIdentity.title')}
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" startIcon={<Pencil size={14} />} onClick={() => setEditInfoOpen(true)}>
            {t('common.edit')}
          </Button>
        </div>

        {/* ── Basic Info ── */}
        <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line text-sm space-y-1.5">
          <DetailRow label={t('customer.phone')} value={formatTel(customer.tel)} mono />
          {customer.tel2 && <DetailRow label={`${t('customer.phone')} 2`} value={formatTel(customer.tel2)} mono />}
          <DetailRow label={t('customer.dateOfBirth')}>
            {customer.date_of_birth ? <DateTime value={customer.date_of_birth} showTime={false} /> : <span>—</span>}
          </DetailRow>
          {customer.facebook && <DetailRow label={t('customer.facebook')} value={customer.facebook} />}
          {customer.line_id && <DetailRow label={t('customer.lineId')} value={customer.line_id} />}
          <DetailRow label="Created">
            <DateTime value={customer.created_at} showTime={false} />
          </DetailRow>
        </div>

        {/* ── App Login ── */}
        <div className="mb-4">
          <CustomerLoginCard
            customer={{
              id: customer.id,
              full_name: customer.full_name,
              id_number: customer.id_number,
              tel: customer.tel,
              username: customer.username,
              has_login: customer.has_login,
              last_login_at: customer.last_login_at,
              failed_login_count: customer.failed_login_count,
              locked_until: customer.locked_until,
              is_currently_locked: customer.is_currently_locked,
            }}
            onChanged={() => { invalidateLogin(customer.id); refreshAll(); }}
          />
        </div>

        {/* ── Addresses ── */}
        <SectionHeader title={t('customer.addresses')} />

        <AddressCard
          label={t('customer.addressHome')}
          address={homeAddress}
          onEdit={() => setEditAddressType('HOME')}
        />
        <AddressCard
          label={t('customer.addressWork')}
          address={workAddress}
          onEdit={() => setEditAddressType('WORK')}
        />
        <AddressCard
          label={t('customer.addressShipping')}
          address={shippingAddress}
          onEdit={() => setEditAddressType('SHIPPING')}
        />

        {/* ── Contacts ── */}
        <SectionHeader
          title={`${t('customer.contacts')} (${contacts.length})`}
          action={<Button variant="ghost" size="sm" startIcon={<Plus size={14} />} onClick={() => setAddContactOpen(true)}>{t('customer.addContact')}</Button>}
        />
        <div className="mb-4 rounded-md bg-surface border border-line">
          {contacts.length === 0 ? (
            <div className="px-3 py-3 text-sm text-subtler">{t('customer.noContacts')}</div>
          ) : (
            <div className="divide-y divide-line">
              {contacts.map(c => (
                <ContactRow key={c.id} contact={c} onDeleted={() => { refreshAll(); showSuccess(t('customer.contactDeleted')); }} />
              ))}
            </div>
          )}
        </div>

        {/* ── References ── */}
        <SectionHeader
          title={`${t('customer.references')} (${references.length})`}
          action={<Button variant="ghost" size="sm" startIcon={<UserPlus size={14} />} onClick={() => setAddReferenceOpen(true)}>{t('customer.addReference')}</Button>}
        />
        <div className="mb-4 rounded-md bg-surface border border-line">
          {references.length === 0 ? (
            <div className="px-3 py-3 text-sm text-subtler">{t('customer.noReferences')}</div>
          ) : (
            <div className="divide-y divide-line">
              {references.map(r => (
                <ReferenceRow
                  key={r.id}
                  reference={r}
                  onEdit={() => setEditReference(r)}
                  onDeleted={() => { refreshAll(); showSuccess(t('customer.referenceDeleted')); }}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Related Contracts ── */}
        <SectionHeader title={`${t('customer.relatedContracts')} (${contracts.length})`} />
        <div className="mb-4 rounded-md bg-surface border border-line">
          {contracts.length === 0 ? (
            <div className="px-3 py-3 text-sm text-subtler">{t('customer.noContracts')}</div>
          ) : (
            <div className="divide-y divide-line">
              {contracts.map(c => (
                <div key={c.id} className="px-3 py-2.5 flex items-center justify-between">
                  <div>
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/contracts/search/${c.id}`)}
                      className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                    >
                      {c.code_display}
                      <ExternalLink size={12} />
                    </button>
                    {c.branch_name && <div className="text-xs text-subtle">{c.branch_name}</div>}
                  </div>
                  <Badge size="xs" color={stateColor(c.state)}>{t(`contract.state_${c.state}`, { defaultValue: c.state })}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      <EditInfoModal
        open={editInfoOpen}
        onClose={() => setEditInfoOpen(false)}
        customer={customer}
        onSuccess={() => { setEditInfoOpen(false); refreshAll(); showSuccess(t('customer.saveSuccess')); }}
      />

      <EditIdentityModal
        open={editIdentityOpen}
        customerId={customer.id}
        currentIdType={customer.id_type}
        currentIdNumber={customer.id_number}
        onClose={() => setEditIdentityOpen(false)}
        onSuccess={() => { setEditIdentityOpen(false); refreshAll(); showSuccess(t('customer.editIdentity.success')); }}
      />

      <EditAddressModal
        open={!!editAddressType}
        onClose={() => setEditAddressType(null)}
        customerId={customerId}
        addressType={editAddressType ?? 'HOME'}
        existing={
          editAddressType === 'HOME' ? homeAddress
            : editAddressType === 'WORK' ? workAddress
            : editAddressType === 'SHIPPING' ? shippingAddress
            : undefined
        }
        onSuccess={() => { setEditAddressType(null); refreshAll(); showSuccess(t('customer.addressSaved')); }}
      />

      <AddContactModal
        open={addContactOpen}
        onClose={() => setAddContactOpen(false)}
        customerId={customerId}
        onSuccess={() => { setAddContactOpen(false); refreshAll(); showSuccess(t('customer.contactSaved')); }}
      />

      <AddReferenceModal
        open={addReferenceOpen}
        onClose={() => setAddReferenceOpen(false)}
        customerId={customerId}
        onSuccess={() => { setAddReferenceOpen(false); refreshAll(); showSuccess(t('customer.referenceSaved')); }}
      />

      <EditReferenceModal
        open={!!editReference}
        reference={editReference}
        onClose={() => setEditReference(null)}
        onSuccess={() => { setEditReference(null); refreshAll(); showSuccess(t('customer.referenceUpdated')); }}
      />

      <Modal open={!!contractModalId} onClose={() => setContractModalId(null)} maxWidth="56rem" width="100%">
        <div className="h-[80dvh] flex flex-col">
          {contractModalId && <ContractDetailPanel contractId={contractModalId} isMobile={false} />}
        </div>
      </Modal>
    </div>
  );
}

// ── Section Header ──────────────────────────────────────────────────────────

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2 mt-2">
      <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">{title}</h3>
      {action}
    </div>
  );
}

// ── Address Card (read-only) ────────────────────────────────────────────────

function AddressCard({ label, address, onEdit }: {
  label: string;
  address: CustomerAddress | undefined;
  onEdit: () => void;
}) {
  return (
    <div className="mb-3 px-3 py-2.5 rounded-md bg-surface border border-line">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium flex items-center gap-1.5">
          <MapPin size={13} className="text-subtle" />
          {label}
        </span>
        <Button variant="ghost" className="btn-icon-xs" onClick={onEdit} startIcon={address ? <Pencil size={12} /> : <Plus size={12} />} />
      </div>
      {address ? (
        <div className="text-sm text-subtle">{formatAddress(address)}</div>
      ) : (
        <div className="text-sm text-subtler">—</div>
      )}
    </div>
  );
}

// ── Contact Row ─────────────────────────────────────────────────────────────

function ContactRow({ contact, onDeleted }: { contact: CustomerContact; onDeleted: () => void }) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.rpc('fn_customer_contact_delete', { p_id: contact.id });
      onDeleted();
    } catch (err) {
      // A delete that silently does nothing reads as success — surface it.
      const msg = err instanceof ApiError ? translateApiError(err, t) : (err instanceof Error ? err.message : String(err));
      addSnackbar({ message: <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{msg}</div></div></div> });
    } finally { setDeleting(false); }
  };

  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        {contact.is_primary && <Star size={12} className="text-warning-fg fill-warning" />}
        <Badge size="xs" color="info">{contact.contact_type}</Badge>
        <span className="tabular-nums">{contact.value}</span>
        {contact.label && <span className="text-subtle text-xs">({contact.label})</span>}
      </div>
      <Button variant="ghost" className="btn-icon-xs text-subtle hover:text-danger" onClick={handleDelete} disabled={deleting} startIcon={<Trash2 size={12} />} />
    </div>
  );
}

// ── Detail Row ──────────────────────────────────────────────────────────────

function DetailRow({ label, value, mono, children }: {
  label: string; value?: string; mono?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-subtle shrink-0">{label}</span>
      {children ?? <span className={`text-right ${mono ? 'tabular-nums' : ''}`}>{value}</span>}
    </div>
  );
}

// ── Edit Info Modal ─────────────────────────────────────────────────────────

function EditInfoModal({ open, onClose, customer, onSuccess }: {
  open: boolean; onClose: () => void; customer: Customer; onSuccess: () => void;
}) {
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

  // Re-sync form when customer changes or modal opens
  useEffect(() => {
    if (open) {
      setForm({
        prefix: customer.prefix ?? '',
        first_name: customer.first_name,
        last_name: customer.last_name,
        tel: customer.tel ?? '',
        tel2: customer.tel2 ?? '',
        date_of_birth: customer.date_of_birth ?? '',
        facebook: customer.facebook ?? '',
        line_id: customer.line_id ?? '',
      });
      setError('');
    }
  }, [open, customer]);

  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!form.first_name.trim() || !form.last_name.trim()) return;
    setSaving(true);
    setError('');
    try {
      // Edit path is keyed by customer_id, NOT id_number — the displayed id is
      // masked, so sending it as p_id_number to fn_customer_register_or_update
      // fails citizen-id validation. fn_customer_update_contact never touches
      // the citizen id and updates only the contact fields below.
      await apiClient.rpc('fn_customer_update_contact', {
        p_customer_id: customer.id,
        p_prefix: form.prefix || null,
        p_first_name: form.first_name.trim(),
        p_last_name: form.last_name.trim(),
        p_tel: form.tel.trim() || null,
        p_tel2: form.tel2.trim() || null,
        p_date_of_birth: form.date_of_birth || null,
        p_facebook: form.facebook.trim() || null,
        p_line_id: form.line_id.trim() || null,
      });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setError(translated || err.message);
      } else setError(String(err));
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('customer.editCustomerInfo')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="modal-content">
        {error && <div className="alert alert-danger mb-3"><XCircle size={14} /><span>{error}</span></div>}
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('customer.prefix')}</label>
            <Select options={PREFIX_OPTIONS} value={form.prefix} onChange={v => set('prefix', (v as string) ?? '')} showChevron clearable />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.firstName')} *</label>
              <Input value={form.first_name} onChange={e => set('first_name', e.target.value)} className="w-full" />
            </div>
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.lastName')} *</label>
              <Input value={form.last_name} onChange={e => set('last_name', e.target.value)} className="w-full" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.phone')}</label>
              <PhoneInput value={form.tel} onChange={(raw) => set('tel', raw)} className="w-full" />
            </div>
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.phone')} 2</label>
              <PhoneInput value={form.tel2} onChange={(raw) => set('tel2', raw)} className="w-full" />
            </div>
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('customer.dateOfBirth')}</label>
            <DatePicker
              value={parseLocalDate(form.date_of_birth)}
              onChange={v => set('date_of_birth', toLocalDateStr(v))}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.facebook')}</label>
              <Input value={form.facebook} onChange={e => set('facebook', e.target.value)} className="w-full" />
            </div>
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.lineId')}</label>
              <Input value={form.line_id} onChange={e => set('line_id', e.target.value)} className="w-full" />
            </div>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={handleSave} disabled={saving || !form.first_name.trim() || !form.last_name.trim()}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Edit Address Modal ──────────────────────────────────────────────────────

function EditAddressModal({ open, onClose, customerId, addressType, existing, onSuccess }: {
  open: boolean; onClose: () => void; customerId: number; addressType: string;
  existing?: CustomerAddress; onSuccess: () => void;
}) {
  const { t } = useTranslation();

  const { register, handleSubmit, formState: { errors }, watch, setValue, reset } = useForm({
    defaultValues: {
      address_line1: '', address_line2: '', soi: '', road: '',
      postal_code: '', sub_district: '', district: '', province: '',
    },
  });

  // Re-sync form when modal opens
  useEffect(() => {
    if (open) {
      reset({
        address_line1: existing?.address_line1 ?? '',
        address_line2: existing?.address_line2 ?? '',
        soi: existing?.soi ?? '',
        road: existing?.road ?? '',
        postal_code: existing?.postal_code ?? '',
        sub_district: existing?.sub_district ?? '',
        district: existing?.district ?? '',
        province: existing?.province ?? '',
      });
      setApiError('');
    }
  }, [open, existing, reset]);

  register('sub_district', { required: t('common.required') });
  register('district', { required: t('common.required') });
  register('province', { required: t('common.required') });

  const postalCode = watch('postal_code');
  const [postalResults, setPostalResults] = useState<PostalLookup[]>([]);
  const [apiError, setApiError] = useState('');
  const [saving, setSaving] = useState(false);

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
        const translated = translateApiError(err, t);
        setApiError(translated || err.message);
      } else setApiError(String(err));
    } finally { setSaving(false); }
  };

  const addressLabel = addressType === 'HOME' ? t('customer.addressHome') : t('customer.addressWork');

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{addressLabel}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-content">
          {apiError && <div className="alert alert-danger mb-3"><XCircle size={14} /><span>{apiError}</span></div>}
          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('customer.addressLine1')} *</label>
              <Input className="w-full" {...register('address_line1', { required: t('common.required') })} />
              <FormErrorMessage error={errors.address_line1} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('customer.addressLine2')}</label>
              <Input className="w-full" {...register('address_line2')} />
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col flex-1">
                <label className="form-label">{t('customer.soi')}</label>
                <Input className="w-full" {...register('soi')} />
              </div>
              <div className="flex flex-col flex-1">
                <label className="form-label">{t('customer.road')}</label>
                <Input className="w-full" {...register('road')} />
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col flex-1">
                <label className="form-label">{t('customer.postalCode')} *</label>
                <Input className="w-full" maxLength={5} placeholder={t('customer.postalCodeHint')} {...register('postal_code', { required: t('common.required') })} />
                <FormErrorMessage error={errors.postal_code} />
              </div>
              <div className="flex flex-col flex-1">
                <label className="form-label">{t('customer.subDistrict')} *</label>
                {postalResults.length > 0 ? (
                  <Select
                    options={subDistrictOptions}
                    value={watch('sub_district')}
                    onChange={handleSubDistrictSelect}
                    placeholder={t('customer.selectSubDistrict')}
                    showChevron
                  />
                ) : (
                  <Input className="w-full" value={watch('sub_district')} onChange={e => setValue('sub_district', e.target.value, { shouldValidate: true })} />
                )}
                <FormErrorMessage error={errors.sub_district} />
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col flex-1">
                <label className="form-label">{t('customer.district')} *</label>
                <Input className="w-full" disabled={postalResults.length > 0} value={watch('district')} onChange={e => setValue('district', e.target.value, { shouldValidate: true })} />
                <FormErrorMessage error={errors.district} />
              </div>
              <div className="flex flex-col flex-1">
                <label className="form-label">{t('customer.province')} *</label>
                <Input className="w-full" disabled={postalResults.length > 0} value={watch('province')} onChange={e => setValue('province', e.target.value, { shouldValidate: true })} />
                <FormErrorMessage error={errors.province} />
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button color="primary" type="submit" disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Add Contact Modal ───────────────────────────────────────────────────────

function AddContactModal({ open, onClose, customerId, onSuccess }: {
  open: boolean; onClose: () => void; customerId: number; onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [contactType, setContactType] = useState('MOBILE');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setValue(''); setLabel(''); setIsPrimary(false); setContactType('MOBILE'); setError(''); }
  }, [open]);

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
        const translated = translateApiError(err, t);
        setError(translated || err.message);
      } else setError(String(err));
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('customer.addContact')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="modal-content">
        {error && <div className="alert alert-danger mb-3"><XCircle size={14} /><span>{error}</span></div>}
        <div className="form-grid">
          <div className="flex gap-3">
            <div className="flex flex-col" style={{ width: '8rem' }}>
              <label className="form-label">{t('customer.contactType')}</label>
              <Select options={typeOptions} value={contactType} onChange={v => setContactType(v as string)} showChevron searchable={false} />
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <label className="form-label">{t('customer.contactValue')} *</label>
              {['MOBILE', 'HOME', 'WORK'].includes(contactType) ? (
                <PhoneInput value={value} onChange={(raw) => setValue(raw)} className="w-full" />
              ) : (
                <Input value={value} onChange={e => setValue(e.target.value)} className="w-full" />
              )}
            </div>
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('customer.contactLabel')}</label>
            <Input value={label} onChange={e => setLabel(e.target.value)} className="w-full" />
          </div>
          <LabeledCheckbox label={t('customer.contactPrimary')} checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} />
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={handleSave} disabled={saving || !value.trim()}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Add Reference Modal ─────────────────────────────────────────────────────

function AddReferenceModal({ open, onClose, customerId, onSuccess }: {
  open: boolean; onClose: () => void; customerId: number; onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [tel, setTel] = useState('');
  const [relation, setRelation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setName(''); setLastName(''); setTel(''); setRelation(''); setError(''); }
  }, [open]);

  const handleSave = async () => {
    // tel + relation are NOT NULL at the DB level (verified live) despite the
    // delivery doc marking them optional — require them so add never 500s.
    if (!name.trim() || !tel.trim() || !relation.trim()) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_customer_reference_add', {
        p_customer_id: customerId,
        p_name: name.trim(),
        p_last_name: lastName.trim() || null,
        p_tel: tel.trim(),
        p_relation: relation.trim(),
        p_facebook: null,
        p_line_id: null,
      });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setError(translated || err.message);
      } else setError(String(err));
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('customer.addReference')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="modal-content">
        {error && <div className="alert alert-danger mb-3"><XCircle size={14} /><span>{error}</span></div>}
        <div className="form-grid">
          <div className="flex gap-3">
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.refName')} *</label>
              <Input value={name} onChange={e => setName(e.target.value)} className="w-full" />
            </div>
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.refLastName')}</label>
              <Input value={lastName} onChange={e => setLastName(e.target.value)} className="w-full" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.refTel')} *</label>
              <PhoneInput value={tel} onChange={(raw) => setTel(raw)} className="w-full" />
            </div>
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.refRelation')} *</label>
              <Input value={relation} onChange={e => setRelation(e.target.value)} className="w-full" />
            </div>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={handleSave} disabled={saving || !name.trim() || !tel.trim() || !relation.trim()}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Reference Row (edit + soft-delete) ──────────────────────────────────────
// Writes go through RPCs — v_customer_references is read-only (mig 441).

function ReferenceRow({ reference, onEdit, onDeleted }: {
  reference: CustomerReference; onEdit: () => void; onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.rpc('fn_customer_reference_delete', { p_reference_id: reference.id });
      setConfirming(false);
      onDeleted();
    } catch (err) {
      // A delete that silently does nothing reads as success — surface it.
      const msg = err instanceof ApiError ? translateApiError(err, t) : (err instanceof Error ? err.message : String(err));
      addSnackbar({ message: <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{msg}</div></div></div> });
    } finally { setDeleting(false); }
  };

  return (
    <div className="flex items-center justify-between px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <div>
          <span className="font-medium">{reference.name} {reference.last_name}</span>
          {reference.relation && <span className="text-subtle ml-1.5">({reference.relation})</span>}
        </div>
        {reference.tel && <div className="text-xs tabular-nums text-subtle">{reference.tel}</div>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" className="btn-icon-xs" onClick={onEdit} startIcon={<Pencil size={12} />} />
        <Button variant="ghost" className="btn-icon-xs text-subtle hover:text-danger" onClick={() => setConfirming(true)} startIcon={<Trash2 size={12} />} />
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={handleDelete}
        message={t('customer.confirmDeleteReference', { name: `${reference.name} ${reference.last_name ?? ''}`.trim() })}
        confirmLabel={t('common.delete')}
        pending={deleting}
      />
    </div>
  );
}

// ── Edit Reference Modal ────────────────────────────────────────────────────

function EditReferenceModal({ open, reference, onClose, onSuccess }: {
  open: boolean; reference: CustomerReference | null; onClose: () => void; onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [tel, setTel] = useState('');
  const [relation, setRelation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && reference) {
      setName(reference.name);
      setLastName(reference.last_name ?? '');
      setTel(reference.tel ?? '');
      setRelation(reference.relation ?? '');
      setError('');
    }
  }, [open, reference]);

  const handleSave = async () => {
    // tel + relation are NOT NULL at the DB level (verified live) despite the
    // delivery doc marking them optional — require them so we never save blanks.
    if (!reference || !name.trim() || !tel.trim() || !relation.trim()) return;
    setSaving(true);
    setError('');
    try {
      // Send the whole visible object (doc recommends this for clear patch results).
      await apiClient.rpc('fn_customer_reference_update', {
        p_reference_id: reference.id,
        p_name: name.trim(),
        p_last_name: lastName.trim(),
        p_tel: tel.trim(),
        p_relation: relation.trim(),
      });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setError(translated || err.message);
      } else setError(String(err));
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('customer.editReference')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="modal-content">
        {error && <div className="alert alert-danger mb-3"><XCircle size={14} /><span>{error}</span></div>}
        <div className="form-grid">
          <div className="flex gap-3">
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.refName')} *</label>
              <Input value={name} onChange={e => setName(e.target.value)} className="w-full" />
            </div>
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.refLastName')}</label>
              <Input value={lastName} onChange={e => setLastName(e.target.value)} className="w-full" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.refTel')} *</label>
              <PhoneInput value={tel} onChange={(raw) => setTel(raw)} className="w-full" />
            </div>
            <div className="flex flex-col flex-1">
              <label className="form-label">{t('customer.refRelation')} *</label>
              <Input value={relation} onChange={e => setRelation(e.target.value)} className="w-full" />
            </div>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={handleSave} disabled={saving || !name.trim() || !tel.trim() || !relation.trim()}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}
