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

export default defineConfig({
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion()),
  },
  plugins: [
    react(),
    tailwindcss(),
    basicSsl(),
  ],
})
