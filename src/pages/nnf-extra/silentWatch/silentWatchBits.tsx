// Small pieces both halves of the silent-watch console print the same way:
// how long the device has been silent, its level, its group and a check result.
// Every value comes from the backend; these only put it into words.

import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import type { SilentGroup } from './silentWatchApi';

/** "6 วัน 21 ชม." from the backend's `silent_hours`. */
export function useSilentDuration() {
  const { t } = useTranslation();
  return (hours: number | null | undefined) => {
    if (hours == null) return '—';
    const h = Math.floor(hours);
    const days = Math.floor(h / 24);
    const rest = h % 24;
    if (days === 0) return t('silentWatch.dur.hours', { h: rest });
    if (rest === 0) return t('silentWatch.dur.days', { d: days });
    return t('silentWatch.dur.daysHours', { d: days, h: rest });
  };
}

type BadgeColor = 'default' | 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info';

/** The level the backend reached (48 · 72 · 120 · 240 · 360 · 480 h), as days. */
export function LevelBadge({ hours }: { hours: number }) {
  const { t } = useTranslation();
  const color: BadgeColor = hours >= 240 ? 'danger' : hours >= 120 ? 'warning' : 'default';
  const days = hours / 24;
  return (
    <Badge size="xs" color={color}>
      {Number.isInteger(days) ? t('silentWatch.level.days', { d: days }) : t('silentWatch.level.hours', { h: hours })}
    </Badge>
  );
}

export function GroupBadge({ group }: { group: SilentGroup }) {
  const { t } = useTranslation();
  const color: BadgeColor = group === 'PRE_FIRST_DUE' ? 'info' : group === 'OVERDUE' ? 'danger' : 'default';
  return <Badge size="xs" color={color}>{t(`silentWatch.group.${group}`, { defaultValue: group })}</Badge>;
}

const RESULT_COLOR: Record<string, BadgeColor> = {
  REACHED_OK: 'success',
  NOT_REACHED: 'warning',
  SUSPICIOUS: 'warning',
  FLIGHT_RISK: 'danger',
  FIELD_VISITED: 'info',
  ANOMALY_FOUND: 'danger',
};

export function ResultBadge({ code }: { code: string }) {
  const { t } = useTranslation();
  return <Badge size="xs" color={RESULT_COLOR[code] ?? 'default'}>{t(`silentWatch.result.${code}`, { defaultValue: code })}</Badge>;
}

export function TestDataBadge() {
  const { t } = useTranslation();
  return <Badge size="xs" color="secondary">{t('silentWatch.testData')}</Badge>;
}
