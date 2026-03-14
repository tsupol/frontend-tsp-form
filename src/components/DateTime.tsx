import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../lib/format';

interface DateTimeProps {
  value: string | null;
  showTime?: boolean;
  className?: string;
}

export function DateTime({ value, showTime = true, className }: DateTimeProps) {
  const { i18n } = useTranslation();
  return <span className={className}>{formatDateTime(value, i18n.language, showTime)}</span>;
}
