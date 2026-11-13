// Board of devices stuck in Lost Mode (UI_SUMMARY 164 · work order 2026-11-13).
// The system locks a phone for under a minute to read its location and then
// releases it; a phone that drops off the internet in between stays locked and
// its customer cannot use it or fix it. Every staff role sees this board — what
// they can DO about a row stays behind the existing buttons and permissions.
//
// No "close" button: a row leaves by itself when the device unlocks. Rows come
// in the backend's order (system-locked first, longest first).

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, DataTable, MobileHeader, PageNav, PageNavPanel, Select, Tooltip } from 'tsp-form';
import {
  ArrowRightFromLine, Battery, Store, ScanEye, CheckCircle2, Cpu, ExternalLink, Lock, RefreshCw, Smartphone, UserCog, Info,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { EntityCodeLink } from '../../components/EntityCodeLink';
import { TelLink } from '../../components/TelLink';
import { CopyButton } from '../../components/CopyButton';
import { RelativeDateTime } from '../inventory/mdm/RelativeDateTime';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { useLostModeStuckList, type LostModeStuckRow } from './lostModeStuckApi';
import { useAuth } from '../../contexts/AuthContext';
import { defaultScopeFor } from '../../lib/scope';

// Who locked it decides what to do next: a system lock → call the customer,
// a staff lock → ask whoever ordered it. Split the same way as the backend's `counts`.
type Who = '' | 'system' | 'staff';

/** "2 วัน 7 ชม." · "3 ชม. 54 นาที" · "79 นาที" from `locked_minutes`. */
function useLockedFor() {
  const { t } = useTranslation();
  return (minutes: number) => {
    const m = Math.max(0, Math.floor(minutes));
    const days = Math.floor(m / 1440);
    const hours = Math.floor((m % 1440) / 60);
    const mins = m % 60;
    if (days > 0) return hours > 0 ? t('lostModeStuck.dur.dh', { d: days, h: hours }) : t('lostModeStuck.dur.d', { d: days });
    if (hours > 0) return mins > 0 ? t('lostModeStuck.dur.hm', { h: hours, m: mins }) : t('lostModeStuck.dur.h', { h: hours });
    return t('lostModeStuck.dur.m', { m: mins });
  };
}

export function LostModeStuckPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  // From a lost_mode_stuck_staff notification: the device it was about.
  const focusAsset = Number(searchParams.get('asset')) || null;
  const { data, error, isLoading, isFetching, refetch } = useLostModeStuckList();
  const { user } = useAuth();
  // A branch user only ever sees their own branch — no branch picker for them.
  const multiBranch = defaultScopeFor(user).kind !== 'branch';
  const [who, setWho] = useState<Who>('');
  const [branchId, setBranchId] = useState<string>('');
  const allRows = data?.items ?? [];
  const branchOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of allRows) if (r.branch.id != null && !seen.has(r.branch.id)) seen.set(r.branch.id, `${r.branch.name ?? '—'} · ${r.company.name}`);
    return [...seen].map(([id, label]) => ({ value: String(id), label }));
  }, [allRows]);
  // Filtered on screen: the list is small (cap 100) and comes whole, in the backend's order.
  const rows = allRows.filter((r) =>
    (who === '' || (who === 'staff') === (r.reason_code === 'STAFF'))
    && (!branchId || String(r.branch.id) === branchId));
  const focusGone = focusAsset != null && !!data && !allRows.some((r) => r.asset_id === focusAsset);
  const tabs: { key: Who; label: string; n: number | undefined }[] = [
    { key: '', label: t('lostModeStuck.tab.all'), n: data?.total },
    { key: 'system', label: t('lostModeStuck.tab.system'), n: data?.counts.system },
    { key: 'staff', label: t('lostModeStuck.tab.staff'), n: data?.counts.staff },
  ];

  const refresh = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: ['nav', 'counters'] });
  };

  return (
    <PageNav panels={['list']} className="h-dvh overflow-hidden">
      {({ isMobile }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" aria-label={t('common.openMenu', { defaultValue: 'Open menu' })} onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
                  <ArrowRightFromLine size={18} />
                </button>
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">{t('lostModeStuck.title')}</div>
              <div className="mobile-header-end w-nav">
                <Button variant="ghost" size="sm" aria-label={t('lostModeStuck.reload')} startIcon={<RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />} disabled={isFetching} onClick={refresh} />
              </div>
            </MobileHeader>
          )}
          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-3">
              <h1 className="heading-2 shrink-0">{t('lostModeStuck.title')}</h1>
              {data && data.total > 0 && (
                <span className="text-sm text-subtle">
                  {t('lostModeStuck.countLine', { system: data.counts.system, staff: data.counts.staff })}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <Link to="/admin/nnf-extra/device-watch" className="btn btn-outline-default btn-sm inline-flex items-center gap-1.5 no-underline shrink-0" data-testid="device-watch-link">
                  <ScanEye size={14} />{t('deviceWatch.open')}
                </Link>
                <Tooltip content={t('lostModeStuck.reload')} placement="bottom">
                  <Button variant="ghost" size="sm" aria-label={t('lostModeStuck.reload')} startIcon={<RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />} disabled={isFetching} onClick={refresh} />
                </Tooltip>
              </div>
            </div>
          )}
          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 overflow-auto better-scroll">
              <div className="max-w-5xl mx-auto p-4 flex flex-col gap-3">
                <div className="text-sm text-subtle flex items-start gap-2">
                  <Info size={14} className="mt-0.5 shrink-0" />
                  <span>{t('lostModeStuck.intro', { min: data?.threshold_minutes ?? 10 })}</span>
                </div>
                {/* Tabs take the row and their line runs its full width; the
                    branch picker sits at the end, or takes its own full row
                    on a narrow screen — never a lone box floating right. */}
                {/* The fade under it is the mobile header's (`mobile-header-scrolled-shadow`):
                    the bar's own background running out to transparent over the rows. */}
                <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-bg flex items-end gap-x-3 gap-y-2 flex-wrap after:content-[''] after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-linear-to-b after:from-bg after:to-transparent after:pointer-events-none">
                  <div className="flex-1 min-w-fit flex items-center border-b border-line">
                    {tabs.map((tb) => (
                      <button
                        key={tb.key || 'all'}
                        type="button"
                        data-who={tb.key || 'all'}
                        onClick={() => setWho(tb.key)}
                        className={`px-3 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 bg-transparent ${
                          who === tb.key ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
                        }`}
                      >
                        {tb.label}{tb.n != null && <span className="ml-1 tabular-nums">({tb.n})</span>}
                      </button>
                    ))}
                  </div>
                  {multiBranch && (
                    <div className="w-full sm:w-60 shrink-0">
                      <Select
                        options={branchOptions}
                        value={branchId || null}
                        onChange={(v) => setBranchId((v as string) ?? '')}
                        placeholder={t('lostModeStuck.allBranches')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                  )}
                </div>
                {focusGone && (
                  <div className="alert alert-success"><CheckCircle2 size={16} /><span className="alert-description">{t('lostModeStuck.focusGone')}</span></div>
                )}
                {error ? (
                  <div className="alert alert-danger"><span className="alert-description">{error instanceof ApiError ? translateApiError(error, t) : t('common.error')}</span></div>
                ) : (
                  <DataTable<LostModeStuckRow>
                    data={rows}
                    outlined
                    getRowProps={(row) => ({ 'data-state': row.original.asset_id === focusAsset ? 'selected' : undefined })}
                    renderRow={(row) => <StuckRow r={row.original} />}
                    className={`h-auto! [&_.data-table-content]:overflow-visible! ${isFetching ? 'opacity-60' : ''} transition-opacity`}
                    noResults={
                      <div className="p-8 text-center text-subtle flex flex-col items-center gap-2">
                        <CheckCircle2 size={28} className="text-success-fg" />
                        {isLoading ? t('common.loading') : allRows.length > 0 ? t('lostModeStuck.emptyFiltered') : t('lostModeStuck.empty')}
                      </div>
                    }
                  />
                )}
              </div>
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}

const REASON_COLOR: Record<string, 'danger' | 'warning' | 'info' | 'default'> = {
  SYSTEM_HEALTH_CHECK: 'danger',
  SYSTEM_DUNNING: 'warning',
  SYSTEM_HANDOVER: 'info',
  STAFF: 'default',
};

/** One stuck device: why, how long, last contact, what to do. Also the device-watch scene's card. */
export function StuckRow({ r }: { r: LostModeStuckRow }) {
  const { t } = useTranslation();
  const lockedFor = useLockedFor();
  const isStaff = r.reason_code === 'STAFF';
  // What to say to the customer, ready to copy. Health-check wording never
  // mentions debt (work order §6); a staff-ordered lock has no customer script.
  const script = isStaff ? null : t(`lostModeStuck.script.${r.reason_code}`, { defaultValue: '' }) || null;

  return (
    <div className="w-full px-4 py-3 flex flex-col gap-2" data-asset={r.asset_id} data-reason={r.reason_code}>
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <span className="inline-flex items-center gap-1 font-semibold text-sm">
          {isStaff ? <UserCog size={14} /> : <Cpu size={14} />}
          <Lock size={13} className="text-danger-fg" />
          {t('lostModeStuck.lockedFor', { dur: lockedFor(r.locked_minutes) })}
        </span>
        <Badge size="xs" color={REASON_COLOR[r.reason_code] ?? 'default'}>{t(`lostModeStuck.reason.${r.reason_code}`, { defaultValue: r.reason_code })}</Badge>
        {isStaff && r.ordered_by_username && (
          <span className="text-xs text-subtle">{t('lostModeStuck.orderedBy', { user: r.ordered_by_username })}</span>
        )}
        {r.is_test_data && <Badge size="xs" color="secondary">{t('silentWatch.testData')}</Badge>}
      </div>

      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-sm min-w-0">
        <EntityCodeLink to={`/admin/contracts/search/${r.contract.id}`} code={r.contract.code} className="font-mono" />
        <span className="truncate">{r.customer.name ?? '—'}</span>
        {r.customer.tel && <TelLink tel={r.customer.tel} />}
        {r.contract.overdue_days > 0 && (
          <span className="text-xs text-danger-fg">{t('lostModeStuck.overdue', { n: r.contract.overdue_days })}</span>
        )}
      </div>

      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-subtle">
        <span className="inline-flex items-center gap-1"><Store size={12} />{r.branch.name ?? '—'} · {r.company.name}</span>
        <span className="inline-flex items-center gap-1"><Smartphone size={12} />{r.product_name ?? '—'}</span>
        <Link to={`/admin/inventory/assets/${r.asset_id}?tab=mdm`} className="text-primary-fg hover:underline inline-flex items-center gap-1">
          {r.asset_code}<ExternalLink size={11} />
        </Link>
        <span className="inline-flex items-center gap-1">{t('lostModeStuck.lastSeen')} <RelativeDateTime value={r.last_seen_at} staleAfterDays={1} /></span>
        {r.battery_percent != null && (
          <span className={`inline-flex items-center gap-1 ${r.battery_percent <= 20 ? 'text-danger-fg' : ''}`}><Battery size={12} />{r.battery_percent}%</span>
        )}
      </div>

      <div className={`rounded-md px-3 py-2 text-sm flex items-start gap-2 ${
        r.advice_code === 'CONNECT_INTERNET' ? 'bg-info-soft border border-info-border' : 'bg-warning-soft border border-warning-border'
      }`}>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="font-medium">{t(`lostModeStuck.advice.${r.advice_code}`, { user: r.ordered_by_username ?? t('lostModeStuck.someoneWithRight') })}</span>
          {script && <span className="text-xs text-subtle whitespace-pre-wrap">“{script}”</span>}
        </div>
        {script && (
          <Tooltip content={t('lostModeStuck.copyScript')} placement="top">
            <span className="shrink-0"><CopyButton value={script} size={14} /></span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
