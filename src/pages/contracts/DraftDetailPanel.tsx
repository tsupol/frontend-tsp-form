import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Badge } from 'tsp-form';
import { Copy, Check, Star } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { getStateColor, getStateLabel } from './contractUtils';
import { ContractActionButtons } from './ContractActions';

interface ContractDetail {
  id: number;
  code: string;
  code_display: string | null;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  state: string;
  commercial_model: string | null;
  customer_id: number | null;
  customer_name: string | null;
  draft_note: string | null;
  device_id: number | null;
  is_paused: boolean;
  model_id: number | null;
  model_name: string | null;
  variant_id: number | null;
  variant_name: string | null;
  agreed_price: number | null;
  down_payment: number | null;
  insurance_deposit: number | null;
  insurance_balance: number | null;
  installment_amount: number | null;
  snapshot_term_months: number | null;
  agreed_total_financed: number | null;
  discount_amount: number | null;
  discount_percent: number | null;
  total_paid: number | null;
  outstanding_amount: number | null;
  credit_balance: number | null;
  credit_balance_company: number | null;
  late_fee_balance: number | null;
  saving_balance: number | null;
  paid_installment_count: number | null;
  total_installments: number | null;
  next_due_date: string | null;
  next_due_amount: number | null;
  staff_confidence_score: number | null;
  commission_owner_name: string | null;
  last_note: string | null;
  created_by_name: string | null;
  created_at: string;
  draft_age_days: number | null;
  transfer_to_branch_id: number | null;
}

interface ContractNote {
  id: number;
  contract_id: number;
  note: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

type DraftTab = 'overview' | 'notes';

export function DraftDetailPanel({ contractId, isMobile }: { contractId: number; isMobile: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<DraftTab>('overview');
  const [copied, setCopied] = useState(false);

  const handleCopyCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

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
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{contract.code_display ?? contract.code}</span>
          <button
            type="button"
            onClick={() => handleCopyCode(contract.code_display ?? contract.code)}
            className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer text-subtle hover:text-fg"
            aria-label={t('common.copy')}
            title={copied ? t('common.copied') : t('common.copy')}
          >
            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
          </button>
          <Badge size="xs" color={getStateColor(contract.state)}>
            {getStateLabel(contract.state, t)}
          </Badge>
          {contract.commercial_model && (
            <span className="text-xs text-subtle">{contract.commercial_model}</span>
          )}
        </div>
      )}

      <div className="flex-none border-b border-line flex px-2">
        {(['overview', 'notes'] as DraftTab[]).map(tab => (
          <button
            key={tab}
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === tab
                ? 'border-primary-fg text-primary-fg'
                : 'border-transparent text-fg'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {t(`contract.tab_${tab}`)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto better-scroll">
        {activeTab === 'overview' && <DraftOverviewTab contract={contract} t={t} />}
        {activeTab === 'notes' && <NotesTab contractId={contractId} t={t} />}
      </div>

      <ContractActionButtons
        contract={contract}
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
          queryClient.invalidateQueries({ queryKey: ['draft-contracts'] });
        }}
      />
    </div>
  );
}

function DraftOverviewTab({ contract, t }: { contract: ContractDetail; t: ReturnType<typeof useTranslation>['t'] }) {
  const isFin2 = contract.commercial_model === 'FIN2';

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="border border-line rounded-md px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <InfoCell label={t('contract.customer')} value={contract.customer_name ?? '—'} />
          <InfoCell label={t('contract.branch')} value={contract.branch_name} />
          {contract.commission_owner_name && (
            <InfoCell label={t('contract.commissionOwner')} value={contract.commission_owner_name} />
          )}
          {contract.draft_age_days != null && (
            <InfoCell label={t('contract.draftAge')} value={`${contract.draft_age_days} ${t('contract.days')}`} />
          )}
        </div>
      </div>

      {contract.model_name && (
        <div className="border border-line rounded-md px-4 py-3">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-3">{t('contract.productPlan')}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <div className="text-xs text-subtle">{t('contract.device')}</div>
              <div className="text-sm font-medium">{contract.model_name}</div>
              {contract.variant_name && <div className="text-xs text-subtle">{contract.variant_name}</div>}
            </div>
            <InfoCell label={t('contract.agreedPrice')} value={fmtCurrency(contract.agreed_price)} />
            <InfoCell label={t('contract.downPayment')} value={fmtCurrency(contract.down_payment)} />
            <InfoCell label={t('contract.installmentAmount')} value={fmtCurrency(contract.installment_amount)} />
            <InfoCell
              label={t('contract.termMonths')}
              value={contract.snapshot_term_months ? `${contract.snapshot_term_months} ${t('contract.months')}` : '—'}
            />
            {isFin2 && contract.insurance_deposit != null && (
              <InfoCell label={t('contract.insuranceDeposit')} value={fmtCurrency(contract.insurance_deposit)} />
            )}
            {contract.discount_amount != null && contract.discount_amount > 0 && (
              <InfoCell label={t('contract.discount')} value={`${fmtCurrency(contract.discount_amount)} (${contract.discount_percent ?? 0}%)`} />
            )}
          </div>
        </div>
      )}

      <div className="border border-line rounded-md px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-subtle">{t('contract.staffConfidence')}</span>
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map(star => (
              <Star
                key={star}
                size={14}
                className={contract.staff_confidence_score != null && star <= contract.staff_confidence_score
                  ? 'text-warning-fg fill-warning'
                  : 'text-fg/20'
                }
              />
            ))}
            {contract.staff_confidence_score == null && (
              <span className="text-xs text-subtle ml-2">{t('contract.notRated')}</span>
            )}
          </div>
        </div>
      </div>

      {contract.draft_note && (
        <div className="border border-line rounded-md px-4 py-3">
          <div className="text-xs text-subtle mb-1">{t('contract.draftNote')}</div>
          <div className="text-sm">{contract.draft_note}</div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle pb-4">
        <span>{t('contract.createdBy')}: {contract.created_by_name ?? '—'}</span>
        <span>{t('contract.createdAt')}: <DateTime value={contract.created_at} /></span>
        {contract.last_note && <span>{t('contract.lastNote')}: {contract.last_note}</span>}
      </div>
    </div>
  );
}

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

function InfoCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-subtle">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}
