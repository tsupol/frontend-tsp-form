// The worst word about a customer, as a small badge on a list row:
// blacklisted, owing now, or paid late before. Shared by the credit queue and
// the customer list, so both say the same thing about the same customer.

import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import { riskTone, type CustomerRisk } from '../pages/partner-cases/customerRisk';

export function CustomerRiskBadge({ risk }: { risk: CustomerRisk | undefined }) {
  const { t } = useTranslation();
  const tone = riskTone(risk);
  if (!risk || !tone) return null;
  const label = risk.blacklisted
    ? t('partnerCase.riskBlacklisted')
    : risk.overdueInstallments > 0
      ? t('partnerCase.riskOverdue', { count: risk.overdueInstallments })
      : t('partnerCase.riskLate', { count: risk.lateInstallments });
  return <Badge color={tone === 'bad' ? 'danger' : 'warning'} size="sm" className="shrink-0">{label}</Badge>;
}
