import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  MobileHeader, Select, Button, Badge, InputDateRangePicker,
  DataTable, DataTableColumnHeader, type ColumnDef,
} from 'tsp-form';
import {
  ArrowRightFromLine, PackagePlus, Download, Printer, Keyboard,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { toLocalDateStr, parseLocalDate, makeDateRangePickerFormat } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { printWithMarker } from '../../lib/printDoc';
import { ContractableToggle, type Contractable } from './ContractableToggle';
import { LotIntakeByModelSheet, type ModelSheetRow } from './LotIntakeByModelSheet';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานเครื่องเข้าตามรุ่น — goods received into LOTs, one row per model, with
 * the three intake channels (ซื้อจาก supplier / ซื้อคืนจากลูกค้า / ปรับเพิ่ม-ยกมา)
 * broken out into their own columns. A table rather than a chart: there are
 * many models and the point is reading the per-channel numbers side by side.
 * Data: POST /rpc/fn_lot_intake_by_model — only models with activity in the
 * window, already in model_rank order (net desc); never re-sorted here.
 * receive_pct / net_qty are DB-computed, and receive_qty already equals the
 * three channels summed — the totals row here only adds up what's on screen.
 * Same counting rules as "รายงานเครื่องเข้า", so both screens always agree.
 * A BUYBACK stays labelled BUYBACK even when it rides the same PO flow as a
 * purchase. Scope is JWT-bound; the pickers only narrow inside what the JWT
 * already permits.
 * Spec: UI_FEEDBACK/2026-08-19_IMPLEMENT_report_lot_intake_by_model.md
 * ─────────────────────────────────────────────────────────────────────────── */

interface ModelRow {
  model_id: number;
  brand_name: string;
  model_name: string;
  is_contractable: boolean;
  model_rank: number;
  purchase_qty: number;
  buyback_qty: number;
  stock_gain_qty: number;
  receive_qty: number;
  receive_pct: number;
  correction_qty: number;
  net_qty: number;
}

interface Branch { id: number; name: string; company_id: number }
interface Company { id: number; name: string }

const CHANNELS = ['PURCHASE', 'BUYBACK', 'STOCK_GAIN'] as const;

function monthStartIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function parseDate8(digits: string): Date | null {
  if (digits.length !== 8) return null;
  const day = parseInt(digits.slice(0, 2), 10);
  const month = parseInt(digits.slice(2, 4), 10);
  let year = parseInt(digits.slice(4, 8), 10);
  if (year > 2400) year -= 543;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function LotIntakeByModelReportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isHoldingScope = !user?.company_id && !user?.branch_id;
  const isCompanyScope = !!user?.company_id && !user?.branch_id;

  const now = new Date();
  const [fromDate, setFromDate] = useState(monthStartIso(now));
  const [toDate, setToDate] = useState(toLocalDateStr(now));
  const [companyId, setCompanyId] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');
  const [channel, setChannel] = useState<string>('');
  const [contractable, setContractable] = useState<Contractable>(null);
  const [isTypingRange, setIsTypingRange] = useState(false);
  const [printRows, setPrintRows] = useState<ModelSheetRow[] | null>(null);

  // HOLDING scope may pick a company; the branch list follows that choice.
  const { data: companies = [] } = useQuery({
    queryKey: ['companies-active'],
    queryFn: () => apiClient.get<Company[]>('/v_companies?select=id,name&order=name'),
    enabled: isHoldingScope,
  });

  const branchScopeParam = companyId
    ? `?company_id=eq.${companyId}&is_active=is.true&order=name`
    : '?is_active=is.true&order=name';
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active', companyId || 'all'],
    queryFn: () => apiClient.get<Branch[]>(`/v_branches${branchScopeParam}`),
    enabled: isHoldingScope || isCompanyScope,
  });

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['lot-intake-by-model', fromDate, toDate, companyId, branchId, channel, contractable],
    queryFn: () => apiClient.rpc<ModelRow[]>('fn_lot_intake_by_model', {
      p_date_from: fromDate || null,
      p_date_to: toDate || null,
      p_branch_id: branchId ? Number(branchId) : null,
      p_company_id: companyId ? Number(companyId) : null,
      p_channel: channel || null,
      p_contractable: contractable,
    }),
  });

  const totals = useMemo(() => rows.reduce(
    (acc, r) => {
      acc.purchase_qty += r.purchase_qty;
      acc.buyback_qty += r.buyback_qty;
      acc.stock_gain_qty += r.stock_gain_qty;
      acc.receive_qty += r.receive_qty;
      acc.correction_qty += r.correction_qty;
      acc.net_qty += r.net_qty;
      return acc;
    },
    { purchase_qty: 0, buyback_qty: 0, stock_gain_qty: 0, receive_qty: 0, correction_qty: 0, net_qty: 0 },
  ), [rows]);

  const hasData = rows.length > 0;

  const selectedBranch = branches.find((b) => String(b.id) === branchId);
  const selectedCompany = companies.find((c) => String(c.id) === companyId);
  const scopeLabel = selectedBranch?.name ?? selectedCompany?.name ?? t('lotIntake.allBranches');
  const kindLabel = contractable === null
    ? t('lotIntake.kindAll')
    : contractable ? t('lotIntake.kindDevice') : t('lotIntake.kindRetail');
  const channelLabel = channel ? t(`lotIntake.channel.${channel}`) : t('lotIntake.allChannels');
  const reportSubtitle = `${scopeLabel} · ${fromDate} — ${toDate} · ${kindLabel} · ${channelLabel}`;

  const companyOptions = companies.map((c) => ({ value: String(c.id), label: c.name }));
  const branchOptions = branches.map((b) => ({ value: String(b.id), label: b.name }));
  const channelOptions = useMemo(
    () => CHANNELS.map((c) => ({ value: c, label: t(`lotIntake.channel.${c}`) })),
    [t],
  );

  // The kind badge only earns its place in the "all" view — inside a filtered
  // view every row is the same kind and the column is dead weight.
  const showKind = contractable === null;

  const columns = useMemo<ColumnDef<ModelRow>[]>(() => [
    {
      accessorKey: 'model_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('lotIntakeByModel.col.model')} />,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{row.original.model_name}</div>
          <div className="text-xs text-subtle truncate">{row.original.brand_name}</div>
        </div>
      ),
    },
    ...(showKind ? [{
      id: 'kind',
      header: () => <span className="text-xs">{t('lotIntakeByModel.col.kind')}</span>,
      cell: ({ row }) => (
        <Badge color={row.original.is_contractable ? 'primary' : 'default'} size="sm">
          {row.original.is_contractable ? t('lotIntake.kindDevice') : t('lotIntake.kindRetail')}
        </Badge>
      ),
      enableSorting: false,
      className: 'w-28',
    } as ColumnDef<ModelRow>] : []),
    {
      accessorKey: 'purchase_qty',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('lotIntake.channel.PURCHASE')} />,
      cell: ({ row }) => <NumCell value={row.original.purchase_qty} />,
      className: 'w-28',
    },
    {
      accessorKey: 'buyback_qty',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('lotIntake.channel.BUYBACK')} />,
      cell: ({ row }) => <NumCell value={row.original.buyback_qty} />,
      className: 'w-28',
    },
    {
      accessorKey: 'stock_gain_qty',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('lotIntake.channel.STOCK_GAIN')} />,
      cell: ({ row }) => <NumCell value={row.original.stock_gain_qty} />,
      className: 'w-28',
    },
    {
      accessorKey: 'receive_qty',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('lotIntake.col.receiveQty')} />,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.receive_qty}
          <span className="text-subtler text-xs"> ({row.original.receive_pct}%)</span>
        </span>
      ),
      className: 'w-32',
    },
    {
      accessorKey: 'correction_qty',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('lotIntake.col.correctionQty')} />,
      cell: ({ row }) => <NumCell value={row.original.correction_qty} />,
      className: 'w-24 max-md:hidden',
    },
    {
      accessorKey: 'net_qty',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('lotIntake.col.netQty')} />,
      cell: ({ row }) => <span className="text-sm tabular-nums font-semibold">{row.original.net_qty}</span>,
      className: 'w-24',
    },
  ], [t, showKind]);

  // ── CSV export — one row per model, field order per the ticket. ───────────
  const handleExportCsv = useCallback(() => {
    if (rows.length === 0) return;
    const csvRows = rows.map((r) => ({
      brand_name: r.brand_name,
      model_name: r.model_name,
      is_contractable: r.is_contractable ? t('lotIntake.kindDevice') : t('lotIntake.kindRetail'),
      purchase_qty: r.purchase_qty,
      buyback_qty: r.buyback_qty,
      stock_gain_qty: r.stock_gain_qty,
      receive_qty: r.receive_qty,
      receive_pct: r.receive_pct,
      correction_qty: r.correction_qty,
      net_qty: r.net_qty,
    }));
    const columnDefs = [
      { key: 'brand_name', label: t('lotIntakeByModel.col.brand') },
      { key: 'model_name', label: t('lotIntakeByModel.col.model') },
      { key: 'is_contractable', label: t('lotIntakeByModel.col.kind') },
      { key: 'purchase_qty', label: t('lotIntake.channel.PURCHASE') },
      { key: 'buyback_qty', label: t('lotIntake.channel.BUYBACK') },
      { key: 'stock_gain_qty', label: t('lotIntake.channel.STOCK_GAIN') },
      { key: 'receive_qty', label: t('lotIntake.col.receiveQty') },
      { key: 'receive_pct', label: t('lotIntakeByModel.col.receivePct') },
      { key: 'correction_qty', label: t('lotIntake.col.correctionQty') },
      { key: 'net_qty', label: t('lotIntake.col.netQty') },
    ];
    downloadCsv(csvRows, columnDefs, `lot-intake-by-model_${fromDate}_${toDate}.csv`);
  }, [rows, fromDate, toDate, t]);

  const handlePrint = useCallback(() => {
    setPrintRows(rows.map((r) => ({
      model_id: r.model_id,
      brand_name: r.brand_name,
      model_name: r.model_name,
      is_contractable: r.is_contractable,
      purchase_qty: r.purchase_qty,
      buyback_qty: r.buyback_qty,
      stock_gain_qty: r.stock_gain_qty,
      receive_qty: r.receive_qty,
      receive_pct: r.receive_pct,
      correction_qty: r.correction_qty,
      net_qty: r.net_qty,
    })));
    const styleEl = document.createElement('style');
    styleEl.id = 'retail-report-print-page';
    styleEl.textContent = '@media print { @page { size: A4 landscape; margin: 12mm; } }';
    document.head.appendChild(styleEl);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        printWithMarker('retail-report');
      } finally {
        styleEl.remove();
        setPrintRows(null);
      }
    }));
  }, [rows]);

  const dateRangePicker = (
    <InputDateRangePicker
      fromDate={parseLocalDate(fromDate)}
      toDate={parseLocalDate(toDate)}
      onFromDateChange={(d) => setFromDate(toLocalDateStr(d))}
      onToDateChange={(d) => setToDate(toLocalDateStr(d))}
      dateFormat={makeDateRangePickerFormat(i18n.language)}
      size="sm"
      locale={i18n.language}
      calendar="gregorian"
      endIcon={<Keyboard size={14} />}
      onEndIconClick={() => setIsTypingRange((v) => !v)}
      typingMode={isTypingRange}
      onTypingModeChange={setIsTypingRange}
      typingMask="##/##/#### - ##/##/####"
      typingPlaceholder="DD/MM/YYYY - DD/MM/YYYY"
      parseTypedDates={(raw) => ({
        from: parseDate8(raw.slice(0, 8)),
        to: raw.length >= 16 ? parseDate8(raw.slice(8, 16)) : null,
      })}
    />
  );

  const companyPicker = isHoldingScope && (
    <Select
      options={companyOptions}
      value={companyId || null}
      onChange={(v) => { setCompanyId((v as string) ?? ''); setBranchId(''); }}
      placeholder={t('lotIntakeByModel.allCompanies')}
      size="sm"
      clearable
      showChevron
    />
  );

  const branchPicker = (isHoldingScope || isCompanyScope) && (
    <Select
      options={branchOptions}
      value={branchId || null}
      onChange={(v) => setBranchId((v as string) ?? '')}
      placeholder={t('lotIntake.allBranches')}
      size="sm"
      clearable
      showChevron
    />
  );

  const channelPicker = (
    <Select
      options={channelOptions}
      value={channel || null}
      onChange={(v) => setChannel((v as string) ?? '')}
      placeholder={t('lotIntake.allChannels')}
      size="sm"
      clearable
      showChevron
    />
  );

  const kindToggle = <ContractableToggle value={contractable} onChange={setContractable} />;

  const actions = (
    <>
      <Button variant="outline" size="sm" startIcon={<Download size={16} />} onClick={handleExportCsv} disabled={!hasData}>
        {t('lotIntake.exportCsv')}
      </Button>
      <Button variant="outline" size="sm" startIcon={<Printer size={16} />} onClick={handlePrint} disabled={!hasData}>
        {t('common.print')}
      </Button>
    </>
  );

  const emptyState = (
    <div className="p-8 flex flex-col items-center justify-center gap-2 text-subtler">
      <PackagePlus size={28} strokeWidth={1.5} />
      <span className="text-sm">{t('lotIntake.noData')}</span>
    </div>
  );

  return (
    <div className="flex flex-col h-dvh">
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
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('lotIntakeByModel.title')}
        </div>
        <div className="mobile-header-end w-nav">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current disabled:opacity-40"
            aria-label={t('lotIntake.exportCsv')}
            onClick={handleExportCsv}
            disabled={!hasData}
          >
            <Download size={18} />
          </button>
        </div>
      </MobileHeader>

      {/* Desktop header — title + pickers + actions */}
      <div className="flex-none px-4 py-2.5 border-b border-line flex flex-col gap-2 max-md:hidden">
        <h1 className="heading-2 whitespace-nowrap">{t('lotIntakeByModel.title')}</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div style={{ width: '17rem' }}>{dateRangePicker}</div>
          {kindToggle}
          <div style={{ width: '11rem' }}>{channelPicker}</div>
          {companyPicker && <div style={{ width: '11rem' }}>{companyPicker}</div>}
          {branchPicker && <div style={{ width: '11rem' }}>{branchPicker}</div>}
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </div>
      </div>

      {/* Mobile pickers */}
      <div className="flex-none p-2 border-b border-line flex flex-col gap-2 md:hidden">
        <div className="w-full">{dateRangePicker}</div>
        <div className="flex items-center gap-2">
          {kindToggle}
          <div className="flex-1 min-w-0">{channelPicker}</div>
        </div>
        <div className="flex items-center gap-2">
          {companyPicker && <div className="flex-1 min-w-0">{companyPicker}</div>}
          {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex-none flex items-stretch divide-x divide-line border-b border-line">
        <SummaryCell label={t('lotIntake.channel.PURCHASE')} value={String(totals.purchase_qty)} />
        <SummaryCell label={t('lotIntake.channel.BUYBACK')} value={String(totals.buyback_qty)} />
        <SummaryCell label={t('lotIntake.channel.STOCK_GAIN')} value={String(totals.stock_gain_qty)} />
        <SummaryCell label={t('lotIntake.sumReceiveQty')} value={String(totals.receive_qty)} />
        <SummaryCell label={t('lotIntake.sumNetQty')} value={String(totals.net_qty)} />
      </div>

      {/* Desktop table. The RPC returns the whole ranked list for the window
          (no server paging), so every row renders and the summary strip adds
          up exactly what's on screen. */}
      <DataTable<ModelRow>
        data={rows}
        columns={columns}
        className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
        noResults={emptyState}
      />

      {/* Mobile cards */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll md:hidden pb-8 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {rows.length === 0 ? emptyState : (
          <div className="flex flex-col divide-y divide-line border-b border-line">
            {rows.map((r) => (
              <div key={r.model_id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{r.model_name}</div>
                    <div className="text-xs text-subtle truncate">{r.brand_name}</div>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums font-semibold">
                    {r.net_qty}
                    <span className="text-subtler text-xs font-normal"> ({r.receive_pct}%)</span>
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs text-subtle tabular-nums">
                  {showKind && (
                    <Badge color={r.is_contractable ? 'primary' : 'default'} size="sm">
                      {r.is_contractable ? t('lotIntake.kindDevice') : t('lotIntake.kindRetail')}
                    </Badge>
                  )}
                  {r.purchase_qty > 0 && <span>{t('lotIntake.channel.PURCHASE')} {r.purchase_qty}</span>}
                  {r.buyback_qty > 0 && <span>{t('lotIntake.channel.BUYBACK')} {r.buyback_qty}</span>}
                  {r.stock_gain_qty > 0 && <span>{t('lotIntake.channel.STOCK_GAIN')} {r.stock_gain_qty}</span>}
                  {r.correction_qty > 0 && (
                    <span className="text-danger-fg">{t('lotIntake.col.correctionQty')} {r.correction_qty}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Off-screen print portal — mounted only during the print flow. */}
      {printRows && createPortal(
        <div className="print-only-retail-report" aria-hidden>
          <LotIntakeByModelSheet
            title={t('lotIntakeByModel.title')}
            subtitle={reportSubtitle}
            rows={printRows}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}

function NumCell({ value }: { value: number }) {
  return <span className={`text-sm tabular-nums ${value === 0 ? 'text-subtler' : ''}`}>{value}</span>;
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 px-4 py-2.5 min-w-0">
      <div className="text-xs text-subtle truncate">{label}</div>
      <div className="text-lg font-semibold tabular-nums truncate">{value}</div>
    </div>
  );
}
