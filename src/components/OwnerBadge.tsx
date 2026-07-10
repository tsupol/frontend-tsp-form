import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import { OWNER_BADGE_COLOR, type OwnerType } from '../lib/ownerTypes';

// Shows the device/stock owner of an entity (asset, lot, PO, contract, buyback).
// See UI_SUMMARY/125_INTAKE_OWNER_CONFIG.md §4.
//
// Views expose owner_type (code) + owner_name (resolved display name). Show owner_name
// as the badge text, color by owner_type. If owner_name is missing, fall back to the
// translated owner_type label.
export function OwnerBadge({
  ownerType,
  ownerName,
  size = 'sm',
}: {
  ownerType: OwnerType | null | undefined;
  ownerName: string | null | undefined;
  size?: 'xs' | 'sm' | 'md';
}) {
  const { t } = useTranslation();
  if (!ownerType) return <span className="text-subtler">—</span>;
  const label = ownerName || t(`ownerType.${ownerType}`);
  return (
    <Badge size={size} color={OWNER_BADGE_COLOR[ownerType] ?? 'default'}>
      {label}
    </Badge>
  );
}
