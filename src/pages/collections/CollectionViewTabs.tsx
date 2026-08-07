import { useTranslation } from 'react-i18next';
import type { CollectionView } from './useCollectionContext';

/* ───────────────────────────────────────────────────────────────────────────
 * The สาขา / Pool / สมุดของฉัน switcher shared by the two collection reports.
 * Pressing a tab IS the choice of view — the numbers behind each tab count
 * different things on purpose and must never be reconciled against each other.
 * A single available view renders nothing (no switcher for a non-choice).
 * ─────────────────────────────────────────────────────────────────────────── */

export function CollectionViewTabs({
  views, value, onChange, poolName,
}: {
  views: CollectionView[];
  value: CollectionView;
  onChange: (v: CollectionView) => void;
  /** Shown as the Pool tab label when the caller belongs to a named pool. */
  poolName?: string | null;
}) {
  const { t } = useTranslation();
  if (views.length < 2) return null;

  const labelFor = (v: CollectionView) => {
    if (v === 'pool' && poolName) return poolName;
    return t(`collectionView.${v}`);
  };

  // h-7 matches tsp-form's form-control-sm height so the switcher lines up with
  // the Selects sitting beside it in the header row.
  return (
    <div className="input-group h-7">
      {views.map((v, i) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-3 text-xs cursor-pointer border-none whitespace-nowrap transition-colors ${
            value === v
              ? 'bg-item-active-bg text-item-active-fg font-medium'
              : 'bg-transparent text-subtle hover:text-fg'
          } ${i > 0 ? 'border-l border-line' : ''}`}
        >
          {labelFor(v)}
        </button>
      ))}
    </div>
  );
}
