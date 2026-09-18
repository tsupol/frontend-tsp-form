// "รอรับเครื่องคืน" — the fund warehouse's inbox, 146 §2.
//
// Warehouse staff need one short list: devices from shop returns that are on
// their way here, with a button to confirm arrival. Nothing else on the return
// document is theirs to do.
//
// Who sees what: a user sitting at a warehouse branch sees their own branch's
// shipments (their `branch_id` filters the query). Fund finance, who can act for
// any warehouse, sees all of them — the same list, unfiltered — with a toggle
// back to their own branch when they are standing in it.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { PageNav, PageNavPanel, DataTable, MobileHeader, Badge, Button, LabeledCheckbox } from 'tsp-form';
import { ArrowRightFromLine, ExternalLink, PackageCheck } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { useAuth } from '../../contexts/AuthContext';
import { usePartnerReturnWarehouseQueue, usePartnerReturnDetail } from './usePartnerReturns';
import { ReturnWarehouseReceiveModal } from './ReturnWarehouseReceiveModal';
import type { PartnerReturnQueueRow } from './partnerReturnTypes';

/** Roles that may act for any warehouse rather than only the one they sit at. */
const ALL_WAREHOUSE_ROLES = ['COMPANY_FINANCE', 'COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'];

export function PartnerReturnWarehousePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isDealPartner } = useAuth();

  const seesEveryWarehouse = ALL_WAREHOUSE_ROLES.includes(user?.role_code ?? '');
  const myBranchId = user?.branch_id ?? null;

  const [onlyMine, setOnlyMine] = useState(!seesEveryWarehouse);
  const [receiveId, setReceiveId] = useState<number | null>(null);

  const filterBranch = onlyMine ? myBranchId : null;
  const queue = usePartnerReturnWarehouseQueue(filterBranch);
  const { detail } = usePartnerReturnDetail(receiveId);

  const target = queue.rows.find(r => r.return_id === receiveId) ?? null;

  if (isDealPartner) return <Navigate to="/admin/contracts/search" replace />;

  return (
    <PageNav panels={['list']} className="h-dvh overflow-hidden">
      {({ isMobile }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                <button
                  className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                  aria-label={t('nav.openMenu', { defaultValue: 'Open menu' })}
                  onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                >
                  <ArrowRightFromLine size={18} />
                </button>
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {t('partnerReturn.warehouseTitle')}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('partnerReturn.warehouseTitle')}</h1>
              <span className="text-sm text-subtle">
                {t('partnerReturn.foundCount', { count: queue.rows.length })}
              </span>
              <span className="flex-1" />
              {seesEveryWarehouse && myBranchId != null && (
                <LabeledCheckbox
                  label={t('partnerReturn.onlyMyWarehouse')}
                  checked={onlyMine}
                  onChange={e => setOnlyMine(e.target.checked)}
                />
              )}
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 flex flex-col">
              {isMobile && seesEveryWarehouse && myBranchId != null && (
                <div className="flex-none p-2 border-b border-line">
                  <LabeledCheckbox
                    label={t('partnerReturn.onlyMyWarehouse')}
                    checked={onlyMine}
                    onChange={e => setOnlyMine(e.target.checked)}
                  />
                </div>
              )}

              <DataTable<PartnerReturnQueueRow>
                data={queue.rows}
                renderRow={row => (
                  <WarehouseRow
                    row={row.original}
                    onOpen={() => navigate(`/admin/partner-returns/${row.original.return_id}`)}
                    onReceive={() => setReceiveId(row.original.return_id)}
                  />
                )}
                className={`flex-1 min-h-0 panel-datatable ${queue.isFetching ? 'opacity-60' : ''} transition-opacity`}
                noResults={
                  <div className="p-8 flex flex-col items-center gap-3 text-center text-subtler">
                    <PackageCheck size={40} />
                    <div>{t('partnerReturn.warehouseEmpty')}</div>
                  </div>
                }
              />
            </PageNavPanel>
          </div>

          <ReturnWarehouseReceiveModal
            open={receiveId != null}
            detail={detail}
            warehouseName={target?.warehouse_branch_name ?? null}
            onClose={() => setReceiveId(null)}
          />
        </>
      )}
    </PageNav>
  );
}

function WarehouseRow({ row, onOpen, onReceive }: {
  row: PartnerReturnQueueRow;
  onOpen: () => void;
  onReceive: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="px-4 py-2.5 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{row.device_code ?? '—'}</span>
          <Badge color="info" size="sm">
            {t(`partnerReturn.bucket_${row.device_bucket}`, { defaultValue: row.device_bucket ?? '—' })}
          </Badge>
          <span className="flex-1" />
          <span className="text-xs text-subtle shrink-0">
            {row.transfer_shipped_at
              ? <DateTime value={row.transfer_shipped_at} showTime />
              : '—'}
          </span>
        </div>
        <div className="text-sm mt-0.5 truncate">
          {row.branch_name} · {row.customer_name ?? '—'}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <button
            type="button"
            onClick={onOpen}
            className="text-xs font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
          >
            {row.return_code}
            <ExternalLink size={12} />
          </button>
          {row.warehouse_branch_name && (
            <span className="text-xs text-subtle">{row.warehouse_branch_name}</span>
          )}
        </div>
      </div>

      <Button size="sm" variant="outline" onClick={onReceive}>
        {t('partnerReturn.action_WAREHOUSE_RECEIVE')}
      </Button>
    </div>
  );
}
