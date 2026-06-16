// Thai Buddhist Era date helpers — used by the contract PDF builder.
// Buddhist Era = Gregorian + 543. The contract sample shows dates as
// "18/05/2569" (DD/MM/YYYY) and the long form "18 พฤษภาคม พ.ศ. 2569".

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseLocal(date: string): Date {
  // Inputs are YYYY-MM-DD or ISO; force Bangkok-day boundary
  if (date.length === 10) return new Date(`${date}T00:00:00+07:00`);
  return new Date(date);
}

/** "2026-05-18" → "18/05/2569" */
export function toDateBE(date: string | null | undefined): string {
  if (!date) return '';
  const d = parseLocal(date);
  if (isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear() + 543}`;
}

/** "2026-05-18" → "18 พฤษภาคม พ.ศ. 2569" */
export function toLongDateBE(date: string | null | undefined): string {
  if (!date) return '';
  const d = parseLocal(date);
  if (isNaN(d.getTime())) return '';
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} พ.ศ. ${d.getFullYear() + 543}`;
}

/** ISO timestamp → "DD/MM/YYYY HH:MM" in Asia/Bangkok with Buddhist Era year.
 *  Matches the misc-go `formatBangkokBE` output so freshness stamps render
 *  identically whether the value comes from the client or the server. */
export function toDateTimeBE(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).filter(p => p.type !== 'literal').map(p => [p.type, p.value]),
  );
  const yearBE = Number(parts.year) + 543;
  return `${parts.day}/${parts.month}/${yearBE} ${parts.hour}:${parts.minute}`;
}
