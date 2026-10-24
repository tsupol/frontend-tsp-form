// The expandable MDM check: closed it is the handover-ready box, open it is the
// device's MDM tab in place. Used where someone needs MDM without leaving the
// job they are on — finance's close-out review, and the contract's device tab
// (Ohm #11, 2026-10-24: a separate device page was a place the branch had to
// know to go). The host draws its own heading and puts
// MdmCheckToggle in it, so the toggle belongs to the section it opens.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { AssetMdmTab } from './AssetMdmTab';
import { AddIdentifierModal, type IdentifierTargetAsset } from './AddIdentifierModal';
import { MdmReadinessBox } from './mdm/MdmReadinessBox';
import { useMdmStatus } from './mdm/useMdmStatus';

export function MdmCheckToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="sm"
      endIcon={open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      onClick={onToggle}
      aria-expanded={open}
    >
      {open ? t('asset.mdm.check.hideDetails') : t('asset.mdm.check.showDetails')}
    </Button>
  );
}

export function MdmCheckBody({ assetId, open, allowAddSerial = false }: {
  assetId: number;
  open: boolean;
  /** The branch doing the enrolment may add the serial; a reviewer may not. */
  allowAddSerial?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useMdmStatus(assetId);
  const [addSerialOpen, setAddSerialOpen] = useState(false);

  // Enrolment starts with the serial; a phone registered with only an IMEI is
  // stuck at step 1 until one is added, so the window comes along.
  const { data: asset } = useQuery({
    queryKey: ['mdm-check-asset', assetId],
    queryFn: () => apiClient.get<IdentifierTargetAsset[]>(
      `/v_assets?asset_id=eq.${assetId}&select=asset_id,asset_code,asset_code_display,brand_name,family_name,model_name&limit=1`,
    ).then(r => r[0] ?? null),
    enabled: open && allowAddSerial,
  });

  const content = !open
    ? (status
      ? <MdmReadinessBox status={status} />
      : <div className="text-sm text-subtler">{isLoading ? t('common.loading') : t('asset.mdm.check.noStatus')}</div>)
    : (
      <div className="rounded-md border border-line overflow-hidden flex flex-col">
        <AssetMdmTab
          assetId={assetId}
          onRefresh={() => {}}
          onAddSerial={allowAddSerial && asset ? () => setAddSerialOpen(true) : undefined}
        />
      </div>
    );

  return (
    <>
      {content}
      {/* Always mounted (the Modal rule); its button only appears once the
          device row is in. */}
      <AddIdentifierModal
        open={addSerialOpen}
        identifierType="SERIAL_NO"
        asset={asset ?? { asset_id: assetId, asset_code: '' }}
        onClose={() => setAddSerialOpen(false)}
        onSuccess={() => {
          setAddSerialOpen(false);
          queryClient.invalidateQueries({ queryKey: ['asset-mdm-status', assetId] });
          queryClient.invalidateQueries({ queryKey: ['asset-summary', assetId] });
        }}
      />
    </>
  );
}
