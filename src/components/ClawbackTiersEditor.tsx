import { useTranslation } from 'react-i18next';
import { Button, MaskedInput } from 'tsp-form';
import { Plus, Trash2 } from 'lucide-react';

// ============================================================================
// Clawback tier table — shared by the holding policy (§6a default) and the
// per-shop config (§6b override) on the deal partner terms page (mig 1217).
//
// Reads "paid X installments → claw back Y% of the deal partner commission".
// The DB rules the FE must not fight (work order §1):
//   · `paid` starts at 0 and rises by exactly 1 per row — so it is NOT an input,
//     it is the row index. The user only ever types the percent.
//   · pct is 0–100, and must be non-increasing as `paid` rises (paying more
//     never claws back more).
//   · at most 24 rows; [] means never claw back.
//   · anything past the last row claws back 0%.
// Only the last row can be removed, because removing a middle row would
// renumber every row below it and silently change what the user agreed to.
// ============================================================================

export interface ClawbackTier {
  paid: number;
  pct: number;
}

export const MAX_CLAWBACK_TIERS = 24;

/** Mirrors the DB check so the user sees the problem before the round trip.
 *  Returns an i18n key, or null when the tiers are valid. The DB still decides. */
export function validateClawbackTiers(tiers: ClawbackTier[]): string | null {
  if (tiers.length > MAX_CLAWBACK_TIERS) return 'dealPartnerRate.clawbackTooManyTiers';
  for (let i = 0; i < tiers.length; i++) {
    const pct = tiers[i].pct;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return 'dealPartnerRate.clawbackPctRange';
    if (i > 0 && pct > tiers[i - 1].pct) return 'dealPartnerRate.clawbackNotDescending';
  }
  return null;
}

/** Normalises `paid` to the row index — the only numbering the DB accepts. */
export function renumberTiers(tiers: ClawbackTier[]): ClawbackTier[] {
  return tiers.map((tier, i) => ({ paid: i, pct: tier.pct }));
}

interface Props {
  value: ClawbackTier[];
  onChange: (tiers: ClawbackTier[]) => void;
  disabled?: boolean;
}

export function ClawbackTiersEditor({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const errorKey = validateClawbackTiers(value);

  const setPct = (index: number, raw: string) => {
    const next = value.map((tier, i) => (i === index ? { ...tier, pct: raw === '' ? NaN : parseFloat(raw) } : tier));
    onChange(renumberTiers(next));
  };

  const addRow = () => {
    // A new row inherits the row above so it starts valid (non-increasing);
    // the very first row starts at the full 100%.
    const prev = value[value.length - 1];
    onChange(renumberTiers([...value, { paid: value.length, pct: prev ? prev.pct : 100 }]));
  };

  const removeLast = () => onChange(renumberTiers(value.slice(0, -1)));

  return (
    <div className="flex flex-col">
      {value.length === 0 ? (
        <div className="px-3 py-2.5 rounded-md bg-surface border border-line text-sm text-subtle">
          {t('dealPartnerRate.clawbackNoTiers')}
        </div>
      ) : (
        <div className="rounded-md border border-line overflow-hidden">
          {value.map((tier, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 px-3 py-2 ${i > 0 ? 'border-t border-line' : ''}`}
            >
              <span className="text-sm flex-1 min-w-0">
                {t('dealPartnerRate.clawbackTierRow', { paid: tier.paid })}
              </span>
              <div className="w-24 shrink-0">
                <MaskedInput
                  mask="number"
                  decimalScale={0}
                  size="sm"
                  value={Number.isNaN(tier.pct) ? '' : String(tier.pct)}
                  onChange={raw => setPct(i, raw)}
                  suffix="%"
                  disabled={disabled}
                />
              </div>
              {i === value.length - 1 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  startIcon={<Trash2 size={14} />}
                  onClick={removeLast}
                  disabled={disabled}
                  aria-label={t('dealPartnerRate.clawbackRemoveRow')}
                />
              ) : (
                // Keeps the percent inputs on one column — only the last row
                // is removable, so the other rows reserve exactly the width
                // of that icon-only small button (its height token).
                <div className="shrink-0" style={{ width: 'var(--height-control-sm, 1.75rem)' }} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-2">
        <p className="text-xs text-subtle">{t('dealPartnerRate.clawbackBeyondLastRow')}</p>
        <Button
          variant="outline"
          size="sm"
          type="button"
          startIcon={<Plus size={14} />}
          onClick={addRow}
          disabled={disabled || value.length >= MAX_CLAWBACK_TIERS}
        >
          {t('dealPartnerRate.clawbackAddRow')}
        </Button>
      </div>

      {errorKey && <p className="text-xs text-danger-fg mt-1">{t(errorKey)}</p>}
    </div>
  );
}
