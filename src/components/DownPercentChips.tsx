import { Button } from 'tsp-form';

/** Tap-to-pick down percents under the slider (owner 2026-11-01: "10, 15 … 50").
 *  Every 5% from the branch's minimum up to this ceiling; the slider still
 *  reaches the 1% steps and the branch maximum above it. */
const DOWN_CHIP_STEP = 5;
const DOWN_CHIP_MAX = 50;

export function DownPercentChips({ percents, value, onChange }: {
  /** The percents this branch allows; only the chip-worthy ones become chips. */
  percents: number[];
  value: number | null;
  onChange: (percent: number) => void;
}) {
  const chips = percents.filter(p => p % DOWN_CHIP_STEP === 0 && p <= DOWN_CHIP_MAX);
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {chips.map(p => (
        <Button
          key={p}
          size="sm"
          variant={p === value ? 'solid' : 'outline'}
          color={p === value ? 'primary' : 'default'}
          className="tabular-nums"
          onClick={() => onChange(p)}
        >
          {p}%
        </Button>
      ))}
    </div>
  );
}
