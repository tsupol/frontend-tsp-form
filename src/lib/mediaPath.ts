import { config } from '../config/config';

export type MediaPrivacy = 'public' | 'private';

const PUBLIC_PREFIX = 'uploads/';
const PRIVATE_PREFIX = 'private/';

export function normalizeKey(key: string): string {
  return key.replace(/^\//, '');
}

export function getMediaPrivacy(key: string): MediaPrivacy | null {
  const k = normalizeKey(key);
  if (k.startsWith(PUBLIC_PREFIX)) return 'public';
  if (k.startsWith(PRIVATE_PREFIX)) return 'private';
  return null;
}

export function publicMediaUrl(key: string): string {
  return `${config.r2PublicUrl}/${normalizeKey(key)}`;
}

/**
 * Format a storage key into the canonical shape expected by the backend's
 * core.is_media_path_* validators:
 *   - private keys:        "private/..."     (no leading slash)
 *   - public uploads keys: "/uploads/..."    (leading slash)
 *   - media/ keys:         "media/..."       (no leading slash)
 * The R2 upload service returns keys without a leading slash; this function
 * applies the slash only where the backend expects it.
 */
export function toStoragePath(key: string): string {
  const k = normalizeKey(key);
  if (k.startsWith('uploads/')) return `/${k}`;
  return k;
}
