// แถวทวง — the "queue view" tab of the collector screen (nnf UI_SUMMARY/162 ·
// IMPLEMENT 2026-11-11_dunning_queue). Customers stand in line in front of a counter;
// the head of each line is the one not contacted for the longest. Tap a customer →
// the work panel. Everything is drawn from fn_dunning_queue_live; nothing is
// re-sorted or re-bucketed here.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DataTable, PopOver, Select, Tooltip } from 'tsp-form';
import { AlertTriangle, CircleHelp, Maximize2, Minimize2, Play, Star, Trash2, X } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { situationColor, situationText } from '../../../lib/situation';
import { DateTime } from '../../../components/DateTime';
import { formatDateTime } from '../../../lib/format';
import { QueueScene, type Counter, type SceneHandle } from './QueueScene';
import { honk, PAID_MS, SHOUT_MS, type Fx } from './queueGeom';
import { SHIRT } from './queueWorld';
import { QueuePanel, PanelTitle } from './QueuePanel';
import { QueueSheet } from './QueueSheet';
import { SimWindow } from '../../simulation/SimWindow';
import { useWindowStack } from '../../simulation/useWindowStack';
import '../../simulation/simulation.css';
import {
  LANES, baht, contactLong, queueKey, useDunningQueue,
  type QueueData, type QueueLane, type QueuePerson,
} from './queueApi';
import './queue.css';

const LANE_ORDER: QueueLane[] = [...LANES.map(L => L.lane), 'LONG'];
const FLAG_LEVELS = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'WHITE'] as const;
const FLAG_HEX: Record<string, string> = { RED: '#DC2626', ORANGE: '#F97316', YELLOW: '#EAB308', GREEN: '#16A34A', WHITE: '#9CA3AF' };
const BRANCH_KEY = 'dunningQueue.branch';
/** Same breakpoint as the simulation's windows (SimWindow): from here up they float and can be dragged. */
const WIDE = '(min-width: 1024px)';

const readKey = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const saveKey = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };

export function DunningQueueView({ isMobile }: { isMobile: boolean }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const sceneRef = useRef<SceneHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Supervisor scope. '' = every branch they oversee; collector '' = all together.
  const [branchSel, setBranchSel] = useState(() => readKey(BRANCH_KEY));
  const [collectorSel, setCollectorSel] = useState('');
  const branchId = branchSel ? Number(branchSel) : null;
  const { data, error, isFetching, dataUpdatedAt } = useDunningQueue(branchId);

  const [picked, setPicked] = useState<number | null>(null);
  const [list, setList] = useState<{ kind: 'bin' } | { kind: 'more'; lane: QueueLane } | null>(null);
  const [focusOnly, setFocusOnly] = useState(false);
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [legendOpen, setLegendOpen] = useState(false);
  const [fx, setFx] = useState<Fx[]>([]);
  const fxKey = useRef(0);

  // Wide screen (computer, iPad landscape) → a window you can drag, as in the simulation;
  // narrow (iPad portrait) → a sheet from the bottom with three heights.
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const stack = useWindowStack();

  // Full screen: the queue covers the whole browser window (menus and tabs hidden); Esc or the
  // button brings it back. Esc is left alone while a dialog is open — that Esc closes the dialog.
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.body.classList.contains('has-modal-open')) return;
      setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);
  // Where the panel covers the scene now, so picking a person keeps them out from under it.
  const blocker = () => {
    const stage = stageRef.current;
    const box = stage?.querySelector<HTMLElement>('.dq-panelbox');
    if (!stage || !box) return null;
    const a = stage.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    return { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height };
  };

  const people = useMemo(() => data?.people ?? [], [data]);
  const isOverseer = !!data?.is_overseer;

  // Collectors present in the data — the counter picker (supervisor only).
  const collectors = useMemo(() => {
    const m = new Map<number, { id: number; name: string; n: number }>();
    for (const p of people) {
      const c = m.get(p.collector_id) ?? { id: p.collector_id, name: p.collector_name, n: 0 };
      c.n++;
      m.set(p.collector_id, c);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [people]);
  const collectorId = collectorSel !== '' && collectors.some(c => String(c.id) === collectorSel) ? Number(collectorSel) : null;
  const shown = useMemo(
    () => (collectorId == null ? people : people.filter(p => p.collector_id === collectorId)),
    [people, collectorId],
  );

  const counter: Counter | null = useMemo(() => {
    if (!shown.length) return null;
    const branchName = branchId ? (data?.branches.find(b => b.id === branchId)?.name ?? '') : t('dunningQueue.allBranches');
    const c: Counter = {
      key: `${branchId ?? 'all'}|${collectorId ?? 'all'}|${isOverseer}`,
      id: collectorId ?? (isOverseer ? -1 : (shown[0]?.collector_id ?? -1)),
      name: collectorId != null
        ? (collectors.find(x => x.id === collectorId)?.name || t('dunningQueue.unassigned'))
        : isOverseer ? branchName : (shown[0]?.collector_name || user?.username || ''),
      clerks: collectorId != null ? (collectorId === 0 ? 0 : 1) : new Set(shown.filter(p => p.collector_id !== 0).map(p => p.collector_id)).size,
      people: [], bin: [], amount: 0,
    };
    for (const p of shown) {
      if (p.lane === 'LONG') c.bin.push(p); else c.people.push(p);
      c.amount += p.overdue_amount;
    }
    c.bin.sort((a, b) => a.pos - b.pos);
    return c;
  }, [shown, collectorId, collectors, branchId, data?.branches, isOverseer, user, t]);

  // Filters dim, never remove — lines keep their shape.
  const match = useMemo(() => {
    if (!focusOnly && flags.size === 0) return null;
    return new Set(shown.filter(p => (!focusOnly || p.focused) && (flags.size === 0 || flags.has(p.flag_level))).map(p => p.id));
  }, [shown, focusOnly, flags]);

  // ── Effects (staff only, nothing saved) ──
  const addFx = (f: Omit<Fx, 't0' | 'key'>) => {
    const item: Fx = { ...f, t0: performance.now(), key: ++fxKey.current };
    setFx(cur => [...cur.filter(x => !(x.kind === f.kind && x.id === f.id)), item]);
    window.setTimeout(() => setFx(cur => cur.filter(x => x.key !== item.key)), (f.kind === 'shout' ? SHOUT_MS : PAID_MS) + 100);
  };
  // Left the queue between two refreshes AND the backend says paid in the last
  // 20 minutes → fireworks where they stood. Never guessed from amounts.
  const prevIds = useRef<{ scope: string; ids: Set<number> } | null>(null);
  useEffect(() => {
    if (!data) return;
    const scope = String(branchId);
    const ids = new Set(data.people.map(p => p.id));
    const prev = prevIds.current;
    prevIds.current = { scope, ids };
    if (!prev || prev.scope !== scope) return;
    const paid = new Map(data.paid_recent.map(x => [x.id, x.amount]));
    for (const id of prev.ids) if (!ids.has(id) && paid.has(id)) addFx({ kind: 'paid', id, amount: paid.get(id) });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // The open customer — kept after they leave the queue so the panel can say so.
  const lastPerson = useRef<QueuePerson | null>(null);
  const live = picked != null ? people.find(p => p.id === picked) ?? null : null;
  if (live) lastPerson.current = live;
  const person = live ?? (picked != null && lastPerson.current?.id === picked ? lastPerson.current : null);
  const gone = picked != null && !live;
  const paidAmount = gone ? (data?.paid_recent.find(x => x.id === picked)?.amount ?? null) : null;

  // "Next person": the first one in line order (this line first, then the following lines)
  // who hasn't been opened yet in this sitting. Without the "opened" memory it bounced
  // between the first two of a line whenever nobody logged a result in between.
  // It stays where the person is: someone on the floor leads to the next one on the floor
  // (never into the bin — those people aren't drawn, the scene would show nothing); someone
  // opened from the bin list leads to the next one in the bin. When everyone there has been
  // opened, there is no next (the button greys out) — "Start at the head" begins a new round.
  const opened = useRef(new Set<number>());
  const FLOOR_LANES = LANE_ORDER.filter(l => l !== 'LONG');
  const nextOf = (cur: QueuePerson | null): QueuePerson | null => {
    const pool = shown.filter(p => (!match || match.has(p.id)) && p.id !== cur?.id && !opened.current.has(p.id));
    const lanes = cur?.lane === 'LONG' ? (['LONG'] as QueueLane[]) : FLOOR_LANES;
    const start = cur ? Math.max(0, lanes.indexOf(cur.lane)) : 0;
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[(start + i) % lanes.length];
      const hit = pool.filter(p => p.lane === lane).sort((a, b) => a.pos - b.pos)[0];
      if (hit) return hit;
    }
    return null;
  };
  const next = person ? nextOf(person) : null;
  /** "Start at the head": a new round — forget who was opened, open the first head on the floor. */
  const startRound = () => {
    opened.current.clear();
    const head = nextOf(null);
    if (head) pick(head.id);
  };

  const pick = (id: number | null) => {
    setPicked(id);
    if (id != null) {
      opened.current.add(id);
      setList(null);
      requestAnimationFrame(() => sceneRef.current?.showPerson(id));
    }
  };

  const setFocusLocal = (id: number, on: boolean) => {
    queryClient.setQueryData<QueueData>(queueKey(branchId), old => old && ({
      ...old, people: old.people.map(p => (p.id === id ? { ...p, focused: on } : p)),
    }));
  };

  const tipOf = (p: QueuePerson) => {
    const state = p.lane === 'BROKEN'
      ? t('dunningQueue.brokenDaysN', { n: p.broken_days })
      : p.lane === 'PROMISED'
        ? `${t('dunningQueue.promise')} ${formatDateTime(p.promise_date, i18n.language, false)}`
        : situationText(t, p.situation_code, p.overdue_days);
    return [p.code, p.name, state, baht(p.overdue_amount), contactLong(t, p.contact_hours)];
  };

  // ── Summary numbers: counts of what is on screen (no re-bucketing) ──
  const count = (l: QueueLane) => shown.filter(p => p.lane === l).length;
  const total = shown.reduce((s, p) => s + p.overdue_amount, 0);
  const chats = shown.reduce((s, p) => s + p.chat_unread, 0);
  const focusN = shown.filter(p => p.focused).length;
  const unassignedN = shown.filter(p => p.collector_id === 0).length;

  const listPeople = !list || !counter ? [] : list.kind === 'bin'
    ? counter.bin
    : counter.people.filter(p => p.lane === list.lane).sort((a, b) => a.pos - b.pos).slice(48);

  const branchOptions = (data?.branches ?? []).map(b => ({ value: String(b.id), label: `${b.code} · ${b.name}` }));
  const collectorOptions = collectors.map(c => ({
    value: String(c.id),
    label: `${c.id ? c.name : t('dunningQueue.unassigned')} · ${t('dunningQueue.peopleN', { n: c.n })}`,
  }));

  const canStart = shown.some(p => p.lane !== 'LONG' && (!match || match.has(p.id)));

  return (
    <div className={`dq${full ? ' dq--full' : ''}`}>
      {/* ── Toolbar ── */}
      <div className="dq-bar">
        {isOverseer && (
          <>
            <div className="w-56">
              <Select
                size="sm"
                options={branchOptions}
                value={branchSel || null}
                onChange={(v) => { const s = (v as string) ?? ''; setBranchSel(s); saveKey(BRANCH_KEY, s); setCollectorSel(''); setPicked(null); }}
                placeholder={t('dunningQueue.allBranches')}
                clearable
                showChevron
              />
            </div>
            <div className="w-56">
              <Select
                size="sm"
                options={collectorOptions}
                value={collectorSel || null}
                onChange={(v) => { setCollectorSel((v as string) ?? ''); setPicked(null); }}
                placeholder={t('dunningQueue.allCollectors')}
                clearable
                showChevron
              />
            </div>
          </>
        )}
        <Button
          size="sm"
          color="primary"
          startIcon={<Play size={14} />}
          disabled={!canStart}
          onClick={startRound}
        >
          {t('dunningQueue.start')}
        </Button>
        {/* Toggle filters: the project's chip pattern (PaymentMethodChips) — solid primary when on. */}
        <Button
          size="sm"
          variant={focusOnly ? 'solid' : 'outline'}
          color={focusOnly ? 'primary' : 'default'}
          aria-pressed={focusOnly}
          startIcon={<Star size={14} className={focusOnly ? '' : 'text-warning-fg'} />}
          onClick={() => setFocusOnly(v => !v)}
        >
          {t('dunningQueue.focusOnly')} {focusN}
        </Button>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('dunningQueue.flagFilter')}>
          {FLAG_LEVELS.map(f => {
            const on = flags.has(f);
            return (
              <Button
                key={f}
                size="sm"
                variant={on ? 'solid' : 'outline'}
                color={on ? 'primary' : 'default'}
                aria-pressed={on}
                startIcon={<i className="dq-swatch" style={{ background: FLAG_HEX[f] }} />}
                onClick={() => setFlags(cur => { const n = new Set(cur); if (n.has(f)) n.delete(f); else n.add(f); return n; })}
              >
                {t(`dunningQueue.flagLevel.${f}`)}
              </Button>
            );
          })}
        </div>
        <Tooltip content={full ? t('dunningQueue.exitFullHint') : t('dunningQueue.fullHint')}>
          <Button
            size="sm"
            variant={full ? 'solid' : 'outline'}
            color={full ? 'primary' : 'default'}
            aria-pressed={full}
            startIcon={full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            onClick={() => setFull(v => !v)}
          >
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
            <div><i style={{ background: SHIRT.M }} />{t('dunningQueue.gender.M')}<i style={{ background: SHIRT.F }} />{t('dunningQueue.gender.F')}<i style={{ background: SHIRT[''] }} />{t('dunningQueue.genderNone')}</div>
            <div>{t('dunningQueue.legendRing')}:
              {(['OVERDUE', 'IN_GRACE', 'DUE_TODAY', 'CURRENT'] as const).map(k => (
                <span key={k}><b className="dq-ring" style={{ borderColor: situationColor(k) }} />{t(`situation.${k}`)}</span>
              ))}
            </div>
            <div>{t('dunningQueue.legendHead')}</div>
            <div>{t('dunningQueue.legendFaded')}</div>
            <div>{t('dunningQueue.legendFocus')}</div>
            <div>{t('dunningQueue.legendFlag')}</div>
            <div>{t('dunningQueue.legendBin')}</div>
          </div>
        </PopOver>
        <div className="dq-updated">
          {error ? (
            <span className="text-warning-fg inline-flex items-center gap-1"><AlertTriangle size={13} />{t('dunningQueue.refreshFailed')}</span>
          ) : dataUpdatedAt ? (
            <span className={isFetching ? 'opacity-60' : ''}>{t('dunningQueue.updatedAt')} <DateTime value={new Date(dataUpdatedAt).toISOString()} /></span>
          ) : null}
        </div>
      </div>

      {/* ── Lane chips: counts of what is on screen; tap = pan to that line ── */}
      {counter && (
        <div className="dq-chips">
          <span className="dq-total"><b>{t('dunningQueue.peopleN', { n: shown.length })}</b> · {baht(total)}</span>
          {/* Tap a line's count → the scene pans to that line. */}
          {LANES.map(L => (
            <Button key={L.lane} size="sm" variant="ghost" onClick={() => sceneRef.current?.showLane(L.lane)}>
              <span className="dq-lanecount" style={{ ['--tone' as string]: L.tone }}>{t(`dunningQueue.lane.${L.lane}`)} <b>{count(L.lane)}</b></span>
            </Button>
          ))}
          <Button size="sm" variant="ghost" startIcon={<Trash2 size={14} />} onClick={() => setList(l => (l?.kind === 'bin' ? null : { kind: 'bin' }))}>
            {t('dunningQueue.lane.LONG')} <b className="ml-1">{count('LONG')}</b>
          </Button>
          {chats > 0 && <span className="text-sm text-info-fg px-2">{t('dunningQueue.chatUnread')} <b>{chats}</b></span>}
          {unassignedN > 0 && <span className="text-sm text-danger-fg px-2">{t('dunningQueue.unassigned')} <b>{unassignedN}</b></span>}
        </div>
      )}

      {/* ── Stage ── */}
      <div className="dq-stage" ref={stageRef}>
        {counter && (
          <QueueScene
            ref={sceneRef}
            counter={counter}
            picked={picked}
            match={match}
            fx={fx}
            onPick={pick}
            onBin={() => setList(l => (l?.kind === 'bin' ? null : { kind: 'bin' }))}
            onMore={(lane) => setList({ kind: 'more', lane })}
            tipOf={tipOf}
            blocker={blocker}
          />
        )}
        {!data && !error && <div className="dq-empty">{t('common.loading')}</div>}
        {data && !counter && <div className="dq-empty dq-empty--yay">{t('dunningQueue.emptyYay')}</div>}
        {!data && error && <div className="dq-empty"><div className="alert alert-danger"><AlertTriangle size={16} /><span>{t('dunningQueue.loadFailed')}</span></div></div>}

        {/* Bin / "+N" list */}
        {list && counter && listPeople.length > 0 && (
          <div className="dq-list" onPointerDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
              <b className="text-sm flex-1 min-w-0 truncate">
                {list.kind === 'bin'
                  ? t('dunningQueue.binTitle', { n: counter.bin.length, amount: baht(counter.bin.reduce((s, p) => s + p.overdue_amount, 0)) })
                  : t('dunningQueue.moreTitle', { lane: t(`dunningQueue.lane.${list.lane}`), n: listPeople.length })}
              </b>
              <Button size="sm" variant="ghost" startIcon={<X size={14} />} onClick={() => setList(null)} aria-label={t('common.close')} />
            </div>
            <DataTable<QueuePerson>
              data={listPeople}
              getRowProps={row => ({ 'data-state': row.original.id === picked ? 'selected' : undefined })}
              enableKeyboardNav={!isMobile}
              onRowActivate={row => pick(row.original.id)}
              renderRow={row => {
                const p = row.original;
                return (
                  <button type="button" className="w-full text-left px-3 py-2 cursor-pointer" onClick={() => pick(p.id)}>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{p.code}</span>
                      <span className="truncate flex-1 min-w-0">{p.name}</span>
                      <span className="tabular-nums">{baht(p.overdue_amount)}</span>
                    </div>
                    <div className="text-xs text-subtle flex items-center gap-2">
                      <span>{situationText(t, p.situation_code, p.overdue_days)}</span>
                      <span className={p.contact_hours == null ? 'text-danger-fg' : ''}>{contactLong(t, p.contact_hours)}</span>
                    </div>
                  </button>
                );
              }}
              className="flex-1 min-h-0 panel-datatable"
            />
          </div>
        )}

        {/* Work panel: one title bar (contract · line · name · next) and one scroll area under it. */}
        {person && (() => {
          const title = <PanelTitle person={person} nextLabel={next ? `${next.code} · ${next.name}` : null} onNext={next ? () => pick(next.id) : null} />;
          const content = (
            <QueuePanel
              person={person}
              gone={gone}
              paidAmount={paidAmount}
              branch={data?.branches.find(b => b.id === person.branch_id)}
              onShout={() => { if (!gone) { honk(); addFx({ kind: 'shout', id: person.id }); } }}
              onPaidDemo={() => { if (!gone) addFx({ kind: 'paid', id: person.id, amount: person.overdue_amount }); }}
              onFocusChanged={setFocusLocal}
              isMobile={isMobile}
            />
          );
          return wide ? (
            <SimWindow id="dunning-person" stack={stack} head={title} headClassName="dq-win-head" onClose={() => setPicked(null)} className="dq-win dq-panelbox">
              {content}
            </SimWindow>
          ) : (
            <QueueSheet head={title} onClose={() => setPicked(null)} onResized={() => sceneRef.current?.showPerson(person.id)}>{content}</QueueSheet>
          );
        })()}
      </div>
    </div>
  );
}
