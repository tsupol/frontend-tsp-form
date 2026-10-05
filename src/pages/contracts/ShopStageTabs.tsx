import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import { OverflowTabs } from '../../components/OverflowTabs';
import { useNavCounts } from '../../hooks/useNavCounts';
import { SHOP_STAGES, type ShopStage } from '../../lib/shopStages';
import { liveStageSearch, STAGE_SEARCH_STATE } from '../../lib/stageSearch';
import { stageDestination } from '../../lib/stagePick';

const TAB_STAGES = SHOP_STAGES.filter(s => s.tab);
const TAB_KEYS = TAB_STAGES.map(s => s.key);

// The shop's stages as one tab row above every stage page — the same entries,
// names and order as the side menu, which opens the same pages. Pressing a tab
// keeps whatever is typed in the search box, so one contract number can be
// looked for stage by stage, and reopens the row that was open in that stage.
export function ShopStageTabs({ active }: { active: ShopStage }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { draftContractsCount, pendingPaymentCount } = useNavCounts();
  const counts = { draft: draftContractsCount, pendingPayment: pendingPaymentCount };

  return (
    <OverflowTabs
      tabs={TAB_KEYS}
      activeTab={active.key}
      onTabChange={key => {
        const stage = TAB_STAGES.find(s => s.key === key);
        if (!stage || stage.key === active.key) return;
        navigate(stageDestination(stage.path), { state: { [STAGE_SEARCH_STATE]: liveStageSearch() } });
      }}
      renderLabel={key => {
        const stage = TAB_STAGES.find(s => s.key === key);
        if (!stage) return key;
        const count = stage.count ? counts[stage.count] : 0;
        return (
          <span className="inline-flex items-center gap-1.5">
            {t(stage.labelKey)}
            {count > 0 && <Badge size="xs" color="warning">{count > 99 ? '99+' : count}</Badge>}
          </span>
        );
      }}
    />
  );
}
