// The shop's "photos for the credit desk" card — mig 1559 / 1561,
// UI_FEEDBACK 2026-11-01 NOTICE partner_case_credit_support_photos.
//
// Two optional groups of the contract album (CREDIT_WORK, CREDIT_OTHER — the
// codes are the contract, the labels come from the slots view) that a
// deal-partner shop fills while drafting, before it asks for approval: an
// employee card, the workplace, anything that helps the credit desk decide.
// Each photo takes a caption the reviewer reads under it.
//
// Sits right above the approval card on every surface a shop meets its FIN1
// contract (wizard, drafts panel, contract panel), and is nothing for anyone
// else. Not a gate: submitting never waits on it.
//
// The album component does the work (add / drag / move / replace / remove,
// captions, per-photo locks). This card only picks the two groups, hosts the
// per-group QR (the phone opens on that group — mig 1561) and says what the
// card is for. Once the credit desk approves, each existing photo comes back
// `is_locked` and the album freezes that photo; the groups still take new ones.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { ContractPhotoGroups } from '../contracts/ContractPhotoGroups';
import { ContractCaptureModal } from '../contracts/workspace/ContractCaptureModal';
import {
  CREDIT_PHOTO_SLOTS, photosKey, statusKey, useContractAlbumPhotos, useContractPhotoStatus,
  type PhotoStatusSlot,
} from '../contracts/contractPhotoStatus';

/** States in which the request is still ahead or open — the card's whole life. */
const SHOWN_STATES = new Set(['DRAFT', 'SAVING', 'PENDING_APPROVAL', 'APPROVED']);

export function CreditSupportPhotosCard({
  contractId,
  contractCode,
  commercialModel,
  contractState,
  variant = 'plain',
  className,
}: {
  contractId: number | null;
  contractCode: string | null;
  /** The flow is FIN1 only; null = not known yet, let it render. */
  commercialModel?: string | null;
  contractState?: string | null;
  /** `plain` for a bordered card in a detail panel, `flush` inside the wizard's card column. */
  variant?: 'plain' | 'flush';
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const { isDealPartner } = useAuth();
  const queryClient = useQueryClient();
  const [capture, setCapture] = useState<PhotoStatusSlot | null>(null);

  const applies = isDealPartner
    && contractId != null
    && (commercialModel == null || commercialModel === 'FIN1')
    && (contractState == null || SHOWN_STATES.has(contractState));

  // Only to say "locked" in the header once the desk has approved: the album
  // itself reads the per-photo flag. The same cached reads the album uses.
  const { data: status } = useContractPhotoStatus(applies ? contractId : 0);
  const { data: photos = [] } = useContractAlbumPhotos(
    applies ? contractId : 0,
    status?.slots.map(s => s.slot) ?? [],
  );
  const anyLocked = photos.some(p => CREDIT_PHOTO_SLOTS.includes(p.usage_type) && p.is_locked);

  if (!applies) return null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: photosKey(contractId) });
    queryClient.invalidateQueries({ queryKey: statusKey(contractId) });
  };

  const wrapperClass = variant === 'flush'
    ? `border-b border-line px-4 py-4 ${className ?? ''}`
    : `rounded-md border border-line bg-surface px-4 py-3 ${className ?? ''}`;
  const isThai = i18n.language === 'th';

  return (
    <div className={wrapperClass}>
      <div className="flex items-center gap-2">
        <Camera size={16} className="text-subtle shrink-0" />
        <span className="font-medium text-sm flex-1 min-w-0">{t('contractPhotos.creditTitle')}</span>
      </div>
      <p className="mt-1 text-xs text-subtle">
        {anyLocked ? t('contractPhotos.creditLockedHint') : t('contractPhotos.creditHint')}
      </p>

      <ContractPhotoGroups
        contractId={contractId}
        className="mt-3"
        hideBanner
        hideRequired
        onlySlots={CREDIT_PHOTO_SLOTS}
        captions
        onCaptureGroup={setCapture}
      />

      {/* One session per press: the phone opens on the pressed group. Photos
          it sends land in the album as they arrive; closing keeps the session
          alive on the backend so a half-done phone still finishes. */}
      <ContractCaptureModal
        open={capture != null}
        onClose={() => setCapture(null)}
        contractId={contractId}
        contractCode={contractCode}
        slot={capture?.slot ?? null}
        slotLabel={capture ? (isThai ? capture.label_th : capture.label_en) : null}
        onUploaded={refresh}
      />
    </div>
  );
}
