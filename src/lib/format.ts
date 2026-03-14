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
