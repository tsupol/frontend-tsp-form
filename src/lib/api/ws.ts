// WebSocket singleton — see UI_FEEDBACK/2026-05-21_DELIVERED_realtime_websocket_webpush_implementation.md
//
// One connection per tab. Many features call subscribe(channel, handler) on the
// same socket; chat/slip-review/approvals all share it. Polling stays as a
// safety net per the doc's §10.7.

const WS_URL = 'wss://ws.czynet.dev/ws/v1';
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const PONG_TIMEOUT_MS = 10_000;

export type WsEventHandler = (data: unknown) => void;

interface ChannelEvent {
  type: 'channel_event';
  channel: string;
  data: unknown;
}

interface SimpleMsg {
  type: 'hello' | 'subscribed' | 'unsubscribed' | 'pong' | 'ping' | 'auth_error'
      | 'acl_denied' | 'token_expiring' | 'error';
  [k: string]: unknown;
}

type ServerMsg = ChannelEvent | SimpleMsg;

/**
 * Role from the JWT we connected with, for `acl_denied` diagnostics only.
 *
 * `acl_denied` is a normal protocol reply, not an error — a channel the server
 * doesn't recognise is refused silently and the feature quietly falls back to
 * polling. Two channels (`slip:company:*`, `chat:branch:*`) stayed dead that way
 * for ~2 months because nothing logged the refusal. BE asked us to always warn
 * with channel + role so the next dead channel surfaces on day one.
 * (UI_FEEDBACK/2026-08-07_IMPLEMENT_ws_channels_restored.md §6.)
 */
function currentRoleFromToken(): string {
  try {
    const jwt = localStorage.getItem('access_token');
    if (!jwt) return 'unknown';
    const payload = jwt.split('.')[1];
    if (!payload) return 'unknown';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { role_code?: string; role?: string };
    return claims.role_code ?? claims.role ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

class WsClient {
  private ws: WebSocket | null = null;
  private subscribers = new Map<string, Set<WsEventHandler>>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private connecting = false;
  private intentionallyClosed = false;

  subscribe(channel: string, handler: WsEventHandler): () => void {
    let subs = this.subscribers.get(channel);
    const isNewChannel = !subs;
    if (!subs) {
      subs = new Set();
      this.subscribers.set(channel, subs);
    }
    subs.add(handler);

    if (isNewChannel) {
      this.sendIfOpen({ type: 'subscribe', channels: [channel] });
    }
    this.connect();

    return () => this.unsubscribe(channel, handler);
  }

  private unsubscribe(channel: string, handler: WsEventHandler) {
    const subs = this.subscribers.get(channel);
    if (!subs) return;
    subs.delete(handler);
    if (subs.size === 0) {
      this.subscribers.delete(channel);
      this.sendIfOpen({ type: 'unsubscribe', channels: [channel] });
    }
  }

  connect() {
    if (typeof window === 'undefined') return;
    if (this.connecting) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN ||
                    this.ws.readyState === WebSocket.CONNECTING)) return;

    const jwt = localStorage.getItem('access_token');
    if (!jwt) return;

    this.intentionallyClosed = false;
    this.connecting = true;

    try {
      this.ws = new WebSocket(WS_URL, [`bearer.${jwt}`]);
    } catch (e) {
      console.error('[ws] construct failed', e);
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connecting = false;
      this.reconnectAttempt = 0;
      const channels = Array.from(this.subscribers.keys());
      if (channels.length) this.sendIfOpen({ type: 'subscribe', channels });
    };

    this.ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); }
      catch { return; }

      switch (msg.type) {
        case 'channel_event':
          this.dispatch(msg.channel, msg.data);
          break;
        case 'ping':
          this.sendIfOpen({ type: 'pong' });
          this.armPongTimer();
          break;
        case 'acl_denied':
          // Never swallow this — see currentRoleFromToken() above. If a channel
          // you expect to work shows up here, tell BE rather than routing around
          // it; a workaround hides the symptom, not the dead channel.
          console.warn(
            `[ws] acl_denied channel=${String(msg.channel ?? '?')} ` +
            `role=${currentRoleFromToken()} reason=${String(msg.reason ?? '?')}`,
            msg,
          );
          break;
        case 'auth_error':
          console.warn('[ws] auth_error', msg);
          break;
        case 'token_expiring':
          // Background refresher in AuthContext handles renewal; nothing to do here.
          break;
      }
    };

    this.ws.onclose = (ev) => {
      this.ws = null;
      this.connecting = false;
      if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
      if (this.intentionallyClosed) return;
      if (ev.code === 4001) {
        console.warn('[ws] closed 4001 (auth) — not reconnecting');
        return;
      }
      if (this.subscribers.size > 0) this.scheduleReconnect();
    };

    this.ws.onerror = (ev) => {
      console.warn('[ws] error', ev);
    };
  }

  disconnect() {
    this.intentionallyClosed = true;
    this.subscribers.clear();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
    if (this.ws) {
      try { this.ws.close(1000, 'logout'); } catch { /* ignore */ }
    }
    this.ws = null;
    this.reconnectAttempt = 0;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const idx = Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1);
    const delay = RECONNECT_DELAYS_MS[idx];
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // If we don't hear another ping within ~30s + slack, assume the socket is
  // dead and force a reconnect. Browser keepalive does not cover app-level.
  private armPongTimer() {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = setTimeout(() => {
      if (this.ws) {
        try { this.ws.close(4000, 'pong_timeout'); } catch { /* ignore */ }
      }
    }, 30_000 + PONG_TIMEOUT_MS);
  }

  private sendIfOpen(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
    }
  }

  private dispatch(channel: string, data: unknown) {
    const subs = this.subscribers.get(channel);
    if (!subs) return;
    subs.forEach(h => {
      try { h(data); } catch (e) { console.error('[ws] handler threw', e); }
    });
  }
}

export const wsClient = new WsClient();
