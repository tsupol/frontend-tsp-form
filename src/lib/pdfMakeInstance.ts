// ============================================================================
// Shared pdfmake runtime — lazily loads pdfmake 0.3.8 and registers the Sarabun
// Thai fonts into its VFS. Both the thermal-receipt PDF (billDocPdf) and the
// A4 band reports (expenseReportPdf) use this so the font wiring lives once.
//
// pdfmake 0.3.8 runtime shape (differs from @types/pdfmake): createPdf takes
// (docDefinition, options); fonts come from the instance `.fonts` property; the
// VFS is the instance `.virtualfs` object populated via
// `writeFileSync(name, base64, 'base64')`. Setting `pdfMake.vfs` (the 0.1/0.2
// API) is silently ignored — which is why the font wasn't found before.
// ============================================================================

export interface PdfMakeRuntime {
  createPdf: (def: unknown, options?: unknown) => { download: (name: string) => void; open: () => void };
  fonts: Record<string, unknown>;
  virtualfs: { writeFileSync: (name: string, content: string, encoding: string) => void };
}

const FONT_DEF = {
  Sarabun: {
    normal: 'Sarabun-Regular.ttf',
    bold: 'Sarabun-Bold.ttf',
    italics: 'Sarabun-Regular.ttf',
    bolditalics: 'Sarabun-Bold.ttf',
  },
};

async function fetchAsBase64(url: string): Promise<string> {
  const buf = await fetch(url).then((r) => r.arrayBuffer());
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

let pdfMakeReady: Promise<PdfMakeRuntime> | null = null;

/** Lazily loads pdfmake with Sarabun fonts registered. Deduped across callers. */
export async function getPdfMake(): Promise<PdfMakeRuntime> {
  if (pdfMakeReady) return pdfMakeReady;
  pdfMakeReady = (async () => {
    const pdfMakeMod = await import('pdfmake/build/pdfmake');
    const mod = pdfMakeMod as unknown as { default?: unknown };
    const pdfMake = (mod.default ?? pdfMakeMod) as unknown as PdfMakeRuntime;
    const [regular, bold] = await Promise.all([
      import('../assets/fonts/Sarabun-Regular.ttf?url').then((m) => fetchAsBase64(m.default)),
      import('../assets/fonts/Sarabun-Bold.ttf?url').then((m) => fetchAsBase64(m.default)),
    ]);
    pdfMake.virtualfs.writeFileSync('Sarabun-Regular.ttf', regular, 'base64');
    pdfMake.virtualfs.writeFileSync('Sarabun-Bold.ttf', bold, 'base64');
    pdfMake.fonts = FONT_DEF;
    return pdfMake;
  })();
  return pdfMakeReady;
}
