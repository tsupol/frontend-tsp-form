// Sub-nav for the fund's money — the page-level twin of the "ภาพรวมเงินกองทุน"
// parent in AppSideNav. Both carry the same items in the same order.
//
// Laid out the way the owner asked (10-30: "ไม่สับสน ทั้งเรื่องการบัญชี การดู
// การเคลื่อนไหว"): looking at money first, from the overall position down to the
// lines, then settings apart. Each figure has one home — what is in the accounts
// is the position and the passbooks, today's in/out is the daily summary, capital
// versus money at work is the money book. Recording money (paying a shop,
// capital in/out, expenses) stays where the work is: the shop-payment screens
// and the buttons on the position and money-book pages.
//
// Gating matches the side nav: a fund company, and one of the money permissions
// read from the effective list (role or per-user grant).

import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BookOpenText, CalendarClock, History, Landmark, MessageSquareText, PiggyBank, Wallet, type LucideIcon,
} from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { useAuth } from '../../contexts/AuthContext';

type FundNavItem =
  | { type: 'group'; labelKey: string }
  | { type: 'link'; path: string; labelKey: string; icon: LucideIcon; anyOf?: string[] };

/** Same order as the side nav's "ภาพรวมเงินกองทุน" children. */
const FUND_MONEY_NAV: FundNavItem[] = [
  { type: 'group', labelKey: 'nav.groupFundView' },
  { type: 'link', path: '/admin/fund-cash', labelKey: 'nav.fundCash', icon: PiggyBank },
  { type: 'link', path: '/admin/fund-passbook', labelKey: 'nav.fundPassbook', icon: BookOpenText },
  { type: 'link', path: '/admin/fund-day-money', labelKey: 'nav.fundDayMoney', icon: CalendarClock },
  { type: 'link', path: '/admin/fund-day-recon', labelKey: 'nav.fundDayRecon', icon: History },
  { type: 'link', path: '/admin/fund-book', labelKey: 'nav.fundBook', icon: Wallet },
  { type: 'group', labelKey: 'nav.groupFundSettings' },
  { type: 'link', path: '/admin/company/bank-accounts?tab=company', labelKey: 'nav.fundBankAccounts', icon: Landmark, anyOf: ['BANK_ACCOUNT.COMPANY_MANAGE'] },
  { type: 'link', path: '/admin/company/sms-relay', labelKey: 'nav.smsRelay', icon: MessageSquareText, anyOf: ['SMS.VIEW', 'SMS.MANAGE'] },
];

/** Who sees the fund's money at all (same rule as the daily money summary). */
function useCanSeeFundMoney() {
  const { isFundCompany, isDealPartner } = useAuth();
  const { hasPermission } = useMyPermissions();
  // A deal-partner shop sits in the fund company and its own permission list
  // carries REPORT.DAILY.READ, but it never sees the fund's money (doc 151 §1).
  return isFundCompany && !isDealPartner
    && (hasPermission('FUND.RECON_SAVE') || hasPermission('REPORT.DAILY.READ'));
}

export function FundMoneyLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();
  const { hasPermission } = useMyPermissions();
  const canSee = useCanSeeFundMoney();

  const visible = FUND_MONEY_NAV.filter(i => i.type === 'group' || !i.anyOf || i.anyOf.some(p => hasPermission(p)));
  // Drop a heading left with nothing under it.
  const items = visible.filter((item, idx) => item.type === 'link' || visible[idx + 1]?.type === 'link');

  return (
    <div className="flex h-dvh overflow-hidden">
      {canSee && (
        <nav className="hidden lg:flex flex-col gap-0.5 shrink-0 w-50 border-r border-line p-2 pt-7.5 h-full min-h-0 overflow-y-auto better-scroll">
          {items.map((item, i) => {
            if (item.type === 'group') {
              return (
                <span key={item.labelKey} className={`subnav-group-label ${i > 0 ? 'mt-3 mb-1' : 'mb-1'}`}>
                  {t(item.labelKey)}
                </span>
              );
            }
            const { path, labelKey, icon: Icon } = item;
            const isActive = pathname.startsWith(path.split('?')[0]);
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
      )}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto better-scroll">{children}</div>
    </div>
  );
}
