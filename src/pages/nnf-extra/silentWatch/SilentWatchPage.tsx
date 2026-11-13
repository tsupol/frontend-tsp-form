// Silent watch console (UI_SUMMARY 163 · work order 2026-11-13): the queue of
// silent devices on the left, the open one on the right, the check-result bar
// under it — look, judge and record without leaving the page.
//
// The queue is printed in the order the backend sends it (unchecked first →
// higher level → longer silent) and is never re-sorted here. Tab and the open
// row live in the address (`/silent-watch/<episode>?view=WATCH`), so a link from
// a notification opens straight on the row.

import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DataTable, Input, MobileHeader, PageNav, PageNavPanel, Select, Switch, Tooltip } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, MapPinOff, RefreshCw, Search, ShieldOff, X, MonitorX, ScanEye } from 'lucide-react';
import { DateTime } from '../../../components/DateTime';
import { EntityCodeLink } from '../../../components/EntityCodeLink';
import { ApiError } from '../../../lib/api';
import { translateApiError } from '../../../lib/apiErrors';
import { useSilentTaskList, type SilentTaskRow, type SilentView } from './silentWatchApi';
import { GroupBadge, LevelBadge, ResultBadge, TestDataBadge, useSilentDuration } from './silentWatchBits';
import { SilentDetailPanel } from './SilentDetailPanel';

const VIEWS: SilentView[] = ['TASK', 'WATCH', 'CLOSED'];
const BASE = '/admin/nnf-extra/silent-watch';

export function SilentWatchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { episodeId: episodeParam } = useParams();
  const selectedId = episodeParam ? Number(episodeParam) : null;
  const [searchParams] = useSearchParams();
  const viewParam = searchParams.get('view') as SilentView | null;
  const view: SilentView = viewParam && VIEWS.includes(viewParam) ? viewParam : 'TASK';

  const [branchId, setBranchId] = useState<string>('');
  const [uncheckedOnly, setUncheckedOnly] = useState(false);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const { data, error, isFetching, refetch } = useSilentTaskList({
    view, branchId: branchId ? Number(branchId) : null,
    uncheckedOnly: view !== 'CLOSED' && uncheckedOnly, keyword, pageIndex, pageSize,
  });
  const rows = data?.items ?? [];
  const counts = data?.counts;
  const notGranted = error instanceof ApiError && (error.code ?? '').toUpperCase() === 'MDM.AUTH.SILENT_WATCH_NOT_GRANTED';

  const qs = (v: SilentView) => (v === 'TASK' ? '' : `?view=${v}`);
  // Switching tab adds a history entry; picking a row replaces it.
  const switchView = (v: SilentView) => {
    setPageIndex(0);
    navigate(`${BASE}${qs(v)}`);
  };
  const selectRow = (id: number, goTo?: (p: string) => void) => {
    navigate(`${BASE}/${id}${qs(view)}`, { replace: true });
    goTo?.('detail');
  };
  const runSearch = () => { setKeyword(keywordInput.trim()); setPageIndex(0); };
  const clearSearch = () => { setKeywordInput(''); setKeyword(''); setPageIndex(0); };

  const branchOptions = (data?.branches ?? []).map((b) => ({
    value: String(b.branch_id),
    label: `${b.name} · ${b.company_name} (${b.tasks})`,
  }));
  const viewCount = (v: SilentView) => (v === 'TASK' ? counts?.tasks : v === 'WATCH' ? counts?.watch : undefined);

  const refreshAll = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: ['nav', 'counters'] });
  };

  if (notGranted) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center gap-2 text-subtle p-6 text-center">
        <ShieldOff size={32} className="text-subtler" />
        <div className="font-medium">{t('silentWatch.noAccess')}</div>
        <div className="text-sm text-subtler">{t('silentWatch.noAccessHint')}</div>
      </div>
    );
  }

  return (
    <PageNav panels={['list', 'detail']} defaultPanel={selectedId ? 'detail' : undefined} className="h-dvh overflow-hidden">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" aria-label={t('common.openMenu', { defaultValue: 'Open menu' })} onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" aria-label={t('common.back')} onClick={goBack}>
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">{t('silentWatch.title')}</div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-3">
              <h1 className="heading-2 shrink-0">{t('silentWatch.title')}</h1>
              <span className="text-sm text-subtle truncate">{t('silentWatch.subtitle')}</span>
              <div className="ml-auto flex items-center gap-2">
                <Link to="/admin/nnf-extra/device-watch" className="btn btn-outline-default btn-sm inline-flex items-center gap-1.5 no-underline shrink-0" data-testid="device-watch-link">
                  <ScanEye size={14} />{t('deviceWatch.open')}
                </Link>
                <Tooltip content={t('silentWatch.reload')} placement="bottom">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('silentWatch.reload')}
                    startIcon={<RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />}
                    disabled={isFetching}
                    onClick={refreshAll}
                  />
                </Tooltip>
              </div>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              {/* Tabs — the counts are for the whole scope, not this page */}
              <div className="flex-none flex items-center border-b border-line">
                {VIEWS.map((v) => {
                  const n = viewCount(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      data-view={v}
                      className={`flex-1 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 bg-transparent ${
                        view === v ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
                      }`}
                      onClick={() => switchView(v)}
                    >
                      {t(`silentWatch.view.${v}`)}{n != null && <span className="ml-1 tabular-nums">({n})</span>}
                    </button>
                  );
                })}
              </div>

              {/* Filters — the keyword searches on Enter, never per keystroke */}
              <div className="flex-none p-2 border-b border-line flex items-center gap-2 flex-wrap">
                <div className="flex-1 min-w-48">
                  <Input
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                    placeholder={t('silentWatch.searchPlaceholder')}
                    size="sm"
                    className="w-full"
                    startIcon={<Search size={14} />}
                    endIcon={keywordInput ? <X size={14} /> : undefined}
                    onEndIconClick={keywordInput ? clearSearch : undefined}
                  />
                </div>
                <div style={{ width: '13rem' }} className="shrink-0">
                  <Select
                    options={branchOptions}
                    value={branchId || null}
                    onChange={(v) => { setBranchId((v as string) ?? ''); setPageIndex(0); }}
                    placeholder={t('silentWatch.allBranches')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
                {view !== 'CLOSED' && (
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer shrink-0">
                    <Switch size="sm" checked={uncheckedOnly} onChange={(e) => { setUncheckedOnly(e.target.checked); setPageIndex(0); }} />
                    {t('silentWatch.uncheckedOnly')}
                    {counts && <span className="text-subtle tabular-nums">({counts.unchecked})</span>}
                  </label>
                )}
              </div>
              {keyword && keyword.length < 2 && (
                <div className="flex-none px-3 py-1 text-xs text-subtle border-b border-line">{t('silentWatch.searchTooShort')}</div>
              )}

              {error && !notGranted && (
                <div className="flex-none p-2">
                  <div className="alert alert-danger"><span className="alert-description">{error instanceof ApiError ? translateApiError(error, t) : t('common.error')}</span></div>
                </div>
              )}

              <DataTable<SilentTaskRow>
                data={rows}
                getRowProps={(row) => ({ 'data-state': row.original.episode_id === selectedId ? 'selected' : undefined })}
                enableKeyboardNav={!isMobile}
                keyboardActivateMode="manual"
                onRowActivate={(row) => selectRow(row.original.episode_id)}
                renderRow={(row) => (
                  <QueueRow r={row.original} onOpen={() => selectRow(row.original.episode_id, isMobile ? goTo : undefined)} />
                )}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[25, 50, 100]}
                rowCount={data?.total ?? 0}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60' : ''} transition-opacity`}
                noResults={
                  <div className="p-8 text-center text-subtler flex flex-col items-center gap-2">
                    <MonitorX size={28} className="opacity-50" />
                    {keyword ? t('silentWatch.emptySearch') : t(`silentWatch.empty.${view}`)}
                  </div>
                }
              />
            </PageNavPanel>

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 min-h-0 flex flex-col'}>
              {selectedId ? (
                <SilentDetailPanel episodeId={selectedId} />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-subtler gap-2">
                  <MonitorX size={32} className="opacity-40" />
                  <div className="text-sm">{t('silentWatch.selectHint')}</div>
                </div>
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}

function QueueRow({ r, onOpen }: { r: SilentTaskRow; onOpen: () => void }) {
  const { t } = useTranslation();
  const dur = useSilentDuration();
  return (
    <div
      className="w-full text-left px-4 py-2.5 flex flex-col gap-1 transition-colors cursor-pointer"
      onClick={onOpen}
      data-episode={r.episode_id}
    >
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span className="font-semibold text-sm">{t('silentWatch.silentFor', { dur: dur(r.silent_hours) })}</span>
        <LevelBadge hours={r.level_hours} />
        <GroupBadge group={r.group_code} />
        {!r.located.has_fix && (
          <span className="inline-flex items-center gap-1 text-xs text-warning-fg"><MapPinOff size={12} />{t('silentWatch.neverLocatedShort')}</span>
        )}
        {r.customer_episode_count > 1 && (
          <span className="text-xs text-danger-fg font-medium">{t('silentWatch.silentBefore', { n: r.customer_episode_count })}</span>
        )}
        {r.is_test_data && <TestDataBadge />}
      </div>
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <EntityCodeLink to={`/admin/contracts/search/${r.contract.id}`} code={r.contract.code} stopPropagation className="font-mono shrink-0" />
        <span className="truncate">{r.customer.name ?? '—'}</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-subtle min-w-0">
        <span className="truncate">{r.device.product_name ?? '—'}</span>
        <span className="shrink-0">· {r.branch.name} · {r.company.name}</span>
      </div>
      {(r.contract.next_due_date || r.contract.overdue_days > 0) && (
        <div className="flex items-center gap-2 text-xs text-subtle flex-wrap">
          {r.contract.next_due_date && (
            <span>{t('silentWatch.nextDueShort')} <DateTime value={r.contract.next_due_date} showTime={false} /></span>
          )}
          {r.contract.overdue_days > 0 && <span className="text-danger-fg">{t('silentWatch.overdueDays', { n: r.contract.overdue_days })}</span>}
        </div>
      )}
      {/* Check state on its own line, read left to right like the rest of the row. */}
      <div className="flex items-center gap-1.5 text-xs text-subtle flex-wrap">
        {r.closed ? (
          <>
            <span>{t(`silentWatch.closeReason.${r.closed.reason_code}`)}</span>
            <DateTime value={r.closed.at} showTime />
          </>
        ) : r.check.count === 0 ? (
          <span className="text-warning-fg font-medium">{t('silentWatch.unchecked')}</span>
        ) : (
          <>
            <span>{t('silentWatch.lastCheck')}</span>
            {r.check.last_result_code && <ResultBadge code={r.check.last_result_code} />}
            {r.check.last_checked_at && <DateTime value={r.check.last_checked_at} showTime />}
            {r.check.last_checked_by_username && <span>· {r.check.last_checked_by_username}</span>}
          </>
        )}
      </div>
    </div>
  );
}
