// Customer contact values that are web addresses open as links (Ohm #8,
// 2026-10-24: "a Facebook URL etc. should be a link that opens a new tab").
//
// Only clear addresses count: anything with http(s)://, anything starting
// "www.", or a host on the social sites customers actually give. A bare
// "john.doe" LINE id must stay text, so a generic "word.word" is not enough.

const SOCIAL_HOSTS = [
  'facebook.com', 'fb.com', 'fb.me', 'm.me', 'messenger.com',
  'line.me', 'lin.ee',
  'instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be',
  'x.com', 'twitter.com', 'threads.net', 'shopee.co.th', 'lazada.co.th',
];

/** The address to open for a contact value, or null when it isn't one. */
export function contactHref(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v || /\s/.test(v)) return null;
  if (/^https?:\/\/\S+\.\S+/i.test(v)) return v;
  if (/^www\.[^/\s]+\.[^/\s]+/i.test(v)) return `https://${v}`;
  const host = v.split(/[/?#]/)[0].toLowerCase();
  if (SOCIAL_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) return `https://${v}`;
  return null;
}
