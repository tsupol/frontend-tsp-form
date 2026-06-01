// Convert a stored R2 object (referenced by key) into a base64 data URL for
// embedding in the contract PDF HTML rendered by misc-go (chromedp). Chrome
// handles webp/jpeg/png in <img> natively, so the bytes pass through unchanged
// — no canvas re-encode (a lossless PNG re-encode of a photographic ID card
// inflates ~10×, pushing the final data:text/html URL past Chrome's ~2 MB
// Navigate limit and triggering ERR_ABORTED).

import { config } from '../../config/config';
import { normalizeKey } from '../mediaPath';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('reader error'));
    reader.readAsDataURL(blob);
  });
}

export async function fetchImageAsDataUrl(key: string): Promise<string> {
  const url = `${config.uploadUrl}/proxy/s3?key=${encodeURIComponent(normalizeKey(key))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
  const blob = await res.blob();
  return await blobToDataUrl(blob);
}
