// The header row every device-report section wears (§3.4): a disclosure toggle
// carrying the COUNT and how STALE the data is, plus the Pull button that fires
// the async query command.

import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { ChevronRight, RefreshCw, Loader2 } from 'lucide-react';
import { RelativeDateTime } from './RelativeDateTime';

export function MdmSectionHeader({
  open, onToggle, title, count, observedAt, onPull, pulling, canPull,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  count: number | null;
  observedAt: string | null;
  onPull: () => void;
  pulling: boolean;
  canPull: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 min-w-0 flex-1 bg-transparent border-none cursor-pointer text-left p-0 text-current"
      >
        <ChevronRight size={15} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-sm font-medium shrink-0">
          {title}{count != null && <span className="text-subtle"> ({count})</span>}
        </span>
        <span className="text-xs text-subtle truncate ml-1">
          {observedAt
            ? <>{t('asset.mdm.devInfo.observedAt')} <RelativeDateTime value={observedAt} /></>
            : t('asset.mdm.devInfo.neverPulled')}
        </span>
      </button>
      <Button
        variant="outline"
        size="sm"
        disabled={pulling || !canPull}
        onClick={onPull}
        startIcon={pulling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
      >
        {t('asset.mdm.devInfo.pull')}
      </Button>
    </div>
  );
}
