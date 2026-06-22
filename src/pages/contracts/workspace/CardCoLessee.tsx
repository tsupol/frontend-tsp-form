import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { getAge } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardCoLessee({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { contract, customer, coLesseeList, isReadOnly } = useWorkspace();

  const hasCustomer = !!contract?.customer_id;
  const dob = customer?.dateOfBirth;
  const isMinor = dob ? getAge(dob) < 18 : false;
  const needsCoLessee = hasCustomer && isMinor;
  const coLessees = coLesseeList.map(g => ({ customerId: g.customer_id, fullName: g.customer_name, idNumber: g.id_number ?? '' }));
  const hasCoLessees = coLessees.length > 0;

  const contractId = contract?.id ?? null;

  // Check co-lessee completeness — addresses, ID card. Signature is captured
  // in the Documents step (not here), so it's NOT part of this card's status.
  const { data: coLesseeStatus } = useQuery({
    queryKey: ['co-lessee-status', contractId, coLessees.map(g => g.customerId).join(',')],
    queryFn: async () => {
      const results = await Promise.all(coLessees.map(async (g) => {
        const [addrs, idCard, custInfo] = await Promise.all([
          apiClient.get<Array<{ address_type: string }>>(`/v_customer_addresses?customer_id=eq.${g.customerId}&select=address_type`).catch(() => []),
          apiClient.get<Array<{ id: number }>>(`/v_customer_documents?customer_id=eq.${g.customerId}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true&select=id`).catch(() => []),
          apiClient.get<Array<{ date_of_birth: string | null }>>(`/v_customers?id=eq.${g.customerId}&select=date_of_birth`).catch(() => []),
        ]);
        return {
          customerId: g.customerId,
          hasInfo: !!custInfo[0]?.date_of_birth,
          hasHome: addrs.some(a => a.address_type === 'HOME'),
          hasWork: addrs.some(a => a.address_type === 'WORK'),
          hasIdCard: idCard.length > 0,
        };
      }));
      return results;
    },
    enabled: hasCoLessees,
    staleTime: 0,
  });

  const allCoLesseesComplete = coLesseeStatus?.every(g => g.hasInfo && g.hasHome && g.hasWork && g.hasIdCard) ?? false;

  const status = !hasCustomer ? 'locked' as const
    : needsCoLessee && !hasCoLessees ? 'warning' as const
    : hasCoLessees && !allCoLesseesComplete ? 'partial' as const
    : hasCoLessees && allCoLesseesComplete ? 'complete' as const
    : 'complete' as const; // adult with no co-lessee = ok

  return (
    <SummaryCard
      title={`${t('workspace.cardCoLessee')} (${coLessees.length})`}
      status={status}
      onEdit={onEdit}
      active={active}
      shake={shake}
      disabled={isReadOnly || !hasCustomer}
    >
      {!hasCustomer ? (
        <div className="text-subtle text-xs">{t('workspace.needCustomerFirst')}</div>
      ) : !needsCoLessee && !hasCoLessees ? (
        <div className="text-subtle flex items-center gap-2 text-xs">
          <CheckCircle size={14} className="text-success" />
          <span>{t('workspace.coLesseeNotNeeded')}</span>
        </div>
      ) : hasCoLessees ? (
        <div className="flex flex-col gap-1.5">
          {coLessees.map(g => {
            const gs = coLesseeStatus?.find(s => s.customerId === g.customerId);
            const complete = gs ? (gs.hasInfo && gs.hasHome && gs.hasWork && gs.hasIdCard) : false;
            const missing: string[] = [];
            if (gs && !gs.hasInfo) missing.push(t('customer.basicInfo'));
            if (gs && !gs.hasHome) missing.push(t('workspace.addressHome'));
            if (gs && !gs.hasWork) missing.push(t('workspace.addressWork'));
            if (gs && !gs.hasIdCard) missing.push(t('workspace.docIdPhoto'));
            return (
              <div key={g.customerId}>
                <div className="flex items-center gap-2 text-sm">
                  {complete
                    ? <CheckCircle size={14} className="text-success shrink-0" />
                    : <AlertTriangle size={14} className="text-warning-fg shrink-0" />
                  }
                  <span className="truncate">{g.fullName}</span>
                </div>
                {missing.length > 0 && (
                  <div className="text-xs text-warning-fg" style={{ marginLeft: '22px' }}>{missing.join(', ')}</div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-warning-fg flex items-center gap-2 text-xs">
          <AlertTriangle size={14} />
          <span>{t('workspace.coLesseeRequired')}</span>
        </div>
      )}
    </SummaryCard>
  );
}
