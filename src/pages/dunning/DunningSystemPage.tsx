// Dunning Config admin page — replaces the legacy single-ladder
// `DunningConfigPage` per UI_SUMMARY/110_DUNNING_SYSTEM_MIGRATION_GUIDE.md and
// the menu structure recommendation in UI_SUMMARY/112_DUNNING_SYSTEM_MENU_STRUCTURE_RECOMMENDATION.md.
//
// 4 modules (notif / blacklist / ops / legal), each surfaced as a tab. The
// Timeline overview is its own page at /admin/collections/timeline so
// non-admin viewers can read it without entering this config screen.
//
// This iteration ships the SHELL only — container, tab bar, role gating,
// stubbed tab bodies. Per-module tables (the 5 RPCs each) land in follow-on
// commits, Notif first per doc 112 §9. The legacy `DunningConfigPage` stays
// alive in parallel through Phase 1 of the migration (doc 110 §6).
//
// Open design questions resolved with conservative defaults (redirect if
// these turn out wrong):
//   - Single-stage modules: table view (consistent across all 4 tabs)
//   - Audit log: inline panel under each tab (matches existing audit UX)

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MobileHeader } from 'tsp-form';
import { ArrowRightFromLine, Bell, ShieldBan, Phone, Scale } from 'lucide-react';

type DunningTab = 'notif' | 'blacklist' | 'ops' | 'legal';

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

        {activeTab === 'notif'     && <ModuleStub module="notif" />}
        {activeTab === 'blacklist' && <ModuleStub module="blacklist" />}
        {activeTab === 'ops'       && <ModuleStub module="ops" />}
        {activeTab === 'legal'     && <ModuleStub module="legal" />}
      </div>
    </>
  );
}

function ModuleStub({ module }: {
  module: 'notif' | 'blacklist' | 'ops' | 'legal';
}) {
  const { t } = useTranslation();
  return (
    <div className="border border-dashed border-line rounded-md p-8 text-center text-sm text-subtle">
      <div className="font-medium text-fg mb-1">{t(`dunningSystem.tab_${module}`)}</div>
      <div>{t('dunningSystem.stubBody')}</div>
    </div>
  );
}
