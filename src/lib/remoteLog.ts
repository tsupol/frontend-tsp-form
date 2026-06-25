// Remote console logging for device debugging (e.g. iPad Safari where you can't
// open devtools). When enabled, console.* calls + uncaught errors are batched and
// POSTed to the devlog server, viewable at https://devlog.ecap.space/.
//
// Enable: visit any page with ?debug=1 (persists via localStorage). Disable: ?debug=0.
// Off by default — installs nothing unless the flag is set, so prod is unaffected.

const ENDPOINT = 'https://devlog.ecap.space/log';
const FLUSH_INTERVAL_MS = 2000;
const FLUSH_AT_COUNT = 25;
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type Level = (typeof LEVELS)[number];

interface Record {
  ts: number;
  level: Level;
  session: string;
  args: unknown[];
  url?: string;
}

let buffer: Record[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let sending = false; // re-entrancy guard: never let the POST's own logging recurse
let session = '';

// Safe-serialize console args: strip circular refs, DOM nodes, functions, errors.
function safeArgs(args: unknown[]): unknown[] {
  const seen = new WeakSet();
  const sanitize = (v: unknown): unknown => {
    if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
    if (typeof v === 'function') return `[Function: ${v.name || 'anonymous'}]`;
    if (typeof v === 'object' && v !== null) {
      if (v instanceof Node) return `[${v.nodeName}]`;
      if (seen.has(v as object)) return '[Circular]';
      seen.add(v as object);
      if (Array.isArray(v)) return v.map(sanitize);
      const out: Record_ = {};
      for (const k of Object.keys(v as object)) {
        try {
          out[k] = sanitize((v as Record_)[k]);
        } catch {
          out[k] = '[Unserializable]';
        }
      }
      return out;
    }
    return v;
  };
  return args.map(sanitize);
}
type Record_ = { [k: string]: unknown };

function push(level: Level, args: unknown[]) {
  if (sending) return;
  buffer.push({ ts: Date.now(), level, session, args: safeArgs(args), url: location.pathname + location.search });
  if (buffer.length >= FLUSH_AT_COUNT) flush();
}

function flush(useBeacon = false) {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  const body = JSON.stringify(batch);
  sending = true;
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    } else {
      // keepalive lets the request survive a backgrounded tab; ignore failures.
      fetch(ENDPOINT, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } finally {
    sending = false;
  }
}

function getSessionId(): string {
  const KEY = 'remoteLog.session';
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 8) + '-' + Date.now().toString(36).slice(-4);
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

// Resolve the on/off flag. ?debug=1 turns on (persists), ?debug=0 turns off.
function isEnabled(): boolean {
  const KEY = 'remoteLog';
  try {
    const params = new URLSearchParams(location.search);
    const q = params.get('debug');
    if (q === '1') localStorage.setItem(KEY, '1');
    if (q === '0') localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function installRemoteLog() {
  if (!isEnabled()) return;

  session = getSessionId();

  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      push(level, args);
    };
  }

  window.addEventListener('error', (e) => {
    push('error', [`Uncaught: ${e.message}`, { file: e.filename, line: e.lineno, col: e.colno, error: e.error }]);
    flush(true); // crashes flush immediately — the page may be dying
  });

  window.addEventListener('unhandledrejection', (e) => {
    push('error', ['Unhandled promise rejection:', e.reason]);
    flush(true);
  });

  // Periodic + on-hide flush. visibilitychange+pagehide are the reliable
  // unload signals on iOS Safari (beforeunload often doesn't fire there).
  timer = setInterval(() => flush(), FLUSH_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => flush(true));

  console.info(`[remoteLog] enabled, session=${session} → ${ENDPOINT}`);
  void timer;
}
