// แผนที่ลูกค้า (UI_SUMMARY 159 §5, mig 434): every contract's phone at its newest
// fix, to see how customers are spread out. Who sees which pins is the backend's
// one-door rule; the menu shows for anyone with can_view.
//
// One read of fn_mdm_location_map is logged as one look at those pins (PDPA), so
// it is read only when the days, the branch or a submitted keyword change, and on
// the refresh button — never on a timer, never per keystroke (nnf-mdm mig 462).
// The days, branch and keyword all go to the RPC; nothing is filtered here. Over
// pin_limit the RPC sends no pins (too_many) and the screen asks to narrow down.
//
// Clicking a pin opens the location window (159) for that contract.

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, DataTable, Input, MobileHeader, Select, Tooltip } from 'tsp-form';
import { AlertTriangle, ArrowRightFromLine, ExternalLink, Home, Loader2, MapPin, RefreshCw, Search, SearchCheck, X } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency } from '../../lib/format';
import { DeviceLocationDialog } from '../../components/deviceLocation/DeviceLocationDialog';
import {
  useCustomerMap, useLocationViewCan,
  type CustomerMap, type CustomerMapBranch, type CustomerMapPin,
} from '../../components/deviceLocation/deviceLocationApi';
import { useLocationWhen } from '../../components/deviceLocation/locationWhen';
import { OVERDUE_COLORS, STALE_FIX_DAYS, isRepoOrLegal, overdueColor } from '../../components/deviceLocation/mapColors';

const CustomerMapCanvas = lazy(() => import('../../components/deviceLocation/CustomerMapCanvas'));

const ALL = 'all';
/** Day choices (0 = every contract); 7–42 are the dunning-queue lane edges. */
const DAY_CHOICES = [0, 3, 7, 14, 28, 42];

export function CustomerMapPage() {
  const { t } = useTranslation();
  const when = useLocationWhen();
  const { data: can, isLoading: canLoading } = useLocationViewCan();
  const canView = can?.can_view === true;

  // null days = not sent: the DB picks max(permission, 3).
  const [days, setDays] = useState<number | null>(null);
  const [branchId, setBranchId] = useState<string>(ALL);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState<string | null>(null);
  const [keywordTooShort, setKeywordTooShort] = useState(false);
  const { data, error, isLoading, isFetching, refetch } = useCustomerMap(canView, {
    days, branchId: branchId === ALL ? null : Number(branchId), keyword,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [dialogFor, setDialogFor] = useState<number | null>(null);
  // Keeps the window's target while it animates closed.
  const [lastDialogFor, setLastDialogFor] = useState<number | null>(null);
  const openDialog = (contractId: number) => { setDialogFor(contractId); setLastDialogFor(contractId); };

  // The branch list comes from the last read without a branch (a read for one
  // branch lists only that branch), so the other branches stay pickable.
  const [branchList, setBranchList] = useState<{ branches: CustomerMapBranch[]; withFix: number } | null>(null);
  useEffect(() => {
    if (data && data.scope.branch_id == null) setBranchList({ branches: data.branches, withFix: data.totals.with_fix });
  }, [data]);

  // A search that finds one contract picks it (the map zooms to it on its own).
  useEffect(() => {
    setSelectedId(data?.scope.keyword && data.pins.length === 1 ? data.pins[0].contract.id : null);
  }, [data]);

  const pins = data?.pins ?? [];

  const submitKeyword = () => {
    const kw = keywordInput.trim();
    if (kw.length === 1) { setKeywordTooShort(true); return; }
    setKeywordTooShort(false);
    setKeyword(kw || null);
  };
  const clearKeyword = () => { setKeywordInput(''); setKeyword(null); setKeywordTooShort(false); };

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
    { value: ALL, label: t('customerMap.allBranches', { count: branchList?.withFix ?? 0 }) },
    ...(branchList?.branches ?? []).map((b) => ({
      value: String(b.branch_id),
      label: t('customerMap.branchOption', { name: b.name, pins: b.pins }),
    })),
  ];

  // Choices under the viewer's floor can't be picked (the RPC would lift them);
  // "every contract" shows only when the floor is 0. The label is the days the
  // RPC actually used.
  const floor = data?.scope.permission_min_overdue_days ?? 0;
  const usedDays = data?.scope.min_overdue_days ?? null;
  const daysLabel = (n: number) => (n === 0 ? t('customerMap.daysAll') : t('customerMap.daysOption', { n }));
  const dayChoices = [...new Set([...DAY_CHOICES, ...(usedDays != null ? [usedDays] : [])])]
    .filter((n) => n > 0 || floor === 0)
    .sort((a, b) => a - b);
  const dayOptions = dayChoices.map((n) => ({ value: String(n), label: daysLabel(n), disabled: n < floor }));
  const pickDays = (n: number) => { setDays(n); setSelectedId(null); };
  const pickBranch = (v: string) => { setBranchId(v || ALL); setSelectedId(null); };

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
        <div className="w-full sm:w-64">
          <Select
            value={branchId}
            onChange={(v) => pickBranch(v as string)}
            options={branchOptions}
            searchable={(branchList?.branches.length ?? 0) > 8}
            size="sm"
          />
        </div>
        <div className="w-[calc(50%-0.375rem)] sm:w-40" data-testid="customer-map-days">
          <Select
            value={usedDays != null ? String(usedDays) : ''}
            onChange={(v) => { if (v !== '' && v != null) pickDays(Number(v)); }}
            options={dayOptions}
            disabled={!data}
            size="sm"
          />
        </div>
        {/* Sent on Enter only — every read is logged as a look at the pins. */}
        <div className="w-[calc(50%-0.375rem)] sm:w-72" data-testid="customer-map-search">
          <Input
            size="sm"
            className="w-full"
            value={keywordInput}
            placeholder={t('customerMap.searchPlaceholder')}
            enterKeyHint="search"
            onChange={(e) => { setKeywordInput(e.target.value); setKeywordTooShort(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitKeyword(); }
              if (e.key === 'Escape' && (keywordInput || keyword)) { e.preventDefault(); clearKeyword(); }
            }}
            startIcon={<Search size={14} />}
            onStartIconClick={submitKeyword}
            endIcon={keywordInput || keyword ? <X size={14} aria-label={t('customerMap.searchClear')} /> : undefined}
            onEndIconClick={clearKeyword}
            reserveIconSlots
            error={keywordTooShort}
          />
        </div>
        {data && !data.too_many && (
          <div className="text-sm text-subtle flex items-center gap-x-3 gap-y-0.5 flex-wrap" data-testid="customer-map-totals">
            <span><span className="font-medium text-fg">{data.totals.with_fix}</span> {t('customerMap.withFix')}</span>
            <span><span className="font-medium text-fg">{data.totals.no_fix}</span> {t('customerMap.noFix')}</span>
          </div>
        )}
        {keywordTooShort && <div className="w-full text-xs text-danger-fg">{t('customerMap.searchTooShort')}</div>}
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
      ) : data.too_many ? (
        <TooMany data={data} busy={isFetching} onPickBranch={(id) => pickBranch(String(id))} />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* On a phone the map comes first. */}
          <div className="lg:order-2 flex-none h-[45dvh] lg:h-auto lg:flex-1 min-w-0 flex flex-col">
            <div className="flex-1 min-h-0 relative">
              <Suspense fallback={<div className="h-full" />}>
                <CustomerMapCanvas
                  className="h-full w-full"
                  pins={mapPins}
                  selectedId={selectedId}
                  focusTick={focusTick}
                  onPinClick={(id) => { setSelectedId(id); openDialog(id); }}
                  showAllLabel={t('deviceLocation.showAll')}
                />
              </Suspense>
            </div>
            <MapFooter pin={pins.find((p) => p.contract.id === selectedId) ?? null} />
          </div>
          <div className="lg:order-1 flex-1 lg:flex-none lg:w-[26rem] min-h-0 flex flex-col border-t lg:border-t-0 lg:border-r border-line">
            <div className="md:hidden px-3 py-2 border-b border-line"><Legend /></div>
            {data.totals.below_min_days > 0 && floor < data.scope.min_overdue_days && (
              <div className="px-3 py-2 border-b border-line text-sm flex items-center gap-2 flex-wrap" data-testid="customer-map-below">
                <span className="text-subtle">{t('customerMap.belowMin', { count: data.totals.below_min_days, days: data.scope.min_overdue_days })}</span>
                <Button size="xs" variant="outline" disabled={isFetching} onClick={() => pickDays(floor)}>
                  {t('customerMap.showDays', { label: daysLabel(floor) })}
                </Button>
              </div>
            )}
            {pins.length === 0 ? (
              <div className="py-10 px-4 text-center text-sm text-subtle" data-testid="customer-map-empty">
                {data.scope.keyword
                  ? (data.scope.min_overdue_days > 0
                    ? t('customerMap.emptyKeywordDays', { keyword: data.scope.keyword, days: data.scope.min_overdue_days })
                    : t('customerMap.emptyKeyword', { keyword: data.scope.keyword }))
                  : (data.scope.min_overdue_days > 0
                    ? t('customerMap.emptyDays', { days: data.scope.min_overdue_days })
                    : t('customerMap.empty'))}
              </div>
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
          {pin.match && (
            <Badge size="xs" color="info" data-match={pin.match.reason}>
              <span className="inline-flex items-center gap-0.5">
                <SearchCheck size={11} />{t(`customerMap.match.${pin.match.reason}`, { defaultValue: pin.match.reason })}
              </span>
            </Badge>
          )}
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

/** Over pin_limit the RPC sends no pins, only counts: say how many, how to narrow
 *  it down, and offer the branches (most pins first) as one-press picks. */
function TooMany({ data, busy, onPickBranch }: { data: CustomerMap; busy: boolean; onPickBranch: (id: number) => void }) {
  const { t } = useTranslation();
  const branches = [...data.branches].filter((b) => b.pins > 0).sort((a, b) => b.pins - a.pins);
  return (
    <div className="flex-1 min-h-0 overflow-auto p-4" data-testid="customer-map-too-many">
      <div className="max-w-2xl mx-auto flex flex-col gap-3">
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{t('customerMap.tooMany', { count: data.totals.with_fix, limit: data.pin_limit })}</span>
            <span className="text-sm">{t('customerMap.tooManyHint')}</span>
          </div>
        </div>
        {branches.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-sm text-subtle">{t('customerMap.pickBranch')}</span>
            <div className="flex flex-wrap gap-1.5">
              {branches.map((b) => (
                <Button key={b.branch_id} size="sm" variant="outline" disabled={busy} onClick={() => onPickBranch(b.branch_id)}>
                  {t('customerMap.branchOption', { name: b.name, pins: b.pins })}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Under the map: the chosen contract's newest fix, with its Google Maps link. */
function MapFooter({ pin }: { pin: CustomerMapPin | null }) {
  const { t } = useTranslation();
  const when = useLocationWhen();
  return (
    <div className="shrink-0 min-h-10 px-3 py-2 border-t border-line flex items-center gap-x-3 gap-y-1 flex-wrap text-sm" data-testid="customer-map-footer">
      {pin ? (
        <>
          <span className="font-medium">{pin.contract.code}</span>
          <span className="text-subtle truncate">{pin.customer.name ?? '—'}</span>
          <span className="text-xs text-subtle">{when.at(pin.fix.when)} · {when.ago(pin.fix.when)}</span>
          <span className="text-xs text-subtle font-mono">{pin.fix.lat}, {pin.fix.lon}</span>
          <a
            href={pin.fix.map_url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-primary-fg hover:underline inline-flex items-center gap-1 shrink-0"
            data-testid="customer-map-google"
          >
            {t('deviceLocation.openGoogleMaps')}<ExternalLink size={12} />
          </a>
        </>
      ) : (
        <span className="text-xs text-subtle">{t('customerMap.pickHint')}</span>
      )}
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
