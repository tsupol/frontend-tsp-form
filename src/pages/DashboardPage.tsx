import { useTranslation } from 'react-i18next';
import { MobileHeader } from 'tsp-form';
import { ArrowRightFromLine } from 'lucide-react';

export function DashboardPage() {
  const { t } = useTranslation();

  return (
    <>
      {/* Mobile header */}
      <MobileHeader className="mobile-header-scrolled-shadow md:hidden">
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
          {t('nav.dashboard')}
        </div>
        <div className="mobile-header-end w-12" />
      </MobileHeader>

      <div className="page-content">
        {/* Desktop header */}
        <div className="mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('nav.dashboard')}</h1>
        </div>

        <div className="border border-line bg-surface p-8 rounded-lg text-center text-control-label">
          {t('common.noData')}
        </div>
      </div>
    </>
  );
}
