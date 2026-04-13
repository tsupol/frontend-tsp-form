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

  const status = !hasCustomer ? 'locked' as const
    : needsGuarantor ? (data.guarantorId ? 'complete' as const : 'warning' as const)
    : 'complete' as const;

  return (
    <SummaryCard
      title={t('workspace.cardGuarantor')}
      status={status}
      onEdit={needsGuarantor ? onEdit : undefined}
      active={active}
      disabled={isReadOnly || !hasCustomer}
    >
      {!hasCustomer ? (
        <div className="text-subtle text-xs">{t('workspace.needCustomerFirst')}</div>
      ) : !needsGuarantor ? (
        <div className="text-subtle flex items-center gap-2 text-xs">
          <CheckCircle size={14} className="text-success" />
          <span>{t('workspace.guarantorNotNeeded')}</span>
        </div>
      ) : data.guarantorId ? (
        <div className="flex flex-col gap-1">
          <div className="font-medium flex items-center gap-2">
            <ShieldCheck size={14} className="text-success" />
            {data.guarantorResult?.full_name}
          </div>
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
