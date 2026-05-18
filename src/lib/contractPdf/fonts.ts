// Sarabun TTFs are bundled as static assets (Google Fonts, OFL).
// pdfmake needs every font registered as a base64 string inside its `vfs`
// map, then referenced by file name from `fonts`. We do this once and cache.

import SarabunRegular from '../../assets/fonts/Sarabun-Regular.ttf?url';
import SarabunBold from '../../assets/fonts/Sarabun-Bold.ttf?url';
import SarabunItalic from '../../assets/fonts/Sarabun-Italic.ttf?url';
import SarabunBoldItalic from '../../assets/fonts/Sarabun-BoldItalic.ttf?url';

const FILES = {
  'Sarabun-Regular.ttf': SarabunRegular,
  'Sarabun-Bold.ttf': SarabunBold,
  'Sarabun-Italic.ttf': SarabunItalic,
  'Sarabun-BoldItalic.ttf': SarabunBoldItalic,
} as const;

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font fetch failed: ${res.status} ${url}`);
  const buf = await res.arrayBuffer();
  // btoa works in browser; chunk to avoid call-stack overflow on large buffers
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

let vfsPromise: Promise<Record<string, string>> | null = null;

export function loadPdfFontVfs(): Promise<Record<string, string>> {
  if (!vfsPromise) {
    vfsPromise = (async () => {
      const entries = await Promise.all(
        Object.entries(FILES).map(async ([name, url]) => [name, await fetchAsBase64(url)] as const),
      );
      return Object.fromEntries(entries);
    })();
  }
  return vfsPromise;
}

export const PDF_FONT_DEF = {
  Sarabun: {
    normal: 'Sarabun-Regular.ttf',
    bold: 'Sarabun-Bold.ttf',
    italics: 'Sarabun-Italic.ttf',
    bolditalics: 'Sarabun-BoldItalic.ttf',
  },
};

export const PDF_FONT_NAME = 'Sarabun';
