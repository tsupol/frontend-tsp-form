// ============================================================================
// Sub-tab 7 — พักการบังคับใช้ (131 §9). Unlike the others this is DB-only: it
// records policy, sends NO device command → results are immediate, not queued.
// Works even when the device isn't enrolled (§12 exception).
//
//   default (no until)  → 48h auto-expire (the safe default — never silently
//                         drops a device from tracking)
//   until <date>        → pause to an appointment
//   indefinite          → legal hold; needs may_pause_indefinite
//   one active pause per device — ALREADY_PAUSED points back to the existing row
// ============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, TextArea, InputDatePicker } from 'tsp-form';
import { PauseCircle, PlayCircle, Keyboard, Clock } from 'lucide-react';
import { DateTime } from '../../../components/DateTime';
import { makeDatePickerFormat, toLocalDateStr } from '../../../lib/format';
import {
  fetchEnforcementPauses, pauseEnforcement, resumeEnforcement,
  parseMdmError, type AssetMdmStatus, type ParsedMdmError,
} from './mdmApi';
import { MdmErrorAlert } from './MdmSharedBits';

export function SubTabPause({
  status,
  canIndefinite,
  onChanged,
}: {
  status: AssetMdmStatus;
  canIndefinite: boolean;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const { data: pauses = [], refetch } = useQuery({
    queryKey: ['mdm-enforcement-pauses', status.enrollment_id],
    queryFn: () => fetchEnforcementPauses(status.enrollment_id),
  });
  // Whether/until it's paused is authoritative on the status row. The pauses
  // view isn't asset-scoped (no asset_id/device_id join key — see ASK), so we
  // can only surface a pause_id to resume when exactly one active pause exists
  // in this holding/branch scope; otherwise resume routes through the reason
  // shown on the status row and we hide the resume button to avoid guessing.
  const hasActive = status.is_enforcement_paused;
  const activePauses = pauses.filter((p) => !p.expires_at || new Date(p.expires_at) > new Date());
  const active = activePauses.length === 1 ? activePauses[0] : null;

  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'auto48' | 'until' | 'indefinite'>('auto48');
  const [until, setUntil] = useState('');
  const [typingUntil, setTypingUntil] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ParsedMdmError | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['asset-mdm-status', status.asset_id] });
    await refetch();
    onChanged();
  };

  const submitPause = async () => {
    setBusy(true); setError(null);
    try {
      await pauseEnforcement({
        p_asset_id: status.asset_id,
        p_reason: reason.trim(),
        p_until: mode === 'until' && until ? `${until}T17:00:00+07:00` : null,
        p_indefinite: mode === 'indefinite' ? true : undefined,
      });
      setReason(''); setUntil(''); setMode('auto48');
      await refresh();
    } catch (err) {
      setError(parseMdmError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const doResume = async (pauseId: number) => {
    setBusy(true); setError(null);
    try {
      await resumeEnforcement(pauseId);
      await refresh();
    } catch (err) {
      setError(parseMdmError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && reason.trim().length > 0 && (mode !== 'until' || !!until);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-subtle">{t('asset.mdm.pause.intro')}</p>
      <MdmErrorAlert error={error} />

      {/* Active pause → show it + resume, don't offer a second (§9 one-active).
          Paused-state + until come from the status row (authoritative); resume
          needs a pause_id, offered only when we can identify a single active
          pause in scope. */}
      {hasActive ? (
        <div className="border border-warning-border bg-warning-soft rounded-md p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <PauseCircle size={16} className="text-warning-fg" />
            <span className="text-sm font-semibold text-warning-fg">{t('asset.mdm.pause.activeTitle')}</span>
          </div>
          <div className="text-sm">
            {status.pause_indefinite
              ? t('asset.mdm.pause.indefinite')
              : status.pause_until
                ? <>{t('asset.mdm.pausedBar.until')} <DateTime value={status.pause_until} showTime /></>
                : t('asset.mdm.pausedBar.generic')}
          </div>
          {active?.pause_reason && <div className="text-xs text-subtle">{t('asset.mdm.pause.reasonLabel')}: {active.pause_reason}</div>}
          {active ? (
            <div>
              <Button size="sm" variant="outline" startIcon={<PlayCircle size={15} />} disabled={busy} onClick={() => doResume(active.pause_id)}>
                {t('asset.mdm.pause.resume')}
              </Button>
            </div>
          ) : (
            <div className="text-xs text-subtler">{t('asset.mdm.pause.resumeElsewhere')}</div>
          )}
        </div>
      ) : (
        <div className="border border-line rounded-md p-4 flex flex-col gap-3">
          <div>
            <label className="form-label">{t('asset.mdm.pause.reasonLabel')} *</label>
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full" placeholder={t('asset.mdm.pause.reasonPlaceholder')} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="form-label">{t('asset.mdm.pause.durationLabel')}</label>
            <Radio checked={mode === 'auto48'} onChange={() => setMode('auto48')} label={t('asset.mdm.pause.auto48')} hint={t('asset.mdm.pause.auto48Hint')} />
            <Radio checked={mode === 'until'} onChange={() => setMode('until')} label={t('asset.mdm.pause.untilDate')} />
            {mode === 'until' && (
              <div className="pl-6 pt-1" style={{ maxWidth: '16rem' }}>
                <InputDatePicker
                  value={until ? new Date(until + 'T00:00:00') : null}
                  onChange={(v) => setUntil(toLocalDateStr(v))}
                  dateFormat={makeDatePickerFormat(i18n.language)}
                  locale={i18n.language}
                  calendar="gregorian"
                  size="sm"
                  endIcon={<Keyboard size={16} />}
                  onEndIconClick={() => setTypingUntil((v) => !v)}
                  typingMode={typingUntil}
                  onTypingModeChange={setTypingUntil}
                  typingMask="##/##/####"
                  typingPlaceholder="DD/MM/YYYY"
                  parseTypedDate={(raw) => {
                    if (raw.length !== 8) return null;
                    const day = parseInt(raw.slice(0, 2), 10);
                    const month = parseInt(raw.slice(2, 4), 10);
                    let year = parseInt(raw.slice(4, 8), 10);
                    if (year > 2400) year -= 543;
                    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                    const d = new Date(year, month - 1, day);
                    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                    return d;
                  }}
                />
              </div>
            )}
            {canIndefinite && (
              <Radio checked={mode === 'indefinite'} onChange={() => setMode('indefinite')} label={t('asset.mdm.pause.indefiniteOption')} hint={t('asset.mdm.pause.indefiniteHint')} />
            )}
          </div>

          {/* Reflect the auto-resume promise so nobody thinks it's permanent. */}
          {mode !== 'indefinite' && (
            <div className="text-xs text-subtler flex items-center gap-1">
              <Clock size={12} />
              {mode === 'auto48' ? t('asset.mdm.pause.willResume48') : t('asset.mdm.pause.willResumeDate')}
            </div>
          )}

          <div>
            <Button color="primary" size="sm" startIcon={<PauseCircle size={15} />} disabled={!canSubmit} onClick={submitPause}>
              {t('asset.mdm.pause.pauseButton')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Radio({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5" />
      <span className="min-w-0">
        <span className="text-sm">{label}</span>
        {hint && <span className="block text-xs text-subtler">{hint}</span>}
      </span>
    </label>
  );
}
