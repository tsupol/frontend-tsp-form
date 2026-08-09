// Company → ABM account OTP. Canonical spec: UI_SUMMARY/137_ABM_OTP_RELAY.md,
// plus UI_FEEDBACK/2026-08-07_IMPLEMENT_abm_account_otp.md. DB live since mig 1035-1037.
//
// The problem: enrolling a device into MDM means logging into the company's
// Apple Business Manager account, and Apple texts the OTP to one phone. Staff
// used to phone whoever held that SIM. Now that phone forwards its SMS into NNF
// (via an iOS Shortcut) and whoever is mid-login reads the code themselves.
//
// The load-bearing rule for the whole screen: the unit of meaning is the ABM
// ACCOUNT (login_email), not the code. A company can have several ABM accounts
// and several people logging in at once, so an OTP shown without its email is
// worse than useless — someone will grab the wrong one. login_email and
// otp_code therefore always render on the same line, never apart.
//
// Two more traps the spec calls out:
//  - otp_code can be null (the parser didn't recognise Apple's wording). Always
//    show the full sms_text so the code is still readable by eye.
//  - last_message_at null = the phone-side Shortcut was never set up correctly.
//    Badge it, or nobody finds out until someone is sitting there waiting.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Select, Switch, MobileHeader } from 'tsp-form';
import {
  ArrowRightFromLine, RefreshCw, Plus, Mail, AlertTriangle, Inbox, Smartphone,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { AbmOtpSourceCreateModal } from './AbmOtpSourceCreateModal';
import { AbmOtpSetupModal } from './AbmOtpSetupModal';
import type { AbmOtpSource, AbmOtpMessage } from './abmOtpTypes';

type Tab = 'view' | 'manage';

// Manage is restricted to these; View additionally allows branch staff. The
// view itself returns 0 rows to anyone without MDM.ABM_OTP_SOURCE_MANAGE, so
// this only decides whether the tab is worth showing.
const MAY_MANAGE = new Set(['COMPANY_ADMIN', 'BRANCH_MANAGER', 'HOLDING_ADMIN', 'SYSTEM_DEV']);

// Reading or replacing a key needs MDM.ABM_OTP_TOKEN_REVEAL, which is a
// STRICTLY narrower set than MAY_MANAGE — a branch manager sees these rows and
// can toggle them, but both key RPCs answer 403. So the two buttons hide by
// role, not by whether the row is visible (mig 1043).
const MAY_REVEAL_KEY = new Set(['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV']);

export function AbmOtpPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const companyId = user?.company_id ?? null;
  const mayManage = MAY_MANAGE.has(user?.role_code ?? '');
  const mayRevealKey = MAY_REVEAL_KEY.has(user?.role_code ?? '');

  const [tab, setTab] = useState<Tab>('view');
  const [createOpen, setCreateOpen] = useState(false);
  const [setupSource, setSetupSource] = useState<AbmOtpSource | null>(null);
  // Empty = every account, the project's clearable-filter convention.
  const [filterEmail, setFilterEmail] = useState<string>('');

  // No realtime push for OTP yet — a manual refresh button is the contract.
  // Codes are short-lived, so never serve a cached list.
  const messages = useQuery({
    queryKey: ['abm-otp', 'recent', companyId],
    queryFn: () => apiClient.get<AbmOtpMessage[]>(
      `/v_abm_otp_recent?company_id=eq.${companyId}&order=received_at.desc`,
    ),
    enabled: companyId != null,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const sources = useQuery({
    queryKey: ['abm-otp', 'sources', companyId],
    queryFn: () => apiClient.get<AbmOtpSource[]>(
      `/v_abm_otp_sources?company_id=eq.${companyId}&order=created_at.desc`,
    ),
    enabled: companyId != null && mayManage,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['abm-otp'] });
  };
  const refreshing = messages.isFetching || sources.isFetching;
  // A spinning icon is the only feedback a fast refetch gives, and it's over
  // before the eye lands on it — you press the button and can't tell whether
  // anything happened. So the button isn't the feedback: the timestamp says
  // what you're looking at, and the list dims while it's being replaced.
  const loadedAt = tab === 'view' ? messages.dataUpdatedAt : sources.dataUpdatedAt;

  // Narrowing to one ABM account is the real defence against the mistake this
  // screen exists to prevent: several people logging into different accounts at
  // once, and someone grabbing a code that isn't theirs. Reading carefully is
  // the fallback; filtering to the email you just typed makes it structural.
  //
  // Client-side on purpose. The view already caps at 10 messages PER ACCOUNT
  // server-side, so everything that could match is already in hand — a refetch
  // per filter change would be slower for identical rows. (This is the narrow
  // exception to the server-side-pagination rule, which exists to stop the FE
  // pulling an unbounded table; there isn't one here.)
  const allMessages = messages.data ?? [];
  // Built from the messages themselves, so the Select can never offer an
  // account with nothing to show behind it.
  const emailOptions = Array.from(new Set(allMessages.map(m => m.login_email)))
    .sort((a, b) => a.localeCompare(b))
    .map(email => ({ value: email, label: email }));
  const visibleMessages = filterEmail
    ? allMessages.filter(m => m.login_email === filterEmail)
    : allMessages;

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
        <div className="mobile-header-title mobile-header-title-truncate">{t('abmOtp.title')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      {/* Clamped to the viewport so the title, refresh and tabs stay put and
          only the rows scroll — on the View tab the list grows without bound
          and used to push the tabs off the top of the screen. */}
      <div className="page-content responsive-dvh-mobile-header flex flex-col gap-4 p-4">
        <div className="flex-none flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="heading-2 hidden lg:block">{t('abmOtp.title')}</h1>
            <p className="text-xs text-subtle mt-1">{t('abmOtp.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {loadedAt > 0 && (
              <span className="text-xs text-subtle">
                {t('abmOtp.loadedAt')} <DateTime value={new Date(loadedAt).toISOString()} showTime />
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              startIcon={<RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} />}
              onClick={refresh}
              disabled={refreshing}
            >
              {t('abmOtp.refresh')}
            </Button>
            {tab === 'manage' && mayManage && (
              <Button size="sm" color="primary" startIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
                {t('abmOtp.addAccount')}
              </Button>
            )}
          </div>
        </div>

        {mayManage && (
          <div className="flex-none flex border-b border-line">
            <TabButton active={tab === 'view'} onClick={() => setTab('view')} label={t('abmOtp.tabView')} />
            <TabButton active={tab === 'manage'} onClick={() => setTab('manage')} label={t('abmOtp.tabManage')} />
          </div>
        )}

        {/* Only worth showing once there's an ambiguity to resolve — with a
            single account the filter is a control that can only ever be a
            no-op. Select needs a fixed-width container in a flex row. */}
        {tab === 'view' && emailOptions.length > 1 && (
          <div className="flex-none" style={{ width: '20rem', maxWidth: '100%' }}>
            <Select
              options={emailOptions}
              value={filterEmail || null}
              onChange={(val) => setFilterEmail((val as string) ?? '')}
              placeholder={t('abmOtp.filterAllAccounts')}
              size="sm"
              showChevron
              clearable
            />
          </div>
        )}

        {/* The only scroll pane on the page. Dims while fetching, so the whole
            content reacts to a refresh rather than just a 14px icon. */}
        <div className={`flex-1 min-h-0 overflow-auto better-scroll pb-8 ${refreshing ? 'opacity-60' : ''} transition-opacity`}>
          {tab === 'view'
            ? (
              <OtpList
                rows={visibleMessages}
                loading={messages.isLoading}
                filtered={filterEmail !== ''}
                onClearFilter={() => setFilterEmail('')}
              />
            )
            : (
              <SourceList
                rows={sources.data ?? []}
                loading={sources.isLoading}
                onChanged={refresh}
                mayRevealKey={mayRevealKey}
                onOpenSetup={setSetupSource}
              />
            )}
        </div>
      </div>

      <AbmOtpSourceCreateModal
        open={createOpen}
        companyId={companyId}
        onClose={() => setCreateOpen(false)}
        onCreated={refresh}
      />

      <AbmOtpSetupModal
        open={setupSource !== null}
        sourceId={setupSource?.id ?? null}
        loginEmail={setupSource?.login_email ?? null}
        onClose={() => setSetupSource(null)}
        onRotated={refresh}
      />
    </>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
        active ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
      }`}
    >
      {label}
    </button>
  );
}

// ── Tab: View OTP ────────────────────────────────────────────────────────────
// The view already caps at 10 messages per ABM account, so a chatty account
// can't push a quiet one off the list. No client-side limit needed.

function OtpList({ rows, loading, filtered, onClearFilter }: {
  rows: AbmOtpMessage[];
  loading: boolean;
  /** A filter is narrowing the list — changes what an empty result means. */
  filtered: boolean;
  onClearFilter: () => void;
}) {
  const { t } = useTranslation();
  if (loading) return <p className="text-sm text-subtle">{t('common.loading')}</p>;
  if (rows.length === 0) {
    // 0 rows is a normal 200 response (no accounts yet, or none in scope) —
    // never an error state. But "this account has no codes" and "nothing has
    // arrived at all" are different facts, and someone waiting on a code needs
    // to know which one they're looking at — otherwise a stale filter reads as
    // a broken phone.
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <Inbox size={28} className="text-subtler" />
        <p className="text-sm text-subtle">
          {filtered ? t('abmOtp.noMessagesForAccount') : t('abmOtp.noMessages')}
        </p>
        {filtered ? (
          <Button size="sm" variant="ghost" onClick={onClearFilter}>
            {t('abmOtp.showAllAccounts')}
          </Button>
        ) : (
          <p className="text-xs text-subtler">{t('abmOtp.noMessagesHint')}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-line border-b border-line">
      {rows.map((row) => (
        <div key={row.id} className="py-3 flex flex-col gap-1.5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            {/* Email and code stay on one line together — the entire point of
                this screen. Never render the code on its own. */}
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <Mail size={14} className="shrink-0 text-subtler" />
              <span className="text-sm font-medium break-all">{row.login_email}</span>
              {row.owner_scope === 'BRANCH' && (
                <Badge size="xs" color="default">{t('abmOtp.scopeBranch')}</Badge>
              )}
            </div>
            <span className="text-xs text-subtle shrink-0">
              <DateTime value={row.received_at} showTime />
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {row.otp_code ? (
              <>
                <code className="font-mono text-xl tracking-widest select-all">{row.otp_code}</code>
                <CopyButton value={row.otp_code} size={15} />
              </>
            ) : (
              // Parser missed it — say so plainly and let them read sms_text.
              <span className="text-xs text-warning-fg inline-flex items-center gap-1">
                <AlertTriangle size={13} />{t('abmOtp.codeUnparsed')}
              </span>
            )}
          </div>

          {/* Full text always shown — it's the fallback when otp_code is null,
              and the sanity check when it isn't. */}
          <p className="text-xs text-subtle break-words">{row.sms_text}</p>
          {row.sender && <p className="text-xs text-subtler">{t('abmOtp.sender')}: {row.sender}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Tab: Manage ──────────────────────────────────────────────────────────────

function SourceList({ rows, loading, onChanged, mayRevealKey, onOpenSetup }: {
  rows: AbmOtpSource[];
  loading: boolean;
  onChanged: () => void;
  /** COMPANY_ADMIN and above only — see MAY_REVEAL_KEY. */
  mayRevealKey: boolean;
  onOpenSetup: (row: AbmOtpSource) => void;
}) {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const toggle = async (row: AbmOtpSource) => {
    setBusyId(row.id);
    setError('');
    try {
      await apiClient.rpc('fn_abm_otp_source_set_active', {
        p_source_id: row.id,
        p_is_active: !row.is_active,
      });
      onChanged();
    } catch {
      setError(t('abmOtp.toggleFailed'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="text-sm text-subtle">{t('common.loading')}</p>;
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <Mail size={28} className="text-subtler" />
        <p className="text-sm text-subtle">{t('abmOtp.noSources')}</p>
        <p className="text-xs text-subtler">{t('abmOtp.noSourcesHint')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <div className="alert alert-danger"><span>{error}</span></div>}
      <div className="flex flex-col divide-y divide-line border-b border-line">
        {rows.map((row) => (
          <div key={row.id} className="py-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium break-all">{row.login_email}</span>
                <Badge size="xs" color={row.owner_scope === 'BRANCH' ? 'default' : 'info'}>
                  {row.owner_scope === 'BRANCH'
                    ? (row.branch_name ?? t('abmOtp.scopeBranch'))
                    : t('abmOtp.scopeCompany')}
                </Badge>
                {!row.is_active && <Badge size="xs" color="danger">{t('abmOtp.inactive')}</Badge>}
              </div>
              {row.label && <span className="text-xs text-subtle">{row.label}</span>}

              {/* No message ever received = the phone-side Shortcut isn't
                  working. Surfacing it here is the only way anyone learns
                  before they're stuck waiting for a code that won't arrive. */}
              {row.last_message_at === null ? (
                <span className="text-xs text-warning-fg inline-flex items-center gap-1">
                  <AlertTriangle size={13} />{t('abmOtp.neverReceived')}
                </span>
              ) : (
                <span className="text-xs text-subtler">
                  {t('abmOtp.lastMessage')} <DateTime value={row.last_message_at} showTime />
                  {' · '}{t('abmOtp.messageCount', { n: row.message_count })}
                </span>
              )}
            </div>
            <div className="shrink-0 pt-0.5 flex items-center gap-2">
              {/* Opens the key + the phone recipe. Rotate lives inside that
                  modal rather than as a second row button — it's destructive
                  and should be reached only after seeing which account and
                  which key you're about to kill. */}
              {mayRevealKey && (
                <Button
                  size="sm"
                  variant="outline"
                  startIcon={<Smartphone size={14} />}
                  onClick={() => onOpenSetup(row)}
                >
                  {t('abmOtp.setup.openButton')}
                </Button>
              )}
              <Switch
                size="sm"
                checked={row.is_active}
                disabled={busyId === row.id}
                onChange={() => toggle(row)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
