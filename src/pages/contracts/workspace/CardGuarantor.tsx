import { useTranslation } from 'react-i18next';
import { ShieldCheck, AlertTriangle, CheckCircle } from 'lucide-react';
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

export function CardGuarantor({ onEdit, active }: { onEdit?: () => void; active?: boolean }) {
  const { t } = useTranslation();
  const { data, isReadOnly } = useWorkspace();

  const hasCustomer = !!data.customerId;
  const dob = data.customerDateOfBirth;
  const isMinor = dob ? getAge(dob) < 18 : false;
  const needsGuarantor = hasCustomer && isMinor;
  const hasGuarantors = data.guarantors.length > 0;

  const status = !hasCustomer ? 'locked' as const
    : needsGuarantor ? (hasGuarantors ? 'complete' as const : 'warning' as const)
    : 'complete' as const;

  return (
    <SummaryCard
      title={`${t('workspace.cardGuarantor')} (${data.guarantors.length})`}
      status={status}
      onEdit={onEdit}
      active={active}
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
        <div className="flex flex-col gap-1">
          {data.guarantors.map(g => (
            <div key={g.customerId} className="font-medium flex items-center gap-2 text-sm">
              <ShieldCheck size={14} className="text-success shrink-0" />
              <span className="truncate">{g.fullName}</span>
            </div>
          ))}
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
