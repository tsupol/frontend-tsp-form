import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, Input, Select, Button, Badge,
  Modal, TextArea, DataTableFooter, InputDatePicker, useSnackbarContext,
} from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Search, Scale, CheckCircle, XCircle, ExternalLink } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';

// ── Types (matched to actual API responses) ─────────────────────────────────

interface LegalCaseListItem {
  id: number;
  case_code: string | null;
  ref_contract_id: number;
  ref_contract_code: string | null;
  ref_contract_source: string | null;
  holding_id: number | null;
  company_id: number | null;
  bucket_code: string;
  first_overdue_due_date: string | null;
  overdue_amount: number;
  overdue_installment_count: number;
  current_bucket_code: string;
  current_overdue_amount: number | null;
  current_overdue_installment_count: number | null;
  current_first_overdue_due_date: string | null;
  next_due_date: string | null;
  next_due_amount: number | null;
  next_due_outstanding: number | null;
  status: string;
  assigned_to_user_id: number | null;
  is_mine: boolean | null;
  assigned_at: string | null;
  last_action_note: string | null;
  last_action_at: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  province_name: string | null;
  district_name: string | null;
  subdistrict_name: string | null;
  created_at: string;
  updated_at: string;
  queue_flag: string | null;
  is_takeable: boolean;
}

interface CaseDetailData {
  id: number;
  source: string;
  status: string;
  case_code: string | null;
  code_display: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  company_id: number | null;
  holding_id: number | null;
  created_at: string;
  updated_at: string;
  assigned_at: string | null;
  assigned_to_user_id: number | null;
  bucket_code: string;
  dunning_job_id: number | null;
  last_action_at: string | null;
  last_action_note: string | null;
  overdue_amount: number;
  overdue_installment_count: number;
  ref_contract_id: number;
  ref_contract_code: string | null;
  ref_contract_source: string | null;
  first_overdue_due_date: string | null;
}

interface CaseEvent {
  id: number;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  note: string | null;
  actor_user_id: number | null;
  created_at: string;
  payload: Record<string, unknown> | null;
}

interface CaseDetailResponse {
  case: CaseDetailData;
  events: CaseEvent[];
}

interface LegalCaseCustomer {
  legal_case_id: number;
  case_code: string | null;
  ref_contract_id: number;
  contract_code: string;
  overdue_amount: number;
  overdue_installment_count: number;
  current_bucket_code: string;
  first_overdue_due_date: string | null;
  customer_id: number | null;
  cus_firstname: string | null;
  cus_lastname: string | null;
  cus_tel: string | null;
  cus_address: string | null;
  cus_facebook: string | null;
  province_name: string | null;
  district_name: string | null;
  subdistrict_name: string | null;
  ref1_firstname: string | null;
  ref1_tel: string | null;
  ref1_relationship: string | null;
  ref1_facebook: string | null;
  ref2_firstname: string | null;
  ref2_tel: string | null;
  ref2_relationship: string | null;
  ref2_facebook: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('en-US');

function overdueDuration(dateStr: string | null): string {
  if (!dateStr) return '—';
  const from = new Date(dateStr);
  const to = new Date();
  if (to < from) return '—';
  const days = Math.round((to.getTime() - from.getTime()) / 86400000);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  const rem = days - months * 30;
  return rem > 0 ? `${months}m ${rem}d` : `${months}m`;
}

const STATUS_OPTIONS = [
  { value: 'QUEUED', label: 'Queued' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'FIRST_LEGAL_NOTICE', label: '1st Notice' },
  { value: 'SECOND_LEGAL_NOTICE', label: '2nd Notice' },
  { value: 'COURT_PROCESS', label: 'Court' },
  { value: 'CLOSED_REPOSSESSION_SUCCESS', label: 'Closed (Repossessed)' },
  { value: 'CLOSED_RESOLVED_BY_PAYMENT', label: 'Closed (Paid)' },
];

const getStatusColor = (status: string) => {
  if (status === 'QUEUED') return 'default';
  if (status === 'IN_PROGRESS') return 'info';
  if (status.includes('NOTICE')) return 'warning';
  if (status === 'COURT_PROCESS') return 'danger';
  if (status.startsWith('CLOSED')) return 'success';
  return 'default' as const;
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'QUEUED': return 'Queued';
    case 'IN_PROGRESS': return 'In Progress';
    case 'FIRST_LEGAL_NOTICE': return '1st Notice';
    case 'SECOND_LEGAL_NOTICE': return '2nd Notice';
    case 'COURT_PROCESS': return 'Court';
    case 'CLOSED_REPOSSESSION_SUCCESS': return 'Repossessed';
    case 'CLOSED_RESOLVED_BY_PAYMENT': return 'Resolved';
    case 'CLOSED_CANCELED_OR_CLOSED': return 'Closed';
    default: return status;
  }
};

const getEventLabel = (type: string) => {
  switch (type) {
    case 'CREATED': return 'Created';
    case 'TAKEN': return 'Taken';
    case 'ADVANCED': return 'Advanced';
    case 'REVERTED': return 'Reverted';
    case 'RELEASED': return 'Released';
    case 'CLOSED': return 'Closed';
    case 'NOTE_ADDED': return 'Note';
    default: return type;
  }
};

const getEventColor = (type: string) => {
  switch (type) {
    case 'CLOSED': return 'success';
    case 'ADVANCED': return 'warning';
    case 'REVERTED': return 'danger';
    case 'NOTE_ADDED': return 'info';
    default: return 'default';
  }
};

const getBucketLabel = (bucket: string) => {
  switch (bucket) {
    case 'CURRENT': return 'Current';
    case 'OVERDUE_1_7': return '1-7d';
    case 'OVERDUE_8_15': return '8-15d';
    case 'OVERDUE_16_30': return '16-30d';
    case 'OVERDUE_31_45': return '31-45d';
    case 'OVERDUE_46_PLUS': return '46+d';
    default: return bucket;
  }
};

// ── Component ────────────────────────────────────────────────────────────────

export function LegalCasesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();
  const canAct = ['COMPANY_REPO', 'SYSTEM_DEV'].includes(user?.role_code ?? '');

  // URL-driven selection
  const { caseId: caseIdParam } = useParams<{ caseId?: string }>();
  const selectedCaseId = caseIdParam ? Number(caseIdParam) : null;

  const setSelectedCaseId = useCallback((id: number | null) => {
    if (id) navigate(`/admin/legal/cases/${id}`, { replace: true });
    else navigate('/admin/legal/cases', { replace: true });
  }, [navigate]);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  // Action modal
  const [actionType, setActionType] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [actionDate, setActionDate] = useState<Date | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionErrorKey, setActionErrorKey] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPageIndex(0); }, [debouncedSearch, filterStatus]);

  // ── Data ──

  const { data: pageData, isFetching } = useQuery({
    queryKey: ['legal-cases', filterStatus, debouncedSearch, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_legal_case_list?order=created_at.desc';
      if (filterStatus) url += `&status=eq.${filterStatus}`;
      if (debouncedSearch) {
        url += `&or=(case_code.ilike.*${encodeURIComponent(debouncedSearch)}*,ref_contract_code.ilike.*${encodeURIComponent(debouncedSearch)}*)`;
      }
      return apiClient.getPaginated<LegalCaseListItem>(url, { page: pageIndex + 1, pageSize });
    },
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const paged = pageData?.data ?? [];
  const totalCount = pageData?.totalCount ?? 0;

  // Case detail (RPC)
  const { data: caseDetail } = useQuery({
    queryKey: ['legal-case-detail', selectedCaseId],
    queryFn: () => apiClient.rpc<CaseDetailResponse>('legal_case_get', { p_case_id: selectedCaseId }),
    staleTime: 30 * 1000,
    enabled: !!selectedCaseId,
  });

  // Customer info (view — has name, tel, address, references)
  const { data: customerData } = useQuery({
    queryKey: ['legal-case-customer', selectedCaseId],
    queryFn: () => apiClient.get<LegalCaseCustomer[]>(`/v_legal_case_customer?legal_case_id=eq.${selectedCaseId}`),
    staleTime: 60 * 1000,
    enabled: !!selectedCaseId,
  });

  const customer = customerData?.[0] ?? null;
  const caseData = caseDetail?.case ?? null;

  const refreshCase = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['legal-cases'] });
    queryClient.invalidateQueries({ queryKey: ['legal-case-detail', selectedCaseId] });
    queryClient.invalidateQueries({ queryKey: ['legal-case-customer', selectedCaseId] });
  }, [queryClient, selectedCaseId]);

  // ── Action mutation ──

  const actionMutation = useMutation({
    mutationFn: () => {
      const params: Record<string, unknown> = { p_case_id: selectedCaseId };
      if (actionNote.trim()) params.p_note = actionNote.trim();
      if (actionType === 'advance' && actionDate) {
        params.p_action_date = actionDate.toISOString().split('T')[0];
      }
      const rpcMap: Record<string, string> = {
        take: 'legal_case_take',
        advance: 'legal_case_advance',
        revert: 'legal_case_revert',
        release: 'legal_case_release',
        close: 'legal_case_close_repossessed',
        note: 'legal_case_add_note',
      };
      return apiClient.rpc(rpcMap[actionType!], params);
    },
    onSuccess: () => {
      const msgMap: Record<string, string> = {
        take: t('legal.actionTakeSuccess'), advance: t('legal.actionAdvanceSuccess'),
        revert: t('legal.actionRevertSuccess'), release: t('legal.actionReleaseSuccess'),
        close: t('legal.actionCloseSuccess'), note: t('legal.actionNoteSuccess'),
      };
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{msgMap[actionType!]}</span></div> });
      setActionType(null);
      setActionNote('');
      setActionDate(null);
      setActionError('');
      refreshCase();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setActionError(translated || err.message);
      } else setActionError(String(err));
      setActionErrorKey(k => k + 1);
    },
  });

  // Available actions based on status
  const actions = useMemo(() => {
    if (!caseData || !canAct) return [];
    const s = caseData.status;
    const list: { key: string; label: string; color: 'primary' | 'danger' | undefined }[] = [];
    if (s === 'QUEUED') list.push({ key: 'take', label: t('legal.actionTake'), color: 'primary' });
    if (['IN_PROGRESS', 'FIRST_LEGAL_NOTICE', 'SECOND_LEGAL_NOTICE'].includes(s)) {
      list.push({ key: 'advance', label: t('legal.actionAdvance'), color: 'primary' });
      list.push({ key: 'release', label: t('legal.actionRelease'), color: undefined });
    }
    if (['FIRST_LEGAL_NOTICE', 'SECOND_LEGAL_NOTICE', 'COURT_PROCESS'].includes(s)) {
      list.push({ key: 'revert', label: t('legal.actionRevert'), color: undefined });
    }
    if (['IN_PROGRESS', 'FIRST_LEGAL_NOTICE', 'SECOND_LEGAL_NOTICE', 'COURT_PROCESS'].includes(s)) {
      list.push({ key: 'close', label: t('legal.actionClose'), color: 'danger' });
    }
    if (!s.startsWith('CLOSED')) list.push({ key: 'note', label: t('legal.actionNote'), color: undefined });
    return list;
  }, [caseData, canAct, t]);

  const goToContract = useCallback((contractId: number) => {
    navigate(`/admin/contracts/search/${contractId}`);
  }, [navigate]);

  // Display name for case
  const caseName = (c: LegalCaseListItem) => c.case_code ?? `#${c.id}`;
  const caseDisplayName = caseData ? (caseData.code_display ?? caseData.case_code ?? `#${caseData.id}`) : '';

  return (
    <PageNav panels={['list', 'detail']} defaultPanel={selectedCaseId ? 'detail' : 'list'} className="h-dvh">
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
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => { setSelectedCaseId(null); goBack(); }}>
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('legal.casesTitle') : caseDisplayName}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('legal.casesTitle')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* ── List ── */}
            <PageNavPanel id="list" className={isMobile ? '' : 'w-5/12 xl:w-4/12 border-r border-line flex flex-col'}>
              <div className="flex-none flex gap-2 p-2 border-b border-line">
                <div className="flex-1 min-w-0">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('legal.searchCases')}
                    size="sm"
                    startIcon={<Search size={16} />}
                    className="w-full"
                  />
                </div>
                <div style={{ width: '8rem' }}>
                  <Select
                    options={STATUS_OPTIONS}
                    value={filterStatus}
                    onChange={(val) => setFilterStatus((val as string) || null)}
                    placeholder={t('legal.allStatuses')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
              </div>

              <div className={`data-table-content better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
                {paged.length === 0 ? (
                  <div className="p-8 text-center text-subtler">{t('common.noData')}</div>
                ) : (
                  <div className="flex flex-col divide-y divide-line">
                    {paged.map(c => (
                      <button
                        key={c.id}
                        className={`w-full text-left px-4 py-2.5 transition-colors cursor-pointer ${
                          c.id === selectedCaseId ? 'bg-primary/10' : 'hover:bg-surface-hover'
                        }`}
                        onClick={() => { setSelectedCaseId(c.id); if (isMobile) goTo('detail'); }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm">{caseName(c)}</span>
                          <Badge size="xs" color={getStatusColor(c.status)}>{getStatusLabel(c.status)}</Badge>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {c.ref_contract_source === 'legacy' && <Badge size="xs" color="default">LEGACY</Badge>}
                            {c.queue_flag === 'NEW' && c.status === 'QUEUED' && <Badge size="xs" color="info">NEW</Badge>}
                            <span className="text-subtle truncate">
                              {getBucketLabel(c.current_bucket_code)} · {c.province_name ?? ''}
                            </span>
                          </div>
                          <span className="tabular-nums text-danger font-medium shrink-0 ml-2">
                            {fmt(c.current_overdue_amount ?? c.overdue_amount)}
                          </span>
                        </div>
                        {c.last_action_note && (
                          <div className="mt-1 text-xs text-subtle truncate">
                            {c.last_action_at && (
                              <span className="text-[11px] text-subtler mr-1">
                                <DateTime value={c.last_action_at} showTime={false} />
                              </span>
                            )}
                            {c.last_action_note}
                          </div>
                        )}
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

            {/* ── Detail ── */}
            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
              {selectedCaseId && caseData ? (
                <div className="flex-1 flex flex-col">
                  <div className="flex-1 overflow-auto better-scroll">
                    <div className="px-4 md:px-6 py-4 max-w-2xl">
                      {/* Case header */}
                      <div className="flex items-center gap-3 mb-4">
                        <h2 className="text-lg font-semibold">{caseDisplayName}</h2>
                        <Badge size="sm" color={getStatusColor(caseData.status)}>{getStatusLabel(caseData.status)}</Badge>
                        {caseData.source === 'LEGACY' && <Badge size="sm" color="default">LEGACY</Badge>}
                      </div>

                      {/* Overdue summary */}
                      <div className="mb-4 px-3 py-2.5 rounded-md bg-danger/5 border border-danger/20">
                        <div className="flex justify-between text-sm">
                          <span className="text-subtle">{t('legal.overdueAmount')}</span>
                          <span className="tabular-nums font-semibold text-danger">{fmt(caseData.overdue_amount)}</span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-subtle">{t('legal.overdueCount')}</span>
                          <span className="tabular-nums">{caseData.overdue_installment_count} {t('legal.installments')}</span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-subtle">{t('legal.since')}</span>
                          <span>{caseData.first_overdue_due_date ? <><DateTime value={caseData.first_overdue_due_date} showTime={false} /> ({overdueDuration(caseData.first_overdue_due_date)})</> : '—'}</span>
                        </div>
                      </div>

                      {/* Contract link */}
                      <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line text-sm space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-subtle">{t('legal.contract')}</span>
                          {customer?.contract_code && caseData.ref_contract_source !== 'legacy' ? (
                            <button
                              className="font-medium text-primary-fg hover:underline cursor-pointer bg-transparent border-none p-0 flex items-center gap-1"
                              onClick={() => goToContract(caseData.ref_contract_id)}
                            >
                              {customer.contract_code}
                              <ExternalLink size={12} />
                            </button>
                          ) : (
                            <span className="text-sm">{customer?.contract_code ?? caseData.ref_contract_code ?? `ID: ${caseData.ref_contract_id}`}</span>
                          )}
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-subtle">{t('legal.bucket')}</span>
                          <Badge size="xs" color="danger">{getBucketLabel(caseData.bucket_code)}</Badge>
                        </div>
                        {caseData.assigned_to_user_id && (
                          <div className="flex justify-between text-xs">
                            <span className="text-subtle">{t('legal.assignedTo')}</span>
                            <span>User #{caseData.assigned_to_user_id}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-xs">
                          <span className="text-subtle">{t('legal.caseCreated')}</span>
                          <DateTime value={caseData.created_at} />
                        </div>
                      </div>

                      {/* Customer info */}
                      {customer && (
                        <div className="mb-4">
                          <h3 className="text-sm font-semibold mb-2">{t('legal.customerInfo')}</h3>
                          <div className="px-3 py-2.5 rounded-md bg-surface border border-line text-sm space-y-1.5">
                            <div className="flex justify-between">
                              <span className="text-subtle">{t('legal.name')}</span>
                              <span>{[customer.cus_firstname, customer.cus_lastname].filter(Boolean).join(' ') || '—'}</span>
                            </div>
                            {customer.cus_tel && (
                              <div className="flex justify-between">
                                <span className="text-subtle">{t('legal.tel')}</span>
                                <span>{customer.cus_tel}</span>
                              </div>
                            )}
                            {customer.cus_address && (
                              <div className="flex justify-between">
                                <span className="text-subtle">{t('legal.address')}</span>
                                <span className="text-right max-w-60">{customer.cus_address}</span>
                              </div>
                            )}
                            {customer.province_name && (
                              <div className="flex justify-between">
                                <span className="text-subtle">{t('legal.area')}</span>
                                <span>{[customer.subdistrict_name, customer.district_name, customer.province_name].filter(Boolean).join(', ')}</span>
                              </div>
                            )}
                            {customer.cus_facebook && customer.cus_facebook !== '-' && (
                              <div className="flex justify-between">
                                <span className="text-subtle">Facebook</span>
                                <a href={customer.cus_facebook} target="_blank" rel="noopener noreferrer" className="text-primary-fg text-xs truncate max-w-48">{customer.cus_facebook}</a>
                              </div>
                            )}

                            {/* References */}
                            {customer.ref1_firstname && (
                              <>
                                <div className="border-t border-line my-2" />
                                <div className="text-xs text-subtle font-medium">{t('legal.reference')} 1: {customer.ref1_relationship}</div>
                                <div className="flex justify-between text-xs">
                                  <span>{customer.ref1_firstname}</span>
                                  <span>{customer.ref1_tel}</span>
                                </div>
                              </>
                            )}
                            {customer.ref2_firstname && customer.ref2_tel && (
                              <>
                                <div className="mt-2 text-xs text-subtle font-medium">{t('legal.reference')} 2: {customer.ref2_relationship}</div>
                                <div className="flex justify-between text-xs">
                                  <span>{customer.ref2_firstname}</span>
                                  <span>{customer.ref2_tel}</span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Event timeline */}
                      {caseDetail && caseDetail.events.length > 0 && (
                        <div className="mb-4">
                          <h3 className="text-sm font-semibold mb-2">{t('legal.timeline')}</h3>
                          <div className="space-y-3">
                            {caseDetail.events.map(ev => (
                              <div key={ev.id} className="flex gap-3">
                                <div className="w-1 shrink-0 rounded-full bg-line" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Badge size="xs" color={getEventColor(ev.event_type)}>
                                      {getEventLabel(ev.event_type)}
                                    </Badge>
                                    {ev.old_status && ev.new_status && (
                                      <span className="text-xs text-subtle">{getStatusLabel(ev.old_status)} → {getStatusLabel(ev.new_status)}</span>
                                    )}
                                    <span className="text-[11px] text-subtler ml-auto shrink-0">
                                      <DateTime value={ev.created_at} />
                                    </span>
                                  </div>
                                  {ev.note && <div className="text-sm mt-1 whitespace-pre-wrap">{ev.note}</div>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action buttons — sticky at bottom */}
                  {actions.length > 0 && (
                    <div className="flex-none px-4 py-3 border-t border-line bg-bg flex flex-wrap gap-2">
                      {actions.map(a => (
                        <Button
                          key={a.key}
                          variant="outline"
                          size="sm"
                          color={a.color}
                          onClick={() => { setActionType(a.key); setActionNote(''); setActionDate(null); setActionError(''); }}
                        >
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  <div className="text-center">
                    <Scale size={32} className="mx-auto mb-2 opacity-40" />
                    <div>{t('legal.selectCase')}</div>
                  </div>
                </div>
              )}
            </PageNavPanel>
          </div>

          {/* Action Modal */}
          <Modal open={!!actionType} onClose={() => setActionType(null)} maxWidth="24rem" width="100%">
            {actionType && (
              <>
                <div className="modal-header">
                  <h2 className="modal-title">
                    {{
                      take: t('legal.actionTake'), advance: t('legal.actionAdvance'),
                      revert: t('legal.actionRevert'), release: t('legal.actionRelease'),
                      close: t('legal.actionClose'), note: t('legal.actionNote'),
                    }[actionType]}
                  </h2>
                </div>
                <div className="modal-content">
                  {actionError && (
                    <div key={actionErrorKey} className="alert alert-danger mb-4 animate-pop-in">
                      <XCircle size={16} /><span>{actionError}</span>
                    </div>
                  )}
                  <div className="form-grid gap-4">
                    {actionType === 'advance' && (
                      <div className="flex flex-col">
                        <label className="form-label">{t('legal.actionDate')}</label>
                        <InputDatePicker
                          value={actionDate}
                          onChange={setActionDate}
                          placeholder={t('legal.actionDatePlaceholder')}
                          size="md"
                        />
                      </div>
                    )}
                    <div className="flex flex-col">
                      <label className="form-label">
                        {t('legal.noteLabel')}{(actionType === 'note' || actionType === 'advance') && ' *'}
                      </label>
                      <TextArea
                        value={actionNote}
                        onChange={(e) => setActionNote(e.target.value)}
                        placeholder={t('legal.notePlaceholder')}
                        rows={3}
                      />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <Button variant="ghost" onClick={() => setActionType(null)}>{t('common.cancel')}</Button>
                  <Button
                    color={actionType === 'close' ? 'danger' : 'primary'}
                    onClick={() => actionMutation.mutate()}
                    disabled={actionMutation.isPending || ((actionType === 'note' || actionType === 'advance') && !actionNote.trim())}
                  >
                    {actionMutation.isPending ? t('common.loading') : t('common.confirm')}
                  </Button>
                </div>
              </>
            )}
          </Modal>
        </>
      )}
    </PageNav>
  );
}
