// Customer situation flag (owner 2026-11-11 · mig 1652/1653/1654).
// One code from the backend — situation_code, the same value as
// v_contract_detail.situation_code — drives the colour on the chat list and on the
// simulation's chat bubbles. Never derive it from overdue_days or the collector:
// a held contract is often fully paid (the collector keeps the job after payment).
// Spec: nnf UI_SUMMARY/66 §5b "ธงสภาพลูกค้า" · 156 §2e.

type T = (key: string, opts?: Record<string, unknown>) => string;

export type SituationCode = 'CURRENT' | 'DUE_TODAY' | 'IN_GRACE' | 'OVERDUE' | 'PAUSED' | 'COMPLETED';

/** Display order for per-colour counts: the ones that need attention first. */
export const SITUATION_ORDER: SituationCode[] = ['OVERDUE', 'IN_GRACE', 'DUE_TODAY', 'CURRENT', 'PAUSED', 'COMPLETED'];

/** Colours from the ops prototype. Each colour's meaning is fixed by the owner;
 *  yellow and orange must stay distinguishable (due today vs. past due in grace). */
const SITUATION_COLOR: Record<string, string> = {
  CURRENT: '#2e9e5b',
  DUE_TODAY: '#e0a800',
  IN_GRACE: '#ef7d22',
  OVERDUE: '#d64541',
  PAUSED: '#8a8f98',
  COMPLETED: '#8a8f98',
};
const GREY = '#8a8f98';
/** Collector name/icon on a green row: present but quiet. */
const COLLECTOR_MUTED = '#a7adb5';

/** null / unknown code = the contract no longer collects (terminated, voided, …) → grey. */
export function situationColor(code: string | null | undefined): string {
  return (code && SITUATION_COLOR[code]) || GREY;
}

/** The collector's name/icon: the flag's colour, except muted grey on a green row. */
export function collectorColor(code: string | null | undefined): string {
  return code === 'CURRENT' ? COLLECTOR_MUTED : situationColor(code);
}

/** "Overdue 12 days" / "Normal customer" — the short label used on hover and tap notes.
 *  Days only for the two past-due codes, and only when the backend says > 0. */
export function situationText(t: T,code: string | null | undefined, overdueDays?: number | null): string {
  const label = code ? t(`situation.${code}`, { defaultValue: code }) : t('situation.NONE');
  if ((code === 'OVERDUE' || code === 'IN_GRACE') && overdueDays && overdueDays > 0) {
    return t('situation.withDays', { label, count: overdueDays });
  }
  return label;
}
