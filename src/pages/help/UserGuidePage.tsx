import { useTranslation } from 'react-i18next';
import { ArrowRightFromLine, BookOpen } from 'lucide-react';
import { MobileHeader } from 'tsp-form';

export function UserGuidePage() {
  const { t } = useTranslation();

  return (
    <>
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
          {t('help.userGuide')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content max-w-4xl">
        <div className="flex items-center gap-2 mb-4 max-md:hidden">
          <BookOpen size={20} />
          <h1 className="heading-2">{t('help.userGuide')}</h1>
        </div>

        <div className="card">
          <p className="text-sm text-subtle">{t('help.userGuideComingSoon')}</p>
        </div>
      </div>
    </>
  );
}
