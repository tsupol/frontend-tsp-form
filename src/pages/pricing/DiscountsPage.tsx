import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, Badge, Input, Select, Button, Switch, Drawer,
  InputDatePicker, useSnackbarContext,
} from 'tsp-form';
import { CheckCircle, XCircle, Settings2, ClipboardList, Calendar } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { formatDateTime } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface DiscountPolicy {
  id: number;
  holding_id: number;
  company_id: number | null;
  branch_id: number | null;
  retail_max_discount_percent: number;
  fin1_max_discount_percent: number;
  fin2_max_discount_percent: number;
  effective_from: string | null;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface CompanyLookup {
  id: number;
  name: string;
}

interface BranchLookup {
  id: number;
  company_id: number;
  name: string;
}

interface ApprovalRequest {
  request_id: number;
  holding_id: number;
  company_id: number | null;
  branch_id: number | null;
  policy_type: string;
  source_type: string;
  source_ref: string | null;
  source_line_ref: string | null;
  status: string;
  target_amount: number | null;
  final_amount: number | null;
  discount_amount: number | null;
  max_discount_percent: number | null;
  requested_discount_percent: number | null;
  excess_discount_percent: number | null;
  min_allowed_amount: number | null;
  requested_reason: string | null;
  requested_by_user_id: number | null;
  requested_at: string | null;
  expires_at: string | null;
  is_expired_now: boolean;
  decision_reason: string | null;
  decided_by_user_id: number | null;
  decision_at: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatNumber = (value: number | null): string => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
};


const statusColor = (status: string): 'warning' | 'success' | 'danger' | 'default' => {
  switch (status) {
    case 'PENDING': return 'warning';
    case 'APPROVED': return 'success';
    case 'REJECTED': return 'danger';
    default: return 'default';
  }
};

const policyTypeColor = (type: string): 'info' | 'warning' | 'success' => {
  switch (type) {
    case 'RETAIL': return 'info';
    case 'FIN1': return 'warning';
    case 'FIN2': return 'success';
    default: return 'info';
  }
};

// ── Policy Tab ───────────────────────────────────────────────────────────────

function PolicyTab() {
  const { t, i18n } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();

  // User scope from auth
  const userCompanyId = user?.company_id ?? null;
  const userBranchId = user?.branch_id ?? null;
  const isHoldingLevel = !userCompanyId && !userBranchId;
  const isCompanyLevel = !!userCompanyId && !userBranchId;
  // Branch level: both set

  // Selected company/branch — only relevant when user can choose
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');

  // Effective IDs for the policy query
  const effectiveCompanyId = isHoldingLevel ? selectedCompanyId : String(userCompanyId ?? '');
  const effectiveBranchId = isHoldingLevel || isCompanyLevel ? selectedBranchId : String(userBranchId ?? '');

  // Form state
  const [retailMax, setRetailMax] = useState('');
  const [fin1Max, setFin1Max] = useState('');
  const [fin2Max, setFin2Max] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState<Date | null>(null);
  const [effectiveTo, setEffectiveTo] = useState<Date | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [policyId, setPolicyId] = useState<number | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Lookups — only fetch what the user can select
  const { data: companies = [] } = useQuery({
    queryKey: ['discount-companies'],
    queryFn: () => apiClient.get<CompanyLookup[]>('/v_companies?is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
    enabled: isHoldingLevel,
  });

  const branchQueryCompanyId = isHoldingLevel ? selectedCompanyId : String(userCompanyId ?? '');
  const { data: branches = [] } = useQuery({
    queryKey: ['discount-branches', branchQueryCompanyId],
    queryFn: () => apiClient.get<BranchLookup[]>(
      `/v_branches?is_active=is.true&company_id=eq.${branchQueryCompanyId}&order=name`
    ),
    enabled: !!branchQueryCompanyId && !userBranchId,
    staleTime: 5 * 60 * 1000,
  });

  const companyOptions = companies.map(c => ({ value: String(c.id), label: c.name }));
  const branchOptions = branches.map(b => ({ value: String(b.id), label: b.name }));

  // Scope label for display
  const scopeLabel = useMemo(() => {
    if (effectiveBranchId) return t('discount.scopeBranch');
    if (effectiveCompanyId) return t('discount.scopeCompany');
    return t('discount.scopeHolding');
  }, [effectiveCompanyId, effectiveBranchId, t]);

  // Reset form when scope changes
  useEffect(() => {
    setPolicyId(null);
    setRetailMax('0');
    setFin1Max('5');
    setFin2Max('5');
    setEffectiveFrom(null);
    setEffectiveTo(null);
    setIsActive(true);
    setErrorMessage('');
  }, [effectiveCompanyId, effectiveBranchId]);

  // Clear branch when company changes (holding-level user)
  useEffect(() => {
    if (isHoldingLevel) setSelectedBranchId('');
  }, [selectedCompanyId, isHoldingLevel]);

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMessage('');
    const start = Date.now();
    try {
      const cid = effectiveCompanyId ? parseInt(effectiveCompanyId) : null;
      const bid = effectiveBranchId ? parseInt(effectiveBranchId) : null;

      const result = await apiClient.rpc<DiscountPolicy>('discount_policy_upsert', {
        p_policy_id: policyId || undefined,
        p_company_id: policyId ? undefined : cid,
        p_branch_id: policyId ? undefined : bid,
        p_retail_max_discount_percent: retailMax ? parseFloat(retailMax) : 0,
        p_fin1_max_discount_percent: fin1Max ? parseFloat(fin1Max) : 5,
        p_fin2_max_discount_percent: fin2Max ? parseFloat(fin2Max) : 5,
        p_effective_from: effectiveFrom ? effectiveFrom.toISOString() : undefined,
        p_effective_to: effectiveTo ? effectiveTo.toISOString() : undefined,
        p_is_active: isActive,
      });
      // After first save, track the policy ID for subsequent updates
      setPolicyId(result.id);
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('discount.policySaved')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      {/* Scope selectors — only show what the user can choose */}
      {(isHoldingLevel || isCompanyLevel) && (
        <div className="form-grid mb-6">
          {isHoldingLevel && (
            <div className="flex flex-col">
              <label className="form-label">{t('users.company')}</label>
              <div>
                <Select
                  options={companyOptions}
                  value={selectedCompanyId || null}
                  onChange={(val) => setSelectedCompanyId((val as string) ?? '')}
                  placeholder={t('users.allCompanies')}
                  showChevron
                  clearable
                />
              </div>
            </div>
          )}
          {(isHoldingLevel ? !!selectedCompanyId : true) && (
            <div className="flex flex-col">
              <label className="form-label">{t('users.branch')}</label>
              <div>
                <Select
                  options={branchOptions}
                  value={selectedBranchId || null}
                  onChange={(val) => setSelectedBranchId((val as string) ?? '')}
                  placeholder={t('users.allBranches')}
                  showChevron
                  clearable
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scope indicator */}
      <div className="mb-4">
        <Badge size="sm" color="info">{scopeLabel}</Badge>
      </div>

      {/* Policy form — always visible with defaults */}
      <div className="space-y-4">
        {errorMessage && (
          <div className="alert alert-danger animate-pop-in">
            <XCircle size={16} />
            <div><div className="alert-description text-xs">{errorMessage}</div></div>
          </div>
        )}

        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('discount.retailMaxDiscount')}</label>
            <Input
              type="number" min={0} max={100} step="0.1"
              value={retailMax}
              onChange={(e) => setRetailMax(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col">
              <label className="form-label">{t('discount.fin1MaxDiscount')}</label>
              <Input
                type="number" min={0} max={100} step="0.1"
                value={fin1Max}
                onChange={(e) => setFin1Max(e.target.value)}
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('discount.fin2MaxDiscount')}</label>
              <Input
                type="number" min={0} max={100} step="0.1"
                value={fin2Max}
                onChange={(e) => setFin2Max(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col">
              <label className="form-label">{t('discount.effectiveFrom')}</label>
              <InputDatePicker
                value={effectiveFrom}
                onChange={setEffectiveFrom}
                placeholder={t('discount.effectiveFrom')}
                endIcon={<Calendar size={18} />}
                locale={i18n.language}
                calendar="gregorian"
                dateFormat={(d) => d ? formatDateTime(d.toISOString(), i18n.language) : ''}
                datePickerProps={{ showTime: true, timeFormat: '24h' }}
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('discount.effectiveTo')}</label>
              <InputDatePicker
                value={effectiveTo}
                onChange={setEffectiveTo}
                placeholder={t('discount.effectiveTo')}
                endIcon={<Calendar size={18} />}
                locale={i18n.language}
                calendar="gregorian"
                dateFormat={(d) => d ? formatDateTime(d.toISOString(), i18n.language) : ''}
                datePickerProps={{ showTime: true, timeFormat: '24h' }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="form-label mb-0">{t('discount.active')}</label>
            <Switch
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
          </div>
        </div>

        <Button
          color="primary" className="w-full"
          disabled={isSaving}
          onClick={handleSave}
        >
          {isSaving ? t('discount.saving') : t('discount.savePolicy')}
        </Button>
      </div>
    </div>
  );
}

// ── Review Drawer ────────────────────────────────────────────────────────────

function ReviewDrawer({ request, open, onClose }: {
  request: ApprovalRequest | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const queryClient = useQueryClient();

  const [reason, setReason] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setErrorMessage('');
    }
  }, [open]);

  const handleDecision = async (decision: 'APPROVE' | 'REJECT') => {
    if (!request) return;
    if (decision === 'REJECT' && !reason.trim()) return;

    const setLoading = decision === 'APPROVE' ? setIsApproving : setIsRejecting;
    setLoading(true);
    setErrorMessage('');
    const start = Date.now();
    try {
      await apiClient.rpc('discount_review', {
        p_request_id: request.request_id,
        p_decision: decision,
        p_decision_reason: reason.trim() || null,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">
              {t(decision === 'APPROVE' ? 'discount.approved' : 'discount.rejected')}
            </div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['discount-approvals'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setLoading(false);
    }
  };

  const isPending = request?.status === 'PENDING' && !request?.is_expired_now;
  const busy = isApproving || isRejecting;

  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('discount.reviewRequest')}>
      <div className="drawer-header">
        <h2 className="drawer-title">{t('discount.reviewRequest')}</h2>
        <button className="drawer-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="drawer-content">
        {request && (
          <div className="space-y-4">
            {/* Detail rows */}
            <div className="space-y-2 text-sm">
              <DetailRow label={t('discount.requestId')} value={`#${request.request_id}`} />
              <DetailRow label={t('discount.policyType')}>
                <Badge size="sm" color={policyTypeColor(request.policy_type)}>{request.policy_type}</Badge>
              </DetailRow>
              <DetailRow label={t('discount.status')}>
                <Badge size="sm" color={statusColor(request.status)}>
                  {t(`discount.status${request.status.charAt(0) + request.status.slice(1).toLowerCase()}`)}
                </Badge>
                {request.is_expired_now && request.status === 'PENDING' && (
                  <Badge size="sm" color="danger" className="ml-1">{t('discount.expired')}</Badge>
                )}
              </DetailRow>
              <DetailRow label={t('discount.sourceType')} value={request.source_type} />
              <DetailRow label={t('discount.sourceRef')} value={request.source_ref ?? '—'} />
              <hr className="border-line" />
              <DetailRow label={t('discount.targetAmount')} value={formatNumber(request.target_amount)} mono />
              <DetailRow label={t('discount.finalAmount')} value={formatNumber(request.final_amount)} mono />
              <DetailRow label={t('discount.discountAmount')} value={formatNumber(request.discount_amount)} mono />
              <DetailRow label={t('discount.requestedPercent')} value={request.requested_discount_percent !== null ? `${request.requested_discount_percent}%` : '—'} mono />
              <DetailRow label={t('discount.maxPercent')} value={request.max_discount_percent !== null ? `${request.max_discount_percent}%` : '—'} mono />
              <DetailRow label={t('discount.excessPercent')} value={request.excess_discount_percent !== null ? `${request.excess_discount_percent}%` : '—'} mono />
              <hr className="border-line" />
              <DetailRow label={t('discount.requestedReason')} value={request.requested_reason ?? '—'} />
              <DetailRow label={t('discount.requestedAt')}><DateTime value={request.requested_at} /></DetailRow>
              <DetailRow label={t('discount.expiresAt')}><DateTime value={request.expires_at} /></DetailRow>
              {request.decision_at && (
                <>
                  <hr className="border-line" />
                  <DetailRow label={t('discount.decisionReason')} value={request.decision_reason ?? '—'} />
                  <DetailRow label={t('discount.decisionAt')}><DateTime value={request.decision_at} /></DetailRow>
                </>
              )}
            </div>

            {/* Error */}
            {errorMessage && (
              <div className="alert alert-danger animate-pop-in">
                <XCircle size={16} />
                <div><div className="alert-description text-xs">{errorMessage}</div></div>
              </div>
            )}

            {/* Actions for PENDING */}
            {isPending && (
              <div className="space-y-3 pt-2 border-t border-line">
                <div className="flex flex-col">
                  <label className="form-label">{t('discount.decisionReason')}</label>
                  <textarea
                    className="input input-sm"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('discount.reasonPlaceholder')}
                    disabled={busy}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    color="success" size="sm" className="flex-1"
                    disabled={busy}
                    onClick={() => handleDecision('APPROVE')}
                  >
                    {isApproving ? t('discount.approving') : t('discount.approve')}
                  </Button>
                  <Button
                    color="danger" size="sm" className="flex-1"
                    disabled={busy || !reason.trim()}
                    onClick={() => handleDecision('REJECT')}
                  >
                    {isRejecting ? t('discount.rejecting') : t('discount.reject')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

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

// ── Approvals Tab ────────────────────────────────────────────────────────────

function ApprovalsTab() {
  const { t } = useTranslation();

  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  // Selected request for drawer
  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const statusOptions = [
    { value: '', label: t('discount.statusAll') },
    { value: 'PENDING', label: t('discount.statusPending') },
    { value: 'APPROVED', label: t('discount.statusApproved') },
    { value: 'REJECTED', label: t('discount.statusRejected') },
    { value: 'CANCELED', label: t('discount.statusCanceled') },
    { value: 'EXPIRED', label: t('discount.statusExpired') },
  ];

  const buildEndpoint = () => {
    const params: string[] = [];
    if (statusFilter) params.push(`status=eq.${statusFilter}`);
    params.push('order=requested_at.desc');
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    return `/v_discount_approval_requests${qs}`;
  };

  const { data: approvalsData, isFetching } = useQuery({
    queryKey: ['discount-approvals', statusFilter, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<ApprovalRequest>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const requests = approvalsData?.data ?? [];
  const totalCount = approvalsData?.totalCount ?? 0;

  // Reset page when filter changes
  useEffect(() => {
    setPageIndex(0);
  }, [statusFilter]);

  const handleRowClick = (req: ApprovalRequest) => {
    setSelectedRequest(req);
    setDrawerOpen(true);
  };

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <div style={{ width: '12rem' }}>
          <Select
            options={statusOptions}
            value={statusFilter}
            onChange={(val) => setStatusFilter((val as string) ?? '')}
            size="sm"
            showChevron
          />
        </div>
      </div>

      <DataTable<ApprovalRequest>
        data={requests}
        renderRow={(row) => {
          const req = row.original;
          return (
            <div
              className="flex items-center gap-3 px-3 py-2.5 border-b border-line hover:bg-surface-hover transition-colors cursor-pointer"
              onClick={() => handleRowClick(req)}
            >
              <span className="shrink-0 w-10 text-sm tabular-nums text-control-label">#{req.request_id}</span>
              <div className="shrink-0 w-14">
                <Badge size="sm" color={policyTypeColor(req.policy_type)}>{req.policy_type}</Badge>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm">{req.source_type}</div>
                {req.source_ref && (
                  <div className="text-[11px] text-control-label truncate">{req.source_ref}</div>
                )}
              </div>
              <div className="shrink-0 w-20 text-right hidden sm:block">
                <div className="text-sm tabular-nums">{formatNumber(req.discount_amount)}</div>
                <div className="text-[10px] text-control-label">{t('discount.discountAmount')}</div>
              </div>
              <div className="shrink-0 w-24 text-right hidden md:block">
                <div className="text-sm tabular-nums">
                  <span className={req.excess_discount_percent && req.excess_discount_percent > 0 ? 'text-danger font-medium' : ''}>
                    {req.requested_discount_percent !== null ? `${req.requested_discount_percent}%` : '—'}
                  </span>
                  <span className="text-control-label"> / </span>
                  <span>{req.max_discount_percent !== null ? `${req.max_discount_percent}%` : '—'}</span>
                </div>
                <div className="text-[10px] text-control-label">{t('discount.requestedPercent')}</div>
              </div>
              <div className="shrink-0 w-24 flex items-center gap-1">
                <Badge size="sm" color={statusColor(req.status)}>
                  {t(`discount.status${req.status.charAt(0) + req.status.slice(1).toLowerCase()}`)}
                </Badge>
                {req.is_expired_now && req.status === 'PENDING' && (
                  <Badge size="sm" color="danger">{t('discount.expired')}</Badge>
                )}
              </div>
              <div className="shrink-0 w-28 text-right hidden lg:block">
                <DateTime value={req.requested_at} className="text-sm text-control-label" />
              </div>
            </div>
          );
        }}
        enablePagination
        pageIndex={pageIndex}
        pageSize={pageSize}
        pageSizeOptions={[15, 25, 50]}
        rowCount={totalCount}
        onPageChange={({ pageIndex: pi, pageSize: ps }) => {
          setPageIndex(pi);
          setPageSize(ps);
        }}
        className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}
        noResults={
          <div className="p-8 text-center text-control-label">
            {t('discount.noRequests')}
          </div>
        }
      />

      <ReviewDrawer
        request={selectedRequest}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function DiscountsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'policies' | 'approvals'>('policies');

  return (
    <div className="page-content">
      <h1 className="heading-2 pb-4">{t('discount.title')}</h1>

      {/* Tab bar */}
      <div className="flex border-b border-line mb-6">
        <button
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium cursor-pointer transition-colors ${
            activeTab === 'policies'
              ? 'border-b-2 border-primary text-primary'
              : 'text-control-label hover:text-fg'
          }`}
          onClick={() => setActiveTab('policies')}
        >
          <Settings2 size={14} />
          {t('discount.policies')}
        </button>
        <button
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium cursor-pointer transition-colors ${
            activeTab === 'approvals'
              ? 'border-b-2 border-primary text-primary'
              : 'text-control-label hover:text-fg'
          }`}
          onClick={() => setActiveTab('approvals')}
        >
          <ClipboardList size={14} />
          {t('discount.approvals')}
        </button>
      </div>

      {activeTab === 'policies' && <PolicyTab />}
      {activeTab === 'approvals' && <ApprovalsTab />}
    </div>
  );
}
