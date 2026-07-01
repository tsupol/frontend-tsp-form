import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Modal, Input, FormErrorMessage, useSnackbarContext } from 'tsp-form';
import { Smartphone, ExternalLink, Wrench, ArrowDownToLine, ArrowUpFromLine, Link2, Link2Off, Cloud, CloudOff, CheckCircle, Pencil, XCircle, Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { getBucketLabel, getBucketColor, codeDisplay } from '../inventory/inventoryUtils';
import { AssignIcloudModal, ReleaseIcloudModal } from './IcloudModals';
import { AssetScreenTimeSection } from '../../components/AssetScreenTimeSection';
import { ImeiInput } from '../../components/ImeiInput';
import { validateIMEI, validateiPhoneSerial } from '../../lib/validators';

type IdentifierType = 'IMEI' | 'SERIAL_NO';

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
  product_display_name: string | null;
  variant_name: string | null;
}

interface AssetSummary {
  asset_id: number;
  asset_code: string;
  asset_code_display: string | null;
  current_bucket: string;
  condition_grade: string | null;
  serial_no: string | null;
  imei: string | null;
  external_ref: string | null;
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
  asset_code_display: string | null;
  loaner_asset_code: string | null;
  loaner_asset_code_display: string | null;
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
  const queryClient = useQueryClient();
  const [icloudAssignOpen, setIcloudAssignOpen] = useState(false);
  const [icloudReleaseOpen, setIcloudReleaseOpen] = useState(false);
  // Identifier (IMEI / SN) correction target for the primary device.
  const [fixIdentifier, setFixIdentifier] = useState<{ type: IdentifierType; oldValue: string } | null>(null);

  // Loaner asset lookup (only when bound)
  const { data: loanerAsset } = useQuery({
    queryKey: ['asset-summary', contract.loaner_device_id],
    queryFn: () => apiClient.get<AssetSummary[]>(
      `/v_assets?asset_id=eq.${contract.loaner_device_id}&select=asset_id,asset_code,asset_code_display,current_bucket,condition_grade,serial_no,imei,external_ref,model_name,variant_name,brand_name,branch_id,branch_name,icloud_account_id,icloud_apple_id&limit=1`,
    ).then(rows => rows[0] ?? null),
    enabled: contract.loaner_device_id != null,
    staleTime: 30 * 1000,
  });

  // Primary asset full details (for asset_code link, identifiers)
  const { data: primaryAsset } = useQuery({
    queryKey: ['asset-summary', contract.device_id],
    queryFn: () => apiClient.get<AssetSummary[]>(
      `/v_assets?asset_id=eq.${contract.device_id}&select=asset_id,asset_code,asset_code_display,current_bucket,condition_grade,serial_no,imei,external_ref,model_name,variant_name,brand_name,branch_id,branch_name,icloud_account_id,icloud_apple_id&limit=1`,
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

  // Drive device-action visibility from the backend capability RPC, not the
  // contract status. A device can be bound before ACTIVE (mig 353) and unbind /
  // repair availability is per-state — status-only gating hid these buttons in
  // pre-ACTIVE bound states, leaving the More menu (which just points back here)
  // as the only path. Shares the query cache with ContractActionButtons.
  const { data: actionsResp } = useQuery({
    queryKey: ['contract-actions', contract.id],
    queryFn: () => apiClient.rpc<{ actions: { action_code: string; is_available: boolean }[] }>(
      'fn_contract_available_actions',
      { p_contract_id: contract.id },
    ),
    staleTime: 30 * 1000,
  });
  const canDo = (code: string): boolean =>
    actionsResp?.actions?.find(a => a.action_code === code)?.is_available ?? false;

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
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Link
                      to={`/admin/inventory/assets/${contract.device_id}`}
                      className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
                    >
                      {primaryAsset ? codeDisplay(primaryAsset.asset_code_display, primaryAsset.asset_code) : `#${contract.device_id}`}
                      <ExternalLink size={11} />
                    </Link>
                    {primaryAsset?.external_ref && (
                      <span className="text-[10px] font-mono text-subtle bg-surface px-1 py-0.5 rounded border border-line">
                        EXT {primaryAsset.external_ref}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-subtle">{t('contract.deviceModel')}</div>
                  <div className="text-sm">{contract.product_display_name ?? contract.variant_name ?? contract.model_name ?? '—'}</div>
                </div>
                {primaryAsset?.imei && (
                  <div>
                    <div className="text-xs text-subtle">IMEI</div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-mono">{primaryAsset.imei}</span>
                      <button
                        type="button"
                        className="btn-icon-xs text-subtle hover:text-fg"
                        aria-label={t('contract.identifierCorrectImei', { defaultValue: 'Correct IMEI' })}
                        title={t('contract.identifierCorrectImei', { defaultValue: 'Correct IMEI' })}
                        onClick={() => setFixIdentifier({ type: 'IMEI', oldValue: primaryAsset.imei! })}
                      >
                        <Pencil size={12} />
                      </button>
                    </div>
                  </div>
                )}
                {primaryAsset?.serial_no && (
                  <div>
                    <div className="text-xs text-subtle">SN</div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-mono">{primaryAsset.serial_no}</span>
                      <button
                        type="button"
                        className="btn-icon-xs text-subtle hover:text-fg"
                        aria-label={t('contract.identifierCorrectSerial', { defaultValue: 'Correct serial number' })}
                        title={t('contract.identifierCorrectSerial', { defaultValue: 'Correct serial number' })}
                        onClick={() => setFixIdentifier({ type: 'SERIAL_NO', oldValue: primaryAsset.serial_no! })}
                      >
                        <Pencil size={12} />
                      </button>
                    </div>
                  </div>
                )}
                {!primaryAsset && contract.device_identifier && (
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
                  {/* Gate by device presence, not contract status: iCloud
                      assign/change/release only needs a bound device +
                      permission + branch match (fn_icloud_device_assign has no
                      ACTIVE guard). We're already inside the hasPrimary branch,
                      so a device exists — show the actions in PENDING_PAYMENT /
                      PENDING_SIGN too, matching the inventory Assets page. */}
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
                </div>
              )}

              {/* Screen Time passcode + recovery email — renders only if the
                  permission-scoped view returns a row (BM / company roles). */}
              {contract.device_id != null && (
                <AssetScreenTimeSection assetId={contract.device_id} className="mt-2" />
              )}

              {(canDo('DEVICE_REPAIR_REQUEST') || canDo('UNBIND_DEVICE') || canDo('CUSTOMER_DEPOSIT_DEVICE') || canDo('RETURN_DEPOSIT')) && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-line mt-2">
                  {canDo('DEVICE_REPAIR_REQUEST') && (
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
                  )}
                  {canDo('UNBIND_DEVICE') && (
                    <Button
                      size="sm"
                      variant="outline"
                      color="danger"
                      startIcon={<Link2Off size={14} />}
                      onClick={() => onRequestAction('unbind_device')}
                    >
                      {t('contract.action_unbind_device')}
                    </Button>
                  )}
                  {canDo('CUSTOMER_DEPOSIT_DEVICE') && (
                    <Button
                      size="sm"
                      variant="outline"
                      startIcon={<ArrowDownToLine size={14} />}
                      onClick={() => onRequestAction('deposit_device')}
                    >
                      {t('contract.action_deposit_device')}
                    </Button>
                  )}
                  {canDo('RETURN_DEPOSIT') && (
                    <Button
                      size="sm"
                      variant="outline"
                      startIcon={<ArrowUpFromLine size={14} />}
                      onClick={() => onRequestAction('return_deposit')}
                    >
                      {t('contract.action_return_deposit')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-subtle">{t('contract.device_noPrimary')}</div>
              {/* Binding does not require ACTIVE — fn_contract_bind_device only
                  checks permission + that no device is bound, so allow binding
                  the primary device before signing/activation too. (The inv
                  issue-to-customer txn still only fires once ACTIVE.) */}
              <Button
                size="sm"
                color="primary"
                startIcon={<Link2 size={14} />}
                onClick={() => onRequestAction('bind_device')}
              >
                {t('contract.action_bind_device')}
              </Button>
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
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Link
                      to={`/admin/inventory/assets/${contract.loaner_device_id}`}
                      className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
                    >
                      {loanerAsset ? codeDisplay(loanerAsset.asset_code_display, loanerAsset.asset_code) : `#${contract.loaner_device_id}`}
                      <ExternalLink size={11} />
                    </Link>
                    {loanerAsset?.external_ref && (
                      <span className="text-[10px] font-mono text-subtle bg-surface px-1 py-0.5 rounded border border-line">
                        EXT {loanerAsset.external_ref}
                      </span>
                    )}
                  </div>
                </div>
                {loanerAsset?.variant_name && (
                  <div>
                    <div className="text-xs text-subtle">{t('contract.deviceModel')}</div>
                    <div className="text-sm">{loanerAsset.variant_name}</div>
                  </div>
                )}
                {loanerAsset?.imei && (
                  <div>
                    <div className="text-xs text-subtle">IMEI</div>
                    <div className="text-sm font-mono">{loanerAsset.imei}</div>
                  </div>
                )}
                {loanerAsset?.serial_no && (
                  <div>
                    <div className="text-xs text-subtle">SN</div>
                    <div className="text-sm font-mono">{loanerAsset.serial_no}</div>
                  </div>
                )}
              </div>

              {canDo('UNBIND_LOANER') && (
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
              {canDo('BIND_LOANER') && (
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

          {!hasLoaner && primaryWithCustomer && !canDo('BIND_LOANER') && (
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
                    {codeDisplay(ro.asset_code_display, ro.asset_code)}
                    {ro.loaner_asset_code && <> · {t('contract.device_loaner')}: {codeDisplay(ro.loaner_asset_code_display, ro.loaner_asset_code)}</>}
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
          <CorrectIdentifierModal
            open={fixIdentifier !== null}
            onClose={() => setFixIdentifier(null)}
            assetId={primaryAsset.asset_id}
            branchId={primaryAsset.branch_id}
            type={fixIdentifier?.type ?? 'IMEI'}
            oldValue={fixIdentifier?.oldValue ?? ''}
            isApple={primaryAsset.brand_name === 'Apple'}
            onSuccess={() => {
              setFixIdentifier(null);
              queryClient.invalidateQueries({ queryKey: ['asset-summary', contract.device_id] });
              addSnackbar({
                message: (
                  <div className="alert alert-success">
                    <CheckCircle size={16} />
                    <span>{t('contract.identifierCorrectSuccess', { defaultValue: 'Identifier corrected' })}</span>
                  </div>
                ),
                type: 'success',
              });
            }}
          />
        </>
      )}
    </div>
  );
}

// Correct a primary device's IMEI / serial number (typo fix) via
// fn_inv_identifier_correct. The backend enforces permission
// (INVENTORY.IDENTIFIER_CORRECT), branch custody, and uniqueness — we just
// collect the new value and surface any error.
function CorrectIdentifierModal({
  open, onClose, assetId, branchId, type, oldValue, isApple, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  assetId: number;
  branchId: number;
  type: IdentifierType;
  oldValue: string;
  // Apple serials have a strict format (11/12 chars, no O/I); only validate the
  // serial format for Apple devices. IMEI (Luhn) is brand-agnostic.
  isApple: boolean;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [newValue, setNewValue] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset fields each time the modal opens for a fresh target.
  const [seenOld, setSeenOld] = useState<string | null>(null);
  if (open && seenOld !== oldValue) {
    setSeenOld(oldValue);
    setNewValue('');
    setNote('');
    setError('');
  }
  if (!open && seenOld !== null) setSeenOld(null);

  const isImei = type === 'IMEI';
  const trimmed = newValue.trim();

  // Format validation (reuses the shared validators). IMEI → Luhn always;
  // serial → Apple format only for Apple devices, else just non-empty.
  const formatError: string | null = (() => {
    if (trimmed.length === 0) return null; // don't nag on empty
    if (isImei) {
      return validateIMEI(trimmed).valid
        ? null
        : t('contract.identifierInvalidImei', { defaultValue: 'Invalid IMEI (checksum failed)' });
    }
    if (isApple) {
      return validateiPhoneSerial(trimmed).valid
        ? null
        : t('contract.identifierInvalidSerial', { defaultValue: 'Invalid serial number' });
    }
    return null;
  })();

  const canSave = trimmed.length > 0 && trimmed !== oldValue && !saving && formatError == null;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_inv_identifier_correct', {
        p_asset_id: assetId,
        p_identifier_type: type,
        p_old_value: oldValue,
        p_new_value: trimmed,
        p_note: note.trim() || null,
        p_branch_id: branchId,
      });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const label = isImei ? 'IMEI' : t('contract.serialNumber', { defaultValue: 'Serial number' });

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {t('contract.identifierCorrectTitle', { defaultValue: 'Correct {{label}}', label })}
        </h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        <div className="form-grid">
          {error && (
            <div className="alert alert-danger">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="flex flex-col">
            <label className="form-label">{t('contract.identifierCorrectExisting', { defaultValue: 'Current value' })}</label>
            <div className="text-sm font-mono px-3 py-2 rounded-md border border-line bg-surface text-subtle">{oldValue}</div>
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('contract.identifierCorrectNew', { defaultValue: 'New {{label}}', label })}</label>
            {isImei ? (
              <ImeiInput value={newValue} onChange={setNewValue} className="w-full" placeholder="000000000000000" />
            ) : (
              <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} className="w-full" />
            )}
            <FormErrorMessage error={formatError ? { message: formatError } : undefined} />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('contract.identifierCorrectNote', { defaultValue: 'Note (optional)' })}</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="w-full" />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button
          color="primary"
          onClick={handleSave}
          disabled={!canSave}
          startIcon={saving ? <Loader2 size={14} className="animate-spin" /> : undefined}
        >
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}
