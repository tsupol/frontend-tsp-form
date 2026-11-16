// ตามหาเครื่อง — the field-find buttons (IMPLEMENT 2026-11-16 field_find_buttons_477).
// Lives on the contract's / asset's MDM tab, the repo yard card and the repo job detail.
//
//   ติดตามแบบไม่มีเสียง / ติดตามแบบมีเสียง → fn_field_find_start (FIND / FIND_SOUND):
//     the device locks with the shop's ownership text, starts sending its location and,
//     with sound, rings. Optional phone number; blank = the shop's number on file.
//   หยุด → fn_field_find_stop — the only way the job ends (§6).
//
// Status (fn_field_find_status) is read once on open and then every 12 s only while a
// job is open: every answer that carries a fix writes an audit row (§2).
// Shown on the MDM.FIELD_FIND permission; the RPC refuses what can't be pressed (§1).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from 'tsp-form';
import { ExternalLink, Loader2, MapPin, Radar, Square, Volume2, VolumeX, XCircle } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { formatTel } from '../../lib/format';
import { DateTime } from '../DateTime';
import { PhoneInput } from '../PhoneInput';
import {
  fetchFieldFindStatus, fieldFindKey, fieldFindStart, fieldFindStop, isJobOpen,
  type FieldFindMode, type FieldFindStartResult, type FieldFindStatus, type FieldFindTarget,
} from './fieldFindApi';

const POLL_MS = 12_000;

export function FieldFindPanel({ target, className = '' }: { target: FieldFindTarget; className?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = fieldFindKey(target);

  const { data: status } = useQuery({
    queryKey: key,
    queryFn: () => fetchFieldFindStatus(target),
    staleTime: 10_000,
    refetchInterval: (q) => (isJobOpen(q.state.data as FieldFindStatus | undefined) ? POLL_MS : false),
    refetchIntervalInBackground: false,
  });
  const open = isJobOpen(status);

  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState<FieldFindMode | 'stop' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What the device shows, from the start answer — kept while the job runs.
  const [sent, setSent] = useState<FieldFindStartResult | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const phoneOk = phone.length === 0 || phone.length >= 9;

  const start = async (mode: FieldFindMode) => {
    setBusy(mode);
    setError(null);
    try {
      setSent(await fieldFindStart(target, mode, phone || null));
      setPhone('');
      await refresh();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy('stop');
    setError(null);
    try {
      await fieldFindStop(target);
    } catch (err) {
      // Someone else already stopped it — the status read below shows that.
      if (!(err instanceof ApiError && err.code === 'MDM.NOT_FOUND.FIELD_FIND_NO_OPEN_JOB')) {
        setError(translateApiError(err, t));
      }
    } finally {
      setSent(null);
      await refresh();
      setBusy(null);
    }
  };

  const stateLine = (() => {
    if (!status || !open) return null;
    if (status.waiting_for_phone || status.state === 'WAITING_PHONE') {
      return <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />{t('fieldFind.state.waiting')}</span>;
    }
    if (status.state === 'FAST') {
      return <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />{t('fieldFind.state.fast', { n: status.fast_minutes_left ?? 0 })}</span>;
    }
    return <span>{t('fieldFind.state.slow')}</span>;
  })();

  const fix = status?.last_fix ?? null;

  return (
    <div className={`border border-line rounded-md p-4 flex flex-col gap-3 ${className}`} data-testid="field-find">
      <div className="flex items-center gap-2">
        <Radar size={16} className="text-danger-fg" />
        <span className="text-sm font-semibold">{t('fieldFind.title')}</span>
        {open && (
          <Badge size="xs" color="danger" className="ml-auto">
            {status?.mode === 'FIND_SOUND' ? t('fieldFind.runningSound') : t('fieldFind.runningSilent')}
          </Badge>
        )}
      </div>

      {!open ? (
        <>
          <p className="text-xs text-subtle">{t('fieldFind.hint')}</p>
          <div className="flex flex-col">
            <label className="form-label">{t('fieldFind.phone')}</label>
            <PhoneInput value={phone} onChange={(raw) => setPhone(raw)} size="sm" className="w-full max-w-60" />
            <div className="text-xs text-subtle mt-1">{t('fieldFind.phoneHint')}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" color="danger" startIcon={busy === 'FIND' ? <Loader2 size={14} className="animate-spin" /> : <VolumeX size={14} />}
              disabled={!!busy || !phoneOk} onClick={() => start('FIND')} data-action="FIELD_FIND_START">
              {t('fieldFind.startSilent')}
            </Button>
            <Button size="sm" color="danger" startIcon={busy === 'FIND_SOUND' ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
              disabled={!!busy || !phoneOk} onClick={() => start('FIND_SOUND')} data-action="FIELD_FIND_START_SOUND">
              {t('fieldFind.startSound')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="text-sm">{stateLine}</div>
          <div className="text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
            <MapPin size={14} className={fix ? 'text-success-fg' : 'text-subtler'} />
            {fix ? (
              <>
                <span>{t('fieldFind.lastFix')} <DateTime value={fix.at} showTime /></span>
                {fix.accuracy_m != null && <span className="text-xs text-subtle">{t('fieldFind.accuracy', { m: Math.round(fix.accuracy_m) })}</span>}
                {fix.map_url && (
                  <a href={fix.map_url} target="_blank" rel="noopener noreferrer" className="text-primary-fg hover:underline inline-flex items-center gap-1">
                    {t('fieldFind.openMap')}<ExternalLink size={12} />
                  </a>
                )}
              </>
            ) : (
              <span className="text-subtle">{t('fieldFind.noFix')}</span>
            )}
          </div>
          {sent?.message && (
            <div className="rounded-md bg-surface border border-line px-3 py-2 text-xs flex flex-col gap-0.5">
              <span className="text-subtle">{t('fieldFind.lockScreen')}</span>
              <span>{sent.message}</span>
              {sent.phone_number && <span>{formatTel(sent.phone_number)}</span>}
              {sent.footnote && <span className="text-subtle">{sent.footnote}</span>}
            </div>
          )}
          <div>
            <Button size="sm" variant="outline" startIcon={busy === 'stop' ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
              disabled={!!busy} onClick={stop} data-action="FIELD_FIND_STOP">
              {t('fieldFind.stop')}
            </Button>
          </div>
        </>
      )}

      {error && (
        <div className="alert alert-danger">
          <XCircle size={16} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
