function getLocale(lang: string): string {
  return lang === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB';
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
