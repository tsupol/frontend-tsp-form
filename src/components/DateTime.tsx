import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../lib/format';
import { useDateCalendar } from '../lib/datePref';

interface DateTimeProps {
  value: string | null;
  showTime?: boolean;
  className?: string;
}

export function DateTime({ value, showTime = true, className }: DateTimeProps) {
  const { i18n } = useTranslation();
  // Subscribe so the formatted string re-renders when the user toggles calendar.
  useDateCalendar();
  return <span className={className}>{formatDateTime(value, i18n.language, showTime)}</span>;
}
