// How long, in words, for the device-watch scene. The numbers are the backend's
// (`silent_hours`, `locked_minutes`, `levels_hours`); this only writes them out.

import { useTranslation } from 'react-i18next';
import { useSilentDuration } from '../silentWatch/silentWatchBits';

export function useWatchTime() {
  const { t } = useTranslation();
  const long = useSilentDuration();
  return {
    /** "6 วัน 21 ชม." */
    hours: (h: number) => long(h),
    /** Over a head: "7ชม." under two days, then whole days "3วัน". */
    hoursShort: (h: number) => (h < 48 ? t('deviceWatch.short.h', { n: Math.floor(h) }) : t('deviceWatch.short.d', { n: Math.floor(h / 24) })),
    /** "2 วัน 7 ชม." · "79 นาที" */
    minutes: (m: number) => {
      const v = Math.max(0, Math.floor(m));
      const d = Math.floor(v / 1440);
      const h = Math.floor((v % 1440) / 60);
      if (d > 0) return h > 0 ? t('lostModeStuck.dur.dh', { d, h }) : t('lostModeStuck.dur.d', { d });
      if (h > 0) return t('lostModeStuck.dur.h', { h });
      return t('lostModeStuck.dur.m', { m: v % 60 });
    },
    /** Over a head: "45น." · "8ชม." · "3วัน" */
    minutesShort: (m: number) => (m < 60 ? t('deviceWatch.short.m', { n: Math.floor(m) })
      : m < 2880 ? t('deviceWatch.short.h', { n: Math.floor(m / 60) })
        : t('deviceWatch.short.d', { n: Math.floor(m / 1440) })),
    /** A band's threshold: "2 วัน", or hours when it isn't whole days. */
    level: (h: number) => (h % 24 === 0 ? t('silentWatch.dur.days', { d: h / 24 }) : t('silentWatch.dur.hours', { h })),
  };
}
