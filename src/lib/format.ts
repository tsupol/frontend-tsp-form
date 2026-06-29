// ── Currency formatter ──────────────────────────────────────────────────────

export function fmtCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

import { getDateCalendar } from './datePref';

function getLocale(lang: string): string {
  if (lang !== 'th') return 'en-GB';
  return getDateCalendar() === 'buddhist' ? 'th-TH-u-ca-buddhist' : 'th-TH-u-ca-gregory';
}

export function formatDateTime(dateStr: string | null, lang: string, showTime = true): string {
  if (!dateStr) return '—';
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  if (showTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }
  return new Date(dateStr).toLocaleString(getLocale(lang), options);
}

/**
 * Format a Date object as `YYYY-MM-DD` using the Date's *local* Y/M/D
 * (not UTC). Required when converting an InputDatePicker `Date | null`
 * back to an ISO date string — `.toISOString().slice(0,10)` is wrong
 * because it shifts the day for any timezone not at UTC midnight.
 */
export function toLocalDateStr(d: Date | null | undefined): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string to a Date in local timezone (avoids UTC shift) */
export function parseLocalDate(str: string | null | undefined): Date | null {
  if (!str) return null;
  return new Date(str + 'T00:00:00');
}

/**
 * Adult-age threshold for contract eligibility. Mirrors the backend's
 * sale._adult_age_threshold() (currently 20). A customer below this needs an
 * adult co-lessee to open a contract. Keep in sync with the backend if it
 * changes — there's no view exposing it, so this is the single FE source.
 */
export const ADULT_AGE = 20;

/** Calculate age from a DOB string (YYYY-MM-DD or ISO) */
export function getAge(dob: string): number {
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

function formatPickerDate(date: Date, lang: string, showTime: boolean): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  const hasTime = showTime && (date.getHours() !== 0 || date.getMinutes() !== 0);
  if (hasTime) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
  }
  return date.toLocaleString(getLocale(lang), opts);
}

/**
 * Display formatter for InputDatePicker's `dateFormat` prop.
 * Uses the Date's *local* fields (no timezone reinterpretation) so the
 * displayed day matches what the user clicked in the calendar.
 * Use: <InputDatePicker dateFormat={makeDatePickerFormat(i18n.language)} ... />
 */
export function makeDatePickerFormat(lang: string, showTime = false) {
  return (date: Date | null): string => {
    if (!date) return '';
    return formatPickerDate(date, lang, showTime);
  };
}

/**
 * Display formatter for InputDateRangePicker's `dateFormat` prop.
 */
export function makeDateRangePickerFormat(lang: string, showTime = false) {
  return (fromDate: Date | null, toDate: Date | null): string => {
    if (!fromDate && !toDate) return '';
    const from = fromDate ? formatPickerDate(fromDate, lang, showTime) : '';
    const to = toDate ? formatPickerDate(toDate, lang, showTime) : '';
    if (from && to) return `${from} — ${to}`;
    return from || to;
  };
}

/**
 * Smart, bucket-relative date formatting for queues / activity feeds.
 *
 * Pattern (Slack/iMessage style — picked over "5 days ago" because reviewers
 * think in calendar buckets, not raw deltas):
 *   < 1 min        → "just now" / "เมื่อกี้"
 *   < 1 hour       → "5m" / "5 นาที"
 *   today          → "15:02"
 *   yesterday      → "Yesterday 15:02" / "เมื่อวาน 15:02"
 *   this week      → "Mon 15:02" / "จันทร์ 15:02"
 *   this year      → "2 May" / "2 พ.ค."
 *   older          → "2 May 2026" / "2 พ.ค. 2026"
 *
 * Calendar bucketing is intentional. Past 1 week the time gets dropped — once
 * something is "last month" the exact hour stops being useful. Pass
 * `showTimeAlways=true` to keep `HH:mm` on every bucket if the page needs it.
 */
export function formatSmart(
  value: string | null | undefined,
  lang: string,
  opts: { showTimeAlways?: boolean } = {},
): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);

  // Calendar-day comparisons use local midnight, not 24h windows — so
  // 23:55 → 00:05 (10 min apart) correctly buckets as "yesterday", not "today".
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.floor((startOfDay(now) - startOfDay(d)) / 86_400_000);

  const isTh = lang === 'th';
  const locale = isTh ? 'th-TH-u-ca-gregory' : 'en-GB';
  const timePart = d.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
    hour12: false,
  });

  // Future timestamps: fall through to absolute format. "in 5m" is rare here
  // and adds branching without a clear win.
  if (diffSec >= 0 && diffSec < 60) {
    return isTh ? 'เมื่อกี้' : 'just now';
  }
  if (diffMin > 0 && diffMin < 60) {
    return isTh ? `${diffMin} นาที` : `${diffMin}m`;
  }

  if (dayDiff === 0) {
    return timePart;
  }
  if (dayDiff === 1) {
    return isTh ? `เมื่อวาน ${timePart}` : `Yesterday ${timePart}`;
  }
  if (dayDiff > 1 && dayDiff < 7) {
    const dow = d.toLocaleDateString(locale, { weekday: 'short', timeZone: 'Asia/Bangkok' });
    return `${dow} ${timePart}`;
  }

  const sameYear = d.getFullYear() === now.getFullYear();
  const datePart = d.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'Asia/Bangkok',
  });
  if (opts.showTimeAlways) {
    return `${datePart} ${timePart}`;
  }
  return datePart;
}

/** Format Thai phone: 0xx-xxx-xxxx (mobile) or 0x-xxx-xxxx (landline) */
export function formatTel(tel: string | null | undefined): string {
  if (!tel) return '—';
  const d = tel.replace(/\D/g, '');
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return tel;
}

/** Format Thai citizen ID: X-XXXX-XXXXX-XX-X */
export function formatCid(cid: string | null | undefined): string {
  if (!cid) return '—';
  const d = cid.replace(/\D/g, '');
  if (d.length === 13) return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
  return cid;
}

/**
 * Format an asset code for display: XX-XXXX-XXXXXX-X
 * e.g. AT26050000152 → AT-2605-000015-2. Prefix is the leading non-digits;
 * the digit body splits 4-6-1. The backend's `asset_code_display` field
 * already carries this format — prefer it when present and only fall back to
 * this for raw `asset_code`.
 */
export function formatAssetCode(code: string | null | undefined): string {
  if (!code) return '—';
  const m = code.match(/^([A-Za-z]*)(\d+)$/);
  if (!m) return code;
  const [, prefix, digits] = m;
  if (digits.length !== 11) return code;
  const head = prefix ? `${prefix}-` : '';
  return `${head}${digits.slice(0, 4)}-${digits.slice(4, 10)}-${digits.slice(10)}`;
}
