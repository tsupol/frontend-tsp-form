import { useTranslation } from 'react-i18next';

export function AssetsPage() {
  const { t } = useTranslation();

  return (
    <div className="page-content">
      <h1 className="text-xl font-semibold">{t('nav.assets')}</h1>
      <p className="text-fg/60 mt-2">Coming soon</p>
    </div>
  );
}
