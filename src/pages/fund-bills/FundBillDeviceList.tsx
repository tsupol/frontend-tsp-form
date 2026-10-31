// The devices a fund-bill action moved between owners — shown in the success
// view of the pay modal (shop → holding) and the credit-note modal (holding →
// shop). Since mig 1554 the RPC sends each device's code, model and Serial/IMEI
// along with the new owner's name, so the row reads like everywhere else in the
// app instead of "#9278" (DONE 2026-11-01 fund_bill_devices_display_1554).
//
// `owner_to_name` names the new owner in the heading; every device in one
// result goes to the same owner, so the first row's name is the heading's.
// Results written before the migration carry only ids — the row then falls
// back to "#id" and the heading to the owner-less wording.

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Smartphone } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';
import type { FundBillPaidDevice } from './fundBillTypes';

interface FundBillDeviceListProps {
  devices: FundBillPaidDevice[];
  /** Which way the devices moved — picks the owner-less fallback heading. */
  direction: 'to_holding' | 'to_shop';
}

export function FundBillDeviceList({ devices, direction }: FundBillDeviceListProps) {
  const { t } = useTranslation();
  if (devices.length === 0) return null;
  const ownerName = devices[0]?.owner_to_name ?? null;
  const heading = ownerName
    ? t('fundBill.devicesNowOwnedBy', { count: devices.length, owner: ownerName })
    : t(direction === 'to_holding' ? 'fundBill.devicesMovedToHolding' : 'fundBill.devicesReturnedToShop', { count: devices.length });

  return (
    <div className="rounded-md border border-line overflow-hidden">
      <div className="px-3 py-2 bg-surface text-sm font-medium flex items-center gap-2">
        <Smartphone size={14} className="text-subtle" />
        {heading}
      </div>
      {devices.map(d => {
        const code = d.asset_code_display ?? d.asset_code ?? `#${d.asset_id}`;
        const ident = d.asset_identifier ?? d.imei ?? d.serial_no ?? null;
        return (
          <div key={d.transfer_id} className="px-3 py-2 border-t border-line flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0 flex flex-col">
              <Link
                to={`/admin/inventory/assets/${d.asset_id}`}
                className="font-medium text-primary-fg hover:underline truncate"
              >
                {code}
              </Link>
              {(d.product_display_name || ident) && (
                <span className="text-xs text-subtle truncate">
                  {[d.product_display_name, ident].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
            <span className="tabular-nums shrink-0">{fmtCurrency(d.cost_basis)}</span>
          </div>
        );
      })}
    </div>
  );
}
