import { useTranslation } from 'react-i18next';
import { CheckCircle } from 'lucide-react';

export function CardPostPayment() {
  const { t } = useTranslation();

  return (
    <div className="alert alert-success">
      <CheckCircle size={18} />
      <div>
        <div className="alert-title">{t('wizard.paymentConfirmed')}</div>
        <div className="alert-description">{t('wizard.contractActivated')}</div>
      </div>
    </div>
  );
}
