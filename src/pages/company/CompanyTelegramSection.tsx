import { SettingsBox, SETTINGS_BOX_ROWS } from './SettingsBox';
import { useEffect, useRef, useState } from 'react';
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

/** One kind of work as the form holds it: times as MaskedInput's raw digits ("2200"). */
interface Draft { enabled: boolean; start: string; end: string; after: string; remind: string }
interface FeatureValues { p_enabled: boolean; p_window_start: string | null; p_window_end: string | null; p_open_after_min: number; p_remind_every_min: number | null }

const digits = (v: string | null) => (v ?? '').replace(':', '');
const hhmm = (d: string) => (d.length === 4 ? `${d.slice(0, 2)}:${d.slice(2)}` : null);
const serverDraft = (f: TgFeature): Draft => ({
  enabled: f.enabled, start: digits(f.window_start), end: digits(f.window_end),
  after: String(f.open_after_min), remind: f.remind_every_min == null ? '' : String(f.remind_every_min),
});
const defaultDraft = (f: TgFeature): Draft => ({
  enabled: f.default_enabled, start: digits(f.default_window_start), end: digits(f.default_window_end),
  after: String(f.default_open_after_min), remind: f.default_remind_every_min == null ? '' : String(f.default_remind_every_min),
});
const toValues = (d: Draft): FeatureValues => ({
  p_enabled: d.enabled,
  p_window_start: hhmm(d.start),
  p_window_end: hhmm(d.end),
  p_open_after_min: Number(d.after || 0),
  p_remind_every_min: d.remind === '' ? null : Number(d.remind),
});
const sameValues = (a: FeatureValues, b: FeatureValues) =>
  a.p_enabled === b.p_enabled && a.p_window_start === b.p_window_start && a.p_window_end === b.p_window_end
  && a.p_open_after_min === b.p_open_after_min && a.p_remind_every_min === b.p_remind_every_min;

export function CompanyTelegramSection({ companyId, onDirtyChange }: {
  companyId: number;
  /** Unsaved edits in "แจ้งเรื่องอะไรบ้าง" — the page asks before leaving. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isReadOnlyViewer } = useAuth();
  const { hasPermission } = useMyPermissions();
  const canEdit = !isReadOnlyViewer && hasPermission('NOTIF.TELEGRAM_MANAGE');

  const [pollUntil, setPollUntil] = useState(0);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // Each box shows its own error: the bot box (key, bind, test, on/off) or the work box.
  const [error, setError] = useState<{ box: 'bot' | 'features'; message: string } | null>(null);
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

  // The form for the four kinds of work. A row is re-seeded only when the server's own
  // values for it change (after a save, or another admin's) — the 3 s re-reads while a
  // key check or bind is pending must not wipe what is being typed.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const seeded = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!data) return;
    setDrafts(prev => {
      const next = { ...prev };
      for (const f of data.features) {
        const sig = JSON.stringify(serverDraft(f));
        if (seeded.current[f.feature_code] !== sig || !next[f.feature_code]) {
          next[f.feature_code] = serverDraft(f);
          seeded.current[f.feature_code] = sig;
        }
      }
      return next;
    });
  }, [data]);

  const features = data ? [...data.features].sort((a, b) => a.sort_order - b.sort_order) : [];
  const rowDirty = (f: TgFeature) => !!drafts[f.feature_code] && !sameValues(toValues(drafts[f.feature_code]), toValues(serverDraft(f)));
  const dirtyRows = features.filter(rowDirty);
  const anyDirty = dirtyRows.length > 0;
  useEffect(() => { onDirtyChange?.(anyDirty); }, [anyDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

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
      const message = field ? t(`telegram.invalid.${String(field)}`, { defaultValue: translateApiError(err, t) }) : translateApiError(err, t);
      setError({ box: name === 'features' ? 'features' : 'bot', message });
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

  // One Save for the box: the backend takes one kind of work per call, so the edited rows
  // go one after another; the first refusal stops the run and its message shows.
  const saveFeatures = async () => {
    for (const f of dirtyRows) {
      const res = await call('features', 'fn_tg_feature_set', { p_feature_code: f.feature_code, ...toValues(drafts[f.feature_code]) }, 0);
      if (!res) return;
    }
  };
  const cancelFeatures = () => {
    setDrafts(Object.fromEntries(features.map(f => [f.feature_code, serverDraft(f)])));
    if (error?.box === 'features') setError(null);
  };
  const setDraft = (code: string, patch: Partial<Draft>) =>
    setDrafts(prev => ({ ...prev, [code]: { ...prev[code], ...patch } }));

  const left = expires ? Math.max(0, Math.round((new Date(expires).getTime() - now) / 1000)) : 0;
  const testResult = c?.test_done_at && c.test_requested_at && c.test_done_at >= c.test_requested_at
    ? (c.test_error ? 'fail' : 'ok') : c?.test_requested_at ? 'waiting' : null;
  const editable = canEdit && !!c;
  const savingFeatures = busy === 'features';

  return (
    <>
      {/* Box 1 — the bot itself. Everything here acts the moment it is pressed. */}
      <SettingsBox title={t('telegram.title')} hint={t('telegram.hint')} testId="tg-section">
        {/* Status */}
        <div className="flex flex-col gap-2">
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
        <div className="mt-4">
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
          <div className="mt-4 flex flex-wrap gap-2">
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
          <div className="mt-3 rounded-md border border-info-border bg-info-soft p-3" data-testid="tg-bind">
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
        {error?.box === 'bot' && (
          <div className="alert alert-danger mt-3"><XCircle size={16} /><div className="alert-description text-xs">{error.message}</div></div>
        )}
      </SettingsBox>

      {/* Box 2 — the four kinds of work: a form with one Cancel/Save at its foot. */}
      {/* The whole row on the settings grid: each row holds 3 fields side by side. */}
      <SettingsBox title={t('telegram.featuresTitle')} hint={c ? undefined : t('telegram.featuresNeedKeyHint')} testId="tg-features" className="@xl/instant:col-span-2">
        {/* Rows split by lines running edge to edge of the box, not boxes of their own. */}
        <div className={`${SETTINGS_BOX_ROWS} border-b border-line mb-4`}>
          {features.map(f => drafts[f.feature_code] && (
            <FeatureRow key={f.feature_code} f={f} draft={drafts[f.feature_code]} editable={editable} busy={savingFeatures}
              onChange={patch => setDraft(f.feature_code, patch)} />
          ))}
        </div>
        {editable && (
          <div className="mt-auto">
            {error?.box === 'features' && (
              <div className="alert alert-danger mb-3"><XCircle size={16} /><div className="alert-description text-xs">{error.message}</div></div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" onClick={cancelFeatures} disabled={savingFeatures || !anyDirty}>{t('common.cancel')}</Button>
              <Button size="sm" color="primary" startIcon={<Save size={14} />} onClick={saveFeatures} disabled={savingFeatures || !anyDirty} data-testid="tg-features-save">
                {savingFeatures ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </SettingsBox>
    </>
  );
}

function FeatureRow({ f, draft, editable, busy, onChange }: {
  f: TgFeature; draft: Draft; editable: boolean; busy: boolean; onChange: (patch: Partial<Draft>) => void;
}) {
  const { t } = useTranslation();
  // "Changed" against the defaults themselves: is_customized stays true after a row is put
  // back to its defaults, so it would keep saying "changed" with nothing changed.
  const changed = !sameValues(toValues(serverDraft(f)), toValues(defaultDraft(f)));
  // Reset fills the row with the defaults; the box's Save writes them, like any edit.
  const atDefault = sameValues(toValues(draft), toValues(defaultDraft(f)));
  const off = !editable || busy;

  return (
    <div className="px-4 py-3 flex flex-col gap-2" data-testid={`tg-feature-${f.feature_code}`}>
      <div className="flex items-center gap-2">
        <Switch size="sm" checked={draft.enabled} disabled={off} onChange={e => onChange({ enabled: e.target.checked })} />
        <span className="text-sm font-medium flex-1 min-w-0">{t(`telegram.feature.${f.feature_code}`, { defaultValue: f.feature_code })}</span>
        {changed && <Badge size="xs" color="default">{t('telegram.customized')}</Badge>}
        {editable && !atDefault && (
          <Button size="xs" variant="ghost" startIcon={<RotateCcw size={12} />} disabled={busy} onClick={() => onChange(defaultDraft(f))}>
            {t('telegram.resetDefault')}
          </Button>
        )}
      </div>
      {/* One grid for the three fields: time pair · report after · remind every (stacks when narrow). */}
      <div className="@container/tgrow">
        <div className="grid grid-cols-1 @md/tgrow:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2 items-start">
          <div className="flex flex-col">
            <span className="text-xs text-subtle">{t('telegram.window')}</span>
            <div className="flex items-center gap-1">
              <div className="w-20"><MaskedInput size="sm" className="w-full" mask="##:##" value={draft.start} placeholder="--:--" disabled={off} onChange={(raw) => onChange({ start: raw })} /></div>
              <span className="text-subtle">–</span>
              <div className="w-20"><MaskedInput size="sm" className="w-full" mask="##:##" value={draft.end} placeholder="--:--" disabled={off} onChange={(raw) => onChange({ end: raw })} /></div>
            </div>
            {!draft.start && !draft.end && <span className="text-[11px] text-subtler mt-0.5">{t('telegram.allDay')}</span>}
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-subtle">{t('telegram.openAfter')}</span>
            <MaskedInput size="sm" className="w-full" mask="number" decimalScale={0} value={draft.after} disabled={off} onChange={(raw) => onChange({ after: raw })} />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-subtle">{t('telegram.remindEvery')}</span>
            <MaskedInput size="sm" className="w-full" mask="number" decimalScale={0} value={draft.remind} placeholder={t('telegram.noRemind')} disabled={off} onChange={(raw) => onChange({ remind: raw })} />
            <span className="text-[11px] text-subtler mt-0.5">{t('telegram.maxReminders', { n: f.max_reminders })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
