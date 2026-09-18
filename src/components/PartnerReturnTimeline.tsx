// The "history" tab of a device-return document — UI_SUMMARY/146 §1
// (`v_partner_return_timeline`, shop: `v_partner_my_return_timeline`), work
// order §3 item 8.
//
// One vertical list that merges five sources in time order, so the whole life
// of a return reads top to bottom without hopping between documents:
//   RETURN  — steps of the document itself (opened, received, closed, voided)
//   SIGNING — the customer's return receipt: issued, signed, voided
//   STOCK   — the device moving between buckets and branches
//   OWNER   — the device changing owner
//   MONEY   — the buyback adjustment row on the shop's payout
//
// Both sides render the same component; only the view they read differs, so
// the shop and the finance team look at the same history.
//
// Three rules this file keeps:
//   - An event's wording comes from i18n keyed on the raw `event` code, and
//     falls back to that code. A new event the backend adds later still shows
//     up (as its code) instead of vanishing.
//   - `from_value → to_value` is drawn only when the backend sent them.
//   - The link at the end of a row comes from `ref_table` / `ref_id`, never
//     from guessing at the event name. A row with no ref carries no link.

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Banknote, ExternalLink, FileSignature, PackageCheck, RefreshCcw, UserCheck,
} from 'lucide-react';
import { DateTime } from './DateTime';

/** One row of v_partner_return_timeline / v_partner_my_return_timeline. */
export interface PartnerReturnTimelineRow {
  at: string;
  source: string;
  event: string;
  from_value: string | null;
  to_value: string | null;
  event_branch_id: number | null;
  actor_name: string | null;
  actor_side: string | null;
  note: string | null;
  ref_table: string | null;
  ref_id: number | null;
  detail: Record<string, unknown> | null;
}

const SOURCE_ICON: Record<string, typeof PackageCheck> = {
  RETURN: PackageCheck,
  SIGNING: FileSignature,
  STOCK: RefreshCcw,
  OWNER: UserCheck,
  MONEY: Banknote,
};

// Icon tint per source. Each is a semantic -fg token so both themes read.
const SOURCE_COLOR: Record<string, string> = {
  RETURN: 'text-primary-fg',
  SIGNING: 'text-info-fg',
  STOCK: 'text-warning-fg',
  OWNER: 'text-secondary-fg',
  MONEY: 'text-success-fg',
};

/** Where a row's source document lives, when the FE has a page for it. */
function linkFor(
  row: PartnerReturnTimelineRow,
  contractId: number,
): { to: string; labelKey: string } | null {
  if (row.ref_id == null) return null;
  switch (row.ref_table) {
    case 'contract_signing':
      return { to: `/admin/contracts/search/${contractId}?tab=signing`, labelKey: 'partnerReturn.timeline.openSigning' };
    case 'inventory_txns':
      return { to: `/admin/contracts/search/${contractId}?tab=device`, labelKey: 'partnerReturn.timeline.openDevice' };
    case 'partner_payout_adjustment': {
      // The adjustment row names its payout in `detail`; without it there is
      // nothing to navigate to, so no link is drawn.
      const payoutId = row.detail?.payout_id;
      if (typeof payoutId !== 'number') return null;
      return { to: `/admin/partner-payouts/${payoutId}`, labelKey: 'partnerReturn.timeline.openPayout' };
    }
    default:
      return null;
  }
}

export function PartnerReturnTimeline({ rows, contractId }: {
  rows: PartnerReturnTimelineRow[];
  contractId: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (rows.length === 0) {
    return <div className="p-8 text-center text-subtler">{t('partnerReturn.timeline.empty')}</div>;
  }

  return (
    <ol className="flex flex-col list-none p-0 m-0">
      {rows.map((row, i) => {
        const Icon = SOURCE_ICON[row.source] ?? PackageCheck;
        const color = SOURCE_COLOR[row.source] ?? 'text-subtle';
        const isLast = i === rows.length - 1;
        const link = linkFor(row, contractId);
        const eventLabel = t(`partnerReturn.timeline.event.${row.event}`, { defaultValue: row.event });
        const sourceLabel = t(`partnerReturn.timeline.source.${row.source}`, { defaultValue: row.source });

        return (
          <li key={`${row.at}-${row.source}-${row.event}-${row.ref_id ?? i}`} className="flex gap-3">
            {/* rail: icon with the thread running through it */}
            <div className="flex flex-col items-center shrink-0">
              <div className={`w-7 h-7 rounded-full bg-surface border border-line flex items-center justify-center ${color}`}>
                <Icon size={14} />
              </div>
              {!isLast && <div className="w-px flex-1 bg-line" />}
            </div>

            <div className={`min-w-0 flex-1 ${isLast ? 'pb-1' : 'pb-4'}`}>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-medium">{eventLabel}</span>
                <span className="text-xs text-subtler">{sourceLabel}</span>
              </div>

              {(row.from_value || row.to_value) && (
                <div className="flex items-center gap-1.5 mt-0.5 text-xs text-subtle flex-wrap">
                  {row.from_value && <span>{row.from_value}</span>}
                  {row.from_value && row.to_value && <ArrowRight size={12} />}
                  {row.to_value && <span className="font-medium text-fg">{row.to_value}</span>}
                </div>
              )}

              {row.note && <div className="text-xs text-subtle mt-0.5 break-words">{row.note}</div>}

              <div className="flex items-center gap-2 mt-0.5 text-xs text-subtler flex-wrap">
                <DateTime value={row.at} showTime />
                {row.actor_name && <span className="truncate">{row.actor_name}</span>}
                {link && (
                  <button
                    type="button"
                    onClick={() => navigate(link.to)}
                    className="text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer text-xs"
                  >
                    {t(link.labelKey)}
                    <ExternalLink size={11} />
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
