// Hosts where /dev sandbox routes are exposed. Add hosts here; remove before
// pointing this build at a real production hostname.
//
// REMINDER: this exposes signature pads, media debug, and notification testers
// to anyone who can reach the listed hosts. Tighten before going live.
const DEV_EXPOSED_HOSTS = new Set<string>([
  'localhost',
  '127.0.0.1',
  '::1',
]);

export function isLocalDev(): boolean {
  if (typeof window === 'undefined') return false;
  return DEV_EXPOSED_HOSTS.has(window.location.hostname);
}
