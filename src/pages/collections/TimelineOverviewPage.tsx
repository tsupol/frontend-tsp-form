// Cross-module dunning timeline — read-only fan-out view across the 4
// dunning modules (notif / blacklist / ops / legal). Lives at
// /admin/collections/timeline so non-admin viewers can read the schedule
// without entering the Dunning Config page.
//
// Data sources (when wired in a follow-on commit):
//   - api.fn_admin_notif_dunning_stage_list
//   - api.fn_admin_blacklist_dunning_stage_list
//   - api.fn_admin_ops_dunning_stage_list
//   - api.fn_admin_legal_dunning_stage_list
// Merge by day_from, render lanes per module. See
// UI_SUMMARY/112_DUNNING_SYSTEM_MENU_STRUCTURE_RECOMMENDATION.md §7.

import { useTranslation } from 'react-i18next';
import { MobileHeader } from 'tsp-form';
import { ArrowRightFromLine } from 'lucide-react';

export function TimelineOverviewPage() {
  const { t } = useTranslation();

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('nav.timelineOverview')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content">
        <div className="mb-6 max-md:hidden">
          <h1 className="heading-2">{t('nav.timelineOverview')}</h1>
          <p className="text-sm text-subtle mt-1">{t('dunningSystem.timelineDescription')}</p>
        </div>

        <div className="border border-dashed border-line rounded-md p-8 text-center text-sm text-subtle">
          <div className="font-medium text-fg mb-1">{t('nav.timelineOverview')}</div>
          <div>{t('dunningSystem.timelineStubBody')}</div>
        </div>
      </div>
    </>
  );
}
