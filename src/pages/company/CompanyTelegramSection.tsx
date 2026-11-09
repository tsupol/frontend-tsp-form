import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, MaskedInput, Switch } from 'tsp-form';
import { Check, Copy, KeyRound, Link2, RotateCcw, Save, Send, XCircle } from 'lucide-react';
import { ApiError, apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { useAuth } from '../../contexts/AuthContext';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { DateTime } from '../../components/DateTime';

// A fund's Telegram bot (IMPLEMENT 2026-11-09 mig 1645): one bot posts into one company
// group when work waits on the company — a shop's request, a close-out, a customer chat,
// a slip left too long. Fund companies only. Every RPC answers with the whole payload, so
// the section redraws from the reply; while something is in flight (key check, group
// binding, test send) it re-reads every 3 s.

type TgStatus = 'VERIFYING' | 'UNBOUND' | 'ACTIVE' | 'BROKEN' | 'OFF';

interface TgChannel {
  status: TgStatus;
  can_send: boolean;
  needs_attention: boolean;
  bot_username: string | null;
  bot_name: string | null;
  chat_title: string | null;
  bound_at: string | null;
  token_last4: string | null;
  token_set_at: string | null;
  bind_pending: boolean;
  bind_code_expires_at: string | null;
  test_requested_at: string | null;
  test_done_at: string | null;
  test_error: string | null;
  last_ok_at: string | null;
  last_error_code: string | null;
  last_error_at: string | null;
}

interface TgFeature {
  feature_code: string;
  sort_order: number;
  enabled: boolean;
  window_start: string | null;
  window_end: string | null;
  open_after_min: number;
  remind_every_min: number | null;
  max_reminders: number;
  is_customized: boolean;
  default_enabled: boolean;
  default_window_start: string | null;
  default_window_end: string | null;
  default_open_after_min: number;
  default_remind_every_min: number | null;
}

interface TgSettings {
  company_id: number;
  channel: TgChannel | null;
  features: TgFeature[];
  /** fn_tg_bind_start only. */
  bind_command?: string;
}

const STATUS_COLOR: Record<TgStatus, 'success' | 'info' | 'warning' | 'danger' | 'default'> = {
  ACTIVE: 'success', VERIFYING: 'info', UNBOUND: 'warning', BROKEN: 'danger', OFF: 'default',
};

/** Still waiting on the sender: key being checked, group code not used yet, test not answered. */
function inFlight(c: TgChannel | null): boolean {
  if (!c) return false;
  if (c.status === 'VERIFYING' || c.bind_pending) return true;
  return !!c.test_requested_at && (!c.test_done_at || c.test_done_at < c.test_requested_at);
}

export function CompanyTelegramSection({ companyId }: { companyId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isReadOnlyViewer } = useAuth();
  const { hasPermission } = useMyPermissions();
  const canEdit = !isReadOnlyViewer && hasPermission('NOTIF.TELEGRAM_MANAGE');

  const [pollUntil, setPollUntil] = useState(0);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bindCommand, setBindCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fund companies only — the section is not drawn for an operating company.
  const { data: companyType } = useQuery({
    queryKey: ['company-type', companyId],
    queryFn: async () => (await apiClient.get<{ company_type: string }[]>(`/v_companies?id=eq.${companyId}&select=company_type`))[0]?.company_type ?? null,
    staleTime: 10 * 60_000,
  });
  const isFund = companyType === 'FINANCIER';

  const key = ['tg-settings', companyId];
  const { data, isError } = useQuery({
    queryKey: key,
    queryFn: () => apiClient.rpc<TgSettings>('fn_tg_settings_get', { p_company_id: companyId }),
    enabled: isFund,
    retry: false,
    refetchInterval: q => (Date.now() < pollUntil && inFlight((q.state.data as TgSettings | undefined)?.channel ?? null) ? 3000 : false),
  });

  // A bind code lives 10 minutes: keep re-reading until it is used or runs out.
  const expires = data?.channel?.bind_code_expires_at;
  useEffect(() => {
    if (data?.channel?.bind_pending && expires) setPollUntil(p => Math.max(p, new Date(expires).getTime()));
    if (data?.channel && !data.channel.bind_pending) setBindCommand(null);
  }, [data?.channel, expires]);

  // Countdown to the bind code's expiry, refreshed every second while it is shown.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!bindCommand) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [bindCommand]);

  if (!isFund || isError || !data) return null;
  const c = data.channel;

  const call = async (name: string, fn: string, body: Record<string, unknown>, poll = 60_000) => {
    setBusy(name);
    setError(null);
    try {
      const res = await apiClient.rpc<TgSettings>(fn, { p_company_id: companyId, ...body });
      queryClient.setQueryData(key, res);
      if (poll) setPollUntil(Date.now() + poll);
      return res;
    } catch (err) {
      // A bad setting names its field; say which one in words, with its allowed range.
      const field = err instanceof ApiError && err.code === 'NOTIF.VALIDATION.TG_SETTING_INVALID' ? err.messageParams?.field : null;
      setError(field ? t(`telegram.invalid.${String(field)}`, { defaultValue: translateApiError(err, t) }) : translateApiError(err, t));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const saveToken = async () => {
    const res = await call('token', 'fn_tg_channel_set_token', { p_token: token.trim() });
    if (res) setToken('');
  };
  const startBind = async () => {
    const res = await call('bind', 'fn_tg_bind_start', {}, 10 * 60_000);
    if (res?.bind_command) setBindCommand(res.bind_command);
  };
  const copyBind = async () => {
    if (!bindCommand) return;
    try { await navigator.clipboard.writeText(bindCommand); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* the command is on screen */ }
  };

  const left = expires ? Math.max(0, Math.round((new Date(expires).getTime() - now) / 1000)) : 0;
  const testResult = c?.test_done_at && c.test_requested_at && c.test_done_at >= c.test_requested_at
    ? (c.test_error ? 'fail' : 'ok') : c?.test_requested_at ? 'waiting' : null;

  return (
    <div data-testid="tg-section">
      <hr className="border-line mt-6 mb-6" />
      <h4 className="text-sm font-semibold text-fg uppercase tracking-wider mb-1">{t('telegram.title')}</h4>
      <p className="text-xs text-subtle mb-3">{t('telegram.hint')}</p>

      {/* Status */}
      <div className="rounded-md border border-line p-3 max-w-2xl flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={c ? STATUS_COLOR[c.status] : 'default'} size="sm" data-testid="tg-status">
            {c ? t(`telegram.status.${c.status}`) : t('telegram.status.NONE')}
          </Badge>
          {c?.bot_username && <span className="text-sm font-medium">@{c.bot_username}</span>}
          {c?.bot_name && <span className="text-xs text-subtle">{c.bot_name}</span>}
          {c && canEdit && (
            <div className="ml-auto flex items-center gap-2 text-xs text-subtle">
              <span>{t('telegram.enabled')}</span>
              <Switch size="sm" checked={c.status !== 'OFF'} disabled={!!busy}
                onChange={e => call('enable', 'fn_tg_channel_set_enabled', { p_enabled: e.target.checked })} />
            </div>
          )}
        </div>
        {c?.chat_title && (
          <div className="text-sm">{t('telegram.group')}: <b>{c.chat_title}</b>{c.bound_at && <span className="text-xs text-subtle"> · <DateTime value={c.bound_at} showTime /></span>}</div>
        )}
        {c?.last_error_code && (
          <div className="text-xs text-danger-fg">{t(`telegram.error.${c.last_error_code}`, { defaultValue: c.last_error_code })}{c.last_error_at && <> · <DateTime value={c.last_error_at} showTime /></>}</div>
        )}
        {c?.last_ok_at && <div className="text-xs text-subtle">{t('telegram.lastOk')} <DateTime value={c.last_ok_at} showTime /></div>}
      </div>

      {/* Bot key */}
      <div className="mt-4 max-w-2xl">
        <div className="text-xs text-subtle mb-1">{t('telegram.token')}</div>
        {c?.token_last4 && (
          <div className="text-sm mb-2 tabular-nums">••••{c.token_last4}{c.token_set_at && <span className="text-xs text-subtle"> · <DateTime value={c.token_set_at} showTime /></span>}</div>
        )}
        {canEdit && (
          <div className="flex gap-2">
            <Input size="sm" className="w-full" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)}
              placeholder={t('telegram.tokenPlaceholder')} data-testid="tg-token" />
            <Button size="sm" variant="outline" className="shrink-0 whitespace-nowrap" startIcon={<KeyRound size={14} />} disabled={!token.trim() || !!busy} onClick={saveToken}>
              {c ? t('telegram.tokenReplace') : t('telegram.tokenSet')}
            </Button>
          </div>
        )}
      </div>

      {/* Bind + test */}
      {c && canEdit && (
        <div className="mt-4 max-w-2xl flex flex-wrap gap-2">
          <Button size="sm" variant="outline" startIcon={<Link2 size={14} />} disabled={!!busy || !['UNBOUND', 'ACTIVE', 'BROKEN'].includes(c.status)} onClick={startBind}>
            {c.chat_title ? t('telegram.rebind') : t('telegram.bind')}
          </Button>
          <Button size="sm" variant="outline" startIcon={<Send size={14} />} disabled={!!busy || !c.can_send} onClick={() => call('test', 'fn_tg_test_send', {})}>
            {t('telegram.test')}
          </Button>
          {testResult === 'ok' && <span className="text-xs text-success-fg self-center">{t('telegram.testOk')}</span>}
          {testResult === 'fail' && <span className="text-xs text-danger-fg self-center">{t('telegram.testFail', { reason: c.test_error })}</span>}
          {testResult === 'waiting' && <span className="text-xs text-subtle self-center">{t('telegram.testWaiting')}</span>}
        </div>
      )}
      {bindCommand && c?.bind_pending && (
        <div className="mt-3 max-w-2xl rounded-md border border-info-border bg-info-soft p-3" data-testid="tg-bind">
          <div className="flex items-center gap-2">
            <code className="text-xl font-semibold tabular-nums">{bindCommand}</code>
            <Button size="sm" variant="outline" startIcon={copied ? <Check size={14} className="text-success" /> : <Copy size={14} />} onClick={copyBind}>
              {copied ? t('common.copied') : t('common.copy')}
            </Button>
            <span className="ml-auto text-xs text-subtle tabular-nums">{t('telegram.bindLeft', { m: Math.floor(left / 60), s: String(left % 60).padStart(2, '0') })}</span>
          </div>
          <div className="text-xs mt-2">{t('telegram.bindHow', { bot: c.bot_username ?? '' })}</div>
        </div>
      )}
      {error && (
        <div className="alert alert-danger mt-3 max-w-2xl"><XCircle size={16} /><div className="alert-description text-xs">{error}</div></div>
      )}

      {/* The four kinds of work */}
      <div className="mt-5 max-w-3xl">
        <div className="text-xs text-subtle mb-2">{c ? t('telegram.featuresTitle') : t('telegram.featuresNeedKey')}</div>
        <div className="rounded-md border border-line divide-y divide-line">
          {[...data.features].sort((a, b) => a.sort_order - b.sort_order).map(f => (
            <FeatureRow key={f.feature_code} f={f} editable={canEdit && !!c} busy={busy === f.feature_code}
              onSave={v => call(f.feature_code, 'fn_tg_feature_set', { p_feature_code: f.feature_code, ...v }, 0)} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface FeatureValues { p_enabled: boolean; p_window_start: string | null; p_window_end: string | null; p_open_after_min: number; p_remind_every_min: number | null }

function FeatureRow({ f, editable, busy, onSave }: { f: TgFeature; editable: boolean; busy: boolean; onSave: (v: FeatureValues) => void }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(f.enabled);
  // Times are kept as MaskedInput's raw digits ("2200"); "HH:MI" only on the way out.
  const digits = (v: string | null) => (v ?? '').replace(':', '');
  const hhmm = (d: string) => (d.length === 4 ? `${d.slice(0, 2)}:${d.slice(2)}` : null);
  const [start, setStart] = useState(digits(f.window_start));
  const [end, setEnd] = useState(digits(f.window_end));
  const [after, setAfter] = useState(String(f.open_after_min));
  const [remind, setRemind] = useState(f.remind_every_min == null ? '' : String(f.remind_every_min));
  // Re-seed whenever the server's row changes (after a save, or another admin's).
  useEffect(() => {
    setEnabled(f.enabled); setStart(digits(f.window_start)); setEnd(digits(f.window_end));
    setAfter(String(f.open_after_min)); setRemind(f.remind_every_min == null ? '' : String(f.remind_every_min));
  }, [f.enabled, f.window_start, f.window_end, f.open_after_min, f.remind_every_min]);

  const values = (): FeatureValues => ({
    p_enabled: enabled,
    p_window_start: hhmm(start),
    p_window_end: hhmm(end),
    p_open_after_min: Number(after || 0),
    p_remind_every_min: remind === '' ? null : Number(remind),
  });
  // "Changed" against the defaults themselves: is_customized stays true after a row is put
  // back to its defaults, so it would keep saying "changed" with nothing changed.
  const changed = f.enabled !== f.default_enabled || f.window_start !== f.default_window_start || f.window_end !== f.default_window_end
    || f.open_after_min !== f.default_open_after_min || f.remind_every_min !== f.default_remind_every_min;
  const dirty = enabled !== f.enabled || hhmm(start) !== f.window_start || hhmm(end) !== f.window_end
    || Number(after || 0) !== f.open_after_min || (remind === '' ? null : Number(remind)) !== f.remind_every_min;

  return (
    <div className="p-3 flex flex-col gap-2" data-testid={`tg-feature-${f.feature_code}`}>
      <div className="flex items-center gap-2">
        <Switch size="sm" checked={enabled} disabled={!editable || busy} onChange={e => setEnabled(e.target.checked)} />
        <span className="text-sm font-medium flex-1 min-w-0">{t(`telegram.feature.${f.feature_code}`, { defaultValue: f.feature_code })}</span>
        {changed && <Badge size="xs" color="default">{t('telegram.customized')}</Badge>}
      </div>
      {/* One grid for the three fields: time pair · report after · remind every (stacks on a phone). */}
      <div className="grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2 items-start">
        <div className="flex flex-col">
          <span className="text-xs text-subtle">{t('telegram.window')}</span>
          <div className="flex items-center gap-1">
            <div className="w-20"><MaskedInput size="sm" className="w-full" mask="##:##" value={start} placeholder="--:--" disabled={!editable || busy} onChange={(raw) => setStart(raw)} /></div>
            <span className="text-subtle">–</span>
            <div className="w-20"><MaskedInput size="sm" className="w-full" mask="##:##" value={end} placeholder="--:--" disabled={!editable || busy} onChange={(raw) => setEnd(raw)} /></div>
          </div>
          {!start && !end && <span className="text-[11px] text-subtler mt-0.5">{t('telegram.allDay')}</span>}
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-subtle">{t('telegram.openAfter')}</span>
          <MaskedInput size="sm" className="w-full" mask="number" decimalScale={0} value={after} disabled={!editable || busy} onChange={(raw) => setAfter(raw)} />
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-subtle">{t('telegram.remindEvery')}</span>
          <MaskedInput size="sm" className="w-full" mask="number" decimalScale={0} value={remind} placeholder={t('telegram.noRemind')} disabled={!editable || busy} onChange={(raw) => setRemind(raw)} />
          <span className="text-[11px] text-subtler mt-0.5">{t('telegram.maxReminders', { n: f.max_reminders })}</span>
        </div>
      </div>
      {editable && (
        <div className="flex gap-2 justify-end">
          {changed && (
            <Button size="sm" variant="ghost" startIcon={<RotateCcw size={14} />} disabled={busy}
              onClick={() => onSave({ p_enabled: f.default_enabled, p_window_start: f.default_window_start, p_window_end: f.default_window_end, p_open_after_min: f.default_open_after_min, p_remind_every_min: f.default_remind_every_min })}>
              {t('telegram.resetDefault')}
            </Button>
          )}
          <Button size="sm" variant="outline" startIcon={<Save size={14} />} disabled={!dirty || busy} onClick={() => onSave(values())}>
            {t('common.save')}
          </Button>
        </div>
      )}
    </div>
  );
}
