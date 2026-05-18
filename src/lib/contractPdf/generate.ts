// Orchestrator: ContractPdfInput → PDF file → browser download.
//
// Note: pdfmake builds expose a single combined module via `pdfmake/build/pdfmake`.
// We dynamically import so the bundle splits and the ~1 MB pdfmake payload only
// loads when the user actually triggers PDF generation.

import type { ContractPdfInput } from './types';
import { buildContractDocDefinition } from './buildDocDefinition';
import { loadPdfFontVfs, PDF_FONT_DEF } from './fonts';

interface PdfMakeStatic {
  vfs?: Record<string, string>;
  fonts: Record<string, unknown>;
  addVirtualFileSystem?: (vfs: Record<string, string>) => void;
  addFonts?: (fonts: Record<string, unknown>) => void;
  createPdf: (def: unknown) => {
    download: (filename: string) => void;
    open: () => void;
    getBlob: (cb: (blob: Blob) => void) => void;
  };
}

let pdfMakeReady: Promise<PdfMakeStatic> | null = null;

async function getPdfMake(): Promise<PdfMakeStatic> {
  if (!pdfMakeReady) {
    pdfMakeReady = (async () => {
      const mod = await import('pdfmake/build/pdfmake');
      const pdfMake = (mod as unknown as { default: PdfMakeStatic }).default ?? (mod as unknown as PdfMakeStatic);
      const vfs = await loadPdfFontVfs();
      // pdfmake 0.3 stores VFS entries in an internal store reached via
      // addVirtualFileSystem(). Plain `pdfMake.vfs = vfs` no longer populates
      // the store, so font lookups during measure() fail with
      // "File 'Pridi-Bold.ttf' not found in virtual file system".
      if (typeof pdfMake.addVirtualFileSystem === 'function') {
        pdfMake.addVirtualFileSystem(vfs);
      } else {
        pdfMake.vfs = vfs;
      }
      if (typeof pdfMake.addFonts === 'function') {
        pdfMake.addFonts(PDF_FONT_DEF);
      } else {
        pdfMake.fonts = PDF_FONT_DEF;
      }
      return pdfMake;
    })();
  }
  return pdfMakeReady;
}

export async function downloadContractPdf(input: ContractPdfInput, filename: string): Promise<void> {
  const pdfMake = await getPdfMake();
  const docDef = buildContractDocDefinition(input);
  pdfMake.createPdf(docDef).download(filename);
}
