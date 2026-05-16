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
