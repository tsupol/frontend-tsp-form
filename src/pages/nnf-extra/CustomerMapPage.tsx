// แผนที่ลูกค้า (UI_SUMMARY 159 §5, mig 434): every contract's phone at its newest
// fix, to see how customers are spread out. Who sees which pins is the backend's
// one-door rule; the menu shows for anyone with can_view.
//
// One read of fn_mdm_location_map is logged as one look at everyone's location
// (PDPA), so it is read on open and on the refresh button only — never on a
// timer, and the branch filter works on the pins already loaded.
//
// Clicking a pin opens the location window (159) for that contract.

import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, DataTable, MobileHeader, Select, Tooltip } from 'tsp-form';
import { AlertTriangle, ArrowRightFromLine, ExternalLink, Home, Loader2, MapPin, RefreshCw } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency } from '../../lib/format';
import { DeviceLocationDialog } from '../../components/deviceLocation/DeviceLocationDialog';
import { useCustomerMap, useLocationViewCan, type CustomerMapPin } from '../../components/deviceLocation/deviceLocationApi';
import { useLocationWhen } from '../../components/deviceLocation/locationWhen';
import { OVERDUE_COLORS, STALE_FIX_DAYS, isRepoOrLegal, overdueColor } from '../../components/deviceLocation/mapColors';

const CustomerMapCanvas = lazy(() => import('../../components/deviceLocation/CustomerMapCanvas'));

const ALL = 'all';

export function CustomerMapPage() {
  const { t } = useTranslation();
  const when = useLocationWhen();
  const { data: can, isLoading: canLoading } = useLocationViewCan();
  const canView = can?.can_view === true;
  const { data, error, isLoading, isFetching, refetch } = useCustomerMap(canView);

  const [branchId, setBranchId] = useState<string>(ALL);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [dialogFor, setDialogFor] = useState<number | null>(null);
  // Keeps the window's target while it animates closed.
  const [lastDialogFor, setLastDialogFor] = useState<number | null>(null);
  const openDialog = (contractId: number) => { setDialogFor(contractId); setLastDialogFor(contractId); };

  const pins = useMemo(
    () => (data?.pins ?? []).filter((p) => branchId === ALL || String(p.branch.id) === branchId),
    [data, branchId],
  );
  const branch = branchId === ALL ? null : data?.branches.find((b) => String(b.branch_id) === branchId) ?? null;
  const noFix = branch ? branch.no_fix : data?.totals.no_fix ?? 0;

  const mapPins = useMemo(() => pins.map((p) => ({
    id: p.contract.id,
    lat: p.fix.lat,
    lon: p.fix.lon,
    color: overdueColor(p.contract.overdue_days),
    faded: p.fix.when.days_ago > STALE_FIX_DAYS,
    flagged: isRepoOrLegal(p.contract.dunning_status),
    resident: p.residence_status === 'RESIDENT',
    label: `${p.contract.code} · ${p.customer.name ?? '—'} · ${when.at(p.fix.when)} (${when.ago(p.fix.when)})`,
  })), [pins]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchOptions = [
    { value: ALL, label: t('customerMap.allBranches', { count: data?.totals.with_fix ?? 0 }) },
    ...(data?.branches ?? []).map((b) => ({
      value: String(b.branch_id),
      label: t('customerMap.branchOption', { name: b.name, pins: b.pins }),
    })),
  ];

  const refreshButton = (
    <Tooltip content={t('customerMap.refresh')} placement="bottom">
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('customerMap.refresh')}
        startIcon={<RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />}
        disabled={isFetching || !canView}
        onClick={() => void refetch()}
      />
    </Tooltip>
  );

  const notAllowed = (!canLoading && !canView)
    || (error instanceof ApiError && error.code === 'MDM.AUTH.LOCATION_VIEW_NOT_GRANTED');

  return (
    <div className="flex flex-col h-dvh overflow-hidden">
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">{t('customerMap.title')}</div>
        <div className="mobile-header-end">{refreshButton}</div>
      </MobileHeader>

      <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-3 flex-wrap">
        <h1 className="heading-2 shrink-0 max-md:hidden">{t('customerMap.title')}</h1>
        <div className="w-full sm:w-72">
          <Select
            value={branchId}
            onChange={(v) => { setBranchId((v as string) || ALL); setSelectedId(null); }}
            options={branchOptions}
            searchable={(data?.branches.length ?? 0) > 8}
            size="sm"
          />
        </div>
        {data && (
          <div className="text-sm text-subtle flex items-center gap-x-3 gap-y-0.5 flex-wrap" data-testid="customer-map-totals">
            <span><span className="font-medium text-fg">{pins.length}</span> {t('customerMap.withFix')}</span>
            <span><span className="font-medium text-fg">{noFix}</span> {t('customerMap.noFix')}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-3 max-md:hidden">
          <Legend />
          {refreshButton}
        </div>
      </div>

      {notAllowed ? (
        <div className="p-4"><div className="alert alert-warning"><AlertTriangle size={16} /><span>{t('deviceLocation.error.notGranted')}</span></div></div>
      ) : error ? (
        <div className="p-4"><div className="alert alert-danger"><AlertTriangle size={16} /><span>{translateApiError(error, t)}</span></div></div>
      ) : isLoading || canLoading || !data ? (
        <div className="py-10 flex justify-center text-subtler"><Loader2 size={20} className="animate-spin" /></div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* On a phone the map comes first. */}
          <div className="lg:order-2 flex-none h-[45dvh] lg:h-auto lg:flex-1 min-w-0 relative">
            <Suspense fallback={<div className="h-full" />}>
              <CustomerMapCanvas
                className="h-full w-full"
                pins={mapPins}
                selectedId={selectedId}
                focusTick={focusTick}
                onPinClick={(id) => { setSelectedId(id); openDialog(id); }}
              />
            </Suspense>
          </div>
          <div className="lg:order-1 flex-1 lg:flex-none lg:w-[26rem] min-h-0 flex flex-col border-t lg:border-t-0 lg:border-r border-line">
            <div className="md:hidden px-3 py-2 border-b border-line"><Legend /></div>
            {pins.length === 0 ? (
              <div className="py-10 text-center text-sm text-subtle">{t('customerMap.empty')}</div>
            ) : (
            <DataTable<CustomerMapPin>
              data={pins}
              renderRow={(row) => (
                <PinRow
                  pin={row.original}
                  onPick={() => { setSelectedId(row.original.contract.id); setFocusTick((n) => n + 1); }}
                  onOpen={() => openDialog(row.original.contract.id)}
                />
              )}
              getRowProps={(row) => ({ 'data-state': row.original.contract.id === selectedId ? 'selected' : undefined })}
              enableKeyboardNav
              onRowActivate={(row) => { setSelectedId(row.original.contract.id); setFocusTick((n) => n + 1); }}
              className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60' : ''} transition-opacity`}
            />
            )}
          </div>
        </div>
      )}

      <DeviceLocationDialog
        open={dialogFor != null}
        target={{ contractId: dialogFor ?? lastDialogFor }}
        onClose={() => setDialogFor(null)}
      />
    </div>
  );
}

function PinRow({ pin, onPick, onOpen }: { pin: CustomerMapPin; onPick: () => void; onOpen: () => void }) {
  const { t } = useTranslation();
  const when = useLocationWhen();
  const { contract, customer, device, fix } = pin;
  const flagged = isRepoOrLegal(contract.dunning_status);
  return (
    <div className="px-3 py-2 flex gap-2 cursor-pointer" onClick={onPick}>
      <span className="mt-1.5 inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: overdueColor(contract.overdue_days) }} aria-hidden />
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/admin/contracts/search/${contract.id}`}
            target="_blank"
            className="font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {contract.code}<ExternalLink size={12} />
          </Link>
          <span className="text-xs text-subtle truncate">{pin.branch.name}</span>
        </div>
        <div className="text-sm truncate">
          {customer.name ?? '—'}
          {customer.tel && <span className="text-subtle"> · {customer.tel}</span>}
        </div>
        <div className="text-xs text-subtle truncate">
          {device.asset_code}{device.product_display_name ? ` · ${device.product_display_name}` : ''}
        </div>
        <div className="text-xs text-subtle">
          {when.at(fix.when)} · <span className={fix.when.days_ago > STALE_FIX_DAYS ? 'text-warning-fg' : ''}>{when.ago(fix.when)}</span>
          {' · '}{t('customerMap.fixesTotal', { n: pin.fixes_total })}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          {contract.overdue_days > 0 ? (
            <Badge size="xs" color={contract.overdue_days >= 7 ? 'danger' : 'warning'}>
              {t('customerMap.overdue', { days: contract.overdue_days, amount: fmtCurrency(contract.overdue_amount) })}
            </Badge>
          ) : (
            <Badge size="xs" color="success">{t('customerMap.notOverdue')}</Badge>
          )}
          {contract.dunning_status && (
            <Badge size="xs" color={flagged ? 'default' : 'info'} className={flagged ? 'font-semibold' : ''}>
              {t(`callCenter.dunningStatus.${contract.dunning_status}`, { defaultValue: contract.dunning_status })}
            </Badge>
          )}
          {pin.residence_status === 'RESIDENT' && (
            <Badge size="xs" color="success">
              <span className="inline-flex items-center gap-0.5"><Home size={11} />{t('customerMap.resident')}</span>
            </Badge>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        startIcon={<MapPin size={14} />}
        className="self-start shrink-0"
        data-action="DEVICE_LOCATION_VIEW"
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
      >
        {t('deviceLocation.button')}
      </Button>
    </div>
  );
}

/** What the pin colours and marks mean. */
function Legend() {
  const { t } = useTranslation();
  const dot = (color: string) => <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} aria-hidden />;
  return (
    <div className="text-xs text-subtle flex items-center gap-x-3 gap-y-1 flex-wrap">
      <span className="inline-flex items-center gap-1">{dot(OVERDUE_COLORS.none)}{t('customerMap.legend.none')}</span>
      <span className="inline-flex items-center gap-1">{dot(OVERDUE_COLORS.some)}{t('customerMap.legend.some')}</span>
      <span className="inline-flex items-center gap-1">{dot(OVERDUE_COLORS.late)}{t('customerMap.legend.late')}</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full border-[3px] border-[#111827] bg-white" aria-hidden />{t('customerMap.legend.repo')}</span>
      <span className="inline-flex items-center gap-1"><Home size={12} />{t('customerMap.legend.resident')}</span>
      <span className="inline-flex items-center gap-1 opacity-60">{dot('#6b7280')}{t('customerMap.legend.stale', { days: STALE_FIX_DAYS })}</span>
    </div>
  );
}
