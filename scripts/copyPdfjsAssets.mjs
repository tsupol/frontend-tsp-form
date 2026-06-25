// Copy pdf.js v6 runtime assets (CMaps, standard fonts, wasm) from the
// installed pdfjs-dist package into public/pdfjs/ so they're served at the app
// root. pdf.js needs explicit URLs for these; without them the worker falls
// back to a degraded glyph path that renders "tofu" boxes on iPad Safari.
// Runs on postinstall and before build so the copy tracks the installed version.
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dest = join(root, 'public', 'pdfjs');
const dirs = ['cmaps', 'standard_fonts', 'wasm'];

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
for (const d of dirs) {
  await cp(join(src, d), join(dest, d), { recursive: true });
}
console.log(`[copyPdfjsAssets] copied ${dirs.join(', ')} → public/pdfjs/`);
