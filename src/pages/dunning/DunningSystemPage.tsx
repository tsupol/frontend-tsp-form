// Dunning Config admin page — 4 modules (notif / blacklist / ops / legal),
// each surfaced as a tab. The Timeline overview is its own page at
// /admin/collections/timeline so non-admin viewers can read the schedule
// without entering this config screen.
//
// Each tab body is the same DunningStagesTable component parameterised by
// module — the per-module differences (extra editable column: reason_code /
// intent_type / action_code) are encoded in MODULE_CONFIG in dunningTypes.ts.
//
// Replaces the legacy single-ladder /admin/company/dunning page per
// UI_SUMMARY/110_DUNNING_SYSTEM_MIGRATION_GUIDE.md. Old paths redirect.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MobileHeader } from 'tsp-form';
import { ArrowRightFromLine, Bell, ShieldBan, Phone, Scale } from 'lucide-react';
import { DunningStagesTable } from './DunningStagesTable';
import type { DunningModule } from './dunningTypes';

type DunningTab = DunningModule;

const TABS: { key: DunningTab; icon: React.ReactNode }[] = [
  { key: 'notif',     icon: <Bell size={14} /> },
  { key: 'blacklist', icon: <ShieldBan size={14} /> },
  { key: 'ops',       icon: <Phone size={14} /> },
  { key: 'legal',     icon: <Scale size={14} /> },
];

export function DunningSystemPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<DunningTab>('notif');

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
          {t('nav.dunningConfig')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content">
        <div className="mb-6 max-md:hidden">
          <h1 className="heading-2">{t('nav.dunningConfig')}</h1>
          <p className="text-sm text-subtle mt-1">{t('dunningSystem.description')}</p>
        </div>

        <div className="flex-none border-b border-line mb-4">
          <div className="flex overflow-x-auto hidden-scroll">
            {TABS.map(tab => (
              <button
                key={tab.key}
                type="button"
                className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap inline-flex items-center gap-1.5 ${
                  activeTab === tab.key
                    ? 'border-primary-fg text-primary-fg'
                    : 'border-transparent text-fg hover:text-primary-fg'
                }`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.icon}
                {t(`dunningSystem.tab_${tab.key}`)}
              </button>
            ))}
          </div>
        </div>

        <DunningStagesTable module={activeTab} />
      </div>
    </>
  );
}
