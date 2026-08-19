// Sub-nav for the NNF Extra section (NNF App + NNF MDM). Mirrors RepoLayout.
// Labels are NNF brand names — intentionally English in every language
// (owner: the name signals "NNF designed this"); content inside is Thai.

import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Smartphone, MonitorSmartphone, ListChecks } from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';

const NAV_ITEMS = [
  { path: '/admin/nnf-extra/mdm-devices', labelKey: 'nav.mdmDevices', icon: ListChecks },
  { path: '/admin/nnf-extra/mdm', labelKey: 'nav.mdmDetection', icon: MonitorSmartphone },
  { path: '/admin/nnf-extra/app', labelKey: 'nav.appDetection', icon: Smartphone },
];

export function NnfExtraLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();

  return (
    <div className="flex min-h-full">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-50 border-r border-line p-4 pt-7.5 sticky top-0 h-dvh">
        <span className="subnav-group-label mb-1">{t('nav.nnfExtra')}</span>
        {NAV_ITEMS.map(({ path, labelKey, icon: Icon }) => {
          // exact match — '/admin/nnf-extra/mdm' is a prefix of '…/mdm-devices',
          // so startsWith would light up both.
          const isActive = pathname === path;
          return (
            <a
              key={path}
              href={path}
              onClick={(e) => { e.preventDefault(); if (!isActive) navGuard?.guardedNavigate(path); }}
              className={`flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-item-active-bg text-item-active-fg font-medium'
                  : 'text-item-fg hover:bg-item-hover-bg hover:text-item-hover-fg'
              }`}
            >
              <Icon size={15} />
              <span className="flex-1">{t(labelKey)}</span>
            </a>
          );
        })}
      </nav>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
