// Simulation (ภาพจำลองสาขา) — UI_SUMMARY/156_SIMULATION.md §2.
// One call to fn_simulation_live = one company's rooms, today's money and the
// customers standing in them. Every "who stands where" and every money figure
// is decided by the DB; the page only draws. Fields that the viewer may not see
// arrive as null together with a false can_see_* flag (§3) — the flag, never
// the role, decides what is drawn.

export const SIMULATION_PERMISSION = 'REPORT.SIMULATION.VIEW';
export const SIMULATION_PATH = '/admin/simulation';

export type CompanyType = 'OPERATING' | 'FINANCIER';
export type ViewerScope = 'GLOBAL' | 'HOLDING' | 'COMPANY' | 'BRANCH';

export interface SimCompany {
  id: number;
  name: string;
  company_type: CompanyType;
  branch_count: number;
  opened_today: number;
}

export interface SimOpened {
  code: string;
  asset: string;
  product: string;
  grade: string;
  financed: number;
  commission: number;
  future: number | null;
  profit: number | null;
  investment: number | null;
  months: number;
  down: number;
  device_price: number;
  down_pct: number | null;
}

export interface SimPayoutDay {
  day: string;
  pending: number;
  paid: number;
}

export interface SimBranch {
  id: number;
  code: string;
  name: string;
  type: 'INTERNAL' | 'DEAL_PARTNER';
  company_id: number;
  company: string;
  company_type: CompanyType;
  day_closed: boolean;
  cash: number;
  transfer: number;
  wallet: number;
  received: number;
  retail: number;
  service: number;
  other: number;
  opened_today: number;
  financed: number;
  commission: number;
  down: number;
  device_price: number;
  down_pct: number | null;
  future: number | null;
  profit: number | null;
  investment: number | null;
  capital_years: number | null;
  payout: number;
  pending_payout: number;
  pending_older: number;
  pending_before: number;
  pending_bills: number;
  pending_ready: number;
  payout_days: SimPayoutDay[];
  opened: SimOpened[];
}

export interface SimWaiting {
  id: number;
  branch_id: number;
  code: string;
  state: string;
  age_min: number;
  months: number;
}

export interface SimulationData {
  generated_at: string;
  refresh_sec: number;
  viewer_scope: ViewerScope;
  company_id: number;
  can_see_profit: boolean;
  can_see_future: boolean;
  can_see_collection: boolean;
  companies: SimCompany[];
  branches: SimBranch[];
  waiting: SimWaiting[];
}

/** fn_installments_collection_monthly — a plain array (older RPC, no envelope). §7 */
export interface CollectionMonth {
  month: string;
  expected_total: number;
  collected_total: number;
  collected_on_time: number;
  collected_late: number;
  collection_pct: number | null;
  installments_due: number;
  installments_paid: number;
}

const BANGKOK = 'Asia/Bangkok';

/** `YYYY-MM` of an ISO instant in Thai time — "this month" of the screen comes from generated_at, never the device clock. */
export function bangkokYearMonth(iso: string): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BANGKOK, year: 'numeric', month: '2-digit' }).formatToParts(new Date(iso));
  const year = Number(parts.find(p => p.type === 'year')?.value);
  const month = Number(parts.find(p => p.type === 'month')?.value);
  return { year, month };
}

/** First day of (year, month + delta) as YYYY-MM-DD. */
export function monthStart(year: number, month: number, delta: number): string {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function bangkokClock(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: BANGKOK, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}

/** Whole baht, `฿12,345` (§2b). */
export const baht = (n: number | null | undefined) => `฿${Math.round(n ?? 0).toLocaleString('en-US')}`;

/** `฿2.09M` for bar labels in the collection chart (§7). */
export const compactBaht = (n: number) => `฿${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(n)}`;

// Annual % (owner KB #496): sum numerators and denominators first, never average percentages.
export const COLLECT_RATE = 0.9;
export const annualPct = (profit: number, capitalYears: number) =>
  (capitalYears > 0 ? `${((profit / capitalYears) * 100).toFixed(1)}%` : '—');
export const annualAtRate = (future: number, investment: number, capitalYears: number) =>
  annualPct(COLLECT_RATE * future - investment, capitalYears);

// Down payment % of device price (mig 1612): `20%` when whole, else `22.7%`, null → `—` (§6d).
export const downPct = (pct: number | null | undefined) => (pct == null ? '—' : `${+pct.toFixed(1)}%`);
// The company card sums every room's down and device price first, never averages the rooms' % (§5).
export const downPctOf = (down: number, devicePrice: number) =>
  downPct(devicePrice > 0 ? (down / devicePrice) * 100 : null);

// ── Wording: the DB sends codes, the screen owns the words (§8) ──────────────
type T = (key: string, opts?: Record<string, unknown>) => string;

export const stateLabel = (t: T, state: string) => t(`simulation.state.${state}`, { defaultValue: state });

export function gradeLabel(t: T, grade: string) {
  if (!grade) return '—';
  return t(`simulation.grade.${grade}`, { defaultValue: t('simulation.grade.USED') });
}

/** `CT-2611-000000-1 (18m)` — no brackets until a rate has been picked. */
export const codeOf = (code: string, months: number) => (months > 0 ? `${code} (${months}m)` : code);

/** Contracts stuck awaiting signature for days are real, so age runs up to days (§2c). */
export function ageText(t: T, min: number) {
  if (min < 60) return t('simulation.ageMin', { n: min });
  if (min < 1440) return t('simulation.ageHour', { n: Math.floor(min / 60) });
  return t('simulation.ageDay', { n: Math.floor(min / 1440) });
}

// ── Scene palette: the floor is an illustration, so it keeps its own colours ──
export const STATE_COLOR: Record<string, string> = {
  DRAFT: '#7b8794',
  PENDING_APPROVAL: '#d9921a',
  APPROVED: '#2a9d8f',
  PENDING_SIGN: '#7a5cd6',
  PENDING_PAYMENT: '#2f7fd6',
  PENDING_PAYMENT_AND_SIGN: '#c2478f',
};
export const stateColor = (state: string) => STATE_COLOR[state] ?? '#7b8794';
export const HAPPY = '#28a745';
export const SOLD_EDGE = '#4aa25e';
export const FLOOR = { idle: '#fbfdfb', guest: '#fff4d8', busy: '#fde8e4', sold: '#d6f0da', closed: '#eef0f2' };
export const companyEdge = (type?: CompanyType) => (type === 'FINANCIER' ? '#4f46b8' : '#0f8f7a');

export type PileKey = 'cash' | 'transfer' | 'wallet' | 'other' | 'pending_payout' | 'payout';
export type Shades = [string, string, string];
export const GREEN: Shades = ['#58b56b', '#3f9153', '#4aa25e'];
export const BLUE: Shades = ['#5a9de0', '#3f7cc0', '#4d8ed2'];
export const AMBER: Shades = ['#e8b64c', '#c7942f', '#d8a53c'];
export const PURPLE: Shades = ['#a58bd6', '#8469bb', '#9478c9'];
export const PILES: Record<CompanyType, { key: PileKey; c: Shades }[]> = {
  OPERATING: [
    { key: 'cash', c: GREEN },
    { key: 'transfer', c: BLUE },
    { key: 'wallet', c: AMBER },
    { key: 'other', c: PURPLE },
  ],
  FINANCIER: [
    { key: 'pending_payout', c: AMBER },
    { key: 'payout', c: GREEN },
  ],
};
