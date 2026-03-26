import { useTranslation } from 'react-i18next';
import { MobileHeader } from 'tsp-form';
import { ArrowRightFromLine } from 'lucide-react';

export function ICloudPoolPage() {
  const { t } = useTranslation();
  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('settings.icloud.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>
      <div className="page-content">
        <div className="hidden lg:block mb-6">
          <h1 className="text-xl font-semibold">{t('settings.icloud.title')}</h1>
          <p className="text-sm text-fg/60 mt-1">{t('settings.icloud.description')}</p>
        </div>
        <div className="text-fg/50 text-sm">{t('common.comingSoon')}</div>
      </div>
    </>
  );
}
