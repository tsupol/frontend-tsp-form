import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTable, Select, Badge, Tooltip,
} from 'tsp-form';
import {
  ArrowRightFromLine, ArrowLeft, Search, X, MapPin, Star, AlertTriangle, Clock,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { SearchInput } from '../../components/SearchInput';
import { fmtCurrency } from '../../lib/format';
import { fetchRepoPool, type RepoPoolRow, type DunningStatus } from './repoApi';
import { RepoDetailPanel } from './RepoDetailPanel';

const STATUS_TABS: Array<{ value: DunningStatus; labelKey: string }> = [
  { value: 'WAIT_FOR_REPO', labelKey: 'repo.pool.tabRepo' },
  { value: 'WAIT_FOR_LEGAL', labelKey: 'repo.pool.tabLegal' },
];

// "Movement" lenses — how the repo team actually triages (not by debt size).
const LENS_OPTIONS = [
  { value: '', labelKey: 'repo.pool.lensAll' },
  { value: 'never', labelKey: 'repo.pool.lensNever' },      // never_actioned=is.true
  { value: 'unclaimed', labelKey: 'repo.pool.lensUnclaimed' }, // is_unclaimed=is.true
  { value: 'stale', labelKey: 'repo.pool.lensStale' },      // order last_action_at.asc.nullsfirst
  { value: 'nogeo', labelKey: 'repo.pool.lensNoGeo' },      // province_code=is.null
];

export function RepoPoolPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { contractId: contractIdParam } = useParams();
  const selectedId = contractIdParam ? Number(contractIdParam) : null;

  const [status, setStatus] = useState<DunningStatus>('WAIT_FOR_REPO');
  const [lens, setLens] = useState<string>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Build the PostgREST query from status + lens + search. Area filtering by
  // *_code (typeahead) is deferred to the map screen; here we keep the movement
  // lenses + a free-text customer/code search.
  const params = (() => {
    const p: string[] = [`dunning_status=eq.${status}`, 'limit=100'];
    let order = 'days_waiting.desc';
    if (lens === 'never') p.push('never_actioned=is.true');
    else if (lens === 'unclaimed') p.push('is_unclaimed=is.true');
    else if (lens === 'stale') order = 'last_action_at.asc.nullsfirst';
    else if (lens === 'nogeo') p.push('province_code=is.null');
    if (search.trim()) {
      const term = search.trim();
      // customer name OR contract code — PostgREST or=()
      p.push(`or=(customer_name.ilike.*${term}*,contract_code_display.ilike.*${term}*)`);
    }
    p.push(`order=${order}`);
    return p.join('&');
  })();

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['repo', 'pool', status, lens, search],
    queryFn: () => fetchRepoPool(params),
    staleTime: 15_000,
  });


  const selectRow = (id: number, goTo?: (p: string) => void) => {
    navigate(`/admin/repo/pool/${id}`);
    goTo?.('detail');
  };

  const selectedRow = rows.find((r) => r.contract_id === selectedId) ?? null;
  const detailTitle = selectedRow?.contract_code_display ?? t('repo.pool.title');

  return (
    <PageNav panels={['list', 'detail']} defaultPanel={selectedId ? 'detail' : undefined} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" aria-label="Open menu" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={goBack}>
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('repo.pool.title') : detailTitle}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('repo.pool.title')}</h1>
              <span className="text-sm text-subtle">{t('repo.pool.count', { count: rows.length })}</span>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              {/* Filters */}
              <div className="flex-none p-2 border-b border-line flex items-center gap-2">
                <SearchInput
                  value={searchInput}
                  onChange={setSearchInput}
                  onDebouncedChange={setSearch}
                  placeholder={t('repo.pool.searchPlaceholder')}
                  size="sm"
                  className="w-full flex-1 min-w-0"
                  startIcon={<Search size={14} />}
                  endIcon={searchInput ? <X size={14} /> : undefined}
                  onEndIconClick={searchInput ? () => { setSearchInput(''); setSearch(''); } : undefined}
                />
                <div style={{ width: '11rem' }} className="shrink-0">
                  <Select
                    value={lens || null}
                    onChange={(v) => setLens((v as string) ?? '')}
                    options={LENS_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                    size="sm"
                    showChevron
                    clearable
                    placeholder={t('repo.pool.lensAll')}
                  />
                </div>
              </div>

              {/* Status tabs */}
              <div className="flex-none flex items-center border-b border-line">
                {STATUS_TABS.map((s) => (
                  <button
                    key={s.value}
                    className={`flex-1 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
                      status === s.value ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
                    }`}
                    onClick={() => setStatus(s.value)}
                  >
                    {t(s.labelKey)}
                  </button>
                ))}
              </div>

              {/* Worklist */}
              <DataTable<RepoPoolRow>
                data={rows}
                getRowProps={(row) => ({ 'data-state': selectedId === row.original.contract_id ? 'selected' : undefined })}
                renderRow={(row) => {
                  const r = row.original;
                  return (
                    <button
                      key={r.contract_id}
                      className="w-full text-left px-4 py-3 flex flex-col gap-1 transition-colors cursor-pointer"
                      onClick={() => selectRow(r.contract_id, isMobile ? goTo : undefined)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-sm font-medium truncate">{r.contract_code_display}</span>
                        {r.never_actioned && <Badge color="danger" size="xs">{t('repo.pool.neverBadge')}</Badge>}
                        {r.is_unclaimed && <Badge color="warning" size="xs">{t('repo.pool.unclaimedBadge')}</Badge>}
                        {r.on_focus && <Star size={13} className="text-primary-fg shrink-0" />}
                        <span className="ml-auto text-sm font-medium tabular-nums shrink-0">{fmtCurrency(r.outstanding)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-subtle min-w-0">
                        <span className="truncate">
                          {r.customer_name ?? '—'}
                          {r.address_display && <> · <span className="text-subtler">{r.address_display}</span></>}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-subtler">
                        <span className="inline-flex items-center gap-1"><Clock size={11} />{t('repo.pool.daysWaiting', { days: r.days_waiting })}</span>
                        {r.attempt_count > 0 && <span>· {t('repo.pool.attempts', { count: r.attempt_count })}</span>}
                        {r.geo_precision === 'CENTROID' && (
                          <Tooltip content={t('repo.geo.CENTROID')} placement="top">
                            <span className="inline-flex items-center gap-0.5 text-warning-fg"><MapPin size={11} />{t('repo.pool.approxArea')}</span>
                          </Tooltip>
                        )}
                        {r.geo_precision === 'NONE' && (
                          <Tooltip content={t('repo.geo.NONE')} placement="top">
                            <span className="inline-flex items-center gap-0.5"><AlertTriangle size={11} />{t('repo.pool.noGeo')}</span>
                          </Tooltip>
                        )}
                        {r.last_action_at && <span className="ml-auto"><DateTime value={r.last_action_at} showTime={false} /></span>}
                      </div>
                    </button>
                  );
                }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={<div className="p-8 text-center text-subtler">{t('repo.pool.empty')}</div>}
              />
            </PageNavPanel>

            <PageNavPanel id="detail" className="flex-1 min-h-0 flex flex-col">
              {selectedId ? (
                <RepoDetailPanel
                  key={selectedId}
                  contractId={selectedId}
                  isMobile={isMobile}
                  onChanged={() => { /* pool query keyed on filters refetches on focus/status change */ }}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-subtler gap-2">
                  <MapPin size={32} className="opacity-40" />
                  <div className="text-sm">{t('repo.pool.selectHint')}</div>
                </div>
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}
