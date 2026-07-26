// ============================================================================
// Sub-tab 1 — นำเครื่องเข้าระบบ (enroll). This IS the original AssetMdmTab body
// (doc 130), moved verbatim into the sub-tab structure. Endpoint / step strip /
// prepare button are unchanged. It reads the SHARED status row (useMdmStatus)
// instead of its own query so the whole tab shares one cache.
// ============================================================================

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import {
  ShieldCheck, RefreshCw, Send, CheckCircle, AlertTriangle, Loader2,
  Fingerprint, ScanLine, RotateCcw, Smartphone, XCircle,
} from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { DateTime } from '../../../components/DateTime';
import type { AssetMdmStatus, MdmStatusCode } from './mdmApi';

interface PrepareResponse {
  request_id: number;
  serial: string;
  status: string;
  dep_name: string;
  abm_tenant_id: number;
  abm_display_name: string;
  deduped?: boolean;
}

type BadgeTone = 'neutral' | 'info' | 'warning' | 'danger' | 'successSoft' | 'success';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-surface border-line text-subtle',
  info: 'bg-info-soft border-info-border text-info-fg',
  warning: 'bg-warning-soft border-warning-border text-warning-fg',
  danger: 'bg-danger-soft border-danger-border text-danger-fg',
  successSoft: 'bg-success-soft border-success-border text-success-fg',
  success: 'bg-success-soft border-success-border text-success-fg',
};

const TONE_ICON: Record<BadgeTone, typeof CheckCircle> = {
  neutral: Fingerprint,
  info: Loader2,
  warning: AlertTriangle,
  danger: XCircle,
  successSoft: Loader2,
  success: CheckCircle,
};

// Extra device-info fields only present on the enroll view; kept optional so the
// shared AssetMdmStatus type doesn't have to carry them.
type EnrollExtras = {
  os_version?: string | null;
  build_version?: string | null;
  battery_level?: number | null;
  is_supervised?: boolean | null;
  capacity_gb?: number | null;
  available_capacity_gb?: number | null;
  device_info_at?: string | null;
  prepare_detail?: string | null;
};
type EnrollStatus = AssetMdmStatus & EnrollExtras;

function statusPresentation(s: AssetMdmStatus): { key: string; tone: BadgeTone; spin?: boolean } {
  switch (s.mdm_status) {
    case 'NO_SERIAL': return { key: 'NO_SERIAL', tone: 'neutral' };
    case 'NOT_STARTED': return { key: 'NOT_STARTED', tone: 'neutral' };
    case 'PREPARING': return { key: 'PREPARING', tone: 'info', spin: true };
    case 'PROFILE_READY': return { key: 'PROFILE_READY', tone: 'warning' };
    case 'PREPARE_FAILED': return { key: 'PREPARE_FAILED', tone: 'danger' };
    case 'IN_MDM':
      return s.has_basic_info
        ? { key: 'IN_MDM_INFO', tone: 'success' }
        : { key: 'IN_MDM_WAITING', tone: 'successSoft', spin: true };
    default: return { key: 'NOT_STARTED', tone: 'neutral' };
  }
}

const STEPS = [
  { key: 'serial', icon: Fingerprint, where: 'system' },
  { key: 'scan', icon: ScanLine, where: 'device' },
  { key: 'send', icon: Send, where: 'system' },
  { key: 'wipe', icon: RotateCcw, where: 'device' },
  { key: 'enrolled', icon: Smartphone, where: 'auto' },
] as const;

function stepState(s: { mdm_status: MdmStatusCode }): { current: number; done: number } {
  switch (s.mdm_status) {
    case 'NO_SERIAL': return { current: 0, done: 0 };
    case 'NOT_STARTED': return { current: 2, done: 1 };
    case 'PREPARING': return { current: 2, done: 2 };
    case 'PROFILE_READY': return { current: 3, done: 3 };
    case 'PREPARE_FAILED': return { current: 2, done: 1 };
    case 'IN_MDM': return { current: 4, done: 5 };
    default: return { current: 0, done: 0 };
  }
}

function StepStrip({ status }: { status: AssetMdmStatus }) {
  const { t } = useTranslation();
  const { current, done } = stepState(status);
  return (
    <div className="flex flex-col">
      {STEPS.map((step, i) => {
        const isDone = i < done;
        const isCurrent = i === current && done < STEPS.length;
        const Icon = step.icon;
        const isLast = i === STEPS.length - 1;
        return (
          <div key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center shrink-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                isCurrent ? 'bg-primary border-primary text-primary-contrast'
                  : isDone ? 'bg-success border-success text-success-contrast'
                    : 'bg-surface border-line text-subtle'
              }`}>
                {isDone ? <CheckCircle size={17} /> : <Icon size={16} />}
              </div>
              {!isLast && <div className={`w-0.5 flex-1 min-h-[0.75rem] my-0.5 ${isDone ? 'bg-success' : 'bg-line'}`} />}
            </div>
            <div className="pb-3 min-w-0">
              <div className={`text-sm font-medium leading-snug ${isCurrent ? 'text-primary-fg' : isDone ? 'text-success-fg' : 'text-fg'}`}>
                <span className="text-subtler tabular-nums">{i + 1}. </span>{t(`asset.mdm.step.${step.key}`)}
              </div>
              <div className="text-xs text-subtle leading-snug mt-0.5">{t(`asset.mdm.stepWhere.${step.where}`)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DeviceInfo({ status }: { status: EnrollStatus }) {
  const { t } = useTranslation();
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (status.os_version) rows.push({ label: t('asset.mdm.info.os'), value: `iOS ${status.os_version}${status.build_version ? ` (${status.build_version})` : ''}` });
  if (status.battery_level != null) rows.push({ label: t('asset.mdm.info.battery'), value: `${Math.round(status.battery_level * 100)}%` });
  if (status.capacity_gb != null) {
    const avail = status.available_capacity_gb != null ? ` (${status.available_capacity_gb.toFixed(1)} GB ${t('asset.mdm.info.free')})` : '';
    rows.push({ label: t('asset.mdm.info.capacity'), value: `${status.capacity_gb} GB${avail}` });
  }
  if (status.is_supervised != null) rows.push({ label: t('asset.mdm.info.supervised'), value: status.is_supervised ? t('common.yes') : t('common.no') });
  if (status.device_info_at) rows.push({ label: t('asset.mdm.info.reportedAt'), value: <DateTime value={status.device_info_at} showTime /> });
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {rows.map((r, i) => (
        <div key={i} className="min-w-0">
          <div className="text-xs text-subtle">{r.label}</div>
          <div className="text-sm truncate">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

export function SubTabEnroll({
  status,
  isFetching,
  onRefetch,
  onRefresh,
}: {
  status: EnrollStatus;
  isFetching: boolean;
  onRefetch: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [justPrepared, setJustPrepared] = useState(false);

  useEffect(() => {
    if (status.mdm_status !== 'PREPARING' && status.mdm_status !== 'PROFILE_READY') setJustPrepared(false);
  }, [status.mdm_status]);

  const prepare = useMutation({
    mutationFn: () => apiClient.rpc<PrepareResponse>('fn_mdm_prepare_asset', { p_asset_id: status.asset_id }),
    onSuccess: () => {
      setErrorMsg(null);
      setJustPrepared(true);
      queryClient.invalidateQueries({ queryKey: ['asset-mdm-status', status.asset_id] });
      onRefresh();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setErrorMsg(translated || err.message);
      } else {
        setErrorMsg(t('asset.mdm.prepareError'));
      }
      onRefetch();
    },
  });

  const presentation = useMemo(() => statusPresentation(status), [status]);
  const showButton = status.can_prepare && status.may_prepare;
  const isRetry = status.mdm_status === 'PREPARE_FAILED';
  const ToneIcon = TONE_ICON[presentation.tone];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-subtle" />
        <h3 className="text-sm font-semibold">{t('asset.mdm.title')}</h3>
        <div className="ml-auto">
          <Button
            variant="ghost" size="sm" className="btn-icon-sm"
            startIcon={<RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />}
            onClick={onRefetch}
            aria-label={t('common.refresh')}
          />
        </div>
      </div>

      <StepStrip status={status} />

      <div className={`flex items-start gap-3 px-4 py-3 rounded-md border ${TONE_CLASS[presentation.tone]}`}>
        <ToneIcon size={20} className={`shrink-0 mt-0.5 ${presentation.spin ? 'animate-spin' : ''}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{t(`asset.mdm.badge.${presentation.key}.label`)}</div>
          <div className="text-xs mt-0.5 opacity-90">
            {status.mdm_status === 'IN_MDM' && status.has_basic_info && (status.os_version || status.battery_level != null)
              ? [
                  status.os_version ? `iOS ${status.os_version}` : null,
                  status.battery_level != null ? `${t('asset.mdm.info.battery')} ${Math.round(status.battery_level * 100)}%` : null,
                  status.capacity_gb != null ? `${status.capacity_gb} GB` : null,
                ].filter(Boolean).join(' · ')
              : t(`asset.mdm.badge.${presentation.key}.sub`)}
          </div>
          {status.mdm_status === 'PREPARE_FAILED' && status.prepare_detail && (
            <div className="text-xs mt-1.5 font-mono opacity-80 break-words">{status.prepare_detail}</div>
          )}
          {status.mdm_status === 'IN_MDM' && status.in_mdm_since && (
            <div className="text-xs mt-1 opacity-80">
              {t('asset.mdm.enrolledSince')} <DateTime value={status.in_mdm_since} showTime />
            </div>
          )}
        </div>
      </div>

      {justPrepared && (status.mdm_status === 'PREPARING' || status.mdm_status === 'PROFILE_READY') && (
        <div className="px-4 py-3 rounded-md border border-info-border bg-info-soft text-info-fg">
          <div className="text-sm font-semibold">{t('asset.mdm.afterPress.title')}</div>
          <div className="text-xs mt-1">{t('asset.mdm.afterPress.next')}</div>
          <div className="text-xs mt-1 opacity-80">{t('asset.mdm.afterPress.note')}</div>
        </div>
      )}

      {status.in_mdm && status.has_basic_info && (
        <div className="border border-line rounded-md p-4">
          <div className="text-xs text-subtle mb-2.5">{t('asset.mdm.deviceInfo')}</div>
          <DeviceInfo status={status} />
        </div>
      )}

      {errorMsg && (
        <div className="alert alert-danger">
          <XCircle size={16} />
          <span>{errorMsg}</span>
        </div>
      )}

      {showButton && (
        <div className="flex-none">
          <Button
            color="primary"
            startIcon={isRetry ? <RotateCcw size={16} /> : <Send size={16} />}
            onClick={() => prepare.mutate()}
            disabled={prepare.isPending}
          >
            {isRetry ? t('asset.mdm.button.retry') : t('asset.mdm.button.prepare')}
          </Button>
        </div>
      )}

      {status.can_prepare && !status.may_prepare && (
        <div className="text-xs text-subtler">{t('asset.mdm.noPermission')}</div>
      )}
    </div>
  );
}
