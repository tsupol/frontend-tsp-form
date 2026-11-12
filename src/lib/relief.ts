// The 24-hour MDM relief ("ผ่อนปรน 24 ชม.") as the collector screens show it:
// a purple mark with the time it ends. relief_until comes from the DB as-is
// (fn_dunning_queue_live / v_my_book · nnf mig 1658/1659) — never worked out here.

type T = (key: string, opts?: Record<string, unknown>) => string;

/** Purple = relief everywhere it shows (queue floor, count bar, lists, badges). */
export const RELIEF_COLOR = '#7c3aed';

const BKK_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' });
const BKK_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });

/** "ผ่อนปรนถึง 23:40" or "ผ่อนปรนถึง พรุ่งนี้ 09:15" — a relief lasts 24 h, so it
 *  always ends today or tomorrow (Bangkok time). */
export function reliefUntilText(t: T, until: string, now: Date = new Date()): string {
  const end = new Date(until);
  const time = BKK_TIME.format(end);
  return BKK_DAY.format(end) === BKK_DAY.format(now)
    ? t('asset.mdm.relief.untilToday', { time })
    : t('asset.mdm.relief.untilTomorrow', { time });
}
