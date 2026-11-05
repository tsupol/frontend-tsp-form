// Printing the backend's `when` (mig 434): weekday, date, time and "how long
// ago" all come ready-made; this only puts them into words.

import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../lib/format';
import type { LocationWhen } from './deviceLocationApi';

export function useLocationWhen() {
  const { t, i18n } = useTranslation();
  /** "พฤ. 5 พ.ย. 2026 05:19" */
  const at = (w: LocationWhen) =>
    `${t(`deviceLocation.dow.${w.dow}`)} ${formatDateTime(w.date, i18n.language, false)} ${w.time}`;
  /** "พฤ. 5 พ.ย. 2026" */
  const day = (w: LocationWhen) =>
    `${t(`deviceLocation.dow.${w.dow}`)} ${formatDateTime(w.date, i18n.language, false)}`;
  /** "วันนี้" · "เมื่อวาน" · "3 วันก่อน" */
  const ago = (w: LocationWhen) =>
    w.days_ago <= 0 ? t('deviceLocation.ago.today')
    : w.days_ago === 1 ? t('deviceLocation.ago.yesterday')
    : t('deviceLocation.ago.days', { n: w.days_ago });
  return { at, day, ago };
}
