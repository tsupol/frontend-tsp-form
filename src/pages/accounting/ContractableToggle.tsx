import { useTranslation } from 'react-i18next';

/* ───────────────────────────────────────────────────────────────────────────
 * ContractableToggle — the "ทั้งหมด / เครื่อง / สินค้าขายปลีก" view switch shared
 * by both lot-intake reports. Items received into a LOT split into two worlds
 * that never cross over: contractable devices (registered per-unit, hundreds a
 * month) and retail goods (cases/film/cables, thousands a month). Mixed
 * together the device bars vanish into the retail ones, so the split is a
 * first-class control, not a filter tucked into an overflow menu.
 *
 * `null` = both; maps straight to the RPCs' `p_contractable`.
 * ─────────────────────────────────────────────────────────────────────────── */

export type Contractable = null | true | false;

/** h-7 = tsp-form's form-control-sm height, so it lines up with the pickers
 *  sitting beside it in the header row. */
export function ContractableToggle({ value, onChange }: {
  value: Contractable;
  onChange: (v: Contractable) => void;
}) {
  const { t } = useTranslation();
  const options: { key: string; value: Contractable; label: string }[] = [
    { key: 'all', value: null, label: t('lotIntake.kindAll') },
    { key: 'device', value: true, label: t('lotIntake.kindDevice') },
    { key: 'retail', value: false, label: t('lotIntake.kindRetail') },
  ];

  return (
    <div className="input-group h-7">
      {options.map((opt, i) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 text-xs cursor-pointer border-none whitespace-nowrap transition-colors ${
            value === opt.value ? 'bg-item-active-bg text-item-active-fg font-medium' : 'bg-transparent text-subtle hover:text-fg'
          } ${i > 0 ? 'border-l border-line' : ''}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
