import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, LabeledCheckbox } from 'tsp-form';
import { CheckCircle, XCircle, Loader2, Package, PackageX, AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useWorkspace } from './WorkspaceContext';
import { useContractHandover, useInvalidateHandover } from './useContractHandover';

interface Props { onClose: () => void }

// The bound asset's stock box state — distinct from the handover "give box to
// customer" flag below. Shown as a hint so staff don't promise a box the
// device doesn't have (or one that's stored at another branch).
interface AssetBoxInfo {
  asset_id: number;
  has_box: boolean;
  box_branch_id: number | null;
  box_branch_name: string | null;
}

export function PanelHandover({ onClose: _onClose }: Props) {
  const { t } = useTranslation();
  const { contract } = useWorkspace();
  const contractId = contract?.id ?? null;
  const targetAssetId = contract?.target_asset_id ?? null;
  const { data: handover } = useContractHandover(contractId);
  const invalidateHandover = useInvalidateHandover();

  const { data: assetBox } = useQuery({
    queryKey: ['handover-asset-box', targetAssetId],
    queryFn: async (): Promise<AssetBoxInfo | null> => {
      const rows = await apiClient.get<AssetBoxInfo[]>(
        `/v_assets?asset_id=eq.${targetAssetId}&select=asset_id,has_box,box_branch_id,box_branch_name&limit=1`,
      );
      return rows[0] ?? null;
    },
    enabled: !!targetAssetId,
    staleTime: 30_000,
  });
  const boxAtOtherBranch = !!assetBox?.has_box
    && assetBox.box_branch_id != null
    && contract?.branch_id != null
    && assetBox.box_branch_id !== contract.branch_id;

  const [hasBox, setHasBox] = useState(false);
  const [hasChargerSet, setHasChargerSet] = useState(false);
  const [hasChargerCable, setHasChargerCable] = useState(false);
  const [unlockCode, setUnlockCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (handover) {
      setHasBox(handover.has_box);
      setHasChargerSet(handover.has_charger_set);
      setHasChargerCable(handover.has_charger_cable);
      setUnlockCode(handover.device_unlock_code ?? '');
    }
  }, [handover]);

  const handleSave = async () => {
    if (!contractId) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_contract_set_handover', {
        p_contract_id: contractId,
        p_has_box: hasBox,
        p_has_charger_set: hasChargerSet,
        p_has_charger_cable: hasChargerCable,
        p_device_unlock_code: unlockCode.trim() || null,
      });
      invalidateHandover(contractId);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSaving(false);
    }
  };

  if (!contractId) return null;

  return (
    <div className="flex flex-col h-full max-w-xl">
      <div className="flex-1 overflow-y-auto better-scroll p-4 flex flex-col gap-5">
        {assetBox && (
          <div className="flex flex-col gap-2">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm ${
              assetBox.has_box ? 'bg-success-soft border-success-border' : 'bg-surface border-line'
            }`}>
              {assetBox.has_box
                ? <Package size={16} className="text-success shrink-0" />
                : <PackageX size={16} className="text-subtle shrink-0" />}
              <span>
                {assetBox.has_box
                  ? t('workspace.handoverStockHasBox', { defaultValue: 'This device has a box in stock' })
                  : t('workspace.handoverStockNoBox', { defaultValue: 'This device has no box in stock' })}
              </span>
            </div>
            {boxAtOtherBranch && (
              <div className="alert alert-warning">
                <AlertTriangle size={14} />
                <span>{t('workspace.handoverBoxOtherBranch', {
                  defaultValue: 'The box is stored at {{branch}} — collect it before handover.',
                  branch: assetBox.box_branch_name ?? '',
                })}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col">
          <label className="form-label mb-3">{t('workspace.handoverIncludedItems')}</label>
          <div className="flex flex-col gap-3">
            <LabeledCheckbox
              label={t('workspace.handoverHasBox')}
              checked={hasBox}
              onChange={e => setHasBox(e.target.checked)}
            />
            <LabeledCheckbox
              label={t('workspace.handoverHasChargerSet')}
              checked={hasChargerSet}
              onChange={e => setHasChargerSet(e.target.checked)}
            />
            <LabeledCheckbox
              label={t('workspace.handoverHasChargerCable')}
              checked={hasChargerCable}
              onChange={e => setHasChargerCable(e.target.checked)}
            />
          </div>
        </div>

        <div className="flex flex-col">
          <label className="form-label">{t('workspace.handoverUnlockCode')}</label>
          <Input
            value={unlockCode}
            onChange={e => setUnlockCode(e.target.value)}
            placeholder="123456"
            className="w-full"
            size="sm"
          />
          <span className="text-xs text-subtle mt-1">{t('workspace.handoverUnlockCodeHint')}</span>
        </div>

        {error && (
          <div className="alert alert-danger">
            <XCircle size={14} />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-bg px-4 py-3 flex justify-end gap-2">
        <Button
          color="primary"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <Loader2 size={14} className="animate-spin" /> : savedFlash ? <CheckCircle size={14} /> : undefined}
        >
          {saving ? t('common.saving') : savedFlash ? t('workspace.handoverSaved') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
