// Convert a stored R2 object (referenced by key) into a base64 PNG data URL.
// pdfmake supports only JPEG and PNG — anything else (WebP in our case) has
// to be re-encoded client-side via a canvas.
//
// Flow:
//   1. Fetch bytes through the misc-go /proxy/s3 endpoint (R2 doesn't allow
//      direct browser CORS).
//   2. Load via blob URL into an Image (same-origin, untainted canvas).
//   3. Draw onto a canvas and export PNG.

import { config } from '../../config/config';
import { normalizeKey } from '../mediaPath';

const PDFMAKE_OK = /^image\/(png|jpeg)$/i;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('reader error'));
    reader.readAsDataURL(blob);
  });
}

async function transcodeToPng(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function fetchImageAsDataUrl(key: string): Promise<string> {
  const url = `${config.uploadUrl}/proxy/s3?key=${encodeURIComponent(normalizeKey(key))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
  const blob = await res.blob();
  // pdfmake accepts JPEG/PNG straight through; WebP and anything else must be
  // re-encoded via a canvas.
  if (PDFMAKE_OK.test(blob.type)) {
    return await blobToDataUrl(blob);
  }
  return await transcodeToPng(blob);
}
