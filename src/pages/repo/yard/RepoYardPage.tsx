// ลานงานยึด — the repo pool as a picture for the repo team (UI_SUMMARY 168 · IMPLEMENT
// 2026-11-15 repo_yard). A view of the same pool as the list (v_repo_pool): which jobs are
// new, which nobody has picked, which are easy to find (located / MDM still answering), and
// which shop each came from. Tap a person → the job's card with its actions.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, MobileHeader, PageNav, PageNavPanel, PopOver, Tooltip } from 'tsp-form';
import { AlertTriangle, ArrowRightFromLine, CircleHelp, Lock, MapPin, Maximize2, Minimize2, RefreshCw, Sparkles } from 'lucide-react';
import { EntityCodeLink } from '../../../components/EntityCodeLink';
import { SimWindow } from '../../simulation/SimWindow';
import { useWindowStack } from '../../simulation/useWindowStack';
import { QueueSheet } from '../../call-center/queue/QueueSheet';
import '../../simulation/simulation.css';
import '../../call-center/queue/queue.css';
import './yard.css';
import { useRepoYard, type YardData, type YardJob } from './yardApi';
import { YardScene, type YardSceneHandle } from './YardScene';
import { YardCard } from './YardCard';
import { UpdatedStatus } from '../../call-center/queue/UpdatedStatus';
import { BAND_TONE, LANE_TONE } from './yardWorld';

const WIDE = '(min-width: 1024px)';
/** One colour per shop, in the order the RPC lists them (most jobs first). */
const SHOP_COLORS = ['#b91c1c', '#1d4ed8', '#b45309', '#7c3aed', '#0f766e', '#be185d', '#4d7c0f', '#0369a1', '#a16207', '#6d28d9'];

export function RepoYardPage() {
  const { t } = useTranslation();
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
              <div className="mobile-header-title mobile-header-title-truncate">{t('repoYard.title')}</div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}
          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 flex flex-col">
              <RepoYardView />
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}

function RepoYardView() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sceneRef = useRef<YardSceneHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stack = useWindowStack();

  const [companyId, setCompanyId] = useState<number | null>(null);
  const [branchId, setBranchId] = useState<number | null>(null);
  const { data, error, isFetching, isLoading, dataUpdatedAt, refetch } = useRepoYard(companyId, branchId);

  // The company list comes from the all-companies answer (the filtered one lists only itself);
  // the shop list from the answer before a shop is picked.
  const companiesRef = useRef<YardData['companies']>([]);
  const branchesRef = useRef<{ key: string; list: YardData['branches'] }>({ key: '', list: [] });
  if (data && companyId == null && branchId == null) companiesRef.current = data.companies;
  if (data && branchId == null) branchesRef.current = { key: String(companyId), list: data.branches };
  const companies = companiesRef.current;
  const branches = useMemo(
    () => (branchesRef.current.key === String(companyId) ? branchesRef.current.list : (data?.branches ?? [])),
    [data, companyId],
  );
  const colorOf = useMemo(() => {
    const m = new Map<number, string>();
    branches.forEach((b, i) => m.set(b.branch_id, SHOP_COLORS[i % SHOP_COLORS.length]));
    return (id: number) => m.get(id) ?? '#52616b';
  }, [branches]);

  const [picked, setPicked] = useState<number | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.body.classList.contains('has-modal-open')) return;
      setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  // The open job — kept after it leaves the yard so the card can say so.
  const lastJob = useRef<YardJob | null>(null);
  const live = picked != null ? data?.jobs.find(j => j.contract_id === picked) ?? null : null;
  if (live) lastJob.current = live;
  const job = live ?? (picked != null && lastJob.current?.contract_id === picked ? lastJob.current : null);
  const pick = (id: number | null) => {
    setPicked(id);
    if (id != null) requestAnimationFrame(() => sceneRef.current?.show(id));
  };
  const blocker = () => {
    const stage = stageRef.current;
    const box = stage?.querySelector<HTMLElement>('.dq-panelbox');
    if (!stage || !box) return null;
    const a = stage.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    return { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height };
  };

  const band = (code: string) => data?.bands.find(b => b.code === code)?.count ?? 0;
  const scopeName = branchId != null
    ? branches.find(b => b.branch_id === branchId)?.name ?? ''
    : companyId != null ? companies.find(c => c.company_id === companyId)?.name ?? '' : t('repoYard.allCompanies');
  const sub = data ? t('repoYard.sub', { n: data.job_count, free: data.free_count, fix: data.with_fix_count }) : '';

  const card = job && (() => {
    const head = (
      <h3 className="dq-title">
        <EntityCodeLink to={`/admin/contracts/search/${job.contract_id}`} code={job.code_display} icon={null} className="font-mono shrink-0" />
        <span className="truncate">{job.customer_name ?? '—'}</span>
      </h3>
    );
    const body = <YardCard job={job} gone={!live} />;
    return wide ? (
      <SimWindow id="repo-yard-job" stack={stack} head={head} headClassName="dq-win-head" onClose={() => setPicked(null)} className="dq-win dq-panelbox">{body}</SimWindow>
    ) : (
      <QueueSheet head={head} onClose={() => setPicked(null)} onResized={() => sceneRef.current?.show(job.contract_id)}>{body}</QueueSheet>
    );
  })();

  return (
    <div className={`dq yd${full ? ' dq--full' : ''}`}>
      <div className="dq-bar">
        <h1 className="heading-3 max-md:hidden shrink-0">{t('repoYard.title')}</h1>
        {/* All companies together, or one company (owner 11-15). */}
        {companies.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('repoYard.companyPick')}>
            <Button size="sm" variant={companyId == null ? 'solid' : 'outline'} color={companyId == null ? 'primary' : 'default'} aria-pressed={companyId == null}
              onClick={() => { setCompanyId(null); setBranchId(null); setPicked(null); }}>
              {t('repoYard.allCompanies')}
            </Button>
            {companies.map(c => (
              <Button key={c.company_id} size="sm" variant={companyId === c.company_id ? 'solid' : 'outline'} color={companyId === c.company_id ? 'primary' : 'default'} aria-pressed={companyId === c.company_id}
                onClick={() => { setCompanyId(c.company_id); setBranchId(null); setPicked(null); }}>
                {c.name} <b className="ml-1">{c.count}</b>
              </Button>
            ))}
          </div>
        )}
        <Tooltip content={full ? t('dunningQueue.exitFullHint') : t('dunningQueue.fullHint')}>
          <Button size="sm" variant={full ? 'solid' : 'outline'} color={full ? 'primary' : 'default'} aria-pressed={full}
            startIcon={full ? <Minimize2 size={14} /> : <Maximize2 size={14} />} onClick={() => setFull(v => !v)}>
            {full ? t('dunningQueue.exitFull') : t('dunningQueue.full')}
          </Button>
        </Tooltip>
        <PopOver
          isOpen={legendOpen}
          onClose={() => setLegendOpen(false)}
          placement="bottom"
          align="end"
          trigger={<Button size="sm" variant="ghost" startIcon={<CircleHelp size={14} />} onClick={() => setLegendOpen(v => !v)}>{t('dunningQueue.legend')}</Button>}
        >
          <div className="dq-legend">
            <div>{t('repoYard.legend.overHead')}</div>
            <div>{t('repoYard.legend.red')}</div>
            <div><b className="dq-ring" style={{ borderColor: '#16a34a' }} />{t('repoYard.legend.mine')}<b className="dq-ring" style={{ borderColor: '#64748b' }} />{t('repoYard.legend.others')}</div>
            <div><i className="dq-tag-repo" style={{ background: BAND_TONE.NEW }}><Sparkles size={9} /></i>{t('repoYard.band.NEW', { d: data?.rules.new_days ?? 0 })}<i className="dq-tag-repo" style={{ background: LANE_TONE.FIX_RECENT }}><MapPin size={9} /></i>{t('repoYard.markFix')}<i className="dq-tag-repo" style={{ background: '#dc2626' }}><Lock size={9} /></i>{t('repoYard.markLocked')}</div>
            <div>{t('repoYard.legend.attempts')}</div>
            <div>{t('repoYard.legend.lanes')}</div>
          </div>
        </PopOver>
        <UpdatedStatus
          error={!!error}
          fetching={isFetching}
          updatedAt={dataUpdatedAt}
          extra={(
            <Tooltip content={t('silentWatch.reload')}>
              <Button size="sm" variant="ghost" aria-label={t('silentWatch.reload')} startIcon={<RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />}
                onClick={() => { void refetch(); void qc.invalidateQueries({ queryKey: ['repo', 'actions'] }); }} />
            </Tooltip>
          )}
        />
      </div>

      {/* Counts of what is on screen — the RPC's numbers — and the shops the jobs came from (tap = only that shop). */}
      {data && (
        <div className="dq-chips">
          <span className="dq-total"><b>{t('repoYard.jobsN', { n: data.job_count })}</b></span>
          <span className="yd-count">{t('repoYard.band.NEW', { d: data.rules.new_days })} <b>{band('NEW')}</b></span>
          <span className="yd-count text-danger-fg">{t('repoYard.nobodyPicked')} <b>{data.free_count}</b></span>
          <span className="yd-count">{t('repoYard.pickedN')} <b>{data.picked_count}</b></span>
          <span className="yd-count">{t('repoYard.band.WORKED')} <b>{band('WORKED')}</b></span>
          <span className="yd-count">{t('repoYard.withFix')} <b>{data.with_fix_count}</b></span>
          <span className="yd-count text-subtle">{t('repoYard.bySystem')} <b>{data.sent_by_system_count}</b></span>
        </div>
      )}
      {branches.length > 0 && (
        <div className="dq-chips" role="group" aria-label={t('repoYard.shops')}>
          <span className="text-sm text-subtle">{t('repoYard.shops')}</span>
          {branches.map(b => (
            <Button key={b.branch_id} size="sm" variant={branchId === b.branch_id ? 'solid' : 'outline'} color={branchId === b.branch_id ? 'primary' : 'default'} aria-pressed={branchId === b.branch_id}
              startIcon={<i className="dq-swatch" style={{ background: colorOf(b.branch_id) }} />}
              onClick={() => { setBranchId(cur => (cur === b.branch_id ? null : b.branch_id)); setPicked(null); }}>
              {b.name} <b>{b.count}</b>
            </Button>
          ))}
        </div>
      )}

      <div className="dq-stage" ref={stageRef}>
        {data && (
          <YardScene
            ref={sceneRef}
            sceneKey={`${companyId ?? 'all'}|${branchId ?? 'all'}`}
            data={data}
            title={`${t('repoYard.title')} · ${scopeName}`}
            sub={sub}
            branchColor={colorOf}
            picked={picked}
            onPick={pick}
            blocker={blocker}
          />
        )}
        {isLoading && <div className="dq-empty">{t('common.loading')}</div>}
        {data && data.job_count === 0 && <div className="dq-empty dq-empty--yay yd-empty">{t('repoYard.empty')}</div>}
        {!data && error && <div className="dq-empty"><div className="alert alert-danger"><AlertTriangle size={16} /><span>{t('repoYard.loadFailed')}</span></div></div>}
        {card}
      </div>
    </div>
  );
}
