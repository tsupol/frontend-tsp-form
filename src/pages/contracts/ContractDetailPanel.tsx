import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Badge } from 'tsp-form';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { getStateColor, getStateLabel, fmtCurrency } from './contractUtils';
import { ContractActionButtons } from './ContractActions';
import { config } from '../../config/config';

// ── Types ────────────────────────────────────────────────────────────────────

interface ContractDetail {
  id: number;
  code: string;
  code_display: string | null;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  state: string;
  close_reason: string | null;
  close_reason_note: string | null;
  commercial_model: string | null;
  customer_id: number | null;
  customer_name: string | null;
  draft_note: string | null;
  device_id: number | null;
  device_identifier: string | null;
  is_paused: boolean;
  paused_at: string | null;
  product_id: number | null;
  model_id: number | null;
  model_name: string | null;
  variant_id: number | null;
  variant_name: string | null;
  rate_card_id: number | null;
  cost_price: number | null;
  list_price: number | null;
  rate_percent: number | null;
  agreed_price: number | null;
  down_payment: number | null;
  insurance_deposit: number | null;
  insurance_balance: number | null;
  installment_amount: number | null;
  value_month: number | null;
  saving_target_amount: number | null;
  snapshot_term_months: number | null;
  snapshot_installment_amount: number | null;
  snapshot_total_financed: number | null;
  agreed_total_financed: number | null;
  discount_amount: number | null;
  discount_percent: number | null;
  discount_approval_id: number | null;
  discount_approval_status: string | null;
  total_paid: number | null;
  outstanding_amount: number | null;
  credit_balance: number | null;
  late_fee_balance: number | null;
  total_refunded: number | null;
  saving_balance: number | null;
  paid_installment_count: number | null;
  total_installments: number | null;
  next_due_date: string | null;
  next_due_amount: number | null;
  next_due_in_days: number | null;
  last_payment_date: string | null;
  overdue_amount: number | null;
  overdue_count: number | null;
  overdue_since_date: string | null;
  overdue_days: number | null;
  staff_score: number | null;
  commission_owner_id: number | null;
  commission_owner_name: string | null;
  shipped_at: string | null;
  shipping_method: string | null;
  tracking_number: string | null;
  source: string | null;
  last_note: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  activated_at: string | null;
  closed_at: string | null;
  updated_at: string;
  current_step: string | null;
  step_data: unknown;
  draft_age_days: number | null;
  transfer_to_branch_id: number | null;
}

interface Installment {
  id: number;
  contract_id: number;
  pay_no: number;
  status: string;
  due_date: string;
  due_amount: number;
  paid_amount: number;
  paid_at: string | null;
  deferred_from: number | null;
  created_at: string;
}

interface ContractTxn {
  id: number;
  contract_id: number;
  txn_type: string;
  amount: number;
  pay_no: number | null;
  ref_type: string | null;
  ref_id: number | null;
  note: string | null;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

interface ContractCustomer {
  id: number;
  contract_id: number;
  customer_id: number;
  customer_name: string;
  role: string;
  relation: string | null;
  created_at: string;
}

interface ContractNote {
  id: number;
  contract_id: number;
  note: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

interface Payment {
  id: number;
  code: string;
  code_display: string | null;
  contract_id: number;
  contract_code: string;
  customer_name: string | null;
  payment_type: string | null;
  amount: number;
  channel: string | null;
  bank_name: string | null;
  account_number: string | null;
  reference: string | null;
  payer_type: string | null;
  payer_name: string | null;
  submit_channel: string | null;
  is_voided: boolean;
  days_early: number | null;
  recorded_by: number | null;
  created_at: string;
}

interface EntityMedia {
  entity_media_id: number;
  entity_type: string;
  entity_id: number;
  usage_type: string;
  display_mode: string;
  sort_order: number;
  caption: string | null;
  is_active: boolean;
  storage_path: Record<string, string>;
  created_at: string;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

type DetailTab = 'overview' | 'installments' | 'txns' | 'customers' | 'notes' | 'payments';

const TABS: DetailTab[] = ['overview', 'installments', 'txns', 'customers', 'notes', 'payments'];

// ── Scrollable Tabs ─────────────────────────────────────────────────────────

function ScrollableTabs({ tabs, activeTab, onTabChange, t }: {
  tabs: DetailTab[];
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  t: (key: string) => string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [checkScroll]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -120 : 120, behavior: 'smooth' });
  };

  return (
    <div className="flex-none relative border-b border-line">
      {canScrollLeft && (
        <button
          className="absolute left-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-bg border-r border-line cursor-pointer border-y-0 border-l-0"
          onClick={() => scroll('left')}
        >
          <ChevronLeft size={14} className="text-fg/60" />
        </button>
      )}
      <div ref={scrollRef} className="flex px-2 overflow-x-auto hidden-scroll">
        {tabs.map(tab => (
          <button
            key={tab}
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-fg/50 hover:text-fg/80'
            }`}
            onClick={() => onTabChange(tab)}
          >
            {t(`contract.tab_${tab}`)}
          </button>
        ))}
      </div>
      {canScrollRight && (
        <button
          className="absolute right-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-bg border-l border-line cursor-pointer border-y-0 border-r-0"
          onClick={() => scroll('right')}
        >
          <ChevronRight size={14} className="text-fg/60" />
        </button>
      )}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function ContractDetailPanel({ contractId, isMobile }: { contractId: number; isMobile: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');

  const { data: contract, isLoading } = useQuery({
    queryKey: ['contract-detail', contractId],
    queryFn: async () => {
      const result = await apiClient.get<ContractDetail[]>(`/v_contract_detail?id=eq.${contractId}`);
      return result[0] ?? null;
    },
    placeholderData: keepPreviousData,
  });

  if (isLoading && !contract) {
    return <div className="flex-1 flex items-center justify-center text-subtler">{t('common.loading')}</div>;
  }

  if (!contract) {
    return <div className="flex-1 flex items-center justify-center text-subtler">{t('common.noData')}</div>;
  }

  return (
    <div className="relative flex flex-col h-full min-w-0">
      {/* Desktop header */}
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{contract.code_display ?? contract.code}</span>
          <Badge size="xs" className={getStateColor(contract.state)}>
            {getStateLabel(contract.state, t)}
          </Badge>
          {contract.is_paused && (
            <Badge size="xs" className="bg-warning/15 text-warning">{t('contract.paused')}</Badge>
          )}
          {contract.commercial_model && (
            <span className="text-xs text-subtle">{contract.commercial_model}</span>
          )}
        </div>
      )}

      {/* Tabs with scroll arrows */}
      <ScrollableTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} t={t} />

      {/* Tab content */}
      <div className="flex-1 overflow-auto better-scroll">
        {activeTab === 'overview' && <OverviewTab contract={contract} t={t} />}
        {activeTab === 'installments' && <InstallmentsTab contractId={contractId} t={t} />}
        {activeTab === 'txns' && <TxnsTab contractId={contractId} t={t} />}
        {activeTab === 'customers' && <CustomersTab contractId={contractId} customerId={contract.customer_id} t={t} />}
        {activeTab === 'notes' && <NotesTab contractId={contractId} t={t} />}
        {activeTab === 'payments' && <PaymentsTab contractId={contractId} t={t} />}
      </div>

      {/* Contract actions */}
      <ContractActionButtons
        contract={contract}
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
          queryClient.invalidateQueries({ queryKey: ['contract-search'] });
          queryClient.invalidateQueries({ queryKey: ['saving-contracts'] });
          queryClient.invalidateQueries({ queryKey: ['contract-installments', contractId] });
          queryClient.invalidateQueries({ queryKey: ['contract-txns', contractId] });
          queryClient.invalidateQueries({ queryKey: ['contract-payments', contractId] });
        }}
      />
    </div>
  );
}

// ── Media thumbnail helper ───────────────────────────────────────────────────

function MediaThumbnail({ media }: { media: EntityMedia }) {
  const src = media.storage_path.sm || media.storage_path.md || media.storage_path.original;
  if (!src) return null;
  const fullUrl = `${config.s3BaseUrl}${src}`;
  return (
    <div className="relative group">
      <img
        src={fullUrl}
        alt={media.caption ?? media.usage_type}
        className="w-16 h-16 object-cover rounded border border-line"
      />
      {media.caption && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 rounded-b truncate">
          {media.caption}
        </div>
      )}
    </div>
  );
}

function MediaRow({ label, media }: { label: string; media: EntityMedia[] }) {
  if (media.length === 0) return null;
  return (
    <div>
      <div className="text-xs text-subtle mb-1">{label}</div>
      <div className="flex gap-2 flex-wrap">
        {media.map(m => <MediaThumbnail key={m.entity_media_id} media={m} />)}
      </div>
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ contract, t }: { contract: ContractDetail; t: ReturnType<typeof useTranslation>['t'] }) {
  const isFin2 = contract.commercial_model === 'FIN2';

  // Contract media: signature + evidence
  const { data: contractMedia = [] } = useQuery({
    queryKey: ['entity-media', 'CONTRACT', contract.id],
    queryFn: () => apiClient.get<EntityMedia[]>(
      `/v_entity_media?entity_type=eq.CONTRACT&entity_id=eq.${contract.id}&is_active=eq.true&order=usage_type,sort_order`
    ),
  });

  const signatures = contractMedia.filter(m => m.usage_type === 'SIGNATURE');
  const evidence = contractMedia.filter(m => m.usage_type === 'EVIDENCE');
  const documents = contractMedia.filter(m => m.usage_type === 'DOCUMENT');

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Customer & Device */}
      <div className="border border-line rounded-md px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-subtle">{t('contract.customer')}</div>
            <div className="font-semibold text-sm">{contract.customer_name ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-subtle">{t('contract.branch')}</div>
            <div className="font-semibold text-sm">{contract.branch_name}</div>
          </div>
        </div>
        {(contract.model_name || contract.device_identifier) && (
          <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-line">
            <div>
              <div className="text-xs text-subtle">{t('contract.device')}</div>
              <div className="text-sm">{contract.model_name ?? '—'}</div>
              {contract.variant_name && <div className="text-xs text-subtle">{contract.variant_name}</div>}
            </div>
            {contract.device_identifier && (
              <div>
                <div className="text-xs text-subtle">IMEI</div>
                <div className="text-sm font-mono">{contract.device_identifier}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Financial summary */}
      <div className="border border-line rounded-md px-4 py-3">
        <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-3">{t('contract.financials')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <InfoCell label={t('contract.agreedPrice')} value={fmtCurrency(contract.agreed_price)} />
          <InfoCell label={t('contract.downPayment')} value={fmtCurrency(contract.down_payment)} />
          <InfoCell label={t('contract.installmentAmount')} value={fmtCurrency(contract.installment_amount)} />
          <InfoCell
            label={t('contract.termMonths')}
            value={contract.snapshot_term_months ? `${contract.snapshot_term_months} ${t('contract.months')}` : '—'}
          />
          <InfoCell label={t('contract.totalPaid')} value={fmtCurrency(contract.total_paid)} />
          <InfoCell label={t('contract.outstanding')} value={fmtCurrency(contract.outstanding_amount)} highlight={contract.outstanding_amount != null && contract.outstanding_amount > 0} />
          {isFin2 && (
            <>
              <InfoCell label={t('contract.insuranceDeposit')} value={fmtCurrency(contract.insurance_deposit)} />
              <InfoCell label={t('contract.insuranceBalance')} value={fmtCurrency(contract.insurance_balance)} />
            </>
          )}
          {contract.credit_balance != null && contract.credit_balance > 0 && (
            <InfoCell label={t('contract.creditBalance')} value={fmtCurrency(contract.credit_balance)} />
          )}
          {contract.late_fee_balance != null && contract.late_fee_balance > 0 && (
            <InfoCell label={t('contract.lateFee')} value={fmtCurrency(contract.late_fee_balance)} highlight />
          )}
          {contract.discount_amount != null && contract.discount_amount > 0 && (
            <InfoCell label={t('contract.discount')} value={`${fmtCurrency(contract.discount_amount)} (${contract.discount_percent ?? 0}%)`} />
          )}
        </div>
      </div>

      {/* Payment progress */}
      {contract.paid_installment_count != null && contract.total_installments != null && (
        <div className="border border-line rounded-md px-4 py-3">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-3">{t('contract.paymentProgress')}</h3>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 bg-fg/10 rounded-full h-2">
              <div
                className="bg-primary rounded-full h-2 transition-all"
                style={{ width: `${contract.total_installments > 0 ? Math.min(100, (contract.paid_installment_count / contract.total_installments) * 100) : 0}%` }}
              />
            </div>
            <span className="text-sm font-medium tabular-nums shrink-0">
              {contract.paid_installment_count}/{contract.total_installments}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InfoCell label={t('contract.nextDueDate')} value={contract.next_due_date ? <DateTime value={contract.next_due_date} showTime={false} /> : '—'} />
            <InfoCell label={t('contract.nextDueAmount')} value={fmtCurrency(contract.next_due_amount)} />
            <InfoCell label={t('contract.lastPaymentDate')} value={contract.last_payment_date ? <DateTime value={contract.last_payment_date} showTime={false} /> : '—'} />
            {contract.overdue_count != null && contract.overdue_count > 0 && (
              <InfoCell
                label={t('contract.overdue')}
                value={`${contract.overdue_count} ${t('contract.installments')} · ${fmtCurrency(contract.overdue_amount)}`}
                highlight
              />
            )}
          </div>
          {contract.overdue_days != null && contract.overdue_days > 0 && (
            <div className="mt-2 text-xs text-danger">
              {t('contract.overdueSince', { date: contract.overdue_since_date, days: contract.overdue_days })}
            </div>
          )}
        </div>
      )}

      {/* Saving progress (for SAVING contracts) */}
      {contract.state === 'SAVING' && contract.saving_target_amount != null && (
        <div className="border border-line rounded-md px-4 py-3">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-3">{t('contract.savingProgress')}</h3>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 bg-fg/10 rounded-full h-2">
              <div
                className="bg-info rounded-full h-2 transition-all"
                style={{ width: `${contract.saving_target_amount > 0 ? Math.min(100, ((contract.saving_balance ?? 0) / contract.saving_target_amount) * 100) : 0}%` }}
              />
            </div>
            <span className="text-sm font-medium tabular-nums shrink-0">
              {fmtCurrency(contract.saving_balance)} / {fmtCurrency(contract.saving_target_amount)}
            </span>
          </div>
        </div>
      )}

      {/* Media: signature, evidence, documents */}
      {(signatures.length > 0 || evidence.length > 0 || documents.length > 0) && (
        <div className="border border-line rounded-md px-4 py-3 flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">{t('contract.media')}</h3>
          <MediaRow label={t('contract.signature')} media={signatures} />
          <MediaRow label={t('contract.evidence')} media={evidence} />
          <MediaRow label={t('contract.documents')} media={documents} />
        </div>
      )}

      {/* Shipping info */}
      {contract.shipped_at && (
        <div className="border border-line rounded-md px-4 py-3">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-3">{t('contract.shipping')}</h3>
          <div className="grid grid-cols-2 gap-3">
            <InfoCell label={t('contract.shippedAt')} value={<DateTime value={contract.shipped_at} />} />
            {contract.shipping_method && <InfoCell label={t('contract.shippingMethod')} value={contract.shipping_method} />}
            {contract.tracking_number && <InfoCell label={t('contract.trackingNumber')} value={contract.tracking_number} />}
          </div>
        </div>
      )}

      {/* Meta info */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle pb-4">
        <span>{t('contract.createdBy')}: {contract.created_by_name ?? '—'}</span>
        <span>{t('contract.createdAt')}: <DateTime value={contract.created_at} /></span>
        {contract.activated_at && <span>{t('contract.activatedAt')}: <DateTime value={contract.activated_at} /></span>}
        {contract.closed_at && <span>{t('contract.closedAt')}: <DateTime value={contract.closed_at} /></span>}
        {contract.close_reason && <span>{t('contract.closeReason')}: {contract.close_reason}</span>}
        {contract.commission_owner_name && <span>{t('contract.commissionOwner')}: {contract.commission_owner_name}</span>}
        {contract.last_note && <span>{t('contract.lastNote')}: {contract.last_note}</span>}
      </div>
    </div>
  );
}

// ── Installments Tab ─────────────────────────────────────────────────────────

function getInstallmentStatusColor(status: string): string {
  switch (status) {
    case 'PAID': return 'bg-success/15 text-success';
    case 'PENDING': return 'bg-warning/15 text-warning';
    case 'DEFERRED': return 'bg-fg/10 text-fg/50';
    default: return 'bg-fg/10 text-fg/60';
  }
}

function InstallmentsTab({ contractId, t }: { contractId: number; t: ReturnType<typeof useTranslation>['t'] }) {
  const { data: installments, isLoading } = useQuery({
    queryKey: ['contract-installments', contractId],
    queryFn: () => apiClient.get<Installment[]>(`/v_installments?contract_id=eq.${contractId}&order=pay_no`),
  });

  if (isLoading) return <div className="p-8 text-center text-subtler">{t('common.loading')}</div>;
  if (!installments || installments.length === 0) return <div className="p-8 text-center text-subtler">{t('common.noData')}</div>;

  return (
    <div className="p-4">
      <div className="border border-line rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface">
              <th className="text-left px-3 py-2 font-medium text-subtle">#</th>
              <th className="text-left px-3 py-2 font-medium text-subtle">{t('contract.dueDate')}</th>
              <th className="text-right px-3 py-2 font-medium text-subtle">{t('contract.dueAmount')}</th>
              <th className="text-right px-3 py-2 font-medium text-subtle">{t('contract.paidAmount')}</th>
              <th className="text-left px-3 py-2 font-medium text-subtle">{t('common.status')}</th>
              <th className="text-left px-3 py-2 font-medium text-subtle">{t('contract.paidAt')}</th>
            </tr>
          </thead>
          <tbody>
            {installments.map(inst => (
              <tr key={inst.id} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2 tabular-nums">
                  {inst.pay_no}
                  {inst.deferred_from != null && (
                    <span className="text-xs text-subtle ml-1">(→{inst.deferred_from})</span>
                  )}
                </td>
                <td className="px-3 py-2"><DateTime value={inst.due_date} showTime={false} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(inst.due_amount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(inst.paid_amount)}</td>
                <td className="px-3 py-2">
                  <Badge size="xs" className={getInstallmentStatusColor(inst.status)}>
                    {t(`contract.installmentStatus_${inst.status}`, { defaultValue: inst.status })}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-subtle">
                  {inst.paid_at ? <DateTime value={inst.paid_at} /> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Transactions Tab ─────────────────────────────────────────────────────────

function TxnsTab({ contractId, t }: { contractId: number; t: ReturnType<typeof useTranslation>['t'] }) {
  const { data: txns, isLoading } = useQuery({
    queryKey: ['contract-txns', contractId],
    queryFn: () => apiClient.get<ContractTxn[]>(`/v_contract_txns?contract_id=eq.${contractId}&order=created_at.desc`),
  });

  if (isLoading) return <div className="p-8 text-center text-subtler">{t('common.loading')}</div>;
  if (!txns || txns.length === 0) return <div className="p-8 text-center text-subtler">{t('common.noData')}</div>;

  return (
    <div className="p-4 flex flex-col gap-2">
      {txns.map(txn => (
        <div key={txn.id} className="border border-line rounded-md px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{t(`contract.txnType_${txn.txn_type}`, { defaultValue: txn.txn_type })}</span>
              {txn.pay_no != null && (
                <span className="text-xs text-subtle">#{txn.pay_no}</span>
              )}
            </div>
            <span className={`font-medium text-sm tabular-nums ${txn.amount < 0 ? 'text-danger' : ''}`}>
              {txn.amount > 0 ? '+' : ''}{fmtCurrency(txn.amount)}
            </span>
          </div>
          {txn.note && <div className="text-xs text-subtle mt-1">{txn.note}</div>}
          <div className="flex items-center gap-3 mt-2 text-xs text-subtle">
            <span>{txn.created_by_name}</span>
            <DateTime value={txn.created_at} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Customers Tab ────────────────────────────────────────────────────────────

function CustomersTab({ contractId, customerId, t }: { contractId: number; customerId: number | null; t: ReturnType<typeof useTranslation>['t'] }) {
  const { data: customers, isLoading } = useQuery({
    queryKey: ['contract-customers', contractId],
    queryFn: () => apiClient.get<ContractCustomer[]>(`/v_contract_customers?contract_id=eq.${contractId}&order=created_at`),
  });

  // Customer ID card media
  const { data: idCardMedia = [] } = useQuery({
    queryKey: ['entity-media', 'CUSTOMER', customerId],
    queryFn: () => apiClient.get<EntityMedia[]>(
      `/v_entity_media?entity_type=eq.CUSTOMER&entity_id=eq.${customerId}&usage_type=eq.ID_CARD&is_active=eq.true`
    ),
    enabled: !!customerId,
  });

  if (isLoading) return <div className="p-8 text-center text-subtler">{t('common.loading')}</div>;
  if (!customers || customers.length === 0) return <div className="p-8 text-center text-subtler">{t('common.noData')}</div>;

  return (
    <div className="p-4 flex flex-col gap-2">
      {customers.map(c => (
        <div key={c.id} className="border border-line rounded-md px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">{c.customer_name}</span>
            <Badge size="xs" className="bg-fg/10 text-fg/60">{c.role}</Badge>
          </div>
          {c.relation && <div className="text-xs text-subtle mt-1">{t('contract.relation')}: {c.relation}</div>}
          <div className="text-xs text-subtle mt-1"><DateTime value={c.created_at} /></div>
          {/* Show ID card for the primary customer */}
          {c.customer_id === customerId && idCardMedia.length > 0 && (
            <div className="mt-2 pt-2 border-t border-line">
              <MediaRow label={t('contract.idCard')} media={idCardMedia} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Notes Tab ────────────────────────────────────────────────────────────────

function NotesTab({ contractId, t }: { contractId: number; t: ReturnType<typeof useTranslation>['t'] }) {
  const { data: notes, isLoading } = useQuery({
    queryKey: ['contract-notes', contractId],
    queryFn: () => apiClient.get<ContractNote[]>(`/v_contract_notes?contract_id=eq.${contractId}&order=created_at.desc`),
  });

  if (isLoading) return <div className="p-8 text-center text-subtler">{t('common.loading')}</div>;
  if (!notes || notes.length === 0) return <div className="p-8 text-center text-subtler">{t('common.noData')}</div>;

  return (
    <div className="p-4 flex flex-col gap-2">
      {notes.map(n => (
        <div key={n.id} className="border border-line rounded-md px-4 py-3">
          <div className="text-sm">{n.note}</div>
          <div className="flex items-center gap-3 mt-2 text-xs text-subtle">
            <span>{n.created_by_name}</span>
            <DateTime value={n.created_at} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Payments Tab ─────────────────────────────────────────────────────────────

function PaymentsTab({ contractId, t }: { contractId: number; t: ReturnType<typeof useTranslation>['t'] }) {
  const { data: payments, isLoading } = useQuery({
    queryKey: ['contract-payments', contractId],
    queryFn: () => apiClient.get<Payment[]>(`/v_payments?contract_id=eq.${contractId}&order=created_at.desc`),
  });

  // Payment slips for this contract
  const { data: paymentSlips = [] } = useQuery({
    queryKey: ['entity-media', 'CONTRACT', contractId, 'PAYMENT_SLIP'],
    queryFn: () => apiClient.get<EntityMedia[]>(
      `/v_entity_media?entity_type=eq.CONTRACT&entity_id=eq.${contractId}&usage_type=eq.PAYMENT_SLIP&is_active=eq.true&order=sort_order`
    ),
  });

  if (isLoading) return <div className="p-8 text-center text-subtler">{t('common.loading')}</div>;

  const hasPayments = payments && payments.length > 0;
  const hasSlips = paymentSlips.length > 0;

  if (!hasPayments && !hasSlips) return <div className="p-8 text-center text-subtler">{t('common.noData')}</div>;

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Payment records */}
      {hasPayments && (
        <div className="flex flex-col gap-2">
          {payments!.map(p => (
            <div key={p.id} className={`border border-line rounded-md px-4 py-3 ${p.is_voided ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{p.code_display ?? p.code}</span>
                  {p.payment_type && (
                    <Badge size="xs" className="bg-fg/10 text-fg/60">{p.payment_type}</Badge>
                  )}
                  {p.is_voided && (
                    <Badge size="xs" className="bg-danger/15 text-danger">VOID</Badge>
                  )}
                </div>
                <span className="font-medium text-sm tabular-nums">{fmtCurrency(p.amount)}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-subtle">
                {p.channel && <span>{p.channel}</span>}
                {p.bank_name && <span>{p.bank_name}</span>}
                {p.payer_name && <span>{t('contract.payer')}: {p.payer_name}</span>}
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-subtle">
                <DateTime value={p.created_at} />
                {p.days_early != null && p.days_early > 0 && (
                  <span className="text-success">{t('contract.daysEarly', { days: p.days_early })}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Payment slips */}
      {hasSlips && (
        <div className="border border-line rounded-md px-4 py-3">
          <MediaRow label={t('contract.paymentSlips')} media={paymentSlips} />
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function InfoCell({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs text-subtle">{label}</div>
      <div className={`text-sm font-medium tabular-nums ${highlight ? 'text-danger' : ''}`}>{value}</div>
    </div>
  );
}
