import { useTranslation } from 'react-i18next';

export function ModelsPage() {
  const { t } = useTranslation();

  return (
    <div className="page-content max-w-[64rem] flex flex-col gap-6 pb-8">
      <h1 className="heading-2">{t('models.title')}</h1>
      <div className="p-8 text-center text-control-label border border-line rounded-lg">
        {t('models.comingSoon')}
      </div>
    </div>
  );
}
