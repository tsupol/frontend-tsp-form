import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, Input, Select, Button, Badge,
  Modal, TextArea, DataTableFooter, useSnackbarContext,
} from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Search, Scale, CheckCircle, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';

// ── Types ────────────────────────────────────────────────────────────────────

interface LegalCase {
  id: number;
  case_code: string;
  ref_contract_id: number;
  ref_contract_code: string;
  status: string;
  bucket_code: string;
  overdue_amount: number;
  overdue_installment_count: number;
  current_overdue_amount: number;
  current_overdue_installment_count: number;
  first_overdue_due_date: string | null;
  assigned_to_user_id: number | null;
  is_mine: boolean | null;
  is_takeable: boolean;
  queue_flag: string | null;
  last_action_note: string | null;
  last_action_at: string | null;
  province_name: string | null;
  district_name: string | null;
  created_at: string;
}

interface CaseDetail {
  case: {
    id: number;
    case_code: string;
    status: string;
    source: string;
    bucket_code: string;
    ref_contract_id: number;
    ref_contract_code: string;
    overdue_amount: number;
    overdue_installment_count: number;
    assigned_to_user_id: number | null;
    assigned_at: string | null;
    last_action_note: string | null;
    last_action_at: string | null;
    closed_at: string | null;
    closed_reason: string | null;
    first_overdue_due_date: string | null;
    created_at: string;
    updated_at: string;
  };
  events: {
    id: number;
    event_type: string;
    old_status: string | null;
    new_status: string | null;
    note: string | null;
    actor_user_id: number | null;
    created_at: string;
    payload: Record<string, unknown> | null;
  }[];
}

interface LegalCaseCustomer {
  legal_case_id: number;
  case_code: string;
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
  ref2_firstname: string | null;
  ref2_tel: string | null;
  ref2_relationship: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('en-US');

function overdueDuration(dateStr: string | null): string {
  if (!dateStr) return '—';
  const from = new Date(dateStr);
  const to = new Date();
  if (to < from) return '—';
  const diffMs = to.getTime() - from.getTime();
  const days = Math.round(diffMs / 86400000);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  const remainDays = days - months * 30;
  if (remainDays > 0) return `${months}m ${remainDays}d`;
  return `${months}m`;
}

const STATUS_OPTIONS = [
  { value: 'QUEUED', label: 'Queued' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'FIRST_LEGAL_NOTICE', label: '1st Notice' },
  { value: 'SECOND_LEGAL_NOTICE', label: '2nd Notice' },
  { value: 'COURT_PROCESS', label: 'Court' },
  { value: 'CLOSED_REPOSSESSED', label: 'Closed (Repossessed)' },
  { value: 'CLOSED_RESOLVED_BY_PAYMENT', label: 'Closed (Paid)' },
];

const getStatusColor = (status: string) => {
  if (status === 'QUEUED') return 'default';
  if (status === 'IN_PROGRESS') return 'info';
  if (status === 'FIRST_LEGAL_NOTICE') return 'warning';
  if (status === 'SECOND_LEGAL_NOTICE') return 'warning';
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
    case 'CLOSED_REPOSSESSED': return 'Repossessed';
    case 'CLOSED_RESOLVED_BY_PAYMENT': return 'Resolved';
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

// ── Component ────────────────────────────────────────────────────────────────

export function LegalCasesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  // Action modal
  const [actionType, setActionType] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionErrorKey, setActionErrorKey] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPageIndex(0); }, [debouncedSearch, filterStatus]);

  // Case list
  const { data: allCases } = useQuery({
    queryKey: ['legal-cases', filterStatus],
    queryFn: () => {
      let url = '/v_legal_case_list?order=created_at.desc';
      if (filterStatus) url += `&status=eq.${filterStatus}`;
      return apiClient.get<LegalCase[]>(url);
    },
    staleTime: 60 * 1000,
  });

  const filtered = useMemo(() => {
    let list = allCases ?? [];
    if (debouncedSearch) {
      const term = debouncedSearch.toLowerCase();
      list = list.filter(c =>
        c.case_code.toLowerCase().includes(term)
        || c.ref_contract_code.toLowerCase().includes(term)
        || (c.province_name ?? '').toLowerCase().includes(term)
      );
    }
    return list;
  }, [allCases, debouncedSearch]);

  const paged = filtered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  // Case detail
  const { data: caseDetail } = useQuery({
    queryKey: ['legal-case-detail', selectedCaseId],
    queryFn: () => apiClient.rpc<CaseDetail>('legal_case_get', { p_case_id: selectedCaseId }),
    staleTime: 30 * 1000,
    enabled: !!selectedCaseId,
  });

  // Customer info
  const { data: customerData } = useQuery({
    queryKey: ['legal-case-customer', selectedCaseId],
    queryFn: () => apiClient.get<LegalCaseCustomer[]>(`/v_legal_case_customer?legal_case_id=eq.${selectedCaseId}`),
    staleTime: 60 * 1000,
    enabled: !!selectedCaseId,
  });

  const customer = customerData?.[0] ?? null;

  const refreshCase = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['legal-cases'] });
    queryClient.invalidateQueries({ queryKey: ['legal-case-detail', selectedCaseId] });
    queryClient.invalidateQueries({ queryKey: ['legal-case-customer', selectedCaseId] });
  }, [queryClient, selectedCaseId]);

  // Action mutation
  const actionMutation = useMutation({
    mutationFn: () => {
      const params: Record<string, unknown> = { p_case_id: selectedCaseId };
      if (actionNote.trim()) params.p_note = actionNote.trim();

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
      const msg = actionType === 'take' ? t('legal.actionTakeSuccess')
        : actionType === 'advance' ? t('legal.actionAdvanceSuccess')
        : actionType === 'revert' ? t('legal.actionRevertSuccess')
        : actionType === 'release' ? t('legal.actionReleaseSuccess')
        : actionType === 'close' ? t('legal.actionCloseSuccess')
        : t('legal.actionNoteSuccess');
      setActionType(null);
      setActionNote('');
      setActionError('');
      refreshCase();
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{msg}</span></div> });
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

  const caseStatus = caseDetail?.case?.status;

  // Available actions based on status
  const actions = useMemo(() => {
    if (!caseStatus) return [];
    const list: { key: string; label: string; color: 'primary' | 'danger' | undefined }[] = [];
    if (caseStatus === 'QUEUED') list.push({ key: 'take', label: t('legal.actionTake'), color: 'primary' });
    if (['IN_PROGRESS', 'FIRST_LEGAL_NOTICE', 'SECOND_LEGAL_NOTICE'].includes(caseStatus)) {
      list.push({ key: 'advance', label: t('legal.actionAdvance'), color: 'primary' });
      list.push({ key: 'revert', label: t('legal.actionRevert'), color: undefined });
      list.push({ key: 'release', label: t('legal.actionRelease'), color: undefined });
    }
    if (caseStatus === 'COURT_PROCESS') {
      list.push({ key: 'close', label: t('legal.actionClose'), color: 'danger' });
      list.push({ key: 'revert', label: t('legal.actionRevert'), color: undefined });
    }
    if (!caseStatus.startsWith('CLOSED')) list.push({ key: 'note', label: t('legal.actionNote'), color: undefined });
    return list;
  }, [caseStatus, t]);

  const getActionTitle = (key: string) => {
    switch (key) {
      case 'take': return t('legal.actionTake');
      case 'advance': return t('legal.actionAdvance');
      case 'revert': return t('legal.actionRevert');
      case 'release': return t('legal.actionRelease');
      case 'close': return t('legal.actionClose');
      case 'note': return t('legal.actionNote');
      default: return '';
    }
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
                {isRoot ? t('legal.casesTitle') : (caseDetail?.case?.case_code ?? '')}
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
              {/* Filters */}
              <div className="flex-none flex gap-2 px-4 py-2 border-b border-line">
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

              {/* Case list */}
              <div className="flex-1 overflow-auto better-scroll">
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
                          <span className="font-medium text-sm">{c.case_code}</span>
                          <Badge size="xs" color={getStatusColor(c.status)}>{getStatusLabel(c.status)}</Badge>
                        </div>
                        <div className="text-xs text-subtle">{c.ref_contract_code}</div>
                        <div className="flex items-center justify-between mt-1 text-xs">
                          <span className="text-subtle">{c.province_name ?? ''}</span>
                          <span className="tabular-nums text-danger font-medium">{fmt(c.current_overdue_amount)}</span>
                        </div>
                        {c.queue_flag === 'NEW' && c.status === 'QUEUED' && (
                          <Badge size="xs" color="info" className="mt-1">NEW</Badge>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Pagination */}
              {filtered.length > 0 && (
                <div className="flex-none border-t border-line px-2 py-1">
                  <DataTableFooter
                    currentPage={pageIndex + 1}
                    totalPages={Math.ceil(filtered.length / pageSize)}
                    onPageChange={(p) => setPageIndex(p - 1)}
                    pageSize={pageSize}
                    pageSizeOptions={[15, 25, 50]}
                    onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
                    totalRows={filtered.length}
                  />
                </div>
              )}
            </PageNavPanel>

            {/* ── Detail ── */}
            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
              {selectedCaseId && caseDetail ? (
                <div className="flex-1 overflow-auto better-scroll">
                  <div className="px-4 md:px-6 py-4 max-w-2xl">
                    {/* Case header */}
                    <div className="flex items-center gap-3 mb-4">
                      <h2 className="text-lg font-semibold">{caseDetail.case.case_code}</h2>
                      <Badge size="sm" color={getStatusColor(caseDetail.case.status)}>{getStatusLabel(caseDetail.case.status)}</Badge>
                    </div>

                    {/* Overdue summary */}
                    <div className="mb-4 px-3 py-2.5 rounded-md bg-danger/5 border border-danger/20">
                      <div className="flex justify-between text-sm">
                        <span className="text-subtle">{t('legal.overdueAmount')}</span>
                        <span className="tabular-nums font-semibold text-danger">{fmt(caseDetail.case.overdue_amount)}</span>
                      </div>
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-subtle">{t('legal.overdueCount')}</span>
                        <span className="tabular-nums">{caseDetail.case.overdue_installment_count} {t('legal.installments')}</span>
                      </div>
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-subtle">{t('legal.since')}</span>
                        <span>{overdueDuration(caseDetail.case.first_overdue_due_date)}</span>
                      </div>
                    </div>

                    {/* Contract ref */}
                    <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line text-sm">
                      <div className="flex justify-between">
                        <span className="text-subtle">{t('legal.contract')}</span>
                        <span className="font-medium">{caseDetail.case.ref_contract_code}</span>
                      </div>
                    </div>

                    {/* Customer info */}
                    {customer && (
                      <div className="mb-4">
                        <h3 className="text-sm font-semibold mb-2">{t('legal.customerInfo')}</h3>
                        <div className="px-3 py-2.5 rounded-md bg-surface border border-line text-sm space-y-1.5">
                          <div className="flex justify-between">
                            <span className="text-subtle">{t('legal.name')}</span>
                            <span>{customer.cus_firstname} {customer.cus_lastname}</span>
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
                          {customer.cus_facebook && (
                            <div className="flex justify-between">
                              <span className="text-subtle">Facebook</span>
                              <a href={customer.cus_facebook} target="_blank" rel="noopener noreferrer" className="text-primary text-xs truncate max-w-48">{customer.cus_facebook}</a>
                            </div>
                          )}

                          {/* References */}
                          {customer.ref1_firstname && (
                            <>
                              <div className="border-t border-line my-1" />
                              <div className="text-xs text-subtle font-medium">{t('legal.reference')} 1: {customer.ref1_relationship}</div>
                              <div className="flex justify-between text-xs">
                                <span>{customer.ref1_firstname}</span>
                                <span>{customer.ref1_tel}</span>
                              </div>
                            </>
                          )}
                          {customer.ref2_firstname && customer.ref2_tel && (
                            <>
                              <div className="text-xs text-subtle font-medium">{t('legal.reference')} 2: {customer.ref2_relationship}</div>
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
                    <div className="mb-4">
                      <h3 className="text-sm font-semibold mb-2">{t('legal.timeline')}</h3>
                      <div className="space-y-3">
                        {caseDetail.events.map(ev => (
                          <div key={ev.id} className="flex gap-3">
                            <div className="w-1 shrink-0 rounded-full bg-line" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <Badge size="xs" color={ev.event_type === 'CLOSED' ? 'success' : ev.event_type === 'ADVANCED' ? 'warning' : 'default'}>
                                  {getEventLabel(ev.event_type)}
                                </Badge>
                                {ev.old_status && ev.new_status && (
                                  <span className="text-xs text-subtle">{ev.old_status} → {ev.new_status}</span>
                                )}
                              </div>
                              {ev.note && <div className="text-sm mt-0.5">{ev.note}</div>}
                              <div className="text-xs text-subtle mt-0.5"><DateTime value={ev.created_at} /></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  {actions.length > 0 && (
                    <div className="flex-none px-4 py-3 border-t border-line flex flex-wrap gap-2">
                      {actions.map(a => (
                        <Button
                          key={a.key}
                          variant="outline"
                          size="sm"
                          color={a.color}
                          onClick={() => { setActionType(a.key); setActionNote(''); setActionError(''); }}
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
                  <h2 className="modal-title">{getActionTitle(actionType)}</h2>
                  <button type="button" className="modal-close-btn" onClick={() => setActionType(null)}>&times;</button>
                </div>
                <div className="modal-content">
                  {actionError && (
                    <div key={actionErrorKey} className="alert alert-danger mb-4 animate-pop-in">
                      <XCircle size={16} /><span>{actionError}</span>
                    </div>
                  )}
                  <div className="form-grid gap-4">
                    <div className="flex flex-col">
                      <label className="form-label">
                        {actionType === 'note' ? `${t('legal.noteLabel')} *` : t('legal.noteLabel')}
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
                  <Button onClick={() => setActionType(null)}>{t('common.cancel')}</Button>
                  <Button
                    color={actionType === 'close' ? 'danger' : 'primary'}
                    onClick={() => actionMutation.mutate()}
                    disabled={actionMutation.isPending || (actionType === 'note' && !actionNote.trim())}
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
