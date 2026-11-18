import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import { AlertTriangle, Repeat } from 'lucide-react';
import { DateTime } from '../../components/DateTime';

// The device on a shop contract was swapped (mig 1700). Finance checks the photos
// against the bound device, so a swap must be impossible to miss (owner 11-18:
// "UI ต้อง render ให้เตะตา"): visible on the queue row without a click, stronger
// when the swap came after finance had already ticked the check.

export interface DeviceSwapFields {
  device_code?: string | null;
  device_swap_count?: number | null;
  device_swapped_at?: string | null;
  device_swapped_from_code?: string | null;
  device_swapped_to_code?: string | null;
  device_swapped_after_check?: boolean | null;
}

/** Queue row: a badge + from → to, no click needed. */
export function DeviceSwapBadge({ row }: { row: DeviceSwapFields }) {
  const { t } = useTranslation();
  const count = row.device_swap_count ?? 0;
  if (count <= 0) return null;
  const afterCheck = row.device_swapped_after_check === true;
  return (
    <div className="flex items-center gap-1.5 mt-1 min-w-0" data-swap-flag={afterCheck ? 'after-check' : 'swapped'}>
      <Badge size="sm" color={afterCheck ? 'danger' : 'warning'} startIcon={afterCheck ? <AlertTriangle size={12} /> : <Repeat size={12} />}>
        {afterCheck ? t('partnerSettlement.swap.afterCheckBadge', { count }) : t('partnerSettlement.swap.badge', { count })}
      </Badge>
      {row.device_swapped_from_code && row.device_swapped_to_code && (
        <span className="text-xs text-subtle font-mono truncate">
          {row.device_swapped_from_code} → {row.device_swapped_to_code}
        </span>
      )}
    </div>
  );
}

/** Detail panel: the same fact as a notice above the photos. */
export function DeviceSwapNotice({ row }: { row: DeviceSwapFields }) {
  const { t } = useTranslation();
  const count = row.device_swap_count ?? 0;
  if (count <= 0) return null;
  const afterCheck = row.device_swapped_after_check === true;
  return (
    <div className={`alert ${afterCheck ? 'alert-danger' : 'alert-warning'} items-start`}>
      {afterCheck ? <AlertTriangle size={16} className="shrink-0 mt-0.5" /> : <Repeat size={16} className="shrink-0 mt-0.5" />}
      <div className="flex flex-col gap-1 min-w-0">
        <span className="font-medium">
          {afterCheck ? t('partnerSettlement.swap.afterCheckTitle') : t('partnerSettlement.swap.title', { count })}
        </span>
        <span className="text-sm font-mono">
          {row.device_swapped_from_code ?? '—'} → {row.device_swapped_to_code ?? row.device_code ?? '—'}
        </span>
        <span className="text-xs">
          {t('partnerSettlement.swap.when')} <DateTime value={row.device_swapped_at ?? null} showTime />
          {' · '}{t('partnerSettlement.swap.count', { count })}
        </span>
        <span className="text-sm">{t('partnerSettlement.swap.checkPhotos', { code: row.device_code ?? row.device_swapped_to_code ?? '—' })}</span>
      </div>
    </div>
  );
}
