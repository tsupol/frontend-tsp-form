import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Circle } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

function getAge(dob: string): number {
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

export function CardGuarantor({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { data, isReadOnly } = useWorkspace();

  const hasCustomer = !!data.customerId;
  const dob = data.customerDateOfBirth;
  const isMinor = dob ? getAge(dob) < 18 : false;
  const needsGuarantor = hasCustomer && isMinor;
  const hasGuarantors = data.guarantors.length > 0;

  // Check guarantor completeness — addresses, ID card, signature
  const { data: guarantorStatus } = useQuery({
    queryKey: ['guarantor-status', data.contractId, data.guarantors.map(g => g.customerId).join(',')],
    queryFn: async () => {
      const results = await Promise.all(data.guarantors.map(async (g) => {
        const [addrs, idCard, sig] = await Promise.all([
          apiClient.get<Array<{ address_type: string }>>(`/v_customer_addresses?customer_id=eq.${g.customerId}&select=address_type`).catch(() => []),
          apiClient.get<Array<{ id: number }>>(`/v_customer_documents?customer_id=eq.${g.customerId}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true&select=id`).catch(() => []),
          data.contractId
            ? apiClient.get<Array<{ id: number }>>(`/v_contract_documents?contract_id=eq.${data.contractId}&customer_id=eq.${g.customerId}&doc_type=eq.SIGNATURE_PAD&select=id`).catch(() => [])
            : [],
        ]);
        return {
          customerId: g.customerId,
          hasHome: addrs.some(a => a.address_type === 'HOME'),
          hasWork: addrs.some(a => a.address_type === 'WORK'),
          hasIdCard: idCard.length > 0,
          hasSignature: sig.length > 0,
        };
      }));
      return results;
    },
    enabled: hasGuarantors,
    staleTime: 0,
  });

  const allGuarantorsComplete = guarantorStatus?.every(g => g.hasHome && g.hasWork && g.hasIdCard && g.hasSignature) ?? false;

  const status = !hasCustomer ? 'locked' as const
    : needsGuarantor && !hasGuarantors ? 'warning' as const
    : hasGuarantors && !allGuarantorsComplete ? 'partial' as const
    : hasGuarantors && allGuarantorsComplete ? 'complete' as const
    : 'complete' as const; // adult with no guarantor = ok

  return (
    <SummaryCard
      title={`${t('workspace.cardGuarantor')} (${data.guarantors.length})`}
      status={status}
      onEdit={onEdit}
      active={active}
      shake={shake}
      disabled={isReadOnly || !hasCustomer}
    >
      {!hasCustomer ? (
        <div className="text-subtle text-xs">{t('workspace.needCustomerFirst')}</div>
      ) : !needsGuarantor && !hasGuarantors ? (
        <div className="text-subtle flex items-center gap-2 text-xs">
          <CheckCircle size={14} className="text-success" />
          <span>{t('workspace.guarantorNotNeeded')}</span>
        </div>
      ) : hasGuarantors ? (
        <div className="flex flex-col gap-1.5">
          {data.guarantors.map(g => {
            const gs = guarantorStatus?.find(s => s.customerId === g.customerId);
            const complete = gs ? (gs.hasHome && gs.hasWork && gs.hasIdCard && gs.hasSignature) : false;
            const missing: string[] = [];
            if (gs && !gs.hasHome) missing.push(t('workspace.addressHome'));
            if (gs && !gs.hasWork) missing.push(t('workspace.addressWork'));
            if (gs && !gs.hasIdCard) missing.push(t('workspace.docIdPhoto'));
            if (gs && !gs.hasSignature) missing.push(t('workspace.docSignature'));
            return (
              <div key={g.customerId}>
                <div className="flex items-center gap-2 text-sm">
                  {complete
                    ? <CheckCircle size={14} className="text-success shrink-0" />
                    : <AlertTriangle size={14} className="text-warning shrink-0" />
                  }
                  <span className="truncate">{g.fullName}</span>
                </div>
                {missing.length > 0 && (
                  <div className="text-xs text-warning" style={{ marginLeft: '22px' }}>{missing.join(', ')}</div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-warning flex items-center gap-2 text-xs">
          <AlertTriangle size={14} />
          <span>{t('workspace.guarantorRequired')}</span>
        </div>
      )}
    </SummaryCard>
  );
}
