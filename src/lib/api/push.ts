// Web Push setup — registers SW, requests permission, subscribes via VAPID,
// upserts device on backend via fn_staff_register_push_device.
//
// VAPID public key is hardcoded per UI_FEEDBACK doc (public, not a secret).
// Backend uses ON CONFLICT (device_token) DO UPDATE, so calling setupStaffPush
// repeatedly is safe.

import { apiClient } from '../api';

const VAPID_PUBLIC_KEY =
  'BGVvtuff8TZqiPRzSO0V1yY0EpLyTHdNwl2p-p6gPVKar_spe8_q0Q0xSVTRst8RfYT7LD-xBwIX7oWXlarvYUo';

const SW_PATH = '/sw.js';

export type PushSetupResult =
  | { ok: true; deviceId?: number; subscription: PushSubscription }
  | { ok: false; reason: string };

function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

function pickUaParens(ua: string): string {
  const m = ua.match(/\(([^)]+)\)/);
  return m?.[1] ?? ua.substring(0, 60);
}

interface RegisterDeviceResult {
  device_id?: number;
}

export async function setupStaffPush(opts?: {
  onNavigate?: (path: string) => void;
}): Promise<PushSetupResult> {
  if (typeof window === 'undefined') return { ok: false, reason: 'no_window' };
  if (!('serviceWorker' in navigator)) return { ok: false, reason: 'no_sw' };
  if (!('PushManager' in window)) return { ok: false, reason: 'no_push' };
  if (!('Notification' in window)) return { ok: false, reason: 'no_notification' };

  // 1. Register service worker
  let reg: ServiceWorkerRegistration;
  try {
    reg = await navigator.serviceWorker.register(SW_PATH);
  } catch (e) {
    console.warn('[push] SW register failed', e);
    return { ok: false, reason: 'sw_register_failed' };
  }

  // 2. Forward SW→page navigation messages to router
  if (opts?.onNavigate) {
    const onNavigate = opts.onNavigate;
    navigator.serviceWorker.addEventListener('message', (ev) => {
      const d = ev.data as { type?: string; url?: string } | undefined;
      if (d?.type === 'navigate' && d.url) {
        try {
          const url = new URL(d.url, window.location.origin);
          onNavigate(url.pathname + url.search);
        } catch {
          /* ignore */
        }
      }
    });
  }

  // 3. Wait for activation
  if (!reg.active) {
    await new Promise<void>(resolve => {
      const sw = reg.installing || reg.waiting;
      if (!sw) return resolve();
      const onState = () => {
        if (sw.state === 'activated') {
          sw.removeEventListener('statechange', onState);
          resolve();
        }
      };
      sw.addEventListener('statechange', onState);
    });
  }

  // 4. Ask permission (resolves immediately if already granted)
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch (e) {
    console.warn('[push] requestPermission threw', e);
    return { ok: false, reason: 'permission_error' };
  }
  if (permission !== 'granted') {
    return { ok: false, reason: `permission_${permission}` };
  }

  // 5. Subscribe to PushManager
  let sub: PushSubscription | null;
  try {
    sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(VAPID_PUBLIC_KEY),
      });
    }
  } catch (e) {
    console.warn('[push] pushManager.subscribe failed', e);
    return { ok: false, reason: 'subscribe_failed' };
  }

  // 6. Register device on backend
  const subJson = sub.toJSON();
  try {
    const ua = navigator.userAgent ?? '';
    const result = await apiClient.rpc<RegisterDeviceResult>('fn_staff_register_push_device', {
      p_device_token: sub.endpoint,
      p_platform: 'web-push',
      p_push_endpoint: sub.endpoint,
      p_push_p256dh: subJson.keys?.p256dh ?? null,
      p_push_auth: subJson.keys?.auth ?? null,
      p_device_name: `Staff Web (${pickUaParens(ua)})`,
      p_app_version: '1.0.0',
      p_os_version: ua.substring(0, 100),
      p_language: (navigator.language ?? 'th').startsWith('en') ? 'en' : 'th',
    });
    return { ok: true, deviceId: result?.device_id, subscription: sub };
  } catch (e) {
    console.warn('[push] register_push_device failed', e);
    return { ok: false, reason: 'rpc_failed' };
  }
}
