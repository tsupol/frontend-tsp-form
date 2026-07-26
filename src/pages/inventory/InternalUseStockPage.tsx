import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MobileHeader } from 'tsp-form';
import { ArrowRightFromLine, Boxes } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { BranchScopedInternalUseView } from './InternalUseAssetsView';

// ============================================================================
// Warehouse → "สต๊อกใช้ภายใน" (internal-use stock).
// All IN_USE_INTERNAL devices + who holds them. The branch filter shows only
// for holding/company users; branch-level users are auto-scoped by the view,
// so they get no filter. Route: /admin/inventory/internal-use
// ============================================================================

export function InternalUseStockPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isMobile = useMediaQuery('(max-width: 767px)');

  // Branch-level users are auto-scoped by the DB → no branch picker for them.
  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const showBranchFilter = !isBranchUser;

  const [filterBranchId, setFilterBranchId] = useState<number | null>(null);

  return (
    <div className="flex flex-col h-dvh">
      {isMobile ? (
        <MobileHeader className="mobile-header-bordered">
          <div className="mobile-header-start">
            <button
              className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
              onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
            >
              <ArrowRightFromLine size={18} />
            </button>
          </div>
          <div className="mobile-header-title mobile-header-title-truncate">
            {t('nav.internalUseStock')}
          </div>
          <div className="mobile-header-end w-nav" />
        </MobileHeader>
      ) : (
        <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
          <h1 className="heading-2 shrink-0 flex items-center gap-2">
            <Boxes size={18} />
            {t('nav.internalUseStock')}
          </h1>
        </div>
      )}

      <BranchScopedInternalUseView
        filterBranchId={filterBranchId}
        onBranchChange={setFilterBranchId}
        showBranchFilter={showBranchFilter}
      />
    </div>
  );
}
