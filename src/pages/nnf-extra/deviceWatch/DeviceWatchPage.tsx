// เฝ้าเครื่อง — one picture of silent devices (UI 163) and devices stuck in Lost Mode
// (UI 164), UI_SUMMARY 165 · IMPLEMENT 2026-11-13 device_watch_scene. A third view next to
// the two lists, not a replacement: tap a person → a card; silent ones can be checked
// right there (fn_silent_check_log), and a checked person stays in the picture.
//
// Every staff member may open it (owner 11-13): without `can_view` the picture is the
// stuck-Lost-Mode plaza alone and fn_silent_task_list is never called (163 §2 — never
// can() / hasPermission).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, MobileHeader, PageNav, PageNavPanel, PopOver, Select, Tooltip } from 'tsp-form';
import {
  AlertTriangle, ArrowRightFromLine, Check, CheckCircle2, CircleHelp, ExternalLink, Lock, MapPinOff, Maximize2, Minimize2, RefreshCw,
} from 'lucide-react';
import { DateTime } from '../../../components/DateTime';
import { EntityCodeLink } from '../../../components/EntityCodeLink';
import { SimWindow } from '../../simulation/SimWindow';
import { useWindowStack } from '../../simulation/useWindowStack';
import { QueueSheet } from '../../call-center/queue/QueueSheet';
import '../../simulation/simulation.css';
import '../../call-center/queue/queue.css';
import './watch.css';
import { useSilentWatchCan, type SilentTaskRow } from '../silentWatch/silentWatchApi';
import { SilentDetailPanel } from '../silentWatch/SilentDetailPanel';
import { useLostModeStuckList, type LostModeStuckRow } from '../lostModeStuckApi';
import { StuckRow } from '../LostModeStuckPage';
import { useWatchSilent, WATCH_POLL_MS } from './deviceWatchApi';
import { WatchScene, type WatchPick, type WatchSceneHandle } from './WatchScene';
import { STUCK_RING, TASK_RING, isStaffLock } from './watchWorld';

const BRANCH_KEY = 'deviceWatch.branch';
const WIDE = '(min-width: 1024px)';
const readKey = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const saveKey = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };

export function DeviceWatchPage() {
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
              <div className="mobile-header-title mobile-header-title-truncate">{t('deviceWatch.title')}</div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}
          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 flex flex-col">
              <DeviceWatchView />
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}

function DeviceWatchView() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sceneRef = useRef<WatchSceneHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stack = useWindowStack();

  const canQ = useSilentWatchCan();
  const canView = canQ.data?.can_view === true;
  const silentQ = useWatchSilent(canView);
  const stuckQ = useLostModeStuckList({ poll: WATCH_POLL_MS });

  const [branchSel, setBranchSel] = useState(() => readKey(BRANCH_KEY));
  const [picked, setPicked] = useState<WatchPick>(null);
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

  const allSilent = useMemo(() => (canView ? silentQ.data?.items ?? [] : []), [canView, silentQ.data]);
  const allStuck = useMemo(() => stuckQ.data?.items ?? [], [stuckQ.data]);

  // Branches in the picture, from the rows themselves (a stuck row may hide its branch: id null).
  const branches = useMemo(() => {
    const m = new Map<number, { id: number; label: string; n: number }>();
    const add = (id: number | null, name: string | null, company: string) => {
      if (id == null) return;
      const b = m.get(id) ?? { id, label: `${name ?? '—'} · ${company}`, n: 0 };
      b.n++;
      m.set(id, b);
    };
    allSilent.forEach(r => add(r.branch.id, r.branch.name, r.company.name));
    allStuck.forEach(r => add(r.branch.id, r.branch.name, r.company.name));
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [allSilent, allStuck]);
  const branchId = branches.some(b => String(b.id) === branchSel) ? Number(branchSel) : null;
  const silent = useMemo(() => (branchId == null ? allSilent : allSilent.filter(r => r.branch.id === branchId)), [allSilent, branchId]);
  const stuck = useMemo(() => (branchId == null ? allStuck : allStuck.filter(r => r.branch.id === branchId)), [allStuck, branchId]);

  const thr = silentQ.data?.thresholds ?? null;
  const levels = useMemo(() => (canView && thr ? thr.levels_hours : null), [canView, thr]);
  const taskDays = thr ? { pre: thr.task_hours_pre_first_due / 24, paying: thr.task_hours_paying / 24 } : null;

  // Counts of what is on screen.
  const sys = stuck.filter(r => !isStaffLock(r)).length;
  const tasks = silent.filter(r => r.in_pool);
  const unchecked = tasks.filter(r => r.check.count === 0).length;
  const neverTask = tasks.filter(r => !r.located.has_fix).length;
  const branchName = branchId == null ? t('deviceWatch.allBranches') : branches.find(b => b.id === branchId)?.label ?? '';
  const sub = canView
    ? t('deviceWatch.subAll', { stuck: stuck.length, silent: silent.length, tasks: tasks.length })
    : t('deviceWatch.subStuck', { stuck: stuck.length });

  // The open person — kept after they leave the picture so the card can say so.
  const lastSilent = useRef<SilentTaskRow | null>(null);
  const lastStuck = useRef<LostModeStuckRow | null>(null);
  const liveSilent = picked?.kind === 'silent' ? allSilent.find(r => r.episode_id === picked.id) ?? null : null;
  const liveStuck = picked?.kind === 'stuck' ? allStuck.find(r => r.asset_id === picked.id) ?? null : null;
  if (liveSilent) lastSilent.current = liveSilent;
  if (liveStuck) lastStuck.current = liveStuck;
  const silentRow = picked?.kind === 'silent' ? liveSilent ?? (lastSilent.current?.episode_id === picked.id ? lastSilent.current : null) : null;
  const stuckRow = picked?.kind === 'stuck' ? liveStuck ?? (lastStuck.current?.asset_id === picked.id ? lastStuck.current : null) : null;

  const pick = (p: WatchPick) => {
    setPicked(p);
    if (p) requestAnimationFrame(() => sceneRef.current?.show(p));
  };
  const blocker = () => {
    const stage = stageRef.current;
    const box = stage?.querySelector<HTMLElement>('.dq-panelbox');
    if (!stage || !box) return null;
    const a = stage.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    return { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height };
  };

  const loading = stuckQ.isLoading || canQ.isLoading || (canView && silentQ.isLoading);
  const failed = stuckQ.isError || (canView && silentQ.isError);
  const updatedAt = Math.max(stuckQ.dataUpdatedAt, canView ? silentQ.dataUpdatedAt : 0);
  const fetching = stuckQ.isFetching || silentQ.isFetching;
  const refresh = () => {
    void stuckQ.refetch();
    if (canView) void silentQ.refetch();
    void qc.invalidateQueries({ queryKey: ['nav', 'counters'] });
  };
  const empty = !loading && !failed && stuck.length === 0 && silent.length === 0;

  // ── Card ──
  const card = (() => {
    if (picked?.kind === 'silent' && silentRow) {
      const head = (
        <h3 className="dq-title">
          <EntityCodeLink to={`/admin/contracts/search/${silentRow.contract.id}`} code={silentRow.contract.code} icon={null} className="font-mono shrink-0" />
          <span className="truncate">{silentRow.customer.name ?? '—'}</span>
          <Tooltip content={t('silentWatch.reload')}>
            <Button size="sm" variant="ghost" aria-label={t('silentWatch.reload')} startIcon={<RefreshCw size={14} />}
              onClick={() => void qc.invalidateQueries({ queryKey: ['silent-watch', 'detail', silentRow.episode_id] })} />
          </Tooltip>
        </h3>
      );
      const body = (
        <div className="flex flex-col gap-3">
          {!liveSilent && <div className="alert alert-success"><CheckCircle2 size={16} /><span className="alert-description">{t('deviceWatch.silentGone')}</span></div>}
          <SilentDetailPanel episodeId={silentRow.episode_id} embedded />
        </div>
      );
      return { head, body, id: silentRow.episode_id };
    }
    if (picked?.kind === 'stuck' && stuckRow) {
      const head = (
        <h3 className="dq-title">
          <Lock size={14} className="text-danger-fg shrink-0" />
          <EntityCodeLink to={`/admin/contracts/search/${stuckRow.contract.id}`} code={stuckRow.contract.code} icon={null} className="font-mono shrink-0" />
          <span className="truncate">{stuckRow.customer.name ?? '—'}</span>
        </h3>
      );
      const body = (
        <div className="flex flex-col gap-3">
          {!liveStuck && <div className="alert alert-success"><CheckCircle2 size={16} /><span className="alert-description">{t('lostModeStuck.focusGone')}</span></div>}
          <div className="-mx-3"><StuckRow r={stuckRow} /></div>
        </div>
      );
      return { head, body, id: stuckRow.asset_id };
    }
    return null;
  })();

  return (
    <div className={`dq dw${full ? ' dq--full' : ''}`}>
      <div className="dq-bar">
        <h1 className="heading-3 max-md:hidden shrink-0">{t('deviceWatch.title')}</h1>
        {branches.length > 1 && (
          <div className="w-60">
            <Select
              size="sm"
              options={branches.map(b => ({ value: String(b.id), label: `${b.label} · ${t('deviceWatch.peopleN', { n: b.n })}` }))}
              value={branchSel && branchId != null ? branchSel : null}
              onChange={(v) => { const s = (v as string) ?? ''; setBranchSel(s); saveKey(BRANCH_KEY, s); setPicked(null); }}
              placeholder={t('deviceWatch.allBranches')}
              clearable
              showChevron
            />
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
            <div>{t('deviceWatch.legend.overHead')}</div>
            <div><b className="dq-ring" style={{ borderColor: STUCK_RING }} />{t('deviceWatch.legend.stuck')}</div>
            {canView && (
              <>
                <div><b className="dq-ring" style={{ borderColor: TASK_RING }} />{t('deviceWatch.legend.task')}</div>
                <div>{t('deviceWatch.legend.faded')}</div>
                <div><i className="dw-mark dw-mark--ok"><Check size={8} strokeWidth={3} /></i>{t('deviceWatch.legend.checked')}</div>
                <div><i className="dw-mark dw-mark--nofix"><MapPinOff size={8} strokeWidth={2.6} /></i>{t('deviceWatch.legend.noFix')}</div>
                <div>{t('deviceWatch.legend.distance')}</div>
              </>
            )}
          </div>
        </PopOver>
        <div className="dq-updated inline-flex items-center gap-2">
          {failed ? (
            <span className="text-warning-fg inline-flex items-center gap-1"><AlertTriangle size={13} />{t('dunningQueue.refreshFailed')}</span>
          ) : updatedAt ? (
            <span className={fetching ? 'opacity-60' : ''}>{t('dunningQueue.updatedAt')} <DateTime value={new Date(updatedAt).toISOString()} /></span>
          ) : null}
          <Tooltip content={t('silentWatch.reload')}>
            <Button size="sm" variant="ghost" aria-label={t('silentWatch.reload')} startIcon={<RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />} onClick={refresh} />
          </Tooltip>
        </div>
      </div>

      {/* Counts of what is on screen; the two lists are one tap away. */}
      <div className="dq-chips">
        <Link to="/admin/nnf-extra/lost-mode-stuck" className="dw-chip dw-chip--stuck"><Lock size={13} />{t('deviceWatch.chip.stuck')} <b>{stuck.length}</b><ExternalLink size={11} /></Link>
        <span className="dw-chip">{t('deviceWatch.stuck.SYSTEM')} <b>{sys}</b></span>
        <span className="dw-chip">{t('deviceWatch.stuck.STAFF')} <b>{stuck.length - sys}</b></span>
        {canView && (
          <>
            <span className="dw-sep" />
            <Link to="/admin/nnf-extra/silent-watch" className="dw-chip">{t('deviceWatch.chip.silent')} <b>{silent.length}</b><ExternalLink size={11} /></Link>
            <span className="dw-chip dw-chip--task">{t('deviceWatch.chip.tasks')} <b>{tasks.length}</b></span>
            {unchecked > 0 && <span className="dw-chip dw-chip--warn">{t('deviceWatch.chip.unchecked')} <b>{unchecked}</b></span>}
            <span className="dw-chip">{t('deviceWatch.chip.watch')} <b>{silent.length - tasks.length}</b></span>
            <span className="dw-chip">{t('deviceWatch.chip.neverFix')} <b>{neverTask}</b></span>
          </>
        )}
      </div>

      <div className="dq-stage" ref={stageRef}>
        {!loading && (
          <WatchScene
            ref={sceneRef}
            sceneKey={`${branchId ?? 'all'}|${canView}`}
            silent={silent}
            stuck={stuck}
            levels={levels}
            taskDays={taskDays}
            title={`${t('deviceWatch.title')} · ${branchName}`}
            sub={sub}
            picked={picked}
            onPick={pick}
            blocker={blocker}
          />
        )}
        {loading && <div className="dq-empty">{t('common.loading')}</div>}
        {empty && <div className="dq-empty dq-empty--yay dw-empty">{canView ? t('deviceWatch.emptyAll') : t('deviceWatch.emptyStuck')}</div>}
        {failed && !allStuck.length && !allSilent.length && (
          <div className="dq-empty"><div className="alert alert-danger"><AlertTriangle size={16} /><span>{t('deviceWatch.loadFailed')}</span></div></div>
        )}

        {card && (wide ? (
          <SimWindow id="device-watch-person" stack={stack} head={card.head} headClassName="dq-win-head" onClose={() => setPicked(null)} className="dq-win dq-panelbox">
            {card.body}
          </SimWindow>
        ) : (
          <QueueSheet head={card.head} onClose={() => setPicked(null)} onResized={() => picked && sceneRef.current?.show(picked)}>{card.body}</QueueSheet>
        ))}
      </div>
    </div>
  );
}
