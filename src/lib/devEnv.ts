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

// Private LAN addresses (RFC 1918) also count as dev. The dev server is reached
// from a phone on the same wifi — testing the QR enrollment page, checking a
// layout on a real handset — and on those the hostname is the machine's LAN IP,
// never "localhost". Without this the whole /dev section, and /dev-login, simply
// vanish the moment you open the app from another device.
//
// Deliberately a RANGE, not a pinned address: DHCP reassigns, and a hardcoded
// IP means this silently stops working on the next lease.
//
//   10.x.x.x  ·  192.168.x.x  ·  172.16–31.x.x
//
// Public hostnames (nnfui.czynet.dev) match none of these, so production is
// unaffected — it has no route to a private address anyway.
const PRIVATE_IPV4 = /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

export function isLocalDev(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return DEV_EXPOSED_HOSTS.has(host) || PRIVATE_IPV4.test(host);
}
