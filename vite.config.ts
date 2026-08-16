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
