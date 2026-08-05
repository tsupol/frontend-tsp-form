// NNF App — staff console for customers who can't get into the customer app.
// Preventive: branches open it daily and see trouble before the customer is
// stuck. Two tabs:
//   ① ต้องช่วยเหลือ (Needs help)  — who can't get in now → call / reset
//   ② ความผิดปกติ (Anomalies)     — who's using it abnormally → follow up early
//
// Unit = contract (1 row = 1 contract, lessees[] holds everyone). Scope is
// automatic from the JWT — this page never gates on role. Company users get a
// branch column; branch users don't.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Badge, Button, Tooltip } from 'tsp-form';
import {
  ArrowRightFromLine, Phone, KeyRound, BellOff, EyeOff, ExternalLink,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { formatTel } from '../../lib/format';
import { ResetCustomerLoginModal } from '../../components/ResetCustomerLoginModal';
import {
  nnfAppKeys, isInstallingNow,
  type AppAccessRow, type AppAnomalyRow, type AppActionCode, type AnomalyCode,
} from './nnfAppApi';

type Tab = 'access' | 'anomaly';

export function NnfAppPage() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const isCompanyUser = !user?.branch_id; // company users span branches
  const canReset = can('CONTRACT.CUSTOMER_RESET_PASSWORD');
  const [tab, setTab] = useState<Tab>('access');
  const [resetTarget, setResetTarget] = useState<{ id: number; name: string | null } | null>(null);

  const access = useQuery({
    queryKey: nnfAppKeys.access('default'),
    queryFn: () => apiClient.get<AppAccessRow[]>(
      '/v_customer_app_access?order=recent_fails.desc,last_failed_at.desc',
    ),
    refetchInterval: 60_000,
  });
  const anomaly = useQuery({
    queryKey: nnfAppKeys.anomaly('default'),
    queryFn: () => apiClient.get<AppAnomalyRow[]>(
      '/v_customer_app_anomaly?order=primary_anomaly.asc,days_since_activated.desc',
    ),
    refetchInterval: 60_000,
    enabled: tab === 'anomaly',
  });

  // Tab count = number of CONTRACTS (rows), excluding "installing now" ones,
  // which have nothing to do yet. (Not the number of people.)
  const accessRows = access.data ?? [];
  const accessCount = useMemo(
    () => accessRows.filter(r => !isInstallingNow(r)).length,
    [accessRows],
  );

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">{t('nnfApp.title')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content flex flex-col gap-4 p-4">
        <h1 className="heading-2 hidden md:block">{t('nnfApp.title')}</h1>

        {/* Tabs — Needs help first (people stuck right now). Underline tab
            strip, matching ContractDunningDetail / ContractDetailPanel. */}
        <div className="flex border-b border-line">
          <button
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
              tab === 'access' ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
            }`}
            onClick={() => setTab('access')}
          >
            <span className="inline-flex items-center gap-1.5">
              {t('nnfApp.tabAccess')}
              {accessCount > 0 && <Badge size="xs" color="warning">{accessCount}</Badge>}
            </span>
          </button>
          <button
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
              tab === 'anomaly' ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
            }`}
            onClick={() => setTab('anomaly')}
          >
            {t('nnfApp.tabAnomaly')}
          </button>
        </div>

        {tab === 'access' ? (
          <AccessTab
            rows={accessRows}
            loading={access.isLoading}
            error={access.isError}
            showBranch={isCompanyUser}
            canReset={canReset}
            onReset={(id, name) => setResetTarget({ id, name })}
          />
        ) : (
          <AnomalyTab
            rows={anomaly.data ?? []}
            loading={anomaly.isLoading}
            error={anomaly.isError}
            showBranch={isCompanyUser}
          />
        )}
      </div>

      <ResetCustomerLoginModal
        open={resetTarget !== null}
        customerId={resetTarget?.id ?? null}
        customerName={resetTarget?.name}
        onClose={() => setResetTarget(null)}
        onDone={() => access.refetch()}
      />
    </>
  );
}

// ── Tab ① Needs help ──────────────────────────────────────────────────────────

function AccessTab({ rows, loading, error, showBranch, canReset, onReset }: {
  rows: AppAccessRow[];
  loading: boolean;
  error: boolean;
  showBranch: boolean;
  canReset: boolean;
  onReset: (customerId: number, name: string | null) => void;
}) {
  const { t } = useTranslation();

  if (loading) return <div className="p-8 text-center text-subtle text-sm">{t('common.loading')}</div>;
  if (error) return <div className="alert alert-danger"><span>{t('common.error')}</span></div>;
  if (rows.length === 0) {
    return (
      <div className="p-8 text-center text-subtle text-sm">{t('nnfApp.accessEmpty')}</div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map(row => (
        <AccessCard
          key={row.contract_id}
          row={row}
          showBranch={showBranch}
          canReset={canReset}
          onReset={onReset}
        />
      ))}
    </div>
  );
}

function AccessCard({ row, showBranch, canReset, onReset }: {
  row: AppAccessRow;
  showBranch: boolean;
  canReset: boolean;
  onReset: (customerId: number, name: string | null) => void;
}) {
  const { t } = useTranslation();
  const installing = isInstallingNow(row);

  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2.5">
      {/* Header — contract + activation age */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <ContractLink id={row.contract_id} code={row.contract_code} />
            {showBranch && row.branch_name && (
              <span className="text-xs text-subtle">{row.branch_name}</span>
            )}
          </div>
          <ActivationAge activatedOn={row.contract_activated_on} days={row.days_since_activated} />
        </div>
        {/* The primary action for the contract — most prominent, or the
            neutral "installing" tag when nothing needs doing yet. */}
        {installing
          ? <Badge size="sm" color="default">{t('nnfApp.installing')}</Badge>
          : <ActionBadge code={row.action_code} />}
      </div>

      {installing && (
        <p className="text-xs text-subtle mt-1.5">{t('nnfApp.installingHint')}</p>
      )}

      {/* Lessees — show everyone; branch can call whoever's easiest to reach. */}
      <div className="mt-2 flex flex-col divide-y divide-line">
        {row.lessees.map(l => (
          <div key={l.customer_id} className="flex items-center justify-between gap-3 py-1.5">
            <div className="min-w-0 flex items-center gap-2 flex-wrap">
              <span className="text-sm truncate">{l.customer_name ?? '—'}</span>
              <Badge size="xs" color={l.role === 'PRIMARY' ? 'default' : 'info'}>
                {t(`lesseeRole.${l.role}`, { defaultValue: l.role })}
              </Badge>
              {!installing && <ActionBadge code={l.action_code} small />}
              {l.recent_fails > 0 && (
                <span className="text-[11px] text-danger">
                  {t('nnfApp.recentFails', { count: l.recent_fails })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {l.tel && (
                <a
                  href={`tel:${l.tel}`}
                  className="inline-flex items-center gap-1 text-xs text-primary-fg hover:underline tabular-nums"
                >
                  <Phone size={12} />
                  {formatTel(l.tel) ?? l.tel}
                </a>
              )}
              {/* Reset only for actions that call for it, and only with perms. */}
              {canReset && (l.action_code === 'RESET' || l.action_code === 'ONBOARD_RESET') && (
                <Button
                  size="sm"
                  variant="outline"
                  className="btn-icon-sm"
                  startIcon={<KeyRound size={13} />}
                  onClick={() => onReset(l.customer_id, l.customer_name)}
                  title={t('nnfApp.reset.title', { name: l.customer_name ?? '' })}
                  aria-label={t('nnfApp.reset.confirm')}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab ② Anomalies ───────────────────────────────────────────────────────────

function AnomalyTab({ rows, loading, error, showBranch }: {
  rows: AppAnomalyRow[];
  loading: boolean;
  error: boolean;
  showBranch: boolean;
}) {
  const { t } = useTranslation();

  if (loading) return <div className="p-8 text-center text-subtle text-sm">{t('common.loading')}</div>;
  if (error) return <div className="alert alert-danger"><span>{t('common.error')}</span></div>;
  if (rows.length === 0) {
    return <div className="p-8 text-center text-subtle text-sm">{t('nnfApp.anomalyEmpty')}</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map(row => (
        <div key={row.contract_id} className="rounded-md border border-line bg-surface px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <ContractLink id={row.contract_id} code={row.contract_code} />
                {showBranch && row.branch_name && (
                  <span className="text-xs text-subtle">{row.branch_name}</span>
                )}
              </div>
              <ActivationAge activatedOn={row.contract_activated_on} days={row.days_since_activated} />
            </div>
            <div className="flex items-center gap-1 flex-wrap justify-end">
              {row.anomaly_codes.map(code => <AnomalyBadge key={code} code={code} />)}
            </div>
          </div>

          <div className="text-xs text-subtle mt-1.5">
            {row.app_last_seen_at
              ? t('nnfApp.lastSeen', { count: row.days_since_app_seen ?? 0 })
              : t('nnfApp.neverSeen')}
          </div>

          <div className="mt-2 flex flex-col divide-y divide-line">
            {row.lessees.map(l => (
              <div key={l.customer_id} className="flex items-center justify-between gap-3 py-1.5">
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <span className="text-sm truncate">{l.customer_name ?? '—'}</span>
                  <Badge size="xs" color={l.role === 'PRIMARY' ? 'default' : 'info'}>
                    {t(`lesseeRole.${l.role}`, { defaultValue: l.role })}
                  </Badge>
                  {!l.has_push_device && (
                    <Tooltip content={t('nnfApp.anomaly.NO_PUSH_DEVICE')}>
                      <BellOff size={13} className="text-warning-fg" />
                    </Tooltip>
                  )}
                  {!l.ever_opened && (
                    <Tooltip content={t('nnfApp.anomaly.NEVER_OPENED')}>
                      <EyeOff size={13} className="text-subtle" />
                    </Tooltip>
                  )}
                </div>
                <div className="shrink-0 text-xs text-subtle">
                  {l.app_last_seen_at
                    ? <DateTime value={l.app_last_seen_at} showTime={false} />
                    : <span className="text-subtler">{t('nnfApp.neverSeenShort')}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function ActivationAge({ activatedOn, days }: { activatedOn: string | null; days: number | null }) {
  const { t } = useTranslation();
  if (activatedOn == null || days == null) return null;
  const label = days === 0 ? t('nnfApp.age.today')
    : days === 1 ? t('nnfApp.age.yesterday')
      : t('nnfApp.age.nDays', { n: days });
  return (
    <div className="text-[11px] text-subtle mt-0.5">
      {t('nnfApp.activatedLabel')} {label}
      {' · '}
      <DateTime value={activatedOn} showTime={false} />
    </div>
  );
}

/** Contract code → the contract screen. Every row on this page is a contract,
 *  and the staffer's next move is almost always to open it. */
function ContractLink({ id, code }: { id: number; code: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/admin/contracts/search/${id}`)}
      className="font-medium text-sm tabular-nums text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
    >
      {code}<ExternalLink size={12} className="opacity-60" />
    </button>
  );
}

const ACTION_COLOR: Record<string, 'info' | 'danger' | 'warning' | 'default'> = {
  TELL_HOW: 'info',
  RESET: 'danger',
  ONBOARD: 'warning',
  ONBOARD_RESET: 'danger',
};

function ActionBadge({ code, small }: { code: AppActionCode; small?: boolean }) {
  const { t } = useTranslation();
  const color = ACTION_COLOR[code] ?? 'default';
  const label = t(`nnfApp.action.${code}`, { defaultValue: code });
  return (
    <Badge size={small ? 'xs' : 'sm'} color={color}>{label}</Badge>
  );
}

const ANOMALY_COLOR: Record<string, 'danger' | 'warning' | 'info'> = {
  NO_PUSH_DEVICE: 'danger',
  NEVER_OPENED: 'warning',
  DORMANT_35D: 'info',
};

function AnomalyBadge({ code }: { code: AnomalyCode }) {
  const { t } = useTranslation();
  return (
    <Badge size="xs" color={ANOMALY_COLOR[code] ?? 'default'}>
      {t(`nnfApp.anomaly.${code}`, { defaultValue: code })}
    </Badge>
  );
}
