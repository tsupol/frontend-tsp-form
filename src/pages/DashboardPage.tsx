import { useTranslation } from 'react-i18next';

export function DashboardPage() {
  const { t } = useTranslation();

  return (
    <div className="page-content p-6">
      <h1 className="text-xl font-bold mb-4">{t('nav.dashboard')}</h1>
      <div className="border border-line bg-surface p-8 rounded-lg text-center text-control-label">
        {t('common.noData')}
      </div>
    </div>
  );
}
