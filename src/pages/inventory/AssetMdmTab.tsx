// ============================================================================
// AssetMdmTab — the MDM tab shell. Hosts the sub-tab strip (131 §0).
//
//   sub-tab 1 นำเครื่องเข้าระบบ   (SubTabEnroll — the original tab, moved in)
//   sub-tab 2 สถานะ & คิวงาน       (SubTabStatus)
//   sub-tab 3 การทวงถาม ⭐          (SubTabDunning)
//   sub-tab 4–7 + branch wallpaper  → phase 2 (not yet shown)
//
// Central rules the shell owns so sub-tabs don't each re-implement them:
//   - in_mdm === false → show ONLY sub-tab 1 + a "enrol first" hint (§12).
//   - is_enforcement_paused → warning bar up top; dunning buttons self-disable.
//   - visibility of 2–7 from the per-device may_* flags (DONE 2026-07-26), NOT
//     role_code. sub-tab 2 is visible to everyone once enrolled.
// ============================================================================

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { ScrollableTabs } from './ScrollableTabs';
import { useMdmStatus } from './mdm/useMdmStatus';
import { EnforcementPausedBar } from './mdm/MdmSharedBits';
import { SubTabEnroll } from './mdm/SubTabEnroll';
import { SubTabStatus } from './mdm/SubTabStatus';
import { SubTabDunning } from './mdm/SubTabDunning';
import type { AssetMdmStatus } from './mdm/mdmApi';

type MdmSubTab = 'enroll' | 'status' | 'dunning';

/** Which sub-tabs to show, given enrollment + per-device permissions. */
function visibleSubTabs(status: AssetMdmStatus | null): MdmSubTab[] {
  // Not enrolled → only the enroll tab (§12). Also covers a null/loading row.
  if (!status || !status.in_mdm) return ['enroll'];
  const tabs: MdmSubTab[] = ['enroll', 'status'];
  if (status.may_dunning) tabs.push('dunning');
  return tabs;
}

export function AssetMdmTab({ assetId, onRefresh }: { assetId: number; onRefresh: () => void }) {
  const { t } = useTranslation();
  const { data: status, isLoading, isFetching, refetch } = useMdmStatus(assetId);

  const tabs = useMemo(() => visibleSubTabs(status ?? null), [status]);

  // Land on status when enrolled, enroll otherwise (§0). Kept in state so the
  // user can move between sub-tabs; clamped to the visible set below.
  const [active, setActive] = useState<MdmSubTab>('enroll');
  const effectiveActive = tabs.includes(active)
    ? active
    : (status?.in_mdm ? 'status' : 'enroll');

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-subtler">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex-1 flex items-center justify-center text-subtler">
        {t('asset.mdm.noStatus')}
      </div>
    );
  }

  const goToEnroll = () => setActive('enroll');

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {tabs.length > 1 && (
        <ScrollableTabs
          tabs={tabs}
          activeTab={effectiveActive}
          onTabChange={setActive}
          renderLabel={(tab) => t(`asset.mdm.subtab.${tab}`)}
        />
      )}

      <div className="flex-1 min-h-0 overflow-auto better-scroll p-4 flex flex-col gap-4">
        {/* Pause bar — visible on every action sub-tab (not on enroll). */}
        {effectiveActive !== 'enroll' && (
          <EnforcementPausedBar status={status} />
        )}

        {effectiveActive === 'enroll' && (
          <SubTabEnroll
            status={status}
            isFetching={isFetching}
            onRefetch={() => refetch()}
            onRefresh={onRefresh}
          />
        )}

        {effectiveActive === 'status' && (
          <SubTabStatus status={status} onNotEnrolled={goToEnroll} />
        )}

        {effectiveActive === 'dunning' && (
          <SubTabDunning
            status={status}
            onAck={() => refetch()}
            onNotEnrolled={goToEnroll}
          />
        )}
      </div>
    </div>
  );
}
