// 4-tab contract detail for the collector: Overview / Installments / Contacts / History.
// Overview hosts inline click-to-edit summary + inline log-activity (no modals —
// high-frequency workflow). Reads v_my_book row for header data.

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Select, TextArea, useSnackbarContext } from 'tsp-form';
import {
  ChevronLeft, ChevronRight, Phone, Pencil, CheckCircle, XCircle,
  Smartphone, Users, ExternalLink, Save, Clock, Flag, CalendarClock,
  MessageSquare, Cloud,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useChatDock } from '../../contexts/ChatDockContext';
import { DateTime } from '../../components/DateTime';
import { formatTel, fmtCurrency } from '../../lib/format';
import {
  ccKeys, useFlagLevels, useActorEventTypes, useActionResults,
  useActiveAppointment, useContractIcloud,
  focusAdd, focusRemove, logDunningAction, setDunningSummary, overdueColor,
  type BookRow, type InstallmentRow, type ContactBook, type TimelineRow,
} from './callCenterApi';
import {
  FlagPair, SkipReasonBadge, DunningStatusBadge,
  DeviceContextBadges, AppointmentBadge, DeviceLink,
} from './ccBadges';
import { FlagChangeModal, PromiseModal, IcloudRevealButton } from './DunningActions';

type DetailTab = 'overview' | 'installments' | 'contacts' | 'history';
const TABS: DetailTab[] = ['overview', 'installments', 'contacts', 'history'];

// ── Scrollable tab strip (same pattern as ContractDetailPanel) ──────────────

function ScrollableTabs({
  activeTab, onTabChange, renderLabel,
}: {
  activeTab: DetailTab;
  onTabChange: (t: DetailTab) => void;
  renderLabel: (t: DetailTab) => React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [checkScroll]);

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -120 : 120, behavior: 'smooth' });
  };

  return (
    <div className="flex-none relative border-b border-line">
      {canScrollLeft && (
        <button className="absolute left-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-bg border-r border-line cursor-pointer border-y-0 border-l-0" onClick={() => scroll('left')}>
          <ChevronLeft size={14} className="text-subtle" />
        </button>
      )}
      <div ref={scrollRef} className="flex px-2 overflow-x-auto hidden-scroll">
        {TABS.map(tab => (
          <button
            key={tab}
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === tab ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
            }`}
            onClick={() => onTabChange(tab)}
          >
            {renderLabel(tab)}
          </button>
        ))}
      </div>
      {canScrollRight && (
        <button className="absolute right-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-bg border-l border-line cursor-pointer border-y-0 border-r-0" onClick={() => scroll('right')}>
          <ChevronRight size={14} className="text-subtle" />
        </button>
      )}
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function SummaryBlock({ row }: { row: BookRow }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.summary ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setDraft(row.summary ?? ''); setEditing(false); }, [row.contract_id, row.summary]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await setDunningSummary(row.contract_id, draft.trim());
      queryClient.invalidateQueries({ queryKey: ccKeys.bookRow(row.contract_id) });
      queryClient.invalidateQueries({ queryKey: ccKeys.timeline(row.contract_id) });
      queryClient.invalidateQueries({ queryKey: ['cc', 'book'] });
      setEditing(false);
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={18} /><span>{t('callCenter.summarySaved')}</span></div>,
        type: 'success', duration: 2500,
      });
    } catch (err) {
      setError(err instanceof ApiError ? (err.message || t('common.error')) : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-warning-soft border border-warning-border rounded-md px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-subtle">{t('callCenter.summary')}</span>
        {!editing && (
          <button
            className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
            onClick={() => setEditing(true)}
          >
            <Pencil size={12} />{t('callCenter.editSummary')}
          </button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <TextArea
            className="w-full"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('callCenter.summaryPlaceholder')}
            rows={3}
            autoFocus
          />
          {error && <div className="alert alert-danger"><XCircle size={16} /><span>{error}</span></div>}
          <div className="flex gap-2">
            <Button color="primary" size="sm" disabled={saving || !draft.trim()} onClick={save} startIcon={<Save size={14} />}>
              {t('common.save')}
            </Button>
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => { setDraft(row.summary ?? ''); setEditing(false); setError(''); }}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <button
          className="text-sm text-left w-full bg-transparent border-none p-0 cursor-text whitespace-pre-wrap"
          onClick={() => setEditing(true)}
        >
          {row.summary
            ? row.summary
            : <span className="text-subtler italic">{t('callCenter.summaryEmpty')}</span>}
        </button>
      )}
      {row.summary_at && !editing && (
        <div className="text-xs text-subtle mt-1.5 flex items-center gap-1">
          <Clock size={11} className="shrink-0" />
          <span>{t('callCenter.summaryUpdated')}</span>
          <DateTime value={row.summary_at} />
        </div>
      )}
    </div>
  );
}

function LogActivity({ row }: { row: BookRow }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { data: eventTypes } = useActorEventTypes();
  const [action, setAction] = useState<string>('CALL');
  const [result, setResult] = useState<string>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { data: results } = useActionResults(action || null);

  // Reset the picked result whenever the action changes.
  useEffect(() => { setResult(''); }, [action]);
  useEffect(() => { setAction('CALL'); setResult(''); setNote(''); setError(''); }, [row.contract_id]);

  const actionOptions = (eventTypes ?? []).map(e => ({
    value: e.code, label: t(`callCenter.event.${e.code}`, { defaultValue: e.code }),
  }));
  const resultOptions = (results ?? []).map(r => ({
    value: r.result_code, label: t(`callCenter.result_code.${r.result_code}`, { defaultValue: r.result_code }),
  }));
  const needsResult = resultOptions.length > 0;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await logDunningAction({
        contractId: row.contract_id,
        event: action,
        resultCode: needsResult ? (result || null) : null,
        note: note.trim() || null,
      });
      queryClient.invalidateQueries({ queryKey: ccKeys.timeline(row.contract_id) });
      queryClient.invalidateQueries({ queryKey: ccKeys.bookRow(row.contract_id) });
      queryClient.invalidateQueries({ queryKey: ['cc', 'book'] });
      setResult(''); setNote('');
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={18} /><span>{t('callCenter.logSaved')}</span></div>,
        type: 'success', duration: 2500,
      });
    } catch (err) {
      setError(err instanceof ApiError ? (err.message || t('common.error')) : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const canSave = !!action && (!needsResult || !!result) && !saving;

  return (
    <section className="border-t border-line pt-4 flex flex-col gap-3">
      <h3 className="text-sm font-medium">{t('callCenter.logAction')}</h3>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="form-label">{t('callCenter.actionLabel')}</label>
            <Select
              options={actionOptions}
              value={action || null}
              onChange={(v) => setAction((v as string) ?? 'CALL')}
              placeholder={t('callCenter.selectAction')}
              size="sm"
            />
          </div>
          {needsResult && (
            <div className="flex flex-col gap-1">
              <label className="form-label">{t('callCenter.resultLabel')}</label>
              <Select
                options={resultOptions}
                value={result || null}
                onChange={(v) => setResult((v as string) ?? '')}
                placeholder={t('callCenter.selectResult')}
                size="sm"
              />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="form-label">{t('callCenter.noteLabel')}</label>
          <TextArea
            className="w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('callCenter.notePlaceholder')}
            rows={2}
          />
        </div>
        {error && <div className="alert alert-danger"><XCircle size={16} /><span>{error}</span></div>}
        <div className="flex justify-end">
          <Button color="primary" size="sm" disabled={!canSave} onClick={save} startIcon={<Phone size={14} />}>
            {saving ? t('callCenter.logging') : t('callCenter.logButton')}
          </Button>
        </div>
      </div>
    </section>
  );
}

function OverviewTab({ row }: { row: BookRow }) {
  const { t } = useTranslation();
  const { data: flagLevels } = useFlagLevels();
  const queryClient = useQueryClient();
  const [flagOpen, setFlagOpen] = useState(false);
  const [promiseOpen, setPromiseOpen] = useState(false);

  const { data: appointment } = useActiveAppointment(row.contract_id);
  const { data: icloud } = useContractIcloud(row.contract_id);

  const refreshRow = () => {
    queryClient.invalidateQueries({ queryKey: ccKeys.bookRow(row.contract_id) });
    queryClient.invalidateQueries({ queryKey: ccKeys.timeline(row.contract_id) });
    queryClient.invalidateQueries({ queryKey: ccKeys.appointment(row.contract_id) });
    queryClient.invalidateQueries({ queryKey: ['cc', 'book'] });
  };

  // open_promise_date is the sortable column; the appointment view carries the
  // note. Prefer whichever date is present.
  const promiseDate = appointment?.appointment_date ?? row.open_promise_date;

  return (
    <div className="flex flex-col gap-4 p-4">
      <SummaryBlock row={row} />

      {/* Flags + status. The flag pair carries a "change" button. */}
      <div className="flex items-center gap-3 flex-wrap">
        <FlagPair
          auto={row.auto_flag_level}
          manual={row.manual_flag_level}
          divergent={row.flag_divergent}
          levels={flagLevels}
          showLabels
        />
        <Button variant="ghost" size="sm" startIcon={<Flag size={14} />} onClick={() => setFlagOpen(true)}>
          {t('callCenter.changeFlag')}
        </Button>
        <DunningStatusBadge status={row.dunning_status} />
        <SkipReasonBadge reason={row.dunning_skip_reason} />
      </div>

      {/* Appointment (promise) — badge if one stands, else the "log promise" CTA */}
      <div className="flex items-center gap-2 flex-wrap">
        {promiseDate ? (
          <>
            <AppointmentBadge date={promiseDate} />
            {appointment?.appointment_note && (
              <span className="text-xs text-subtle truncate">{appointment.appointment_note}</span>
            )}
            <Button variant="ghost" size="sm" startIcon={<CalendarClock size={14} />} onClick={() => setPromiseOpen(true)}>
              {t('callCenter.reschedulePromise')}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" startIcon={<CalendarClock size={14} />} onClick={() => setPromiseOpen(true)}>
            {t('callCenter.logPromise')}
          </Button>
        )}
      </div>

      {/* Money */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-subtle">{t('callCenter.outstanding')}</div>
          <div className="font-medium">฿{fmtCurrency(row.outstanding)}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('callCenter.overdueAmount')}</div>
          <div className="font-medium">
            ฿{fmtCurrency(row.overdue_amount)}
            {row.overdue_count > 0 && (
              <span className="text-subtle text-xs ml-1">
                ({t('callCenter.installmentsOverdue', { count: row.overdue_count })})
              </span>
            )}
          </div>
        </div>
        {row.is_overdue && (
          <div>
            <div className="text-xs text-subtle">{t('callCenter.overdueDaysShort', { n: row.overdue_days })}</div>
            <div>
              <Badge size="sm" color={overdueColor(row.overdue_days)}>
                {t('callCenter.overdueDays', { n: row.overdue_days })}
              </Badge>
            </div>
          </div>
        )}
        {row.next_due_date && (
          <div>
            <div className="text-xs text-subtle">{t('callCenter.nextDue')}</div>
            <div className="flex items-center gap-1.5">
              <DateTime value={row.next_due_date} showTime={false} />
              {row.next_due_amount != null && <span className="text-subtle text-xs">฿{fmtCurrency(row.next_due_amount)}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Late fee — separate line, capped balance, never summed into overdue */}
      {row.late_fee_balance > 0 && (
        <div className="text-sm text-subtle">
          {t('callCenter.lateFeeAccrued', {
            fee: fmtCurrency(row.late_fee_balance),
            perDay: fmtCurrency(row.late_fee_per_day),
          })}
        </div>
      )}

      {/* Device — model + code link, context badges, loaner identity */}
      {(row.device_code_display || row.product_display_name || row.device_in_repair || row.device_deposited || row.has_loaner) && (
        <div className="flex flex-col gap-2 border border-line rounded-md p-3">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <Smartphone size={15} className="text-subtle shrink-0" />
            <span className="text-xs text-subtle shrink-0">{t('callCenter.boundDevice')}</span>
            {(row.device_code_display || row.product_display_name) ? (
              <DeviceLink
                deviceId={row.device_id}
                code={row.device_code_display}
                product={row.product_display_name}
                className="text-sm"
              />
            ) : (
              <span className="text-subtler text-xs">{t('callCenter.noDevice')}</span>
            )}
          </div>
          {(row.device_in_repair || row.device_deposited || row.has_loaner) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <DeviceContextBadges
                inRepair={row.device_in_repair}
                deposited={row.device_deposited}
                hasLoaner={row.has_loaner}
              />
            </div>
          )}
          {row.has_loaner && (row.loaner_code_display || row.loaner_product_display_name) && (
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-xs text-subtle shrink-0">{t('callCenter.loanerDevice')}</span>
              <DeviceLink
                deviceId={row.loaner_device_id}
                code={row.loaner_code_display}
                product={row.loaner_product_display_name}
                className="text-sm"
              />
            </div>
          )}
        </div>
      )}

      {/* iCloud pool account — Apple ID + audited reveal */}
      {icloud?.device_icloud_account_id && (
        <div className="flex flex-col gap-2 border border-line rounded-md p-3">
          <div className="flex items-center gap-2 text-sm">
            <Cloud size={15} className="text-subtle shrink-0" />
            <span className="text-xs text-subtle shrink-0">{t('callCenter.icloudAppleId')}</span>
            <span className="font-medium truncate">
              {icloud.device_icloud_apple_id || icloud.device_icloud_email || '—'}
            </span>
          </div>
          <IcloudRevealButton accountId={icloud.device_icloud_account_id} />
        </div>
      )}

      <LogActivity row={row} />

      <FlagChangeModal
        open={flagOpen}
        contractId={row.contract_id}
        currentManual={row.manual_flag_level}
        onClose={() => setFlagOpen(false)}
        onChanged={refreshRow}
      />
      <PromiseModal
        open={promiseOpen}
        contractId={row.contract_id}
        onClose={() => setPromiseOpen(false)}
        onSaved={refreshRow}
      />
    </div>
  );
}

// ── Installments tab (payment_state, NEVER status) ──────────────────────────

function paymentStateColor(state: string): 'success' | 'danger' | 'warning' | 'info' | 'default' {
  switch (state) {
    case 'PAID': return 'success';
    case 'OVERDUE': return 'danger';
    case 'PARTIAL': return 'warning';
    case 'DUE_TODAY': return 'warning';
    case 'UPCOMING': return 'info';
    default: return 'default';
  }
}

function InstallmentsTab({ contractId }: { contractId: number }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ccKeys.installments(contractId),
    queryFn: () => apiClient.get<InstallmentRow[]>(`/v_installments?contract_id=eq.${contractId}&order=pay_no.asc`),
  });

  if (isLoading) return <div className="p-4 text-subtle">{t('common.loading')}</div>;
  if (!data || data.length === 0) return <div className="p-4 text-subtler">{t('callCenter.noInstallments')}</div>;

  return (
    <div className="p-4">
      <div className="divide-y divide-line border border-line rounded-md overflow-hidden">
        {data.map(inst => (
          <div key={inst.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="text-subtle w-8 shrink-0">#{inst.pay_no}</span>
            <div className="flex-1 min-w-0">
              <DateTime value={inst.due_date} showTime={false} className="text-sm" />
              {inst.payment_state === 'OVERDUE' && inst.days_past_due > 0 && (
                <span className="text-xs text-danger-fg ml-2">{t('callCenter.daysPastDue', { n: inst.days_past_due })}</span>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="font-medium">฿{fmtCurrency(inst.due_amount)}</div>
              {inst.outstanding_amount > 0 && inst.outstanding_amount !== inst.due_amount && (
                <div className="text-xs text-subtle">{t('callCenter.outstandingAmount')} ฿{fmtCurrency(inst.outstanding_amount)}</div>
              )}
            </div>
            <Badge size="sm" color={paymentStateColor(inst.payment_state)}>
              {t(`callCenter.paymentState.${inst.payment_state}`, { defaultValue: inst.payment_state })}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Contacts tab ─────────────────────────────────────────────────────────────

function ContactsTab({ contractId }: { contractId: number }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ccKeys.contacts(contractId),
    queryFn: async () => {
      const rows = await apiClient.get<ContactBook[]>(`/v_contract_contact_book?contract_id=eq.${contractId}`);
      return rows[0] ?? null;
    },
  });

  if (isLoading) return <div className="p-4 text-subtle">{t('common.loading')}</div>;
  if (!data) return <div className="p-4 text-subtler">{t('callCenter.noContacts')}</div>;

  const telLink = (tel: string) => (
    <a href={`tel:${tel.replace(/\D/g, '')}`} className="text-primary-fg hover:underline inline-flex items-center gap-1">
      <Phone size={13} />{formatTel(tel)}
    </a>
  );

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Customer channels */}
      <div className="flex flex-col gap-2">
        {data.customer_tel && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-subtle w-20 shrink-0">{t('callCenter.customerTel')}</span>
            {telLink(data.customer_tel)}
          </div>
        )}
        {data.customer_tel2 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-subtle w-20 shrink-0">{t('callCenter.customerTel2')}</span>
            {telLink(data.customer_tel2)}
          </div>
        )}
        {data.other_contacts?.map((c, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="text-xs text-subtle w-20 shrink-0">
              {t(`callCenter.contactType.${c.contact_type}`, { defaultValue: c.contact_type })}
            </span>
            {c.value.startsWith('http') ? (
              <a href={c.value} target="_blank" rel="noreferrer" className="text-primary-fg hover:underline inline-flex items-center gap-1 truncate">
                {c.label || c.value}<ExternalLink size={12} />
              </a>
            ) : (
              <span className="truncate">{c.label ? `${c.label}: ${c.value}` : c.value}</span>
            )}
          </div>
        ))}
      </div>

      {/* References */}
      {data.references?.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-subtle" />
            <span className="text-sm font-medium">{t('callCenter.references')}</span>
          </div>
          <div className="text-xs text-subtler">{t('callCenter.referencesHint')}</div>
          <div className="divide-y divide-line border border-line rounded-md">
            {data.references.map(ref => (
              <div key={ref.reference_id} className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{ref.name || '—'}</div>
                  {ref.relation && <div className="text-xs text-subtle">{ref.relation}</div>}
                </div>
                {ref.tel && telLink(ref.tel)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── History tab (immutable timeline) ────────────────────────────────────────

function HistoryTab({ contractId }: { contractId: number }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ccKeys.timeline(contractId),
    queryFn: () => apiClient.get<TimelineRow[]>(`/v_contract_dunning_timeline?contract_id=eq.${contractId}&order=created_at.desc`),
  });

  if (isLoading) return <div className="p-4 text-subtle">{t('common.loading')}</div>;
  if (!data || data.length === 0) return <div className="p-4 text-subtler">{t('callCenter.noHistory')}</div>;

  return (
    <div className="p-4">
      <div className="divide-y divide-line">
        {data.map(evt => {
          const actor = evt.is_system || !evt.actor_username ? t('callCenter.systemActor') : evt.actor_username;
          const note = typeof evt.payload?.note === 'string' ? evt.payload.note : null;
          const summaryFrom = evt.event_type === 'SUMMARY_UPDATED' && typeof evt.payload?.from === 'string' ? evt.payload.from : null;
          const summaryTo = evt.event_type === 'SUMMARY_UPDATED' && typeof evt.payload?.to === 'string' ? evt.payload.to : null;
          return (
            <div key={evt.id} className="flex gap-3 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">
                    {t(`callCenter.event.${evt.event_type}`, { defaultValue: evt.event_type })}
                  </span>
                  {evt.result_code && (
                    <Badge size="sm" color={evt.result_code.startsWith('REACHED') || evt.result_code === 'MET' ? 'success' : 'default'}>
                      {t(`callCenter.result_code.${evt.result_code}`, { defaultValue: evt.result_code })}
                    </Badge>
                  )}
                  <span className="text-xs text-subtle">{actor}</span>
                </div>
                {note && <div className="text-sm text-subtle mt-1 whitespace-pre-wrap">{note}</div>}
                {summaryFrom != null && (
                  <div className="text-xs text-subtle mt-1">
                    <span className="text-subtler">{t('callCenter.summaryFrom')}:</span> {summaryFrom || '—'}
                    {' → '}
                    <span className="text-subtler">{t('callCenter.summaryTo')}:</span> {summaryTo || '—'}
                  </div>
                )}
                <div className="text-xs text-subtler mt-1"><DateTime value={evt.created_at} /></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Container ────────────────────────────────────────────────────────────────

export function ContractDunningDetail({
  contractId, isMobile, initialTab, onTabChange,
}: {
  contractId: number;
  isMobile: boolean;
  initialTab?: DetailTab;
  onTabChange?: (t: DetailTab) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { openChat } = useChatDock();
  const [activeTab, setActiveTab] = useState<DetailTab>(initialTab ?? 'overview');
  const [focusPending, setFocusPending] = useState(false);

  // Desktop opens the floating dock so the collector keeps the dunning detail
  // on screen while replying. Mobile has no dock — chat is a full page there.
  const handleChatCustomer = () => {
    if (isMobile) navigate(`/admin/chat?contract=${contractId}`);
    else openChat(contractId);
  };

  useEffect(() => { if (initialTab) setActiveTab(initialTab); }, [initialTab]);

  const { data: row, isLoading, isError } = useQuery({
    queryKey: ccKeys.bookRow(contractId),
    queryFn: async () => {
      const rows = await apiClient.get<BookRow[]>(`/v_my_book?contract_id=eq.${contractId}`);
      return rows[0] ?? null;
    },
  });

  const toggleFocus = async () => {
    if (!row) return;
    setFocusPending(true);
    try {
      const res = row.on_focus ? await focusRemove(contractId) : await focusAdd(contractId);
      queryClient.setQueryData(ccKeys.bookRow(contractId), { ...row, on_focus: res.on_focus });
      queryClient.invalidateQueries({ queryKey: ['cc', 'book'] });
    } catch {
      addSnackbar({
        message: <div className="alert alert-danger"><XCircle size={18} /><span>{t('common.error')}</span></div>,
        type: 'error', duration: 2500,
      });
    } finally {
      setFocusPending(false);
    }
  };

  const switchTab = (tab: DetailTab) => { setActiveTab(tab); onTabChange?.(tab); };

  if (isLoading) return <div className="p-4 text-subtle">{t('common.loading')}</div>;
  if (isError || !row) {
    return (
      <div className="p-4">
        <div className="alert alert-danger"><XCircle size={18} /><span>{t('common.error')}</span></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {!isMobile && (
        <div className="flex-none flex items-center gap-2 h-panel-header-h px-4 border-b border-line">
          <span className="font-semibold truncate">{row.contract_code_display}</span>
          <span className="text-sm text-subtle truncate">{row.customer_name}</span>
          <div className="ml-auto shrink-0 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              startIcon={<MessageSquare size={14} />}
              onClick={handleChatCustomer}
            >
              {t('callCenter.chatCustomer')}
            </Button>
            <Button
              variant={row.on_focus ? 'outline' : 'solid'}
              color="primary"
              size="sm"
              disabled={focusPending}
              onClick={toggleFocus}
            >
              {row.on_focus ? t('callCenter.removeFromFocus') : t('callCenter.addToFocus')}
            </Button>
          </div>
        </div>
      )}

      <ScrollableTabs
        activeTab={activeTab}
        onTabChange={switchTab}
        renderLabel={(tab) => {
          if (tab === 'overview') return t('callCenter.tabOverview');
          if (tab === 'installments') return t('callCenter.tabInstallments');
          if (tab === 'history') return t('callCenter.tabHistory');
          return t('callCenter.tabContacts');
        }}
      />

      <div className="flex-1 min-h-0 overflow-y-auto better-scroll">
        {isMobile && (
          <div className="px-4 pt-3 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              startIcon={<MessageSquare size={14} />}
              onClick={handleChatCustomer}
            >
              {t('callCenter.chatCustomer')}
            </Button>
            <Button
              variant={row.on_focus ? 'outline' : 'solid'}
              color="primary"
              size="sm"
              disabled={focusPending}
              onClick={toggleFocus}
            >
              {row.on_focus ? t('callCenter.removeFromFocus') : t('callCenter.addToFocus')}
            </Button>
          </div>
        )}
        {activeTab === 'overview' && <OverviewTab row={row} />}
        {activeTab === 'installments' && <InstallmentsTab contractId={contractId} />}
        {activeTab === 'contacts' && <ContactsTab contractId={contractId} />}
        {activeTab === 'history' && <HistoryTab contractId={contractId} />}
      </div>
    </div>
  );
}
