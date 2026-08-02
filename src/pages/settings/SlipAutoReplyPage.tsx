import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRightFromLine, MessageSquareReply, XCircle, CheckCircle, Info } from 'lucide-react';
import { MobileHeader, Switch, TextArea, MaskedInput, Button } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { DateTime } from '../../components/DateTime';

interface AutoReplyConfig {
  company_id: number;
  event_type: string;
  enabled: boolean;
  message_text: string | null;
  cooldown_minutes: number;
  updated_at: string | null;
  updated_by: number | null;
}

interface AutoReplyLogRow {
  contract_id: number;
  contract_code: string | null;
  chat_message_id: number;
  message_text: string | null;
  submission_id: number | null;
  submission_amount: number | null;
  submission_status: string | null;
  created_at: string;
}

type Tab = 'settings' | 'log';

// A distinct sentinel so we can tell "the get RPC returned permission-denied"
// (hide the whole section) from any other failure (show an error state).
class PermissionDenied extends Error {}

function MobileHead({ title }: { title: string }) {
  return (
    <MobileHeader className="mobile-header-scrolled-shadow md:hidden">
      <div className="mobile-header-start">
        <button
          className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
          aria-label="Open menu"
          onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
        >
          <ArrowRightFromLine size={18} />
        </button>
      </div>
      <div className="mobile-header-title mobile-header-title-truncate">{title}</div>
      <div className="mobile-header-end w-nav" />
    </MobileHeader>
  );
}

export function SlipAutoReplyPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('settings');

  // Form state — seeded from the server config once loaded.
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [cooldown, setCooldown] = useState('60');
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  const configQuery = useQuery<AutoReplyConfig, Error>({
    queryKey: ['chat-autoreply-config'],
    queryFn: async () => {
      try {
        return await apiClient.rpc<AutoReplyConfig>('fn_chat_autoreply_get', {});
      } catch (e) {
        if (e instanceof ApiError && e.code === 'CHAT.AUTH.PERMISSION_DENIED') {
          throw new PermissionDenied();
        }
        throw e;
      }
    },
    retry: false,
  });

  const config = configQuery.data;

  // Seed the form whenever a fresh config arrives.
  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setMessage(config.message_text ?? '');
    setCooldown(String(config.cooldown_minutes ?? 60));
  }, [config]);

  const dirty = useMemo(() => {
    if (!config) return false;
    return (
      enabled !== config.enabled ||
      message !== (config.message_text ?? '') ||
      cooldown !== String(config.cooldown_minutes ?? 60)
    );
  }, [config, enabled, message, cooldown]);

  const cooldownNum = cooldown === '' ? NaN : Number(cooldown);
  const cooldownValid = Number.isInteger(cooldownNum) && cooldownNum >= 0 && cooldownNum <= 1440;
  // Enabling with no message is a backend validation error — block it up front.
  const messageValid = !enabled || message.trim().length > 0;
  const canSave = dirty && cooldownValid && messageValid;

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Send the message exactly as typed — no trim, no escape, no conversion.
      // \n and emoji (incl. skin-tone) must round-trip byte-identical.
      const params: Record<string, unknown> = {
        p_enabled: enabled,
        p_message_text: message,
        p_cooldown_minutes: cooldownNum,
      };
      return apiClient.rpc<AutoReplyConfig>('fn_chat_autoreply_set', params);
    },
    onSuccess: (updated) => {
      setSaveError('');
      setSaved(true);
      // Prime the cache with the server's post-save shape so the form re-seeds
      // from canonical values (and `dirty` resets to false).
      queryClient.setQueryData(['chat-autoreply-config'], updated);
      queryClient.invalidateQueries({ queryKey: ['chat-autoreply-log'] });
    },
    onError: (e) => {
      setSaved(false);
      setSaveError(translateApiError(e, t));
    },
  });

  const isPermissionDenied = configQuery.error instanceof PermissionDenied;

  // Hide the whole section for users without permission.
  if (isPermissionDenied) {
    return (
      <>
        <MobileHead title={t('slipAutoReply.title')} />
        <div className="page-content max-w-2xl">
          <div className="alert alert-info">
            <Info size={16} />
            <div>
              <div className="alert-description text-sm">{t('slipAutoReply.noAccess')}</div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <MobileHead title={t('slipAutoReply.title')} />

      <div className="page-content max-w-2xl">
        <div className="flex items-center gap-2 mb-2 max-md:hidden">
          <MessageSquareReply size={20} />
          <h1 className="heading-2">{t('slipAutoReply.title')}</h1>
        </div>
        <p className="text-sm text-subtle mb-5">{t('slipAutoReply.subtitle')}</p>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-line mb-5">
          <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
            {t('slipAutoReply.tabSettings')}
          </TabButton>
          <TabButton active={tab === 'log'} onClick={() => setTab('log')}>
            {t('slipAutoReply.tabLog')}
          </TabButton>
        </div>

        {configQuery.isLoading && (
          <div className="text-sm text-subtle">{t('common.loading')}</div>
        )}

        {configQuery.isError && !isPermissionDenied && (
          <div className="alert alert-danger">
            <XCircle size={16} />
            <div>
              <div className="alert-description text-sm">
                {translateApiError(configQuery.error, t)}
              </div>
            </div>
          </div>
        )}

        {config && tab === 'settings' && (
          <SettingsTab
            enabled={enabled}
            setEnabled={(v) => { setEnabled(v); setSaved(false); }}
            message={message}
            setMessage={(v) => { setMessage(v); setSaved(false); }}
            cooldown={cooldown}
            setCooldown={(v) => { setCooldown(v); setSaved(false); }}
            cooldownValid={cooldownValid}
            messageValid={messageValid}
            canSave={canSave}
            saving={saveMutation.isPending}
            saveError={saveError}
            saved={saved && !dirty}
            onSave={() => saveMutation.mutate()}
          />
        )}

        {config && tab === 'log' && <LogTab />}
      </div>
    </>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors cursor-pointer ${
        active
          ? 'border-primary-fg text-primary-fg font-medium'
          : 'border-transparent text-subtle hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

function SettingsTab(props: {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  message: string;
  setMessage: (v: string) => void;
  cooldown: string;
  setCooldown: (v: string) => void;
  cooldownValid: boolean;
  messageValid: boolean;
  canSave: boolean;
  saving: boolean;
  saveError: string;
  saved: boolean;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const {
    enabled, setEnabled, message, setMessage, cooldown, setCooldown,
    cooldownValid, messageValid, canSave, saving, saveError, saved, onSave,
  } = props;

  return (
    <div className="flex flex-col gap-6">
      {/* Enable toggle */}
      <section className="border border-line bg-surface p-5 rounded-lg">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium">{t('slipAutoReply.enableLabel')}</div>
            <div className="text-sm text-subtle">{t('slipAutoReply.enableHelp')}</div>
          </div>
          <Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        </div>
      </section>

      {/* Message */}
      <section className="border border-line bg-surface p-5 rounded-lg flex flex-col gap-2">
        <div>
          <div className="font-medium">{t('slipAutoReply.messageLabel')}</div>
          <p className="text-sm text-subtle mt-0.5">{t('slipAutoReply.messageHelp')}</p>
        </div>
        <TextArea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          placeholder={t('slipAutoReply.messagePlaceholder')}
          error={!messageValid}
        />
        {!messageValid && (
          <div className="text-xs text-danger-fg">{t('slipAutoReply.messageRequired')}</div>
        )}

        {/* Live preview — exactly what the customer sees. */}
        <div className="mt-2">
          <div className="text-xs text-subtle mb-1.5">{t('slipAutoReply.previewLabel')}</div>
          <ChatPreview text={message} />
        </div>
      </section>

      {/* Cooldown */}
      <section className="border border-line bg-surface p-5 rounded-lg flex flex-col gap-2">
        <div>
          <div className="font-medium">{t('slipAutoReply.cooldownLabel')}</div>
          <p className="text-sm text-subtle mt-0.5">{t('slipAutoReply.cooldownHelp')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-32">
            <MaskedInput
              mask="number"
              decimalScale={0}
              value={cooldown}
              onChange={(raw) => setCooldown(raw)}
              error={!cooldownValid}
              className="w-full"
            />
          </div>
          <span className="text-sm text-subtle">{t('slipAutoReply.minutesSuffix')}</span>
        </div>
        {!cooldownValid && (
          <div className="text-xs text-danger-fg">{t('slipAutoReply.cooldownRange')}</div>
        )}
      </section>

      {/* Save */}
      {saveError && (
        <div className="alert alert-danger">
          <XCircle size={16} />
          <div><div className="alert-description text-sm">{saveError}</div></div>
        </div>
      )}
      {saved && (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <div><div className="alert-description text-sm">{t('slipAutoReply.saved')}</div></div>
        </div>
      )}
      <div className="flex justify-end">
        <Button color="primary" onClick={onSave} disabled={!canSave || saving}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

// Renders the message the way a customer's chat bubble does — real newlines as
// line breaks, emoji untouched. whitespace-pre-wrap preserves \n and blank lines.
function ChatPreview({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg bg-surface-shallow border border-line p-3">
      <div className="text-xs text-subtle mb-1">{t('slipAutoReply.previewSender')}</div>
      {text.trim().length === 0 ? (
        <div className="text-sm text-subtler italic">{t('slipAutoReply.previewEmpty')}</div>
      ) : (
        <div className="inline-block max-w-full rounded-2xl rounded-tl-sm bg-primary-soft text-fg px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {text}
        </div>
      )}
    </div>
  );
}

function LogTab() {
  const { t } = useTranslation();
  const logQuery = useQuery<AutoReplyLogRow[], Error>({
    queryKey: ['chat-autoreply-log'],
    queryFn: () =>
      apiClient.get<AutoReplyLogRow[]>(
        '/v_chat_autoreply_log?order=created_at.desc&limit=50',
      ),
    retry: false,
  });

  if (logQuery.isLoading) {
    return <div className="text-sm text-subtle">{t('common.loading')}</div>;
  }
  if (logQuery.isError) {
    return (
      <div className="alert alert-danger">
        <XCircle size={16} />
        <div><div className="alert-description text-sm">{translateApiError(logQuery.error, t)}</div></div>
      </div>
    );
  }

  const rows = logQuery.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="border border-line bg-surface rounded-lg p-8 text-center text-sm text-subtler">
        {t('slipAutoReply.logEmpty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.chat_message_id} className="border border-line bg-surface rounded-lg p-4">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <div className="font-medium text-sm">
              {row.contract_code ?? `#${row.contract_id}`}
            </div>
            <DateTime value={row.created_at} showTime className="text-xs text-subtle" />
          </div>
          {row.message_text && (
            <div className="text-sm text-fg whitespace-pre-wrap break-words mb-2">
              {row.message_text}
            </div>
          )}
          {(row.submission_amount != null || row.submission_status) && (
            <div className="text-xs text-subtle">
              {t('slipAutoReply.logSlip')}
              {row.submission_amount != null && (
                <> · {row.submission_amount.toLocaleString()}</>
              )}
              {row.submission_status && <> · {row.submission_status}</>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
