import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTable, Select, Badge, Tooltip,
  Button, Checkbox, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowRightFromLine, ArrowLeft, Search, X, MapPin, Star, AlertTriangle, Clock,
  ExternalLink, CheckCircle, Loader2,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { SearchInput } from '../../components/SearchInput';
import { fmtCurrency } from '../../lib/format';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import {
  fetchRepoPool, repoFocusAdd, repoFocusRemove, repoFocusAddMany,
  type RepoPoolRow, type DunningStatus,
} from './repoApi';
import { RepoDetailPanel } from './RepoDetailPanel';

const STATUS_TABS: Array<{ value: DunningStatus; labelKey: string }> = [
  { value: 'WAIT_FOR_REPO', labelKey: 'repo.pool.tabRepo' },
  { value: 'WAIT_FOR_LEGAL', labelKey: 'repo.pool.tabLegal' },
];

// "Jobs I picked up" is a lens on the same view, not a third status — a picked-up
// job is still waiting for repo or for legal.
const MINE_LENS = 'mine';

// "Movement" lenses — how the repo team actually triages (not by debt size).
const LENS_OPTIONS = [
  { value: '', labelKey: 'repo.pool.lensAll' },
  { value: MINE_LENS, labelKey: 'repo.pool.lensMine' },     // on_focus=is.true
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

  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [status, setStatus] = useState<DunningStatus>('WAIT_FOR_REPO');
  const [lens, setLens] = useState<string>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // Contracts ticked for a bulk pick-up. Cleared whenever the list changes
  // underneath, so a tick can never apply to a row the user can no longer see.
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [focusBusy, setFocusBusy] = useState(false);

  // Build the PostgREST query from status + lens + search. Area filtering by
  // *_code (typeahead) is deferred to the map screen; here we keep the movement
  // lenses + a free-text customer/code search.
  const params = (() => {
    const p: string[] = [`dunning_status=eq.${status}`, 'limit=100'];
    let order = 'days_waiting.desc';
    if (lens === MINE_LENS) p.push('on_focus=is.true');
    else if (lens === 'never') p.push('never_actioned=is.true');
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

  // A tick only means anything for a row still on screen.
  const visibleIds = new Set(rows.map((r) => r.contract_id));
  const pickedVisible = [...picked].filter((id) => visibleIds.has(id));


  const selectRow = (id: number, goTo?: (p: string) => void) => {
    navigate(`/admin/repo/pool/${id}`);
    goTo?.('detail');
  };

  const invalidatePool = () => {
    queryClient.invalidateQueries({ queryKey: ['repo', 'pool'] });
    queryClient.invalidateQueries({ queryKey: ['repo', 'detail'] });
    queryClient.invalidateQueries({ queryKey: ['repo', 'actions'] });
  };

  const ok = (message: string) => addSnackbar({
    message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{message}</span></div>,
    type: 'success',
  });
  const fail = (message: string) => addSnackbar({
    message: <div className="alert alert-danger"><AlertTriangle size={16} /><span className="alert-description">{message}</span></div>,
    type: 'error',
  });
  const failFrom = (err: unknown) => fail(err instanceof ApiError ? translateApiError(err, t) : t('common.error'));

  // One row's star. Picking a job up is not a lock — several agents may hold the
  // same one — so this never checks who else has it.
  const toggleOne = async (contractId: number, add: boolean) => {
    setFocusBusy(true);
    try {
      if (add) await repoFocusAdd(contractId);
      else await repoFocusRemove(contractId);
      invalidatePool();
      ok(add ? t('repo.focus.added') : t('repo.focus.removed'));
    } catch (err) {
      failFrom(err);
    } finally {
      setFocusBusy(false);
    }
  };

  // Many rows in ONE call — ops_repo_focus_add_many, never a loop. It doesn't
  // reject when some contracts aren't the caller's, so the result has to be read
  // and reported: "picked up X of Y".
  const pickUpSelected = async () => {
    const ids = [...picked];
    if (ids.length === 0) return;
    setFocusBusy(true);
    try {
      const res = await repoFocusAddMany(ids);
      setPicked(new Set());
      invalidatePool();
      if (res.skipped_no_access > 0) {
        fail(t('repo.focus.addManyPartial', { added: res.added, requested: res.requested }));
      } else {
        ok(t('repo.focus.addManyDone', { added: res.added }));
      }
    } catch (err) {
      failFrom(err);
    } finally {
      setFocusBusy(false);
    }
  };

  const togglePick = (contractId: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(contractId)) next.delete(contractId);
      else next.add(contractId);
      return next;
    });
  };

  const selectedRow = rows.find((r) => r.contract_id === selectedId) ?? null;
  const detailTitle = selectedRow?.contract_code_display ?? t('repo.pool.title');

  return (
    <PageNav panels={['list', 'detail']} defaultPanel={selectedId ? 'detail' : undefined} className="h-dvh overflow-hidden">
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

              {/* Bulk pick-up — only once something is ticked, so the rail stays
                  quiet in normal use. */}
              {pickedVisible.length > 0 && (
                <div className="flex-none px-2 py-1.5 border-b border-line flex items-center gap-2 bg-surface">
                  <span className="text-xs text-subtle">
                    {t('repo.focus.selectedCount', { count: pickedVisible.length })}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())} disabled={focusBusy}>
                      {t('common.clear')}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      startIcon={focusBusy ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} />}
                      disabled={focusBusy}
                      onClick={pickUpSelected}
                    >
                      {t('repo.focus.addSelected')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Worklist */}
              <DataTable<RepoPoolRow>
                data={rows}
                getRowProps={(row) => ({ 'data-state': selectedId === row.original.contract_id ? 'selected' : undefined })}
                enableKeyboardNav={!isMobile}
                onRowActivate={(row) => selectRow(row.original.contract_id)}
                renderRow={(row) => {
                  const r = row.original;
                  return (
                    <div
                      key={r.contract_id}
                      className="w-full text-left px-4 py-3 flex flex-col gap-1 transition-colors cursor-pointer"
                      onClick={() => selectRow(r.contract_id, isMobile ? goTo : undefined)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Ticking a row must not also open it. */}
                        <span onClick={(e) => e.stopPropagation()} className="shrink-0 flex items-center">
                          <Checkbox
                            checked={picked.has(r.contract_id)}
                            onChange={() => togglePick(r.contract_id)}
                            aria-label={t('repo.focus.select')}
                          />
                        </span>
                        <Tooltip content={t('repo.pool.openContract')} placement="top">
                          <button
                            type="button"
                            className="font-mono text-sm font-medium truncate text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); navigate(`/admin/contracts/search/${r.contract_id}`); }}
                          >
                            {r.contract_code_display}
                            <ExternalLink size={12} className="shrink-0" />
                          </button>
                        </Tooltip>
                        {r.never_actioned && <Badge color="danger" size="xs">{t('repo.pool.neverBadge')}</Badge>}
                        {r.is_unclaimed && <Badge color="warning" size="xs">{t('repo.pool.unclaimedBadge')}</Badge>}
                        <Tooltip content={r.on_focus ? t('repo.focus.remove') : t('repo.focus.add')} placement="top">
                          <button
                            type="button"
                            className="shrink-0 bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-current disabled:cursor-not-allowed"
                            disabled={focusBusy}
                            aria-label={r.on_focus ? t('repo.focus.remove') : t('repo.focus.add')}
                            onClick={(e) => { e.stopPropagation(); toggleOne(r.contract_id, !r.on_focus); }}
                          >
                            {/* Filled = picked up, plain outline = not yet. A crossed-out
                                star here read as "you may not pick this up", which is wrong —
                                anyone may, and several people can hold the same job. */}
                            <Star
                              size={14}
                              className={r.on_focus ? 'text-primary-fg' : 'text-subtler'}
                              fill={r.on_focus ? 'currentColor' : 'none'}
                            />
                          </button>
                        </Tooltip>
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
                    </div>
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
