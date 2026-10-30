// Company → SMS phones. Spec: UI_SUMMARY/154_SMS_RELAY.md, work order
// UI_FEEDBACK/2026-10-28_IMPLEMENT_sms_relay_1530.md (mig 1529-1530).
//
// Phones that receive the bank's money-in/money-out SMS for the company's
// accounts forward each message into NNF (iOS Shortcuts, same as the ABM OTP
// phone). The text is shown exactly as it arrived: no trimming, line breaks
// kept. Since mig 1537 the system also reads it (direction · amount · balance ·
// account · bank time) and shows that reading under the raw text with a badge
// — PARSED / SUSPECT / UNPARSED. The reading helps the person attaching the SMS
// to a line; it is never booked as money (KB #437). A "flagged" filter and a
// count on the inbox tab show what the parser could not read, so someone can
// tell a new bank format from a phone linked to the wrong account.
//
// Two tabs, each bound to its own permission (both COMPANY_ADMIN for now):
//   inbox  — v_sms_messages, newest first, filter by phone   (SMS.VIEW)
//   manage — v_sms_sources: add / edit / setup / key / on-off / link (SMS.MANAGE)
// ?tab= and ?source= are in the address so the sms_received notification can
// land on the inbox already filtered to the phone that sent it.

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, DataTable, MobileHeader, Modal, Select, Switch } from 'tsp-form';
import {
  AlertTriangle, ArrowRightFromLine, BellOff, Inbox, Link2, MessageSquareText,
  Plus, RefreshCw, Search, Smartphone, X,
} from 'lucide-react';
import { SmsFindPaymentModal } from './SmsFindPaymentModal';
import { SmsParseBadge, SmsParsedSummary } from '../../components/SmsLinkParts';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { useAuth } from '../../contexts/AuthContext';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { SmsSourceCreateModal } from './SmsSourceCreateModal';
import { SmsSourceEditModal } from './SmsSourceEditModal';
import { SmsSetupModal, SourceTargetBox } from './SmsSetupModal';
import { SmsLinkAccountModal } from './SmsLinkAccountModal';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { BankAccountLine } from '../../components/BankAccountLine';
import { accountLine, type SmsLinkedAccount, type SmsMessage, type SmsSource } from './smsRelayTypes';

type Tab = 'inbox' | 'manage';

export function SmsRelayPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { hasPermission, isLoading: permsLoading } = useMyPermissions();
  const canView = hasPermission('SMS.VIEW');
  const canManage = hasPermission('SMS.MANAGE');
  const companyId = user?.company_id ?? null;

  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'manage' && canManage ? 'manage'
    : tabParam === 'inbox' && canView ? 'inbox'
    : canView ? 'inbox' : 'manage';
  const filterSource = params.get('source') ?? '';
  // ?linked=unlinked — only SMS not yet attached to any line (the passbook's check bar links here).
  const unlinkedOnly = params.get('linked') === 'unlinked';
  // ?parse=flagged — only SMS the parser could not read, or read with a contradiction (mig 1537).
  const flaggedOnly = params.get('parse') === 'flagged';
  const canLink = hasPermission('SMS.LINK');
  const [findMessage, setFindMessage] = useState<SmsMessage | null>(null);

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };
  const setFilterSource = (id: string) => {
    const p = new URLSearchParams(params);
    if (id) p.set('source', id); else p.delete('source');
    setParams(p, { replace: true });
    setPageIndex(0);
  };
  const setUnlinkedOnly = (on: boolean) => {
    const p = new URLSearchParams(params);
    if (on) p.set('linked', 'unlinked'); else p.delete('linked');
    p.delete('parse');
    setParams(p, { replace: true });
    setPageIndex(0);
  };
  const setFlaggedOnly = () => {
    const p = new URLSearchParams(params);
    p.set('parse', 'flagged');
    p.delete('linked');
    setParams(p, { replace: true });
    setPageIndex(0);
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [editSource, setEditSource] = useState<SmsSource | null>(null);
  const [setupSource, setSetupSource] = useState<SmsSource | null>(null);
  const [linkSource, setLinkSource] = useState<SmsSource | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<{ source: SmsSource; account: SmsLinkedAccount } | null>(null);

  // No realtime push for this list — a refresh button is the contract. Never
  // serve a cached list: someone is usually waiting for a message to land.
  const messages = useQuery({
    queryKey: ['sms-relay', 'messages', filterSource, unlinkedOnly, flaggedOnly, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<SmsMessage>(
      `/v_sms_messages?order=received_at.desc${filterSource ? `&source_id=eq.${filterSource}` : ''}`
      + (unlinkedOnly ? '&link_id=is.null&is_duplicate=is.false' : '')
      + (flaggedOnly ? '&parse_status=neq.PARSED&is_duplicate=is.false' : ''),
      { page: pageIndex + 1, pageSize },
    ),
    enabled: canView,
    staleTime: 0,
    refetchOnMount: 'always',
    placeholderData: (prev) => prev,
  });

  // How many the parser could not read — the count on the inbox tab (doc 154 §4.1).
  const unparsed = useQuery({
    queryKey: ['sms-relay', 'unparsed-count', filterSource],
    queryFn: () => apiClient.count(`/v_sms_unparsed?select=message_id${filterSource ? `&source_id=eq.${filterSource}` : ''}`),
    enabled: canView,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const unparsedCount = unparsed.data ?? 0;

  const sources = useQuery({
    queryKey: ['sms-relay', 'sources'],
    queryFn: () => apiClient.get<SmsSource[]>('/v_sms_sources?order=created_at.desc'),
    enabled: canManage,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['sms-relay'] }); };
  const refreshing = messages.isFetching || sources.isFetching;
  const loadedAt = tab === 'inbox' ? messages.dataUpdatedAt : sources.dataUpdatedAt;

  // Phone filter: every phone the admin manages, plus the one in the address
  // if it isn't among them (arrived from a notification, list not loaded yet).
  const sourceRows = sources.data ?? [];
  const sourceOptions = sourceRows.map(s => ({ value: String(s.source_id), label: s.label }));
  if (filterSource && !sourceOptions.some(o => o.value === filterSource)) {
    const fromMsg = messages.data?.data.find(m => String(m.source_id) === filterSource);
    sourceOptions.push({ value: filterSource, label: fromMsg?.source_label ?? `#${filterSource}` });
  }

  const [toggleError, setToggleError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const toggleActive = async (row: SmsSource) => {
    setBusyId(row.source_id);
    setToggleError('');
    try {
      await apiClient.rpc('fn_sms_source_set_active', { p_source_id: row.source_id, p_is_active: !row.is_active });
      refresh();
    } catch (err) {
      setToggleError(err instanceof ApiError ? translateApiError(err, t) : t('smsRelay.toggleFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const noAccess = !permsLoading && !canView && !canManage;

  return (
    <>
      <MobileHeader className="mobile-header-bordered lg:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">{t('smsRelay.title')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header flex flex-col gap-4 p-4">
        <div className="flex-none flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="heading-2 hidden lg:block">{t('smsRelay.title')}</h1>
            <p className="text-xs text-subtle mt-1">{t('smsRelay.subtitle')}</p>
          </div>
          {!noAccess && (
            <div className="flex items-center gap-2 shrink-0">
              {loadedAt > 0 && (
                <span className="text-xs text-subtle">
                  {t('smsRelay.loadedAt')} <DateTime value={new Date(loadedAt).toISOString()} showTime />
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                startIcon={<RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} />}
                onClick={refresh}
                disabled={refreshing}
              >
                {t('smsRelay.refresh')}
              </Button>
              {tab === 'manage' && canManage && (
                <Button size="sm" color="primary" startIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
                  {t('smsRelay.addPhone')}
                </Button>
              )}
            </div>
          )}
        </div>

        {noAccess && <p className="text-sm text-subtle">{t('smsRelay.noAccess')}</p>}

        {canView && canManage && (
          <div className="flex-none flex border-b border-line">
            <TabButton active={tab === 'inbox'} onClick={() => setTab('inbox')} label={t('smsRelay.tabInbox')} count={unparsedCount} />
            <TabButton active={tab === 'manage'} onClick={() => setTab('manage')} label={t('smsRelay.tabManage')} />
          </div>
        )}

        {tab === 'inbox' && canView && (
          <>
            <div className="flex-none flex items-center gap-3 flex-wrap">
              <div className="btn-group">
                <Button size="sm" variant={!unlinkedOnly && !flaggedOnly ? 'solid' : 'outline'} color={!unlinkedOnly && !flaggedOnly ? 'primary' : 'default'} onClick={() => setUnlinkedOnly(false)}>
                  {t('smsRelay.linkFilterAll')}
                </Button>
                <Button size="sm" variant={unlinkedOnly ? 'solid' : 'outline'} color={unlinkedOnly ? 'primary' : 'default'} onClick={() => setUnlinkedOnly(true)}>
                  {t('smsRelay.linkFilterUnlinked')}
                </Button>
                <Button size="sm" variant={flaggedOnly ? 'solid' : 'outline'} color={flaggedOnly ? 'primary' : 'default'} onClick={setFlaggedOnly}>
                  {t('smsRelay.parseFilterFlagged')}{unparsedCount > 0 ? ` (${unparsedCount})` : ''}
                </Button>
              </div>
              {sourceOptions.length > 0 && (
                <div style={{ width: '20rem', maxWidth: '100%' }}>
                  <Select
                    options={sourceOptions}
                    value={filterSource || null}
                    onChange={(v) => setFilterSource((v as string) ?? '')}
                    placeholder={t('smsRelay.filterAllPhones')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
              )}
            </div>
            <DataTable<SmsMessage>
              outlined
              data={messages.data?.data ?? []}
              renderRow={(row) => <MessageRow m={row.original} onFind={canLink ? () => setFindMessage(row.original) : undefined} />}
              enablePagination
              pageIndex={pageIndex}
              pageSize={pageSize}
              pageSizeOptions={[25, 50, 100]}
              rowCount={messages.data?.totalCount ?? 0}
              onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
              className={`flex-1 min-h-0 ${refreshing ? 'opacity-60' : ''} transition-opacity`}
              noResults={
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Inbox size={28} className="text-subtler" />
                  <p className="text-sm text-subtle">
                    {messages.isLoading ? t('common.loading')
                      : unlinkedOnly ? t('smsRelay.noUnlinked')
                      : flaggedOnly ? t('smsRelay.noFlagged')
                      : filterSource ? t('smsRelay.noMessagesForPhone') : t('smsRelay.noMessages')}
                  </p>
                  {!messages.isLoading && filterSource && (
                    <Button size="sm" variant="ghost" onClick={() => setFilterSource('')}>
                      {t('smsRelay.showAllPhones')}
                    </Button>
                  )}
                </div>
              }
            />
          </>
        )}

        {tab === 'manage' && canManage && (
          <>
            {toggleError && (
              <div className="flex-none alert alert-danger"><AlertTriangle size={16} className="shrink-0" /><span>{toggleError}</span></div>
            )}
            <DataTable<SmsSource>
              outlined
              data={sourceRows}
              renderRow={(row) => (
                <SourceRow
                  s={row.original}
                  busy={busyId === row.original.source_id}
                  onEdit={() => setEditSource(row.original)}
                  onSetup={() => setSetupSource(row.original)}
                  onLink={() => setLinkSource(row.original)}
                  onUnlink={(account) => setUnlinkTarget({ source: row.original, account })}
                  onToggle={() => toggleActive(row.original)}
                />
              )}
              className={`flex-1 min-h-0 ${refreshing ? 'opacity-60' : ''} transition-opacity`}
              noResults={
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Smartphone size={28} className="text-subtler" />
                  <p className="text-sm text-subtle">{sources.isLoading ? t('common.loading') : t('smsRelay.noPhones')}</p>
                  {!sources.isLoading && <p className="text-xs text-subtler">{t('smsRelay.noPhonesHint')}</p>}
                </div>
              }
            />
          </>
        )}
      </div>

      <SmsSourceCreateModal
        open={createOpen}
        companyId={companyId}
        onClose={() => setCreateOpen(false)}
        onCreated={refresh}
        onOpenMessages={(sourceId) => {
          setCreateOpen(false);
          const p = new URLSearchParams(params);
          p.set('tab', 'inbox');
          p.set('source', String(sourceId));
          setParams(p, { replace: true });
          setPageIndex(0);
        }}
      />
      <SmsSourceEditModal
        open={editSource !== null}
        source={editSource}
        onClose={() => setEditSource(null)}
        onSaved={refresh}
      />
      <SmsSetupModal
        open={setupSource !== null}
        sourceId={setupSource?.source_id ?? null}
        label={setupSource?.label ?? null}
        lastMessageAt={setupSource?.last_message_at ?? null}
        onClose={() => setSetupSource(null)}
        onRotated={refresh}
      />
      <SmsLinkAccountModal
        open={linkSource !== null}
        source={linkSource}
        onClose={() => setLinkSource(null)}
        onLinked={refresh}
      />
      <UnlinkConfirm
        target={unlinkTarget}
        onClose={() => setUnlinkTarget(null)}
        onUnlinked={refresh}
      />
      <SmsFindPaymentModal open={findMessage !== null} message={findMessage} onClose={() => setFindMessage(null)} />
    </>
  );
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 inline-flex items-center gap-1.5 ${
        active ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
      }`}
    >
      {label}
      {/* SMS the parser could not read — someone should look (doc 154 §4.1). */}
      {count != null && count > 0 && <Badge size="xs" color="warning">{count}</Badge>}
    </button>
  );
}

// ── Inbox row ────────────────────────────────────────────────────────────────

function MessageRow({ m, onFind }: { m: SmsMessage; onFind?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-3 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-sm font-medium break-words">{m.purpose}</span>
          {m.is_duplicate && <Badge size="xs" color="warning">{t('smsRelay.duplicate')}</Badge>}
          {!m.is_duplicate && <SmsParseBadge status={m.parse_status} reason={m.suspect_reason} />}
          {/* Is this SMS the slip of a line yet? A repeat of another SMS is never attached. */}
          {!m.is_duplicate && (m.link_id != null ? (
            <Badge size="xs" color={m.linked_amount_matches === false ? 'warning' : 'success'}>
              <span className="inline-flex items-center gap-1">
                {m.linked_amount_matches === false ? <AlertTriangle size={11} /> : <Link2 size={11} />}
                {t('smsRelay.linkedTo', { doc: m.linked_doc_code ?? `#${m.linked_payment_id}` })}
              </span>
            </Badge>
          ) : (
            <Badge size="xs" color="default">{t('smsRelay.notLinked')}</Badge>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-subtle"><DateTime value={m.received_at} showTime /></span>
          {onFind && !m.is_duplicate && (
            <Button size="sm" variant="outline" startIcon={<Search size={14} />} onClick={onFind}>
              {t('smsRelay.findLine')}
            </Button>
          )}
        </div>
      </div>
      <div className="text-xs text-subtle flex items-center gap-1.5 flex-wrap">
        <Smartphone size={12} className="shrink-0" />
        <span>{m.source_label}</span>
        {m.sender && <span>· {t('smsRelay.sender')}: {m.sender}</span>}
      </div>
      {/* Exactly as received — never trimmed or reflowed. */}
      <p className="text-sm whitespace-pre-wrap break-words rounded-md bg-surface border border-line px-3 py-2">{m.sms_text}</p>
      {/* What the system read out of it (mig 1537) — a reading, shown under the evidence, never instead of it. */}
      <SmsParsedSummary
        parsed={{
          status: m.parse_status, direction: m.direction, amount: m.parsed_amount, balance_after: m.balance_after,
          our_account_last4: m.our_account_last4, counter_account_last4: m.counter_account_last4, counter_role: m.counter_role,
          bank_time: m.bank_time, pattern_code: m.pattern_code, suspect_reason: m.suspect_reason,
        }}
      />
    </div>
  );
}

// ── Manage row ───────────────────────────────────────────────────────────────
// A click on the row opens the editor; the buttons on the right do the rest.

function SourceRow({ s, busy, onEdit, onSetup, onLink, onUnlink, onToggle }: {
  s: SmsSource;
  busy: boolean;
  onEdit: () => void;
  onSetup: () => void;
  onLink: () => void;
  onUnlink: (account: SmsLinkedAccount) => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => { if (e.key === 'Enter') onEdit(); }}
      className="px-4 py-3 flex items-start justify-between gap-3 cursor-pointer"
    >
      <div className="min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium break-words">{s.label}</span>
          {!s.is_active && <Badge size="xs" color="danger">{t('smsRelay.inactive')}</Badge>}
          {!s.notify && (
            <Badge size="xs" color="default">
              <span className="inline-flex items-center gap-1"><BellOff size={11} />{t('smsRelay.notifyOff')}</span>
            </Badge>
          )}
        </div>
        <span className="text-xs text-subtle break-words">{s.purpose}</span>

        {s.linked_accounts.length > 0 ? (
          <div className="flex flex-col gap-1 mt-0.5">
            {s.linked_accounts.map(a => (
              <span key={a.link_id} className="inline-flex items-center gap-1.5 min-w-0">
                <BankAccountLine account={a} size={22} />
                <button
                  type="button"
                  className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-subtler hover:text-danger-fg hover:bg-surface-hover cursor-pointer bg-transparent border-none"
                  aria-label={t('smsRelay.unlink.button')}
                  onClick={(e) => { stop(e); onUnlink(a); }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-subtle">{t('smsRelay.noLinkedAccount')}</span>
        )}

        {s.last_message_at === null ? (
          <span className="text-xs text-warning-fg inline-flex items-center gap-1">
            <AlertTriangle size={13} className="shrink-0" />{t('smsRelay.neverReceived')}
          </span>
        ) : (
          <span className="text-xs text-subtle inline-flex items-center gap-1 flex-wrap">
            <MessageSquareText size={12} className="shrink-0" />
            {t('smsRelay.lastMessage')} <DateTime value={s.last_message_at} showTime />
            {' · '}{t('smsRelay.todayCount', { n: s.messages_today })}
            {s.dups_today > 0 && <> {t('smsRelay.todayDups', { n: s.dups_today })}</>}
            {' · '}{t('smsRelay.totalCount', { n: s.messages_total })}
          </span>
        )}
      </div>
      <div className="shrink-0 pt-0.5 flex items-center gap-2 flex-wrap justify-end" onClick={stop} onKeyDown={stop}>
        <Button size="sm" variant="outline" startIcon={<Link2 size={14} />} disabled={busy} onClick={onLink}>
          {s.linked_accounts.length > 0 ? t('smsRelay.link.changeButton') : t('smsRelay.link.button')}
        </Button>
        <Button size="sm" variant="outline" startIcon={<Smartphone size={14} />} onClick={onSetup}>
          {t('smsRelay.setup.title')}
        </Button>
        <Switch size="sm" checked={s.is_active} disabled={busy} onChange={onToggle} aria-label={t('smsRelay.activeSwitch')} />
      </div>
    </div>
  );
}

// ── Unlink confirm ───────────────────────────────────────────────────────────

function UnlinkConfirm({ target: targetProp, onClose, onUnlinked }: {
  target: { source: SmsSource; account: SmsLinkedAccount } | null;
  onClose: () => void;
  onUnlinked: () => void;
}) {
  const { t } = useTranslation();
  const last = useRef(targetProp);
  if (targetProp) last.current = targetProp;
  const target = targetProp ?? last.current;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const open = targetProp !== null;
  useEffect(() => {
    if (open) { setView('form'); setBusy(false); setError(''); }
  }, [open]);

  const close = () => { if (busy) return; onClose(); };

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.rpc('fn_sms_source_unlink_account', { p_link_id: target.account.link_id });
      setView('done');
      onUnlinked();
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('smsRelay.unlink.title')}</h2>
        <button type="button" className="modal-close-btn" onClick={close}>&times;</button>
      </div>
      {view === 'done' ? (
        <ActionDoneView
          headline={t('smsRelay.unlink.done')}
          contractCode={target?.source.label ?? ''}
          detailRows={target ? [{ label: t('smsRelay.link.account'), value: accountLine(target.account) }] : []}
          onClose={onClose}
        />
      ) : (
        <>
          <div className="modal-content">
            <SourceTargetBox label={target?.source.label ?? null} purpose={target ? accountLine(target.account) : null} />
            <p className="text-sm text-subtle mt-3">{t('smsRelay.unlink.body')}</p>
          </div>
          <ModalErrorBand message={error} onDismiss={() => setError('')} />
          <div className="modal-footer">
            <Button variant="ghost" onClick={close} disabled={busy}>{t('common.cancel')}</Button>
            <Button color="danger" onClick={submit} disabled={busy}>{t('smsRelay.unlink.submit')}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
