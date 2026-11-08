import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DataTable, MobileHeader, PageNav, PageNavPanel, Skeleton, useSnackbarContext } from 'tsp-form';
import { ArrowRightFromLine, CarFront, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, House, Minus, Plus, X, XCircle } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { DateTime } from '../../components/DateTime';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { useSimulationLive } from './useSimulationLive';
import type { Focus, SceneHandle } from './SimulationScene';
import { useChatters, useCustomers } from './useCustomers';
import { PILE_ICON } from './simulationIcons';
import { SimulationCollection } from './SimulationCollection';
import { HqPoolCard } from './HqPoolCard';
import { SimTile } from './SimTile';
import { HQ_COLOR } from './simulationWorld';
import { flightSvg, type FlightKind } from './simulationFlights';
import {
  AMBER, BLUE, FLOOR, GREEN, PILES, PURPLE, SIMULATION_PERMISSION, SOLD_EDGE,
  ageText, annualAtRate, annualPct, assetOf, baht, bangkokClock, codeOf, companyEdge, downPct, downPctOf, gradeLabel, plainNum, stateColor, stateLabel, termsOf,
  type PileKey, type SimBranch,
} from './simulationTypes';
import './simulation.css';

// Simulation / ภาพจำลอง — UI_SUMMARY/156_SIMULATION.md, work order
// UI_FEEDBACK/2026-11-03_IMPLEMENT_simulation_page.md. Today's dashboard drawn
// as a floor plan. What may be seen is decided ONLY by the RPC's can_see_* flags:
// a hidden figure hides its whole card or line, never a "—" or a 0 (§3).

// Three.js is only worth downloading for the people who open this page.
const SimulationScene = lazy(() => import('./SimulationScene').then(m => ({ default: m.SimulationScene })));

const COMPANY_KEY = 'nnf.simulation.company';
const PANEL_KEY = 'nnf.simulation.panelClosed';
const TABS_KEY = 'nnf.simulation.tabsClosed';
const LEGEND_KEY = 'nnf.simulation.legendClosed';
const LEGEND_STATES = ['DRAFT', 'PENDING_APPROVAL', 'PENDING_SIGN', 'PENDING_PAYMENT'];
const PHONE_QUERY = '(max-width: 743.98px)';

function readCompany(): number | null {
  try {
    const v = localStorage.getItem(COMPANY_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function saveCompany(id: number) {
  try {
    localStorage.setItem(COMPANY_KEY, String(id));
  } catch {
    /* no storage: the page just forgets the company */
  }
}

// Whether a floating part is minimized is this viewer's own convenience, kept per browser.
function useClosed(key: string, initial = false) {
  const [closed, setClosed] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v == null ? initial : v === '1';
    } catch {
      return initial;
    }
  });
  const set = (next: boolean) => {
    setClosed(next);
    try {
      localStorage.setItem(key, next ? '1' : '0');
    } catch {
      /* no storage: it just opens again next time */
    }
  };
  return [closed, set] as const;
}

function useIsPhone() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Kpi({ label, value, unit, sub, sub2, icon }: { label: string; value: ReactNode; unit?: string; sub?: string; sub2?: string; icon?: ReactNode }) {
  return (
    <div className="sim__kpi">
      <label>{icon}{label}</label>
      <strong>{value}{unit && <span> {unit}</span>}</strong>
      {sub && <small>{sub}</small>}
      {sub2 && <small>{sub2}</small>}
    </div>
  );
}

const PILE_SHADE: Record<PileKey, string> = {
  cash: GREEN[1], transfer: BLUE[1], wallet: AMBER[1], other: PURPLE[1], pending_payout: AMBER[1], payout: GREEN[1],
};
/** A legend swatch: a flat colour block (a floor, a stack of folders). */
function Folder({ color, edge }: { color: string; edge?: string }) {
  return <i className="sim__legend-swatch" style={{ background: color, borderColor: edge ?? 'rgba(0,0,0,.25)' }} />;
}

/** A legend swatch: the envelope or bank note that flies (fixed SVG, no data in it). */
function Flight({ k }: { k: FlightKind }) {
  return <span className="sim__legend-flight" dangerouslySetInnerHTML={{ __html: flightSvg(k) }} />;
}

function PileIcon({ k, size = 14 }: { k: PileKey; size?: number }) {
  const Icon = PILE_ICON[k];
  return <Icon size={size} color={PILE_SHADE[k]} className="sim__icon" aria-hidden="true" />;
}

export function SimulationPage() {
  const { t } = useTranslation();
  const { hasPermission, isLoading: permissionsLoading } = useMyPermissions();
  const phone = useIsPhone();
  const allowed = hasPermission(SIMULATION_PERMISSION);

  if (!permissionsLoading && !allowed) return <Navigate to="/admin" replace />;

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
              <div className="mobile-header-title mobile-header-title-truncate">{t('simulation.title')}</div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}
          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0">
              {phone
                ? <div className="h-full flex items-center justify-center p-6 text-center text-subtle">{t('simulation.smallScreen')}</div>
                : <SimulationFloor ready={!permissionsLoading && allowed} isMobile={isMobile} />}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}

// The row scrolls sideways when the companies don't fit. Its edge fades only on a side
// that has more, so a tab cut by the edge reads as "there is more" and not as broken.
function CompanyTabs({ children, activeId, onMinimize }: { children: ReactNode; activeId: number; onMinimize: () => void }) {
  const { t } = useTranslation();
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = () => {
    const el = row.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore(m => (m.left === left && m.right === right ? m : { left, right }));
  };
  useEffect(() => {
    measure();
    const el = row.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    row.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
  }, [activeId]);
  return (
    <div className="sim__card sim__companies-wrap">
      <div ref={row} className="sim__companies hidden-scroll" role="tablist" onScroll={measure}
        onWheel={e => { if (row.current && e.deltaY && !e.deltaX) row.current.scrollLeft += e.deltaY; }}
        style={{ '--sim-fade-left': more.left ? '36px' : '0px', '--sim-fade-right': more.right ? '36px' : '0px' } as CSSProperties}>
        {children}
      </div>
      <button type="button" className="sim__tabs-toggle" aria-label={t('simulation.companiesHide')} aria-expanded onClick={onMinimize}><ChevronLeft size={16} /></button>
    </div>
  );
}

function SimulationFloor({ ready, isMobile }: { ready: boolean; isMobile: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const now = useClock();

  const [company, setCompany] = useState<number | null>(readCompany);
  const [picked, setPicked] = useState<number | null>(null);
  const [collectOf, setCollectOf] = useState<number | null>(null);
  // The company building's room whose card is open (§6h); a shop and a pool card never both.
  const [pickedHq, setPickedHq] = useState<number | null>(null);
  const [legendClosed, setLegendClosed] = useClosed(LEGEND_KEY, true);
  const [panelClosed, setPanelClosed] = useClosed(PANEL_KEY);
  const [tabsClosed, setTabsClosed] = useClosed(TABS_KEY);
  const scene = useRef<SceneHandle>(null);

  // §4.6 — permission revoked while the page is open.
  const onForbidden = (err: ApiError) => {
    queryClient.invalidateQueries({ queryKey: ['my-permissions'] });
    addSnackbar({ message: <div className="alert alert-danger"><XCircle size={16} /><span>{translateApiError(err, t)}</span></div> });
    navigate('/admin', { replace: true });
  };
  const { data, failed } = useSimulationLive(company, ready, onForbidden);
  const customers = useCustomers(data);
  const chatters = useChatters(data);

  const [focusKey, setFocusKey] = useState<string | null>(null);
  const focusTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(focusTimer.current), []);
  const focus: Focus = {
    key: focusKey,
    set: key => {
      window.clearTimeout(focusTimer.current);
      setFocusKey(key);
      focusTimer.current = window.setTimeout(() => setFocusKey(null), 4000);
    },
  };

  const branches = useMemo(() => data?.branches ?? [], [data]);
  const companies = data?.companies ?? [];
  const current = companies.find(c => c.id === data?.company_id) ?? companies[0];
  const isFund = current?.company_type === 'FINANCIER';
  const canProfit = !!data?.can_see_profit;
  const canFuture = !!data?.can_see_future;
  const canCollect = !!data?.can_see_collection;
  const showTabs = data?.viewer_scope === 'HOLDING' || data?.viewer_scope === 'GLOBAL';
  // Chat waiting (§2e, mig 1628): the flag alone decides; false draws nothing about chat.
  const canChat = !!data?.can_see_chat;
  const chat = useMemo(() => (canChat ? data?.chat ?? [] : []), [canChat, data]);
  const chatIn = (id: number) => chat.filter(c => c.branch_id === id);
  const chatUnread = chat.reduce((s, c) => s + c.unread, 0);
  const chatLongest = Math.max(0, ...chat.map(c => c.age_min));
  // The company building (§2f): the flag alone decides; false = no building, no room kept for it.
  const hq = data?.can_see_hq ? data.hq ?? null : null;
  const hqPool = hq && pickedHq != null ? hq.pools[pickedHq] ?? null : null;

  // Tap a branch: tapping the same one again deselects and closes the collection
  // window; an open window follows the new selection (§7).
  const pick = (id: number) => {
    const next = id === picked ? null : id;
    setPicked(next);
    setPickedHq(null);
    if (collectOf != null) setCollectOf(next);
  };
  // Arrow keys in the list move the selection, so they must never toggle it off.
  const pickRow = (id: number) => {
    setPicked(id);
    setPickedHq(null);
    if (collectOf != null) setCollectOf(id);
  };
  const switchCompany = (id: number) => {
    setCompany(id);
    saveCompany(id);
    setPicked(null);
    setCollectOf(null);
    setPickedHq(null);
  };
  const pickHq = (i: number) => {
    setPickedHq(v => (v === i ? null : i));
    setPicked(null);
    setCollectOf(null);
  };

  // In the shop now = today's contracts; earlier days' are counted apart as files left.
  const inRoom = (id: number) => customers.filter(c => c.branchId === id && !c.stale);
  const staleIn = (id: number) => customers.filter(c => c.branchId === id && c.stale);
  const staleTotal = customers.filter(c => c.stale).length;
  const sum = (f: (b: SimBranch) => number | null) => branches.reduce((s, b) => s + (f(b) ?? 0), 0);
  const openedRows = branches.flatMap(b => b.opened);
  // One car on the road per contract opened today (the scene draws the same count).
  const openedToday = openedRows.length;
  const newCount = openedRows.filter(o => o.grade === 'NEW').length;
  const standing = branches.reduce((s, b) => s + inRoom(b.id).length, 0);
  const longest = Math.max(0, ...branches.flatMap(b => inRoom(b.id).map(c => c.age)));
  const ranked = useMemo(
    () => [...branches].sort((a, b) => b.opened.length - a.opened.length || (canProfit ? (b.profit ?? 0) - (a.profit ?? 0) : 0)),
    [branches, canProfit],
  );
  const detail = branches.find(b => b.id === picked) ?? null;
  const collectBranch = branches.find(b => b.id === collectOf) ?? null;
  const grades = t('simulation.gradeSplit', { n: newCount, m: openedRows.length - newCount });

  const empty = !!data && companies.length === 0;

  return (
    <div className="sim">
      {data && !empty && (
        <Suspense fallback={null}>
          <SimulationScene key={data.company_id} ref={scene} branches={branches} customers={customers} chatters={chatters} showChat={!!data.can_see_chat} showProfit={canProfit} picked={picked} focus={focus} onPick={pick}
            hq={hq} companyName={current?.name ?? ''} pickedHq={pickedHq} onPickHq={pickHq} />
        </Suspense>
      )}

      <div className="sim__stack">
        <div className="sim__top">
          {data && !empty && (showTabs && !tabsClosed ? (
            <CompanyTabs activeId={data.company_id} onMinimize={() => setTabsClosed(true)}>
              {companies.map(c => {
                const on = c.id === data.company_id;
                return (
                  <button key={c.id} type="button" role="tab" aria-selected={on} className={`sim__company${on ? ' sim__company--on' : ''}`}
                    style={on ? { background: companyEdge(c.company_type) } : undefined} onClick={() => switchCompany(c.id)}>
                    {c.name}
                    <small><i style={{ background: companyEdge(c.company_type) }} />{t(`simulation.companyType.${c.company_type}`)} · {t('simulation.branchCount', { n: c.branch_count, count: c.branch_count })}</small>
                    <em>{t('simulation.openedToday', { n: c.opened_today })}</em>
                  </button>
                );
              })}
            </CompanyTabs>
          ) : showTabs && current ? (
            <button type="button" className="sim__card sim__company-label sim__company-min" aria-label={t('simulation.companiesShow')} aria-expanded={false} onClick={() => setTabsClosed(false)}>
              <span>
                <b>{current.name}</b>
                <small><i style={{ background: companyEdge(current.company_type) }} />{t(`simulation.companyType.${current.company_type}`)} · {t('simulation.branchCount', { n: current.branch_count, count: current.branch_count })}</small>
              </span>
              <i className="sim__tabs-toggle"><ChevronRight size={16} /></i>
            </button>
          ) : current && (
            <div className="sim__card sim__company-label">
              <b>{current.name}</b>
              <small><i style={{ background: companyEdge(current.company_type) }} />{t(`simulation.companyType.${current.company_type}`)} · {t('simulation.branchCount', { n: current.branch_count, count: current.branch_count })}</small>
            </div>
          ))}
          <div className="sim__card sim__clock">
            <b className={failed ? 'sim__dot sim__dot--bad' : 'sim__dot'} />
            <strong>{bangkokClock(now)}</strong>
            <small>{data ? t('simulation.lastData', { time: bangkokClock(new Date(data.generated_at)) }) : '…'}</small>
          </div>
        </div>

        {failed && <div className="alert alert-warning sim__band">{t('simulation.loadError')}</div>}
      </div>

      <div className={`sim__body${panelClosed ? ' sim__body--panel-closed' : ''}`}>
        {!data && !failed && (
          <div className="sim__loading" aria-busy="true">
            <Skeleton variant="rectangular" width="100%" height={72} />
            <Skeleton variant="rectangular" width="100%" height={320} />
          </div>
        )}
        {empty && <div className="sim__card sim__empty">{t('simulation.noBranches')}</div>}

        {data && !empty && (
          <>
            <div className="sim__zoom">
              <Button variant="ghost" size="sm" startIcon={<Plus size={14} />} aria-label={t('simulation.zoomIn')} onClick={() => scene.current?.zoom(1.2)} />
              <Button variant="ghost" size="sm" startIcon={<Minus size={14} />} aria-label={t('simulation.zoomOut')} onClick={() => scene.current?.zoom(0.83)} />
              <Button variant="ghost" size="sm" startIcon={<House size={14} />} aria-label={t('simulation.zoomFit')} onClick={() => scene.current?.fit()} />
            </div>

            <aside className={`sim__card sim__panel${panelClosed ? ' sim__panel--closed' : ''}`}>
              <button type="button" className="sim__panel-toggle" aria-expanded={!panelClosed} aria-label={t(panelClosed ? 'simulation.panelShow' : 'simulation.panelHide')} onClick={() => setPanelClosed(!panelClosed)}>
                <span>{t('simulation.overview')}</span>
                {panelClosed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>
              {!panelClosed && <>
              <div className="sim__kpis">
                <Kpi label={t('simulation.kpi.standing')} value={standing} unit={t('simulation.unit.people', { count: standing })}
                  sub={standing > 0 ? t('simulation.kpi.longest', { age: ageText(t, longest) }) : undefined}
                  sub2={staleTotal > 0 ? t('simulation.kpi.staleSub', { n: staleTotal }) : undefined} />
                {canChat && (
                  <Kpi label={t('simulation.kpi.chat')} value={chat.length} unit={t('simulation.unit.people', { count: chat.length })}
                    sub={chat.length > 0 ? t('simulation.kpi.chatSub', { n: chatUnread, age: ageText(t, chatLongest), count: chatUnread }) : undefined} />
                )}
                <Kpi label={t('simulation.kpi.contracts')} value={openedRows.length} unit={t('simulation.unit.contracts', { count: openedRows.length })} sub={grades} />
                {isFund ? (
                  <>
                    <Kpi label={t('simulation.kpi.financed')} value={baht(sum(b => b.financed))} sub={`${t('simulation.commission')} ${baht(sum(b => b.commission))}`}
                      sub2={`${t('simulation.downAvg')} ${downPctOf(sum(b => b.down), sum(b => b.device_price))}`} />
                    <Kpi label={t('simulation.kpi.paidOut')} value={baht(sum(b => b.payout))} sub={t('simulation.kpi.paidOutSub')} />
                    <Kpi label={t('simulation.kpi.pendingPayout')} value={baht(sum(b => b.pending_payout))}
                      sub={sum(b => b.pending_older) > 0
                        ? t('simulation.kpi.olderSub', { amount: baht(sum(b => b.pending_older)) })
                        : t('simulation.billsReady', { bills: sum(b => b.pending_bills), ready: sum(b => b.pending_ready), count: sum(b => b.pending_bills) })} />
                    {canFuture && <Kpi label={t('simulation.kpi.future')} value={baht(sum(b => b.future))} sub={t('simulation.kpi.futureSub')} />}
                    {canProfit && <Kpi label={t('simulation.kpi.profit')} value={baht(sum(b => b.profit))} />}
                    {canProfit && <Kpi label={t('simulation.kpi.annual')} value={annualPct(sum(b => b.profit), sum(b => b.capital_years))} sub={t('simulation.kpi.annualSub')} />}
                    {canProfit && <Kpi label={t('simulation.kpi.annualRate')} value={annualAtRate(sum(b => b.future), sum(b => b.investment), sum(b => b.capital_years))} />}
                  </>
                ) : (
                  <>
                    {canFuture && <Kpi label={t('simulation.kpi.future')} value={baht(sum(b => b.future))} sub={t('simulation.kpi.futureSub')} />}
                    {canProfit && <Kpi label={t('simulation.kpi.profit')} value={baht(sum(b => b.profit))} sub={t('simulation.kpi.profitSubOperating')} />}
                    <Kpi label={t('simulation.kpi.retail')} value={baht(sum(b => b.retail))} />
                    <Kpi label={t('simulation.kpi.service')} value={baht(sum(b => b.service))} />
                    <Kpi icon={<PileIcon k="cash" />} label={t('simulation.pile.cash')} value={baht(sum(b => b.cash))} />
                    <Kpi icon={<PileIcon k="transfer" />} label={t('simulation.pile.transfer')} value={baht(sum(b => b.transfer))} />
                    <Kpi icon={<PileIcon k="wallet" />} label={t('simulation.pile.wallet')} value={baht(sum(b => b.wallet))} />
                  </>
                )}
              </div>
              <h3>{t('simulation.branches')}</h3>
              <DataTable<SimBranch>
                data={ranked}
                enablePagination={false}
                getRowProps={row => ({ 'data-state': row.original.id === picked ? 'selected' : undefined })}
                enableKeyboardNav={!isMobile}
                onRowActivate={row => pickRow(row.original.id)}
                className="flex-1 min-h-0 panel-datatable"
                noResults={<div className="p-6 text-center text-subtler">{t('simulation.noBranches')}</div>}
                renderRow={row => {
                  const b = row.original;
                  const rank = ranked.indexOf(b) + 1;
                  const n = inRoom(b.id).length;
                  return (
                    <button type="button" className="sim__row" onClick={() => pick(b.id)}>
                      <span className="sim__row-top">
                        <b><i className={`sim__rank${b.opened.length > 0 ? ' sim__rank--sold' : ''}`}>{rank}</i>{b.name}</b>
                        <em>
                          {t('simulation.contractCount', { n: b.opened.length, count: b.opened.length })} · <span className={n > 0 ? 'sim__people--on' : undefined}>{t('simulation.peopleCount', { n: n, count: n })}</span>
                          {staleIn(b.id).length > 0 && <SimTile kind="stale" n={staleIn(b.id).length} label={v => t('simulation.staleChip', { n: v })} />}
                          {chatIn(b.id).length > 0 && <SimTile kind="chat" n={chatIn(b.id).length} label={v => t('simulation.chatChip', { n: v })} />}
                        </em>
                      </span>
                      {isFund ? (
                        <>
                          {canProfit && <span className="sim__row-sub">{t('simulation.profitShort')} {baht(b.profit)}</span>}
                          {canProfit && (
                            <span className="sim__row-sub">
                              {t('simulation.annualShort')} {annualPct(b.profit ?? 0, b.capital_years ?? 0)} · {t('simulation.rateShort')} {annualAtRate(b.future ?? 0, b.investment ?? 0, b.capital_years ?? 0)}
                            </span>
                          )}
                          <span className="sim__row-sub">
                            {t('simulation.paidShort')} {baht(b.payout)} · {t('simulation.pendingShort')} {baht(b.pending_payout)}
                            {b.pending_older > 0 ? ` · ${t('simulation.olderShort')} ${baht(b.pending_older)}` : ''}
                          </span>
                          {b.opened.slice(0, 3).map(o => (
                            <span key={o.code} className="sim__row-sub">{[o.product, gradeLabel(t, o.grade)].filter(Boolean).join(' · ')}</span>
                          ))}
                          {b.opened.length > 3 && <span className="sim__row-sub">{t('simulation.moreDevices', { n: b.opened.length - 3, count: b.opened.length - 3 })}</span>}
                        </>
                      ) : (
                        <>
                          <span className="sim__row-sub">
                            {canProfit ? `${t('simulation.profitShort')} ${baht(b.profit)} · ` : ''}
                            {t('simulation.kpi.retail')} {baht(b.retail)} · {t('simulation.kpi.service')} {baht(b.service)}
                          </span>
                          <span className="sim__row-sub sim__row-money">
                            <PileIcon k="cash" size={12} />{baht(b.cash)} <PileIcon k="transfer" size={12} />{baht(b.transfer)} <PileIcon k="wallet" size={12} />{baht(b.wallet)}
                          </span>
                        </>
                      )}
                    </button>
                  );
                }}
              />
              </>}
            </aside>

            {detail && (
              <div className="sim__card sim__detail better-scroll">
                <div className="sim__card-head">
                  <h3>{detail.name}<small>{detail.code}{detail.day_closed ? ` · ${t('simulation.dayClosed')}` : ''}</small></h3>
                  <Button variant="ghost" size="sm" className="sim__close" startIcon={<X size={14} />} aria-label={t('common.close')} onClick={() => pick(detail.id)} />
                </div>
                {canCollect && (
                  <Button variant="outline" size="sm" className="w-full mb-2" onClick={() => setCollectOf(detail.id)}>{t('simulation.collection.open')}</Button>
                )}
                <dl>
                  <dt>{t('simulation.kpi.contracts')}</dt><dd>{t('simulation.contractUnit', { n: detail.opened.length, count: detail.opened.length })}</dd>
                  {isFund ? (
                    <>
                      <dt>{t('simulation.financed')}</dt><dd>{baht(detail.financed)}</dd>
                      <dt>{t('simulation.downAvg')}</dt><dd>{detail.down_pct == null ? '—' : t('simulation.downOfPrice', { pct: downPct(detail.down_pct) })}</dd>
                      <dt>{t('simulation.commission')}</dt><dd>{baht(detail.commission)}</dd>
                      <dt><PileIcon k="payout" />{t('simulation.kpi.paidOut')}</dt><dd>{baht(detail.payout)}</dd>
                      <dt><PileIcon k="pending_payout" />{t('simulation.kpi.pendingPayout')}</dt><dd>{baht(detail.pending_payout)}</dd>
                      {detail.pending_older > 0 && <><dt>{t('simulation.older')}</dt><dd>{baht(detail.pending_older)}</dd></>}
                      <dt>{t('simulation.allBills')}</dt><dd>{t('simulation.billsReady', { bills: detail.pending_bills, ready: detail.pending_ready, count: detail.pending_bills })}</dd>
                      {canFuture && <><dt>{t('simulation.kpi.future')}</dt><dd>{baht(detail.future)}</dd></>}
                      {canProfit && (
                        <>
                          <dt>{t('simulation.kpi.profit')}</dt><dd>{baht(detail.profit)}</dd>
                          <dt>{t('simulation.kpi.annual')}</dt><dd>{annualPct(detail.profit ?? 0, detail.capital_years ?? 0)}</dd>
                          <dt>{t('simulation.kpi.annualRate')}</dt><dd>{annualAtRate(detail.future ?? 0, detail.investment ?? 0, detail.capital_years ?? 0)}</dd>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {canFuture && <><dt>{t('simulation.kpi.future')}</dt><dd>{baht(detail.future)}</dd></>}
                      {canProfit && <><dt>{t('simulation.kpi.profit')}</dt><dd>{baht(detail.profit)}</dd></>}
                      <dt>{t('simulation.kpi.retail')}</dt><dd>{baht(detail.retail)}</dd>
                      <dt>{t('simulation.kpi.service')}</dt><dd>{baht(detail.service)}</dd>
                      <dt><PileIcon k="cash" />{t('simulation.pile.cash')}</dt><dd>{baht(detail.cash)}</dd>
                      <dt><PileIcon k="transfer" />{t('simulation.pile.transfer')}</dt><dd>{baht(detail.transfer)}</dd>
                      <dt><PileIcon k="wallet" />{t('simulation.pile.wallet')}</dt><dd>{baht(detail.wallet)}</dd>
                      {detail.other > 0 && <><dt><PileIcon k="other" />{t('simulation.pile.other')}</dt><dd>{baht(detail.other)}</dd></>}
                    </>
                  )}
                </dl>
                {isFund && (detail.payout_days.length > 0 || detail.pending_before > 0) && (
                  <table className="sim__days">
                    <thead className="table-header">
                      <tr className="table-row">
                        <th className="table-head">{t('simulation.submitDay')}</th>
                        <th className="table-head">{t('simulation.pendingShort')}</th>
                        <th className="table-head">{t('simulation.paidShort')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.payout_days.map(d => (
                        <tr key={d.day}><td><DateTime value={d.day} showTime={false} /></td><td>{baht(d.pending)}</td><td>{baht(d.paid)}</td></tr>
                      ))}
                      {detail.pending_before > 0 && <tr><td>{t('simulation.earlier')}</td><td>{baht(detail.pending_before)}</td><td>—</td></tr>}
                    </tbody>
                  </table>
                )}
                {/* Contract lines (§6d, NOTICE 1630): the terms as the shop sold them.
                    "จัด" names the financed amount — without it the figure reads as
                    the device price. sale_price/uplift come as given, never derived. */}
                {detail.opened.map(o => {
                  const asset = assetOf(o.asset, o.serial);
                  const annual = isFund && canProfit
                    ? `${t('simulation.annualShort')} ${annualPct(o.profit ?? 0, ((o.investment ?? 0) * o.months) / 12)}`
                    : '';
                  return (
                    <div key={o.code} className="sim__opened" data-testid="sim-opened">
                      <b>{o.product || '—'}</b>
                      <span>{gradeLabel(t, o.grade)}{isFund ? ` · ${t('simulation.financedShort')} ${baht(o.financed)}` : ''}</span>
                      {isFund && o.sale_price != null && (
                        <small>{t('simulation.saleUplift', { sale: plainNum(o.sale_price), uplift: plainNum(o.uplift ?? 0) })}</small>
                      )}
                      <small>{isFund ? `${termsOf(o)} · ${t('simulation.downShort')} ${downPct(o.down_pct)}` : termsOf(o)}</small>
                      {(asset || annual) && <small>{[asset, annual].filter(Boolean).join(' · ')}</small>}
                    </div>
                  );
                })}
                {chatIn(detail.id).map(c => (
                  <div key={`chat-${c.id}`} className="sim__waiter" data-testid="sim-chat-row">
                    <i className="sim__chat-dot" />{t('simulation.chatRow', { code: c.code, n: c.unread, age: ageText(t, c.age_min), count: c.unread })}
                  </div>
                ))}
                {inRoom(detail.id).map(a => (
                  <div key={a.id} className="sim__waiter">
                    <i style={{ background: stateColor(a.state) }} />{codeOf(a.code, a.months)} · {stateLabel(t, a.state)} · {ageText(t, a.age)}
                    {(a.product || a.asset) && <small className="sim__waiter-sub">{[a.product, a.asset].filter(Boolean).join(' · ')}</small>}
                  </div>
                ))}
                {staleIn(detail.id).length > 0 && <h4 className="sim__sub">{t('simulation.staleHeading', { n: staleIn(detail.id).length })}</h4>}
                {staleIn(detail.id).map(a => (
                  <div key={a.id} className="sim__waiter">
                    <i style={{ background: stateColor(a.state) }} />{codeOf(a.code, a.months)} · {stateLabel(t, a.state)} · {ageText(t, a.age)}
                    {(a.product || a.asset) && <small className="sim__waiter-sub">{[a.product, a.asset].filter(Boolean).join(' · ')}</small>}
                  </div>
                ))}
              </div>
            )}

            {hq && hqPool && (
              <HqPoolCard hq={hq} pool={hqPool} branches={branches} canChat={canChat} onClose={() => setPickedHq(null)} />
            )}

            {collectBranch && canCollect && (
              <SimulationCollection branch={collectBranch} generatedAt={data.generated_at} onClose={() => setCollectOf(null)} />
            )}

            {/* What the picture's colours and things mean, in three groups. Folds down to its bar
                like the overview panel folds up; minimized by default, remembered per browser. */}
            <section className={`sim__card sim__legend${legendClosed ? ' sim__legend--closed' : ''}`} data-testid="sim-legend">
              <button type="button" className="sim__legend-toggle" aria-expanded={!legendClosed} aria-label={t(legendClosed ? 'simulation.legend.show' : 'simulation.legend.hide')} onClick={() => setLegendClosed(!legendClosed)}>
                <span>{t('simulation.legend.title')}</span>
                {legendClosed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {!legendClosed && <div className="sim__legend-groups">
                <div className="sim__legend-group">
                  <h4>{t('simulation.legend.groupCustomers')}</h4>
                  {LEGEND_STATES.map(s => (
                    <span key={s}><i style={{ background: stateColor(s) }} />{stateLabel(t, s)}</span>
                  ))}
                  {canChat && <span className="sim__legend-wide"><i className="sim__chat-dot" />{t('simulation.legend.chat', { n: chat.length })}</span>}
                  <span className="sim__legend-wide">{t('simulation.legend.outside')}</span>
                  <span className="sim__legend-wide"><Folder color="#e3d3a8" />{t('simulation.legend.stale')}</span>
                  <small className="sim__legend-wide">{t('simulation.legend.customersNote')}</small>
                </div>
                <div className="sim__legend-group">
                  <h4>{t('simulation.legend.groupShops')}</h4>
                  <span><Folder color={FLOOR.sold} edge={SOLD_EDGE} />{t('simulation.legend.sold')}</span>
                  <span><Folder color={FLOOR.guest} edge="#e2c98f" />{t('simulation.legend.guest')}</span>
                  {isFund && PILES.FINANCIER.map(p => (
                    <span key={p.key}><PileIcon k={p.key} />{t(`simulation.legend.${p.key}`)}</span>
                  ))}
                  <span className="sim__legend-wide" data-testid="sim-legend-cars"><CarFront size={13} />{t('simulation.legend.cars', { n: openedToday })}</span>
                </div>
                {hq && <div className="sim__legend-group">
                  <h4>{t('simulation.legend.groupCompany')}</h4>
                  <span><Folder color={HQ_COLOR.waiting} /><Flight k="submit" />{t('simulation.legend.hqWaiting')}</span>
                  <span><Folder color={HQ_COLOR.approved} /><Flight k="approve" />{t('simulation.legend.hqApproved')}</span>
                  <span><Folder color={HQ_COLOR.returned} /><Flight k="return" />{t('simulation.legend.hqReturned')}</span>
                  <span><Flight k="withdraw" />{t('simulation.legend.flightWithdraw')}</span>
                  <span><Folder color={HQ_COLOR.checked} />{t('simulation.legend.hqChecked')}</span>
                  <span><Folder color={HQ_COLOR.inPayout} />{t('simulation.legend.hqInPayout')}</span>
                  <span><Folder color={HQ_COLOR.money} /><Flight k="money" />{t('simulation.legend.hqMoney')}</span>
                  <span className="sim__legend-wide">{t('simulation.legend.hqDesks')}</span>
                  <small className="sim__legend-wide">{t('simulation.legend.hqNote')}</small>
                </div>}
              </div>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
