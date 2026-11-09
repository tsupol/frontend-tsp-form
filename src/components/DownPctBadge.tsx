// Down payment as a % of (device price + uplift) — the fund's credit desk reads it at a
// glance (NOTICE 2026-11-09 down_pct_financier_1646). The database works the % out and
// rounds it to 1 decimal; this only formats and draws it. One colour for every value:
// the owner has set no good/bad threshold, so the colour must not suggest one.
// null (an OPERATING contract, a draft not priced yet) draws nothing — no other check.

import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';

/** 23 → "23%" · 20.3 → "20.3%" · null → null (the notice's formatter, verbatim). */
export function formatDownPct(v: number | null | undefined): string | null {
  if (v == null) return null;
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
}

/** `chip` = "ดาวน์ 23%" for a list row with no down label of its own; else just "23%".
 *  Size it at least as large as the baht beside it (§3.2): md (12px) next to 12px row
 *  figures, lg (14px) next to the 14px money fields. */
export function DownPctBadge({ value, chip, size = 'md', className }: {
  value: number | null | undefined;
  chip?: boolean;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const { t } = useTranslation();
  const pct = formatDownPct(value);
  if (!pct) return null;
  return (
    <Badge color="info" size={size} className={`font-semibold tabular-nums shrink-0 ${className ?? ''}`} data-testid="down-pct">
      {chip ? t('downPct.chip', { pct }) : pct}
    </Badge>
  );
}
