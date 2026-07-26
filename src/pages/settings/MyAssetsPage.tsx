import { useTranslation } from 'react-i18next';
import { MobileHeader } from 'tsp-form';
import { ArrowRightFromLine, Smartphone } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { MyInternalUseAssetsView } from '../inventory/InternalUseAssetsView';

// ============================================================================
// Personal menu → "สินทรัพย์ที่ถือไว้" (assets I hold).
// The current user's own held internal-use devices, filtered to
// custodian_user_id = my user_id. The view guarantees a user sees devices
// they personally hold even if the device belongs to a branch outside their
// normal scope. Lives in the Settings section. Route: /admin/settings/my-assets
// ============================================================================

export function MyAssetsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const userLabel =
    [user?.firstname, user?.lastname].filter(Boolean).join(' ').trim() ||
    user?.nickname ||
    user?.username ||
    '';

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
          {t('nav.myAssets')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content max-w-3xl">
        <div className="flex items-center gap-2 mb-4 max-md:hidden">
          <Smartphone size={20} />
          <h1 className="heading-2">{t('nav.myAssets')}</h1>
        </div>

        <p className="text-sm text-subtle mb-3">{t('myAssets.subtitle')}</p>

        <div className="border border-line rounded-lg overflow-hidden">
          {user?.user_id != null ? (
            <MyInternalUseAssetsView userId={user.user_id} userLabel={userLabel} />
          ) : (
            <div className="p-8 text-center text-subtler">{t('common.noData')}</div>
          )}
        </div>
      </div>
    </>
  );
}
