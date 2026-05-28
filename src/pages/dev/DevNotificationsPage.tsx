import { useState } from 'react';
import { Button, Input, Select } from 'tsp-form';
import { Bell, MessageSquare } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { setupStaffPush } from '../../lib/api/push';
import { useAuth } from '../../contexts/AuthContext';

const EVENT_TYPES = [
  'chat_to_customer',
  'chat_to_staff',
  'due_today',
  'due_1d',
  'due_3d',
  'due_7d',
  'promise_today',
  'overdue',
  'overdue_3d',
  'overdue_7d',
  'payment_recorded',
  'slip_uploaded',
  'slip_approved',
  'slip_rejected',
] as const;

const SENDER_TYPES = ['CUSTOMER', 'STAFF'] as const;

interface SendTestResult {
  queue_id: number;
  event_type: string;
  category: string;
  severity: string;
  dismissible: boolean;
  user_type: string;
  user_id: number;
  contract_ids: number[];
  hint?: string;
}

interface SimulateChatResult {
  message_id: number;
  contract_id: number;
  sender_type: string;
  sender_id: number;
  message_text: string;
  hint?: string;
}

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function ResultBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="border border-line rounded-md p-3 bg-surface-2">
      <div className="text-xs font-semibold text-subtle mb-1">{label}</div>
      <pre className="text-xs font-mono whitespace-pre-wrap break-all">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function DevNotificationsPage() {
  const { user } = useAuth();

  // fn_send_test_notification
  const [eventType, setEventType] = useState<string>('chat_to_staff');
  const [pushContractId, setPushContractId] = useState<string>('');
  const [pushLoading, setPushLoading] = useState(false);
  const [pushResult, setPushResult] = useState<SendTestResult | null>(null);
  const [pushError, setPushError] = useState<string>('');

  // fn_dev_simulate_customer_chat
  const [chatContractId, setChatContractId] = useState<string>('');
  const [senderType, setSenderType] = useState<string>('CUSTOMER');
  const [messageText, setMessageText] = useState<string>('hello from test');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatResult, setChatResult] = useState<SimulateChatResult | null>(null);
  const [chatError, setChatError] = useState<string>('');

  // Push registration helper
  const [permission, setPermission] = useState<NotificationPermission | 'unknown'>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unknown'
  );
  const [registerStatus, setRegisterStatus] = useState<string>('');

  const sendTestNotification = async () => {
    setPushLoading(true);
    setPushError('');
    setPushResult(null);
    try {
      const body: Record<string, unknown> = { p_event_type: eventType };
      if (pushContractId.trim()) body.p_contract_id = Number(pushContractId.trim());
      const result = await apiClient.rpc<SendTestResult>('fn_send_test_notification', body);
      setPushResult(result);
    } catch (err) {
      setPushError(formatError(err));
    } finally {
      setPushLoading(false);
    }
  };

  const simulateChat = async () => {
    if (!chatContractId.trim()) {
      setChatError('Contract ID required');
      return;
    }
    setChatLoading(true);
    setChatError('');
    setChatResult(null);
    try {
      const result = await apiClient.rpc<SimulateChatResult>('fn_dev_simulate_customer_chat', {
        p_contract_id: Number(chatContractId.trim()),
        p_sender_type: senderType,
        p_message_text: messageText.trim() || null,
      });
      setChatResult(result);
    } catch (err) {
      setChatError(formatError(err));
    } finally {
      setChatLoading(false);
    }
  };

  const registerPush = async () => {
    setRegisterStatus('Registering…');
    const result = await setupStaffPush();
    if (result.ok) {
      setRegisterStatus(`OK · device_id=${result.deviceId ?? '?'}`);
    } else {
      setRegisterStatus(`Failed: ${result.reason}`);
    }
    if (typeof Notification !== 'undefined') setPermission(Notification.permission);
  };

  return (
    <div className="page-content max-w-3xl mx-auto p-6 flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Notification Tests</h1>
        <p className="text-sm text-subtle">
          Self-serve smoke tests for Web Push + WebSocket. Both RPCs target the
          caller's own JWT — you can only send to yourself.
        </p>
      </div>

      <section className="border border-line rounded-lg p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Bell size={18} />
          <h2 className="text-lg font-semibold">Push subscription</h2>
        </div>
        <div className="text-sm">
          Permission: <span className="font-mono">{permission}</span>
          {user && (
            <> · user_id: <span className="font-mono">{user.user_id}</span></>
          )}
          {user?.branch_id != null && (
            <> · branch_id: <span className="font-mono">{user.branch_id}</span></>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={registerPush}>Register this browser</Button>
          {registerStatus && <span className="text-sm text-subtle">{registerStatus}</span>}
        </div>
        <p className="text-xs text-subtle">
          App.tsx already calls this ~1.5s after login. Use this button to re-register
          after revoking permission in browser settings, or to grab the device_id.
        </p>
      </section>

      <section className="border border-line rounded-lg p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Bell size={18} />
          <h2 className="text-lg font-semibold">fn_send_test_notification</h2>
        </div>
        <p className="text-sm text-subtle">
          Enqueues one notification addressed to you. No chat row, no fan-out.
          Tests the push layer: SW handler, banner, deep-link tap, mute rules.
        </p>

        <div className="form-grid gap-3">
          <div className="flex flex-col">
            <label className="form-label">Event type</label>
            <Select
              value={eventType}
              onChange={v => setEventType(v as string)}
              options={EVENT_TYPES.map(v => ({ value: v, label: v }))}
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">Contract ID (optional)</label>
            <Input
              className="w-full"
              value={pushContractId}
              onChange={e => setPushContractId(e.target.value)}
              placeholder="auto-picks first contract if blank"
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button color="primary" onClick={sendTestNotification} disabled={pushLoading}>
            {pushLoading ? 'Sending…' : 'Send'}
          </Button>
          <span className="text-xs text-subtle">
            Worker picks up within ~10s. Minimize this tab to see the OS notification.
          </span>
        </div>

        {pushError && <ResultBlock label="Error" value={pushError} />}
        {pushResult && <ResultBlock label="Response" value={pushResult} />}
      </section>

      <section className="border border-line rounded-lg p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <MessageSquare size={18} />
          <h2 className="text-lg font-semibold">fn_dev_simulate_customer_chat</h2>
        </div>
        <p className="text-sm text-subtle">
          Inserts a real <code>[TEST]</code>-prefixed row into <code>sale.chat_messages</code>.
          Trigger fires → WS <code>chat:contract:&lt;id&gt;</code> event +
          push fan-out to in-branch staff.
        </p>

        <div className="form-grid gap-3">
          <div className="flex flex-col">
            <label className="form-label">Contract ID (required)</label>
            <Input
              className="w-full"
              value={chatContractId}
              onChange={e => setChatContractId(e.target.value)}
              placeholder="contract in your branch"
              inputMode="numeric"
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">Sender type</label>
            <Select
              value={senderType}
              onChange={v => setSenderType(v as string)}
              options={SENDER_TYPES.map(v => ({ value: v, label: v }))}
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">Message text</label>
            <Input
              className="w-full"
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              placeholder="leave blank for default [TEST] text"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button color="primary" onClick={simulateChat} disabled={chatLoading}>
            {chatLoading ? 'Sending…' : 'Simulate'}
          </Button>
          <span className="text-xs text-subtle">
            Open <code>/admin/chat?contract=&lt;id&gt;</code> in another tab to watch it arrive.
          </span>
        </div>

        {chatError && <ResultBlock label="Error" value={chatError} />}
        {chatResult && <ResultBlock label="Response" value={chatResult} />}
      </section>

      <section className="border border-line rounded-lg p-5 flex flex-col gap-3 bg-surface-2">
        <h2 className="text-sm font-semibold">Cleanup</h2>
        <p className="text-xs text-subtle">
          Test chat rows have <code>[TEST]</code> prefix. Delete via SQL on the backend:
        </p>
        <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-bg p-2 rounded border border-line">
{`DELETE FROM sale.chat_messages
WHERE message_text LIKE '[TEST]%'
  AND created_at < now() - interval '1 day';`}
        </pre>
      </section>
    </div>
  );
}
