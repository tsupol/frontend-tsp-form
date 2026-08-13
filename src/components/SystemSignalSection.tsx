import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Tooltip } from 'tsp-form';
import clsx from 'clsx';
import { apiClient } from '../lib/api';

// ── Types (UI_FEEDBACK/2026-08-13_IMPLEMENT_system_signal_profile_menu.md) ──
//
// GET /v_system_signal always returns exactly these three rows, in no
// guaranteed order — the FE pins the display order itself.

type SignalKey = 'PHOTO_UPLOAD' | 'AUX_SYSTEMS' | 'INTERNAL_SERVICES';
type SignalStatus = 'OK' | 'DOWN' | 'UNKNOWN';

export type SignalRow = {
  signal_key: SignalKey | string;
  status: SignalStatus | string;
  evidence: {
    granted?: number;
    landed?: number;
    sent?: number;
    failed?: number;
    max_age_seconds?: number;
    heartbeat_jobs?: number;
    window_minutes?: number;
  } | null;
  checked_at: string;
};

// Fixed display order — photo upload first (the one staff hit most), internal
// services last. Never derived from the response order.
const SIGNAL_ORDER: SignalKey[] = ['PHOTO_UPLOAD', 'AUX_SYSTEMS', 'INTERNAL_SERVICES'];

// The verdict is computed in the DB, on purpose: the thresholds live in one
// place so they can be retuned without shipping the UI. We only ever read
// `status` — never re-derive a colour from `evidence`.
const dotClassFor = (status: string) =>
  status === 'OK' ? 'bg-success'
  : status === 'DOWN' ? 'bg-danger'
  : 'bg-subtler';

// Seconds since checked_at, for the "checked N ago" line in the dialog.
function secondsAgo(iso: string): number | null {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 1000));
}

function checkedAgoLabel(t: ReturnType<typeof useTranslation>['t'], iso: string): string {
  const s = secondsAgo(iso);
  if (s === null) return '';
  if (s < 60) return t('systemSignal.checkedSecondsAgo', { n: s });
  return t('systemSignal.checkedMinutesAgo', { n: Math.floor(s / 60) });
}

// The evidence numbers behind a verdict, phrased per signal. Returns null when
// the row carries no evidence (e.g. the fetch failed and we're showing the
// unknown placeholder).
function evidenceLine(
  t: ReturnType<typeof useTranslation>['t'],
  row: SignalRow,
): string | null {
  const e = row.evidence;
  if (!e) return null;
  const mins = e.window_minutes ?? 30;
  switch (row.signal_key) {
    case 'PHOTO_UPLOAD':
      if (e.granted == null || e.landed == null) return null;
      return t('systemSignal.evidence.PHOTO_UPLOAD', { mins, granted: e.granted, landed: e.landed });
    case 'AUX_SYSTEMS':
      if (e.sent == null || e.failed == null) return null;
      return t('systemSignal.evidence.AUX_SYSTEMS', { mins, sent: e.sent, failed: e.failed });
    case 'INTERNAL_SERVICES':
      if (e.max_age_seconds == null || e.heartbeat_jobs == null) return null;
      return t('systemSignal.evidence.INTERNAL_SERVICES', {
        seconds: e.max_age_seconds,
        jobs: e.heartbeat_jobs,
      });
    default:
      return null;
  }
}

// Short line shown on hover and as the dialog's lead sentence.
function meaningFor(
  t: ReturnType<typeof useTranslation>['t'],
  key: string,
  status: string,
): string {
  if (status === 'DOWN') return t(`systemSignal.down.${key}`, { defaultValue: t('systemSignal.meaning.DOWN') });
  if (status === 'OK') return t('systemSignal.meaning.OK');
  return t('systemSignal.meaning.UNKNOWN');
}

type Props = {
  /** True while the profile menu is open — drives the one-shot fetch. */
  menuOpen: boolean;
  /** Raise the clicked row so the host can show the dialog outside the menu. */
  onSelect: (row: SignalRow) => void;
};

/**
 * Three system health lights, rendered as a section inside the profile menu.
 *
 * Answers one question — "is the system broken, or is it just me?" — so a
 * branch staffer who can't upload a photo doesn't phone around to find out.
 * Display-only: the rows navigate nowhere, and a red light needs no action
 * from the person reading it (the system team is paged separately).
 *
 * Fetches once when the menu opens and never again: no background polling, no
 * cache across opens (`gcTime: 0` + `staleTime: 0`), so reopening the menu is
 * always a fresh read. A failed or slow fetch shows three grey lights — the
 * section never hides itself and never guesses green.
 *
 * The detail dialog deliberately does NOT live here — see SystemSignalDialog.
 */
export function SystemSignalSection({ menuOpen, onSelect }: Props) {
  const { t } = useTranslation();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['system-signal'],
    queryFn: () => apiClient.get<SignalRow[]>('/v_system_signal'),
    enabled: menuOpen,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Rows in fixed order. Anything missing (loading, error, a key the BE stopped
  // sending) falls back to UNKNOWN — grey, never green.
  const rows: SignalRow[] = SIGNAL_ORDER.map(key => {
    const hit = data?.find(r => r.signal_key === key);
    return hit ?? { signal_key: key, status: 'UNKNOWN', evidence: null, checked_at: '' };
  });

  const pending = isLoading && !isError;

  return (
    <>
      <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-subtler uppercase tracking-wide">
        {t('systemSignal.title')}
      </div>
      {rows.map(row => (
        <Tooltip
          key={row.signal_key}
          content={meaningFor(t, row.signal_key, row.status)}
          placement="right"
        >
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 flex items-center gap-2.5 hover:bg-item-hover-bg transition-colors cursor-pointer bg-transparent border-none"
            onClick={() => onSelect(row)}
          >
            <span
              className={clsx(
                'w-2 h-2 rounded-full shrink-0',
                dotClassFor(row.status),
                pending && 'animate-pulse',
              )}
            />
            <span className="text-sm truncate min-w-0">{t(`systemSignal.key.${row.signal_key}`)}</span>
          </button>
        </Tooltip>
      ))}
    </>
  );
}

/**
 * Detail dialog for one signal row.
 *
 * Rendered by the host OUTSIDE the profile menu's PopOver, on purpose. Modal
 * registers itself in tsp-form's shared modal stack and deregisters on close;
 * the global backdrop stays up while that stack is non-empty. Living inside the
 * PopOver meant closing the dialog also closed the menu, unmounting the Modal
 * mid-exit — it never deregistered, so the backdrop stuck at full opacity with
 * pointer-events on and the page sat behind a dead scrim. Keep this mounted at
 * a level that outlives the menu.
 */
export function SystemSignalDialog({ row, onClose }: { row: SignalRow | null; onClose: () => void }) {
  const { t } = useTranslation();

  // The body must outlive `open`: the host nulls `row` in the same handler that
  // closes, so rendering straight from the prop blanks the panel mid-animation.
  const last = useRef<SignalRow | null>(null);
  if (row) last.current = row;
  const shown = row ?? last.current;

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      maxWidth="24rem"
      width="100%"
      ariaLabel={t('systemSignal.title')}
    >
      <div className="modal-header">
        <h2 className="modal-title">{t('systemSignal.title')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="modal-content">
        <div className="flex flex-col gap-3 min-w-0">
          <div className="px-3 py-2.5 rounded-md bg-surface border border-line flex items-center gap-2.5">
            <span className={clsx('w-2.5 h-2.5 rounded-full shrink-0', dotClassFor(shown?.status ?? 'UNKNOWN'))} />
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">
                {shown ? t(`systemSignal.key.${shown.signal_key}`) : ''}
              </div>
              <div className="text-xs text-subtle">
                {shown ? t(`systemSignal.status.${shown.status}`) : ''}
              </div>
            </div>
          </div>

          <p className="text-sm leading-relaxed">
            {shown ? meaningFor(t, shown.signal_key, shown.status) : ''}
          </p>

          {shown?.status === 'DOWN' && (
            <p className="text-sm leading-relaxed text-subtle">
              {t('systemSignal.noActionNeeded')}
            </p>
          )}

          {shown && evidenceLine(t, shown) && (
            <div className="text-xs text-subtle tabular-nums">
              {evidenceLine(t, shown)}
            </div>
          )}
          {shown?.checked_at && (
            <div className="text-xs text-subtler tabular-nums">
              {checkedAgoLabel(t, shown.checked_at)}
            </div>
          )}
          {shown && !shown.checked_at && (
            <div className="text-xs text-subtler">{t('systemSignal.unavailable')}</div>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
