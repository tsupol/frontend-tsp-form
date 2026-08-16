import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Build stamp — monotonic, readable: YYMMDD-HHMM in Bangkok time (UTC+7).
// Stamped at build, so every deploy bumps it automatically (no manual edits).
function buildVersion(): string {
  const bkk = new Date(Date.now() + 7 * 60 * 60 * 1000); // shift to UTC+7, then read UTC fields
  const p = (n: number) => String(n).padStart(2, '0');
  const yy = p(bkk.getUTCFullYear() % 100);
  const mm = p(bkk.getUTCMonth() + 1);
  const dd = p(bkk.getUTCDate());
  const hh = p(bkk.getUTCHours());
  const mi = p(bkk.getUTCMinutes());
  return `${yy}${mm}${dd}-${hh}${mi}`;
}

// The public enrollment page is its OWN entry, not a route in the admin SPA.
// It is opened cold, once, by someone who is not our staff — on a phone, on
// mobile data, from a QR code — and the admin bundle (~1.3MB gzipped, carrying
// pdfjs / pdfmake / heic2any / recharts) has no business being in front of a
// screen that shows a serial number and a status line.
//
// In dev, Vite serves multi-page apps by filesystem path, so /mdm-enroll would
// 404. This plugin rewrites it to /enroll.html so the URL in the QR code is the
// same one that works in production (where nginx does the same rewrite).
// Build-time slice of the locale files for the enrollment page.
//
// The page must say EXACTLY what tab-1 says, so the wording has to come from the
// same en.json/th.json the admin app uses. But importing those files pulls in
// ~810kB of raw JSON — the entire admin vocabulary — because a runtime key
// lookup keeps the whole object reachable and nothing can tree-shake.
//
// This resolves `virtual:enroll-strings` by reading the real locale files and
// emitting ONLY the keys listed in src/enroll/enrollStringKeys.ts. Single source
// preserved, ~90% of the bundle removed.
//
// A listed key that is missing from either locale file throws and FAILS THE
// BUILD — so a rename in the shared files is caught here, not by a stranger
// seeing a raw dotted key on their phone.
export function enrollStringsPlugin() {
  const VIRTUAL = 'virtual:enroll-strings';
  const RESOLVED = '\0' + VIRTUAL;

  return {
    name: 'enroll-strings',
    resolveId(id: string) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    async load(id: string) {
      if (id !== RESOLVED) return null;

      const { readFile } = await import('node:fs/promises');
      const path = await import('node:path');
      const root = path.resolve(process.cwd(), 'src');

      const keysSrc = await readFile(path.join(root, 'enroll/enrollStringKeys.ts'), 'utf8');
      const keys = Array.from(keysSrc.matchAll(/'([^']+)'\s*,/g)).map((m) => m[1]);

      const pick = (tree: unknown, dotted: string): string | undefined => {
        let cur: unknown = tree;
        for (const part of dotted.split('.')) {
          if (typeof cur !== 'object' || cur === null) return undefined;
          cur = (cur as Record<string, unknown>)[part];
        }
        return typeof cur === 'string' ? cur : undefined;
      };

      const out: Record<string, Record<string, string>> = {};
      const missing: string[] = [];

      for (const lang of ['en', 'th']) {
        const full = JSON.parse(
          await readFile(path.join(root, `i18n/locales/${lang}.json`), 'utf8'),
        );
        out[lang] = {};
        for (const k of keys) {
          const v = pick(full, k);
          if (v === undefined) missing.push(`${lang}:${k}`);
          else out[lang][k] = v;
        }
      }

      if (missing.length) {
        throw new Error(
          `[enroll-strings] key(s) not found in the locale files:\n  ${missing.join('\n  ')}\n` +
          `Fix src/enroll/enrollStringKeys.ts or restore the key in en.json/th.json.`,
        );
      }

      return `export default ${JSON.stringify(out)};`;
    },
  };
}

function enrollPageRewrite() {
  return {
    name: 'enroll-page-rewrite',
    configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (path === '/mdm-enroll' || path === '/mdm-enroll/') {
          // Keep the query string — the token lives there.
          const qs = (req.url ?? '').slice(path.length);
          req.url = `/enroll.html${qs}`;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion()),
  },
  plugins: [
    react(),
    tailwindcss(),
    basicSsl(),
    enrollStringsPlugin(),
    enrollPageRewrite(),
  ],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        enroll: 'enroll.html',
      },
    },
  },
})
