// §3.2 time rule — every MDM timestamp shows BOTH the absolute time and how long
// ago, e.g. "27 ก.ค. 2569 08:41 น. (13 นาทีที่แล้ว)". Past a staleness threshold
// (default 7 days, matching DEVICE_UNREACHABLE) it turns a warning colour so an
// old fix that reads as current can't fool anyone tracking a device.

import { useTranslation } from 'react-i18next';
import { formatRelativeAgo, formatDateTime } from '../../../lib/format';

const DAY_MS = 86_400_000;

export function RelativeDateTime({
  value,
  staleAfterDays = 7,
  className,
}: {
  value: string | null | undefined;
  staleAfterDays?: number;
  className?: string;
}) {
  const { i18n } = useTranslation();
  if (!value) return <span className={className}>—</span>;

  const { rel } = formatRelativeAgo(value, i18n.language);
  const abs = formatDateTime(value, i18n.language, true);
  const ageMs = Date.now() - new Date(value).getTime();
  const stale = Number.isFinite(ageMs) && ageMs > staleAfterDays * DAY_MS;

  return (
    <span className={`${className ?? ''} ${stale ? 'text-warning-fg' : ''}`}>
      {abs} <span className="text-subtler">({rel})</span>
    </span>
  );
}
