import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Badge } from 'tsp-form';
import { CheckCircle, XCircle, User, Shield, Cog, Smartphone, Loader2 } from 'lucide-react';
import { apiClient } from '../lib/api';
import { formatSmart } from '../lib/format';

type AuditAction =
  | 'LOGIN_RESET' | 'USERNAME_CHANGED' | 'PASSWORD_CHANGED'
  | 'ACCOUNT_LOCKED' | 'ACCOUNT_UNLOCKED' | 'UPDATE_IDENTITY';

type ActorKind = 'STAFF' | 'CUSTOMER' | 'SYSTEM';

interface AuditRow {
  id: number;
  customer_id: number;
  action: AuditAction;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  actor_kind: ActorKind;
  actor_display_name: string | null;
  occurred_at: string;
}

interface LoginRow {
  id: number;
  username: string;
  customer_id: number | null;
  ip: string | null;
  user_agent: string | null;
  success: boolean;
  reason: string | null;
  occurred_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  customerId: number;
  customerName: string;
}

export function CustomerActivityModal({ open, onClose, customerId, customerName }: Props) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<'audit' | 'history'>('audit');

  const audit = useQuery({
    queryKey: ['customer-audit-log', customerId],
    queryFn: () => apiClient.get<AuditRow[]>(
      `/v_customer_audit_log?customer_id=eq.${customerId}&order=occurred_at.desc&limit=100`,
    ),
    enabled: open && tab === 'audit',
  });

  const history = useQuery({
    queryKey: ['customer-login-history', customerId],
    queryFn: () => apiClient.get<LoginRow[]>(
      `/v_customer_login_history?customer_id=eq.${customerId}&order=occurred_at.desc&limit=100`,
    ),
    enabled: open && tab === 'history',
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="42rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('customer.login.activityTitle', { name: customerName })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="px-4 pt-3 border-b border-line flex gap-1">
        <TabBtn active={tab === 'audit'} onClick={() => setTab('audit')}>
          {t('customer.login.tabAudit')}
        </TabBtn>
        <TabBtn active={tab === 'history'} onClick={() => setTab('history')}>
          {t('customer.login.tabHistory')}
        </TabBtn>
      </div>
      <div className="modal-content" style={{ minHeight: '20rem' }}>
        {tab === 'audit' && (
          <AuditPanel
            rows={audit.data ?? []}
            loading={audit.isLoading}
            lang={i18n.language}
            t={t}
          />
        )}
        {tab === 'history' && (
          <HistoryPanel
            rows={history.data ?? []}
            loading={history.isLoading}
            lang={i18n.language}
            t={t}
          />
        )}
      </div>
    </Modal>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm border-b-2 -mb-px transition-colors cursor-pointer ${
        active ? 'border-primary text-primary font-medium' : 'border-transparent text-subtle hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

// ── Audit panel ─────────────────────────────────────────────────────────────

interface DayBucket<T> {
  key: string;
  label: string;
  items: T[];
}

function bangkokDayKey(d: Date): string {
  const shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function bucketByDay<T extends { occurred_at: string }>(rows: T[], lang: string): DayBucket<T>[] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const key = bangkokDayKey(new Date(r.occurred_at));
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  const now = new Date();
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const today = bkk.toISOString().slice(0, 10);
  const yest = new Date(bkk.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const locale = lang === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB';

  return [...map.entries()].map(([key, items]) => {
    let label: string;
    if (key === today) label = lang === 'th' ? 'วันนี้' : 'Today';
    else if (key === yest) label = lang === 'th' ? 'เมื่อวาน' : 'Yesterday';
    else label = new Date(`${key}T00:00:00+07:00`).toLocaleDateString(locale, {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok',
    });
    return { key, label, items };
  });
}

function AuditPanel({ rows, loading, lang, t }: {
  rows: AuditRow[];
  loading: boolean;
  lang: string;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const buckets = useMemo(() => bucketByDay(rows, lang), [rows, lang]);

  if (loading) return <CenterLoader />;
  if (rows.length === 0) return <EmptyState text={t('customer.login.auditEmpty')} />;

  return (
    <div className="flex flex-col gap-3">
      {buckets.map(b => (
        <div key={b.key} className="flex flex-col gap-1.5">
          <DaySeparator label={b.label} />
          {b.items.map(r => <AuditRowView key={r.id} row={r} lang={lang} t={t} />)}
        </div>
      ))}
    </div>
  );
}

function ActorIcon({ kind }: { kind: ActorKind }) {
  if (kind === 'STAFF') return <Shield size={13} className="text-info" />;
  if (kind === 'CUSTOMER') return <User size={13} className="text-primary" />;
  return <Cog size={13} className="text-subtle" />;
}

function AuditRowView({ row, lang, t }: {
  row: AuditRow;
  lang: string;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const actionLabel = t(`customer.login.action_${row.action}`, { defaultValue: row.action });
  const actorLabel = t(`customer.login.actor_${row.actor_kind}`, { defaultValue: row.actor_kind });
  const showDelta = (row.action === 'USERNAME_CHANGED' || row.action === 'UPDATE_IDENTITY')
    && (row.old_value || row.new_value);

  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium">{actionLabel}</span>
            <span className="text-xs text-subtle inline-flex items-center gap-0.5">
              <ActorIcon kind={row.actor_kind} />
              {row.actor_display_name || actorLabel}
            </span>
          </div>
          {showDelta && (
            <div className="text-xs text-subtle mt-0.5 break-all">
              {t('customer.login.valueChange', {
                from: row.old_value ?? '—',
                to: row.new_value ?? '—',
              })}
            </div>
          )}
          {row.reason && (
            <div className="text-xs text-subtler mt-0.5 break-words">{row.reason}</div>
          )}
        </div>
        <span className="text-xs text-subtle shrink-0 tabular-nums">
          {formatSmart(row.occurred_at, lang)}
        </span>
      </div>
    </div>
  );
}

// ── History panel ───────────────────────────────────────────────────────────

function HistoryPanel({ rows, loading, lang, t }: {
  rows: LoginRow[];
  loading: boolean;
  lang: string;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const buckets = useMemo(() => bucketByDay(rows, lang), [rows, lang]);

  if (loading) return <CenterLoader />;
  if (rows.length === 0) return <EmptyState text={t('customer.login.historyEmpty')} />;

  return (
    <div className="flex flex-col gap-3">
      {buckets.map(b => (
        <div key={b.key} className="flex flex-col gap-1.5">
          <DaySeparator label={b.label} />
          {b.items.map(r => <LoginRowView key={r.id} row={r} lang={lang} t={t} />)}
        </div>
      ))}
    </div>
  );
}

function LoginRowView({ row, lang, t }: {
  row: LoginRow;
  lang: string;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const device = parseDevice(row.user_agent);
  const failReason = row.reason
    ? t(row.reason, { ns: 'apiErrors', defaultValue: row.reason })
    : null;

  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {row.success ? (
              <Badge size="xs" color="success">
                <CheckCircle size={10} className="mr-0.5" />
                {t('customer.login.result_success')}
              </Badge>
            ) : (
              <Badge size="xs" color="danger">
                <XCircle size={10} className="mr-0.5" />
                {t('customer.login.result_failed')}
              </Badge>
            )}
            {device && (
              <span className="text-xs text-subtle inline-flex items-center gap-0.5">
                <Smartphone size={11} />{device}
              </span>
            )}
            {row.ip && (
              <span className="text-xs text-subtle tabular-nums">{row.ip}</span>
            )}
          </div>
          {!row.success && failReason && (
            <div className="text-xs text-danger mt-0.5">{failReason}</div>
          )}
        </div>
        <span className="text-xs text-subtle shrink-0 tabular-nums">
          {formatSmart(row.occurred_at, lang)}
        </span>
      </div>
    </div>
  );
}

function parseDevice(ua: string | null): string | null {
  if (!ua) return null;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return ua.slice(0, 30);
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 border-t border-line" />
      <span className="text-[11px] text-subtle px-1">{label}</span>
      <div className="flex-1 border-t border-line" />
    </div>
  );
}

function CenterLoader() {
  return (
    <div className="flex items-center justify-center py-10 text-subtler">
      <Loader2 size={20} className="animate-spin" />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center text-subtler text-sm py-10">{text}</div>
  );
}
