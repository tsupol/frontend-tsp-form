// The commission-clawback queue.
//
// Two tabs. "Due" is the work: contracts past their check day whose commission
// is owed back. "Coming" is everything else on the list — not due yet, shown
// because there is no reminder for the check day, so looking here is the only
// way anyone finds out it arrived.
//
// Selection is restricted to one payout at a time, because one clawback settles
// one payout. Rather than let someone tick rows across two and fail on submit,
// picking a row from a different payout replaces the selection.
//
// ⛔ No amount is worked out on this screen. Every figure is the queue's own,
// from the same calculator the issue call uses.

import { OverflowTabs } from '../../components/OverflowTabs';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  PageNav, PageNavPanel, DataTable, MobileHeader, Badge, Button, Checkbox,
} from 'tsp-form';
import { ArrowRightFromLine, Clock, ExternalLink } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency, formatEntityCode } from '../../lib/format';
import { useFundClawbackCandidates } from './useFundClawback';
import { FundClawbackIssueModal } from './FundClawbackIssueModal';
import type { FundClawbackCandidate } from './fundClawbackTypes';

type TabKey = 'DUE' | 'UPCOMING';

export function FundClawbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [tab, setTab] = useState<TabKey>('DUE');
  const [selected, setSelected] = useState<number[]>([]);
  const [issueOpen, setIssueOpen] = useState(false);

  const { rows, isFetching } = useFundClawbackCandidates();

  const visible = useMemo(
    () => rows.filter(r => (tab === 'DUE' ? r.check_day_reached : !r.check_day_reached)),
    [rows, tab],
  );

  const dueCount = rows.filter(r => r.check_day_reached).length;

  const selectedRows = rows.filter(r => selected.includes(r.settlement_id));
  const selectedTotal = selectedRows.reduce((sum, r) => sum + r.claw_total, 0);
  /** The payout the current selection belongs to, if any. */
  const selectedPayoutId = selectedRows[0]?.payout_bill_id ?? null;

  /**
   * Tick a row.
   *
   * One clawback settles one payout, so a row from a different payout starts a
   * new selection instead of joining the old one — the alternative is a rejection
   * on submit for something the screen already knew.
   */
  const toggle = (row: FundClawbackCandidate) => {
    setSelected(prev => {
      if (prev.includes(row.settlement_id)) {
        return prev.filter(x => x !== row.settlement_id);
      }
      if (selectedPayoutId != null && row.payout_bill_id !== selectedPayoutId) {
        return [row.settlement_id];
      }
      return [...prev, row.settlement_id];
    });
  };

  const renderRow = (r: FundClawbackCandidate) => {
    const checked = selected.includes(r.settlement_id);
    const otherPayout = selectedPayoutId != null && r.payout_bill_id !== selectedPayoutId;
    return (
      <div className="px-4 py-2.5 flex items-start gap-3">
        <div className="pt-0.5 shrink-0">
          <Checkbox checked={checked} onChange={() => toggle(r)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/admin/contracts/search/${r.contract_id}`)}
              className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer truncate"
            >
              {formatEntityCode(r.contract_code)}
              <ExternalLink size={12} />
            </button>
            {/* Who owes it back decides what goes on the document, and the shop
             *  never sees a document the company owes. */}
            <Badge color={r.liable_party_type === 'BRANCH' ? 'warning' : 'info'} size="sm">
              {t(`fundClawback.party_${r.liable_party_type}`)}
            </Badge>
            <span className="flex-1" />
            <span className="text-sm tabular-nums font-medium shrink-0">
              {fmtCurrency(r.claw_total)}
            </span>
          </div>

          <div className="text-sm mt-0.5 truncate">
            {r.branch_name}
            {r.product_display_name && <span className="text-subtle"> · {r.product_display_name}</span>}
          </div>

          <div className="text-xs text-subtle mt-0.5 flex flex-wrap gap-x-3">
            <span>{t('fundClawback.paidCount', { count: r.paid_count })}</span>
            {r.tier_pct != null && <span>{t('fundClawback.tierPct', { pct: r.tier_pct })}</span>}
            <span>
              {t('fundClawback.checkDue')}: <DateTime value={r.check_due_date} showTime={false} />
            </span>
          </div>

          <div className="text-xs text-subtler mt-0.5">
            {t('fundClawback.againstPayout')}: {r.payout_bill_code ?? '—'}
          </div>

          {otherPayout && (
            <div className="text-xs text-warning-fg mt-1">
              {t('fundClawback.otherPayoutHint')}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <PageNav panels={['list']} className="h-dvh overflow-hidden">
      {({ isMobile }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                <button
                  className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                  aria-label={t('nav.openMenu', { defaultValue: 'Open menu' })}
                  onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                >
                  <ArrowRightFromLine size={18} />
                </button>
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {t('fundClawback.pageTitle')}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('fundClawback.pageTitle')}</h1>
              <span className="text-sm text-subtle">
                {t('fundClawback.dueCount', { count: dueCount })}
              </span>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 flex flex-col">
              <OverflowTabs
                tabs={(['DUE', 'UPCOMING'] as TabKey[])}
                activeTab={tab}
                onTabChange={(key) => { setTab(key); setSelected([]); }}
                renderLabel={key => t(`fundClawback.tab${key === 'DUE' ? 'Due' : 'Upcoming'}`)}
              />

              {/* There is no reminder for the check day, so this is the only way
               *  anyone learns one has arrived. Said once, on the tab it matters. */}
              {tab === 'UPCOMING' && (
                <div className="flex-none p-2 border-b border-line">
                  <div className="alert alert-info">
                    <Clock size={16} className="shrink-0" />
                    <span>{t('fundClawback.noReminderHint')}</span>
                  </div>
                </div>
              )}

              <DataTable<FundClawbackCandidate>
                data={visible}
                renderRow={row => renderRow(row.original)}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60' : ''} transition-opacity`}
                noResults={
                  <div className="p-8 text-center text-subtler">
                    {tab === 'DUE' ? t('fundClawback.emptyDue') : t('fundClawback.emptyUpcoming')}
                  </div>
                }
              />

              <div className="flex-none border-t border-line px-4 py-3 flex items-center gap-3">
                <span className="text-sm text-subtle">
                  {t('fundClawback.selectedCount', { count: selected.length })}
                </span>
                <span className="text-base font-semibold tabular-nums">
                  {fmtCurrency(selectedTotal)}
                </span>
                <span className="flex-1" />
                <Button
                  color="primary"
                  disabled={selected.length === 0}
                  onClick={() => setIssueOpen(true)}
                >
                  {t('fundClawback.issueAction')}
                </Button>
              </div>
            </PageNavPanel>
          </div>

          <FundClawbackIssueModal
            open={issueOpen}
            rows={selectedRows}
            onClose={() => setIssueOpen(false)}
            onIssued={() => setSelected([])}
          />
        </>
      )}
    </PageNav>
  );
}
