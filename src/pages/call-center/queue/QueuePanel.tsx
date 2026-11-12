// The work panel of the dunning queue: tap a customer in the scene → everything the
// collector does for them, in one place. The top is built for the common loop —
// call, tap the result, save, next person — and the full collector detail (the same
// component as the list view) sits below it, so nothing from the old screen is lost.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Modal, TextArea, Tooltip, useSnackbarContext } from 'tsp-form';
import {
  ArrowRight, CheckCircle, Flag, MessageSquare, Megaphone, PartyPopper,
  Phone, Star, StarOff, ArrowRightLeft, X, XCircle,
} from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { translateApiError } from '../../../lib/apiErrors';
import { formatTel } from '../../../lib/format';
import { DateTime } from '../../../components/DateTime';
import { situationColor, situationText } from '../../../lib/situation';
import { useChatDock } from '../../../contexts/ChatDockContext';
import {
  ccKeys, focusAdd, focusRemove, logDunningAction, useActionResults, useActorEventTypes,
  type ContactBook,
} from '../callCenterApi';
import { FlagChangeModal, PromiseModal, RowTransferModal } from '../DunningActions';
import { ReliefBadge } from '../ccBadges';
import { ContractDunningDetail } from '../ContractDunningDetail';
import { DunningTimeline, SummaryBox, TimelinePeek } from '../DunningTimeline';
import { fetchMdmStory } from '../../inventory/mdm/mdmApi';
import { MdmStoryBox } from '../../inventory/mdm/MdmStoryBox';
import { MdmReliefPanel } from '../../inventory/mdm/MdmReliefPanel';
import { LANES, baht, contactLong, type QueueBranch, type QueuePerson } from './queueApi';

const EVENTS = ['CALL', 'TOLD_REFERENCE', 'FIELD_VISIT', 'NOTE'] as const;
type EventCode = typeof EVENTS[number];

// ── Quick log: event chip → result chip → note → save ───────────────────────
function QuickLog({ contractId, event, setEvent, onSaved, onWillPay }: {
  contractId: number;
  event: EventCode;
  setEvent: (e: EventCode) => void;
  onSaved: () => void;
  onWillPay: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const queryClient = useQueryClient();
  const { data: eventTypes } = useActorEventTypes();
  const { data: results } = useActionResults(event);
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setResult(''); setError(null); }, [event]);
  useEffect(() => { setResult(''); setNote(''); setError(null); }, [contractId]);

  // Only events the backend lists as active for staff are offered.
  const allowed = new Set((eventTypes ?? []).map(e => e.code));
  const events = EVENTS.filter(e => !eventTypes || allowed.has(e));
  const needsResult = (results ?? []).length > 0;
  const canSave = !saving && (!needsResult || !!result) && (needsResult || !!note.trim());

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await logDunningAction({ contractId, event, resultCode: needsResult ? result : null, note: note.trim() || null });
      queryClient.invalidateQueries({ queryKey: ccKeys.timeline(contractId) });
      queryClient.invalidateQueries({ queryKey: ccKeys.bookRow(contractId) });
      queryClient.invalidateQueries({ queryKey: ['cc', 'book'] });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('callCenter.logSaved')}</span></div>,
        type: 'success', duration: 2000,
      });
      const willPay = result === 'REACHED_WILL_PAY';
      setResult('');
      setNote('');
      onSaved();
      if (willPay) onWillPay();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="dq-log" data-quicklog>
      <div className="flex items-center gap-1.5 flex-wrap">
        {events.map(e => (
          <Button
            key={e}
            size="sm"
            variant={event === e ? 'solid' : 'outline'}
            color={event === e ? 'primary' : 'default'}
            aria-pressed={event === e}
            onClick={() => setEvent(e)}
          >
            {t(`callCenter.event.${e}`, { defaultValue: e })}
          </Button>
        ))}
      </div>
      {needsResult && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {(results ?? []).map(r => {
            const good = r.result_code.startsWith('REACHED') || r.result_code === 'MET';
            return (
              <Button
                key={r.result_code}
                size="sm"
                variant={result === r.result_code ? 'solid' : 'outline'}
                color={result === r.result_code ? (good ? 'success' : 'primary') : 'default'}
                aria-pressed={result === r.result_code}
                onClick={() => setResult(cur => (cur === r.result_code ? '' : r.result_code))}
              >
                {t(`callCenter.result_code.${r.result_code}`, { defaultValue: r.result_code })}
              </Button>
            );
          })}
        </div>
      )}
      <TextArea
        className="w-full"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('callCenter.notePlaceholder')}
      />
      {/* Right above the save button, so it is never out of view. */}
      {error && <div className="alert alert-danger"><XCircle size={16} /><span>{error}</span></div>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-subtler">
          {result === 'REACHED_WILL_PAY' ? t('dunningQueue.willPayHint') : ''}
        </span>
        <Button size="sm" color="primary" disabled={!canSave} onClick={save}>
          {saving ? t('callCenter.logging') : t('dunningQueue.saveLog')}
        </Button>
      </div>
    </section>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────
export function QueuePanel({
  person, gone, paidAmount, branch, onShout, onPaidDemo, onFocusChanged, isMobile,
}: {
  person: QueuePerson;
  /** The customer is no longer in the queue (paid or released). */
  gone: boolean;
  paidAmount: number | null;
  branch: QueueBranch | undefined;
  onShout: () => void;
  onPaidDemo: () => void;
  onFocusChanged: (id: number, on: boolean) => void;
  isMobile: boolean;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const queryClient = useQueryClient();
  const { openChat } = useChatDock();
  const p = person;
  const [event, setEvent] = useState<EventCode>('CALL');
  const [flagOpen, setFlagOpen] = useState(false);
  const [promiseOpen, setPromiseOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [focusBusy, setFocusBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // The container (window or sheet body) is the one scroll area.
  const scrollArea = () => root.current?.closest<HTMLElement>('.sim__win-body, .dq-sheet-body') ?? null;

  useEffect(() => {
    setEvent('CALL');
    scrollArea()?.scrollTo({ top: 0 });
  }, [p.id]);

  const { data: contacts } = useQuery({
    queryKey: ccKeys.contacts(p.id),
    queryFn: async () => (await apiClient.get<ContactBook[]>(`/v_contract_contact_book?contract_id=eq.${p.id}`))[0] ?? null,
  });
  const { data: mdm } = useQuery({
    queryKey: ['cc', 'queue-mdm', p.asset_id],
    queryFn: () => fetchMdmStory(p.asset_id!),
    enabled: !!p.asset_id,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['cc', 'book'] });
    queryClient.invalidateQueries({ queryKey: ccKeys.bookRow(p.id) });
    queryClient.invalidateQueries({ queryKey: ccKeys.timeline(p.id) });
    queryClient.invalidateQueries({ queryKey: ccKeys.appointment(p.id) });
    queryClient.invalidateQueries({ queryKey: ['cc', 'queue-mdm', p.asset_id] });
  };

  // Pressing a number dials it and opens the result form for that kind of call.
  const dialed = (kind: EventCode) => {
    setEvent(kind);
    requestAnimationFrame(() => {
      root.current?.querySelector('[data-quicklog]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };

  const toggleFocus = async () => {
    setFocusBusy(true);
    try {
      const res = p.focused ? await focusRemove(p.id) : await focusAdd(p.id);
      onFocusChanged(p.id, res.on_focus);
      queryClient.invalidateQueries({ queryKey: ['cc', 'book'] });
    } catch (err) {
      addSnackbar({
        message: <div className="alert alert-danger"><X size={16} /><span>{translateApiError(err, t)}</span></div>,
        type: 'error', duration: 3000,
      });
    } finally {
      setFocusBusy(false);
    }
  };

  const tels = [contacts?.customer_tel || p.tel, contacts?.customer_tel2].filter((x): x is string => !!x);

  return (
    <div ref={root} className="dq-panel-content">
      {gone && (
        <div className={`alert ${paidAmount != null ? 'alert-success' : 'alert-info'}`}>
          <CheckCircle size={16} />
          <span>{paidAmount != null ? t('dunningQueue.leftPaid', { amount: baht(paidAmount) }) : t('dunningQueue.left')}</span>
        </div>
      )}

      {/* Who and where they stand — a few short lines, straight from the queue row. */}
      <div className="flex flex-col gap-1 text-sm">
        <div className="text-base font-semibold">{p.name || '—'}</div>
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
          <span className="text-subtle">
            {[p.gender ? t(`dunningQueue.gender.${p.gender}`) : '', p.age ? t('dunningQueue.ageN', { n: p.age }) : '',
              p.collector_id ? p.collector_name : t('dunningQueue.unassigned'), branch?.code ?? ''].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <i className="dq-dot" style={{ background: situationColor(p.situation_code) }} />
            {situationText(t, p.situation_code, p.overdue_days)}
            {p.overdue_count > 0 && <span className="text-subtle">· {t('dunningQueue.installmentsN', { n: p.overdue_count })}</span>}
          </span>
          <b className="tabular-nums">{baht(p.overdue_amount)}</b>
        </div>
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
          <span className={p.contact_hours == null ? 'text-danger-fg font-medium' : ''}>{contactLong(t, p.contact_hours)}</span>
          <span className="inline-flex items-center gap-1.5">
            <i className="dq-dot" style={{ background: p.flag_color }} />
            {p.flag_name_th}
            {p.flag_manual !== 'WHITE' && <span className="text-subtle text-xs">({t('dunningQueue.flagManual')})</span>}
          </span>
        </div>
        {p.relief_until && (
          <div className="flex items-center gap-2 flex-wrap">
            <ReliefBadge until={p.relief_until} />
            <span className="text-xs text-subtle">{t('asset.mdm.relief.untilNote')}</span>
          </div>
        )}
        {p.promise_date && (
          <div className="text-subtle">
            {p.lane === 'BROKEN' ? t('dunningQueue.brokenPromise') : t('dunningQueue.promise')}{' '}
            <DateTime value={p.promise_date} showTime={false} />
            {p.lane === 'BROKEN' ? ` · ${t('dunningQueue.brokenDaysN', { n: p.broken_days })}` : ''}
            {p.promise_note ? ` · ${p.promise_note}` : ''}
          </div>
        )}
      </div>

      {/* The four things done most. A number is a tel: link (it dials), dressed as the library's button. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {tels[0] ? (
          <a href={`tel:${tels[0].replace(/\D/g, '')}`} onClick={() => dialed('CALL')} className="btn btn-sm btn-success inline-flex items-center gap-1.5 no-underline">
            <Phone size={14} />{formatTel(tels[0])}
          </a>
        ) : null}
        <Button size="sm" variant="outline" startIcon={<MessageSquare size={14} />} onClick={() => openChat(p.id)}>
          {t('callCenter.chatCustomer')}
          {p.chat_unread > 0 && <Badge size="xs" color="info" className="ml-1">{p.chat_unread}</Badge>}
        </Button>
        <Button
          size="sm"
          variant={p.focused ? 'solid' : 'outline'}
          color={p.focused ? 'primary' : 'default'}
          aria-pressed={p.focused}
          startIcon={p.focused ? <StarOff size={14} /> : <Star size={14} className="text-warning-fg" />}
          disabled={focusBusy}
          onClick={toggleFocus}
        >
          {p.focused ? t('callCenter.removeFromFocus') : t('callCenter.addToFocus')}
        </Button>
        <Button size="sm" variant="outline" startIcon={<Flag size={14} style={{ color: p.flag_color }} />} onClick={() => setFlagOpen(true)}>
          {t('callCenter.changeFlag')}
        </Button>
      </div>

      {/* Summary note — one note the collector overwrites, shown line by line. */}
      {p.summary && <SummaryBox title={t('callCenter.summary')} text={p.summary} />}

      {/* What happened last time, before calling (RECOMMEND 2026-11-12 §5a–b): the last
          three events here, the whole timeline one press away. */}
      <TimelinePeek contractId={p.id} onOpen={() => setHistoryOpen(true)} />

      {/* Other numbers: calling a reference logs "told a reference". */}
      {(tels.length > 1 || (contacts?.references?.length ?? 0) > 0) && (
        <div className="flex flex-col gap-1">
          {tels.slice(1).map(tel => (
            <a key={tel} href={`tel:${tel.replace(/\D/g, '')}`} onClick={() => dialed('CALL')} className="btn btn-sm btn-outline-default w-full justify-between no-underline">
              <span className="text-subtle">{t('callCenter.customerTel2')}</span>
              <span className="inline-flex items-center gap-1 text-primary-fg"><Phone size={13} />{formatTel(tel)}</span>
            </a>
          ))}
          {contacts?.references?.filter(r => r.tel).map(r => (
            <a key={r.reference_id} href={`tel:${r.tel!.replace(/\D/g, '')}`} onClick={() => dialed('TOLD_REFERENCE')} className="btn btn-sm btn-outline-default w-full justify-between no-underline">
              <span className="truncate">{r.name || '—'}{r.relation ? <span className="text-subtle"> · {r.relation}</span> : null}</span>
              <span className="inline-flex items-center gap-1 text-primary-fg shrink-0"><Phone size={13} />{formatTel(r.tel!)}</span>
            </a>
          ))}
        </div>
      )}

      <QuickLog
        contractId={p.id}
        event={event}
        setEvent={setEvent}
        onSaved={() => { /* the queue refetches through ['cc','book'] */ }}
        onWillPay={() => setPromiseOpen(true)}
      />

      {p.asset_id ? (mdm ? <MdmStoryBox story={mdm} /> : null) : (
        <div className="text-xs text-subtler">{t('dunningQueue.noDevice')}</div>
      )}

      {/* 24-hour relief — from the queue row's serial, so a supervisor opening someone
          else's customer has it too (the detail below needs the viewer's own book). */}
      <MdmReliefPanel serial={p.serial} onGranted={refresh} bare />

      <div className="flex items-center gap-1.5 flex-wrap">
        <Button size="sm" variant="outline" startIcon={<ArrowRightLeft size={14} />} onClick={() => setTransferOpen(true)}>
          {t('dunningQueue.transfer')}
        </Button>
        <Button size="sm" variant="ghost" startIcon={<Megaphone size={14} className="text-warning-fg" />} onClick={onShout}>
          {t('dunningQueue.shout')}
        </Button>
        <Button size="sm" variant="ghost" startIcon={<PartyPopper size={14} className="text-success-fg" />} onClick={onPaidDemo}>
          {t('dunningQueue.paidDemo')}
        </Button>
      </div>

      {/* Everything else from the collector screen: overview (promise, send to
          repo, device, iCloud), installments, contacts, history. */}
      <div className="border-t border-line -mx-3">
        <ContractDunningDetail contractId={p.id} isMobile={isMobile} embedded />
      </div>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} maxWidth="34rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title inline-flex items-center gap-2 min-w-0">
            <span className="truncate">{t('callCenter.timelineTitle')} · {p.code}</span>
          </h2>
          <button type="button" className="modal-close-btn" onClick={() => setHistoryOpen(false)}>×</button>
        </div>
        <div className="modal-content">
          <DunningTimeline contractId={p.id} summary={{ text: p.summary || null, by: p.summary_by || null, at: p.summary_at }} />
        </div>
      </Modal>
      <FlagChangeModal open={flagOpen} contractId={p.id} currentManual={p.flag_manual} onClose={() => setFlagOpen(false)} onChanged={refresh} />
      <PromiseModal open={promiseOpen} contractId={p.id} onClose={() => setPromiseOpen(false)} onSaved={refresh} />
      <RowTransferModal
        open={transferOpen}
        contractId={p.id}
        contractCode={p.code}
        onClose={() => setTransferOpen(false)}
        onOffered={() => {
          queryClient.invalidateQueries({ queryKey: ccKeys.tradeOutbox });
          refresh();
        }}
      />
    </div>
  );
}

/** The window's / sheet's title bar: contract (a real link), its line, the name, "next person". */
export function PanelTitle({ person: p, nextLabel, onNext }: { person: QueuePerson; nextLabel: string | null; onNext: (() => void) | null }) {
  const { t } = useTranslation();
  const lane = LANES.find(L => L.lane === p.lane);
  return (
    <>
      <h3 className="dq-title">
        {/* A real link (ctrl/middle click = new tab), no icon: the code reads as plain text until hovered. */}
        {/* This Thai font keeps room under the line for lower vowels, so Latin/digits sit high:
            moved down by the measured 1.5 px so the code lines up with the badge (pixel-measured). */}
        <Link to={`/admin/contracts/search/${p.id}`} className="font-semibold text-fg hover:underline relative top-[1.5px]">
          {p.code}
        </Link>
        {/* tsp-form Badge filled with the line's own colour (the same colour as its sign on the floor). */}
        <Badge
          size="sm"
          style={{ ['--color-badge-default-bg' as string]: lane?.tone ?? '#52616b', ['--color-badge-default-fg' as string]: '#fff' }}
        >
          {t(`dunningQueue.lane.${p.lane}`)}
        </Badge>
      </h3>
      {/* Greyed out when everyone here has been opened this round, with the reason on hover. */}
      <Tooltip content={nextLabel ?? t('dunningQueue.noNext')}>
        <span className="inline-flex">
          <Button size="sm" color="primary" endIcon={<ArrowRight size={14} />} disabled={!onNext} onClick={() => onNext?.()}>
            {t('dunningQueue.next')}
          </Button>
        </span>
      </Tooltip>
    </>
  );
}
