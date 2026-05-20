import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, useSnackbarContext } from 'tsp-form';
import { Smartphone, ExternalLink, Wrench, ArrowDownToLine, ArrowUpFromLine, Link2, Link2Off, Cloud, CloudOff, CheckCircle } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { getBucketLabel, getBucketColor } from '../inventory/inventoryUtils';
import { AssignIcloudModal, ReleaseIcloudModal } from './IcloudModals';

interface ContractForDevice {
  id: number;
  state: string;
  branch_id: number;
  device_id: number | null;
  device_identifier: string | null;
  device_current_bucket: string | null;
  device_condition_grade: string | null;
  loaner_device_id: number | null;
  model_name: string | null;
  variant_name: string | null;
}

interface AssetSummary {
  asset_id: number;
  asset_code: string;
  current_bucket: string;
  condition_grade: string | null;
  serial_no: string | null;
  imei: string | null;
  model_name: string;
  variant_name: string;
  brand_name: string;
  branch_id: number;
  branch_name: string;
  icloud_account_id: number | null;
  icloud_apple_id: string | null;
}

interface RepairOrder {
  id: number;
  repair_no: string;
  status: string;
  result: string | null;
  route_decision: string | null;
  asset_code: string;
  loaner_asset_code: string | null;
  repair_note: string | null;
  created_at: string;
  completed_at: string | null;
}

type DeviceAction =
  | 'bind_device'
  | 'unbind_device'
  | 'deposit_device'
  | 'return_deposit'
  | 'bind_loaner'
  | 'unbind_loaner'
  | 'device_repair_request';

interface DeviceTabProps {
  contract: ContractForDevice;
  onRequestAction: (action: DeviceAction) => void;
}

export function DeviceTab({ contract, onRequestAction }: DeviceTabProps) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [icloudAssignOpen, setIcloudAssignOpen] = useState(false);
  const [icloudReleaseOpen, setIcloudReleaseOpen] = useState(false);

  // Loaner asset lookup (only when bound)
  const { data: loanerAsset } = useQuery({
    queryKey: ['asset-summary', contract.loaner_device_id],
    queryFn: () => apiClient.get<AssetSummary[]>(
      `/v_assets?asset_id=eq.${contract.loaner_device_id}&select=asset_id,asset_code,current_bucket,condition_grade,serial_no,imei,model_name,variant_name,brand_name,branch_id,branch_name,icloud_account_id,icloud_apple_id&limit=1`,
    ).then(rows => rows[0] ?? null),
    enabled: contract.loaner_device_id != null,
    staleTime: 30 * 1000,
  });

  // Primary asset full details (for asset_code link, identifiers)
  const { data: primaryAsset } = useQuery({
    queryKey: ['asset-summary', contract.device_id],
    queryFn: () => apiClient.get<AssetSummary[]>(
      `/v_assets?asset_id=eq.${contract.device_id}&select=asset_id,asset_code,current_bucket,condition_grade,serial_no,imei,model_name,variant_name,brand_name,branch_id,branch_name,icloud_account_id,icloud_apple_id&limit=1`,
    ).then(rows => rows[0] ?? null),
    enabled: contract.device_id != null,
    staleTime: 30 * 1000,
  });

  // Recent repair orders for this contract
  const { data: repairOrders = [] } = useQuery({
    queryKey: ['contract-repair-orders', contract.id],
    queryFn: () => apiClient.get<RepairOrder[]>(
      `/v_repair_orders?contract_id=eq.${contract.id}&order=created_at.desc&limit=5`,
    ),
    staleTime: 30 * 1000,
  });

  const isActive = contract.state === 'ACTIVE';
  const hasPrimary = contract.device_id != null;
  const hasLoaner = contract.loaner_device_id != null;
  const primaryBucket = contract.device_current_bucket;
  const primaryWithCustomer = primaryBucket === 'WITH_CUSTOMER_ACTIVE';

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Primary device card */}
      <section className="border border-line rounded-md">
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-line">
          <div className="flex items-center gap-2">
            <Smartphone size={16} className="text-subtle" />
            <h3 className="text-sm font-semibold">{t('contract.device_primary')}</h3>
          </div>
          {primaryBucket && (
            <Badge size="xs" color={getBucketColor(primaryBucket)}>
              {getBucketLabel(primaryBucket, t)}
            </Badge>
          )}
        </header>

        <div className="px-4 py-3">
          {hasPrimary ? (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-subtle">{t('contract.assetCode')}</div>
                  <Link
                    to={`/admin/inventory/assets/${contract.device_id}`}
                    className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
                  >
                    {primaryAsset?.asset_code ?? `#${contract.device_id}`}
                    <ExternalLink size={11} />
                  </Link>
                </div>
                <div>
                  <div className="text-xs text-subtle">{t('contract.deviceModel')}</div>
                  <div className="text-sm">{contract.variant_name ?? contract.model_name ?? '—'}</div>
                </div>
                {contract.device_identifier && (
                  <div>
                    <div className="text-xs text-subtle">IMEI / SN</div>
                    <div className="text-sm font-mono">{contract.device_identifier}</div>
                  </div>
                )}
                {contract.device_condition_grade && (
                  <div>
                    <div className="text-xs text-subtle">{t('contract.deviceCondition')}</div>
                    <div className="text-sm">{contract.device_condition_grade}</div>
                  </div>
                )}
              </div>

              {/* iCloud — Apple-only */}
              {primaryAsset?.brand_name === 'Apple' && (
                <div className="flex items-center gap-2 pt-2 border-t border-line mt-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {primaryAsset.icloud_account_id ? (
                      <>
                        <Cloud size={14} className="text-success shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs text-subtle">iCloud</div>
                          <div className="text-sm font-mono truncate">{primaryAsset.icloud_apple_id ?? '—'}</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <CloudOff size={14} className="text-subtle shrink-0" />
                        <div>
                          <div className="text-xs text-subtle">iCloud</div>
                          <div className="text-sm text-subtle">{t('contract.icloud_notAssigned')}</div>
                        </div>
                      </>
                    )}
                  </div>
                  {isActive && (
                    <div className="flex gap-2 shrink-0">
                      {primaryAsset.icloud_account_id == null ? (
                        <Button
                          size="sm"
                          color="primary"
                          startIcon={<Cloud size={14} />}
                          onClick={() => setIcloudAssignOpen(true)}
                        >
                          {t('contract.icloud_assign')}
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            startIcon={<Cloud size={14} />}
                            onClick={() => setIcloudAssignOpen(true)}
                          >
                            {t('contract.icloud_change')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            color="danger"
                            startIcon={<CloudOff size={14} />}
                            onClick={() => setIcloudReleaseOpen(true)}
                          >
                            {t('contract.icloud_release')}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isActive && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-line mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    color="primary"
                    startIcon={<Wrench size={14} />}
                    disabled={!primaryWithCustomer}
                    onClick={() => onRequestAction('device_repair_request')}
                  >
                    {t('contract.action_device_repair_request')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    color="danger"
                    startIcon={<Link2Off size={14} />}
                    onClick={() => onRequestAction('unbind_device')}
                  >
                    {t('contract.action_unbind_device')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    startIcon={<ArrowDownToLine size={14} />}
                    onClick={() => onRequestAction('deposit_device')}
                  >
                    {t('contract.action_deposit_device')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    startIcon={<ArrowUpFromLine size={14} />}
                    onClick={() => onRequestAction('return_deposit')}
                  >
                    {t('contract.action_return_deposit')}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-subtle">{t('contract.device_noPrimary')}</div>
              {isActive && (
                <Button
                  size="sm"
                  color="primary"
                  startIcon={<Link2 size={14} />}
                  onClick={() => onRequestAction('bind_device')}
                >
                  {t('contract.action_bind_device')}
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Loaner device card */}
      <section className="border border-line rounded-md">
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-line">
          <div className="flex items-center gap-2">
            <Smartphone size={16} className="text-subtle" />
            <h3 className="text-sm font-semibold">{t('contract.device_loaner')}</h3>
          </div>
          {hasLoaner && loanerAsset && (
            <Badge size="xs" color={getBucketColor(loanerAsset.current_bucket)}>
              {getBucketLabel(loanerAsset.current_bucket, t)}
            </Badge>
          )}
        </header>

        <div className="px-4 py-3">
          {hasLoaner ? (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-subtle">{t('contract.assetCode')}</div>
                  <Link
                    to={`/admin/inventory/assets/${contract.loaner_device_id}`}
                    className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
                  >
                    {loanerAsset?.asset_code ?? `#${contract.loaner_device_id}`}
                    <ExternalLink size={11} />
                  </Link>
                </div>
                {loanerAsset?.variant_name && (
                  <div>
                    <div className="text-xs text-subtle">{t('contract.deviceModel')}</div>
                    <div className="text-sm">{loanerAsset.variant_name}</div>
                  </div>
                )}
                {(loanerAsset?.serial_no || loanerAsset?.imei) && (
                  <div>
                    <div className="text-xs text-subtle">IMEI / SN</div>
                    <div className="text-sm font-mono">{loanerAsset.imei || loanerAsset.serial_no}</div>
                  </div>
                )}
              </div>

              {isActive && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-line mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    color="danger"
                    startIcon={<Link2Off size={14} />}
                    onClick={() => onRequestAction('unbind_loaner')}
                  >
                    {t('contract.action_unbind_loaner')}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-subtle">{t('contract.device_noLoaner')}</div>
              {isActive && !primaryWithCustomer && (
                <Button
                  size="sm"
                  variant="outline"
                  startIcon={<Link2 size={14} />}
                  onClick={() => onRequestAction('bind_loaner')}
                >
                  {t('contract.action_bind_loaner')}
                </Button>
              )}
            </div>
          )}

          {isActive && !hasLoaner && primaryWithCustomer && (
            <div className="text-xs text-subtle mt-2">
              {t('contract.device_loanerHint')}
            </div>
          )}
        </div>
      </section>

      {/* Repair history */}
      {repairOrders.length > 0 && (
        <section className="border border-line rounded-md">
          <header className="px-4 py-2.5 border-b border-line">
            <h3 className="text-sm font-semibold">{t('contract.device_recentRepairs')}</h3>
          </header>
          <div className="divide-y divide-line">
            {repairOrders.map(ro => (
              <div key={ro.id} className="px-4 py-2.5 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/admin/inventory/repairs?repair_id=${ro.id}`}
                      className="text-sm font-medium text-primary-fg hover:underline"
                    >
                      {ro.repair_no}
                    </Link>
                    <Badge size="xs" color={
                      ro.status === 'OPEN' ? 'warning'
                        : ro.status === 'COMPLETED' ? 'success'
                        : 'default'
                    }>
                      {ro.status}
                    </Badge>
                    {ro.result && (
                      <Badge size="xs" color={ro.result === 'FIXED' ? 'success' : 'danger'}>
                        {ro.result}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-subtle mt-0.5">
                    {ro.asset_code}
                    {ro.loaner_asset_code && <> · {t('contract.device_loaner')}: {ro.loaner_asset_code}</>}
                  </div>
                  {ro.repair_note && (
                    <div className="text-xs text-subtle italic mt-1 truncate">{ro.repair_note}</div>
                  )}
                </div>
                <div className="text-xs text-subtle shrink-0 text-right">
                  <DateTime value={ro.created_at} showTime={false} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* iCloud assign/release modals */}
      {primaryAsset && (
        <>
          <AssignIcloudModal
            open={icloudAssignOpen}
            onClose={() => setIcloudAssignOpen(false)}
            onSuccess={() => {
              setIcloudAssignOpen(false);
              addSnackbar({
                message: (
                  <div className="alert alert-success">
                    <CheckCircle size={16} />
                    <span>{t('contract.icloud_assignSuccess')}</span>
                  </div>
                ),
                type: 'success',
              });
            }}
            assetId={primaryAsset.asset_id}
            branchId={primaryAsset.branch_id}
            currentAccountId={primaryAsset.icloud_account_id}
          />
          <ReleaseIcloudModal
            open={icloudReleaseOpen}
            onClose={() => setIcloudReleaseOpen(false)}
            onSuccess={() => {
              setIcloudReleaseOpen(false);
              addSnackbar({
                message: (
                  <div className="alert alert-success">
                    <CheckCircle size={16} />
                    <span>{t('contract.icloud_releaseSuccess')}</span>
                  </div>
                ),
                type: 'success',
              });
            }}
            assetId={primaryAsset.asset_id}
          />
        </>
      )}
    </div>
  );
}
