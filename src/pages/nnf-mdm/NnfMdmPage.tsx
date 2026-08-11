// NNF MDM — MDM device anomaly report (NNF Extra > NNF MDM). Pull-based by
// design: no notifications ever; the system states facts, the reader judges.
// Two tabs:
//   ① ผิดปกติ (default)            — devices under contract we must chase
//                                    (custody CARE), multi-badge per row via
//                                    anomaly_codes (same pattern as NNF App)
//   ② เครื่องเงียบ (ในมือลูกค้า)     — devices out with customers (or on loan)
//                                    that stopped reporting in. Silence HERE is
//                                    the risk signal. Filter is `in.(...)`, not
//                                    `not.in.(...)` — the original spec had the
//                                    direction backwards and the tab showed
//                                    stock/repair devices, where silence is
//                                    normal, so the at-risk group never
//                                    appeared. (FIX 2026-08-08.)
//
// Hard rules (UI_SUMMARY/132_ANOMALY_REPORT.md "Common Mistakes"):
// - No self-invented severity colors / red dots. Prominence = badge count per
//   row (already sorted first) + bold overdue-days. Nothing else.
// - Never compute signals client-side — anomaly_codes IS the answer.
// - Never re-filter by scope client-side — the JWT scopes the endpoint; each
//   caller seeing different totals is correct.
// - SIM_REMOVED rows must always show the last phone/carrier (that's the
//   number collections will call) — never hide it.
// - 0 rows = positive empty state, not an error.
// Backend: migs 915/928/930/931.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { MobileHeader, Badge, Button, DataTableFooter } from 'tsp-form';
import { ArrowRightFromLine, RefreshCw, CheckCircle2, ExternalLink, Copy, Check } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { formatTel } from '../../lib/format';
import { getBucketLabel, getBucketColor } from '../inventory/inventoryUtils';

const PAGE_SIZE = 50;

// ── Row types (api.v_mdm_device_anomaly / api.v_mdm_device_silent, mig 931/930) ──

export type MdmAnomalyCode = 'SIM_REMOVED' | 'SILENT' | 'NO_SIM_EVER' | string;

interface MdmAnomalyRow {
  serial_number: string;
  asset_id: number;
  asset_code: string | null;
  current_bucket: string;
  /** All badges for the row, already ordered by importance. Future signals
   *  arrive as new codes here — render them with a defaultValue fallback. */
  anomaly_codes: MdmAnomalyCode[];
  primary_anomaly: MdmAnomalyCode;
  anomaly_count: number;
  silent_days: number | null;
  last_seen_at: string | null;
  sim_last_phone: string | null;
  sim_last_carrier: string | null;
  sim_removed_at: string | null;
  sim_confirmed_at: string | null;
  contract_id: number | null;
  contract_code: string | null;
  contract_state: string | null;
  overdue_days: number | null;
  branch_name: string | null;
}

interface MdmSilentRow {
  serial_number: string;
  asset_id: number;
  asset_code: string | null;
  current_bucket: string;
  last_seen_at: string | null;
  silent_days: number;
  contract_id: number | null;
  contract_code: string | null;
  contract_state: string | null;
  overdue_days: number | null;
  branch_name: string | null;
}

type Tab = 'anomaly' | 'silent';

export function NnfMdmPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isCompanyUser = !user?.branch_id; // company users span branches
  const [tab, setTab] = useState<Tab>('anomaly');
  const [anomalyPage, setAnomalyPage] = useState(0);
  const [silentPage, setSilentPage] = useState(0);

  // Both queries fire on open (doc 132 §4) so both tab counts show. Data moves
  // at hour granularity — refresh on open + manual button, no polling.
  const anomaly = useQuery({
    queryKey: ['nnf-mdm', 'anomaly', anomalyPage],
    queryFn: () => apiClient.getPaginated<MdmAnomalyRow>(
      '/v_mdm_device_anomaly?order=anomaly_count.desc,overdue_days.desc.nullslast,asset_id.asc',
      { page: anomalyPage + 1, pageSize: PAGE_SIZE },
    ),
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
  const silent = useQuery({
    queryKey: ['nnf-mdm', 'silent', silentPage],
    queryFn: () => apiClient.getPaginated<MdmSilentRow>(
      '/v_mdm_device_silent?current_bucket=in.(WITH_CUSTOMER_ACTIVE,LOANED_OUT)&order=silent_days.desc,asset_id.asc',
      { page: silentPage + 1, pageSize: PAGE_SIZE },
    ),
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });

  const anomalyCount = anomaly.data?.totalCount ?? 0;
  const silentCount = silent.data?.totalCount ?? 0;
  const loadedAt = Math.max(anomaly.dataUpdatedAt, silent.dataUpdatedAt);
  const refreshing = anomaly.isFetching || silent.isFetching;
  const refresh = () => { anomaly.refetch(); silent.refetch(); };

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">{t('nnfMdm.title')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="heading-2 hidden md:block">{t('nnfMdm.title')}</h1>
            <p className="text-xs text-subtle mt-1">{t('nnfMdm.noNotifyNote')}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {loadedAt > 0 && (
              <span className="text-xs text-subtle">
                {t('nnfMdm.loadedAt')} <DateTime value={new Date(loadedAt).toISOString()} showTime />
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              startIcon={<RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} />}
              onClick={refresh}
              disabled={refreshing}
            >
              {t('nnfMdm.refresh')}
            </Button>
          </div>
        </div>

        {/* Tab strip — same underline pattern as NnfAppPage */}
        <div className="flex border-b border-line">
          <button
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
              tab === 'anomaly' ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
            }`}
            onClick={() => setTab('anomaly')}
          >
            <span className="inline-flex items-center gap-1.5">
              {t('nnfMdm.tabAnomaly')}
              {anomalyCount > 0 && <Badge size="xs" color="warning">{anomalyCount}</Badge>}
            </span>
          </button>
          <button
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
              tab === 'silent' ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
            }`}
            onClick={() => setTab('silent')}
          >
            <span className="inline-flex items-center gap-1.5">
              {t('nnfMdm.tabSilent')}
              {silentCount > 0 && <Badge size="xs" color="default">{silentCount}</Badge>}
            </span>
          </button>
        </div>

        {tab === 'anomaly' ? (
          <AnomalyTab
            rows={anomaly.data?.data ?? []}
            totalCount={anomalyCount}
            loading={anomaly.isLoading}
            error={anomaly.isError}
            fetching={anomaly.isFetching}
            showBranch={isCompanyUser}
            pageIndex={anomalyPage}
            onPageChange={setAnomalyPage}
          />
        ) : (
          <SilentTab
            rows={silent.data?.data ?? []}
            totalCount={silentCount}
            loading={silent.isLoading}
            error={silent.isError}
            fetching={silent.isFetching}
            showBranch={isCompanyUser}
            pageIndex={silentPage}
            onPageChange={setSilentPage}
          />
        )}
      </div>
    </>
  );
}

// ── Tab ① Anomalies ───────────────────────────────────────────────────────────

function AnomalyTab({ rows, totalCount, loading, error, fetching, showBranch, pageIndex, onPageChange }: {
  rows: MdmAnomalyRow[];
  totalCount: number;
  loading: boolean;
  error: boolean;
  fetching: boolean;
  showBranch: boolean;
  pageIndex: number;
  onPageChange: (p: number) => void;
}) {
  const { t } = useTranslation();

  if (loading) return <div className="p-8 text-center text-subtle text-sm">{t('common.loading')}</div>;
  if (error) return <div className="alert alert-danger"><span>{t('common.error')}</span></div>;
  if (rows.length === 0) {
    return <PositiveEmpty headline={t('nnfMdm.anomalyEmpty')} hint={t('nnfMdm.anomalyEmptyHint')} />;
  }

  return (
    <div className={`flex flex-col gap-2 ${fetching ? 'opacity-60' : ''} transition-opacity`}>
      {rows.map(row => <AnomalyCard key={row.asset_id} row={row} showBranch={showBranch} />)}
      <PageFooter pageIndex={pageIndex} totalCount={totalCount} onPageChange={onPageChange} />
    </div>
  );
}

function AnomalyCard({ row, showBranch }: { row: MdmAnomalyRow; showBranch: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const simRemoved = row.anomaly_codes.includes('SIM_REMOVED');

  return (
    <div className="rounded-lg border border-line bg-surface p-3.5">
      {/* Header: device identity (title link) · overdue on the right. */}
      <div className="flex items-start justify-between gap-3">
        <DeviceIdentity serial={row.serial_number} assetCode={row.asset_code} assetId={row.asset_id} />
        <div className="shrink-0 text-right">
          {row.overdue_days != null && row.overdue_days > 0
            ? <span className="font-bold tabular-nums">{t('nnfMdm.overdueDays', { n: row.overdue_days })}</span>
            : <span className="text-subtler text-xs">{t('nnfMdm.notOverdue')}</span>}
        </div>
      </div>

      {/* Anomaly badges. Prominence = badge count (rows already sorted by it);
          no self-invented severity colors. */}
      <div className="mt-2 flex items-center gap-1 flex-wrap">
        {row.anomaly_codes.map(code => (
          <Badge key={code} size="xs" color="default">
            {code === 'SILENT' && row.silent_days != null
              ? t('nnfMdm.codeSilentDays', { n: row.silent_days })
              : t(`nnfMdm.code.${code}`, { defaultValue: code })}
          </Badge>
        ))}
      </div>

      {/* SIM_REMOVED: last known phone/carrier — the number collections will
          call. Always shown, never hidden. */}
      {simRemoved && (
        <div className="mt-2 rounded-md bg-surface-shallow px-2.5 py-1.5 text-sm">
          <span className="text-subtle">{t('nnfMdm.lastPhone')}</span>{' '}
          <span className="font-medium tabular-nums">{formatTel(row.sim_last_phone)}</span>
          {row.sim_last_carrier && <span className="text-subtle"> ({row.sim_last_carrier})</span>}
          {row.sim_removed_at && (
            <span className="text-subtle"> · {t('nnfMdm.removedAt')} <DateTime value={row.sim_removed_at} showTime={false} /></span>
          )}
        </div>
      )}

      {/* Context footer — divider separates identity/signal from metadata. */}
      <div className="mt-2.5 pt-2.5 border-t border-line-subtle flex items-center gap-x-2.5 gap-y-1 flex-wrap text-xs text-subtle">
        {row.contract_id && row.contract_code && (
          <button
            type="button"
            onClick={() => navigate(`/admin/contracts/search/${row.contract_id}`)}
            className="text-xs font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer tabular-nums"
          >
            {row.contract_code}
            <ExternalLink size={11} />
          </button>
        )}
        {row.contract_state && (
          <span>{t(`contract.state_${row.contract_state}`, { defaultValue: row.contract_state })}</span>
        )}
        <Badge size="xs" color={getBucketColor(row.current_bucket)}>
          {getBucketLabel(row.current_bucket, t)}
        </Badge>
        {showBranch && row.branch_name && <span>{row.branch_name}</span>}
        <span>{t('nnfMdm.lastSeen')} <DateTime value={row.last_seen_at} showTime={false} /></span>
      </div>
    </div>
  );
}

// ── Tab ② Silent devices in our custody ───────────────────────────────────────

function SilentTab({ rows, totalCount, loading, error, fetching, showBranch, pageIndex, onPageChange }: {
  rows: MdmSilentRow[];
  totalCount: number;
  loading: boolean;
  error: boolean;
  fetching: boolean;
  showBranch: boolean;
  pageIndex: number;
  onPageChange: (p: number) => void;
}) {
  const { t } = useTranslation();

  if (loading) return <div className="p-8 text-center text-subtle text-sm">{t('common.loading')}</div>;
  if (error) return <div className="alert alert-danger"><span>{t('common.error')}</span></div>;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-subtle">{t('nnfMdm.silentTabHint')}</p>
      {rows.length === 0 ? (
        <PositiveEmpty headline={t('nnfMdm.silentEmpty')} hint={t('nnfMdm.silentEmptyHint')} />
      ) : (
        <div className={`flex flex-col gap-2 ${fetching ? 'opacity-60' : ''} transition-opacity`}>
          {rows.map(row => <SilentCard key={row.asset_id} row={row} showBranch={showBranch} />)}
          <PageFooter pageIndex={pageIndex} totalCount={totalCount} onPageChange={onPageChange} />
        </div>
      )}
    </div>
  );
}

function SilentCard({ row, showBranch }: { row: MdmSilentRow; showBranch: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="rounded-lg border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <DeviceIdentity serial={row.serial_number} assetCode={row.asset_code} assetId={row.asset_id} />
        <span className="shrink-0 text-sm tabular-nums">{t('nnfMdm.silentFor', { n: row.silent_days })}</span>
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-line-subtle flex items-center gap-x-2.5 gap-y-1 flex-wrap text-xs text-subtle">
        {/* Which contract this silent device belongs to — keyed on contract_id,
            never the display code (IMPLEMENT 2026-08-11 §3). */}
        {row.contract_id && row.contract_code && (
          <button
            type="button"
            onClick={() => navigate(`/admin/contracts/search/${row.contract_id}`)}
            className="text-xs font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer tabular-nums"
          >
            {row.contract_code}
            <ExternalLink size={11} />
          </button>
        )}
        {row.contract_state && (
          <span>{t(`contract.state_${row.contract_state}`, { defaultValue: row.contract_state })}</span>
        )}
        <Badge size="xs" color={getBucketColor(row.current_bucket)}>
          {getBucketLabel(row.current_bucket, t)}
        </Badge>
        {showBranch && row.branch_name && <span>{row.branch_name}</span>}
        <span>{t('nnfMdm.lastSeen')} <DateTime value={row.last_seen_at} showTime={false} /></span>
      </div>
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

// Device identity block = the card's title. The asset code is the ONLY nav to
// the device page (the card itself is no longer clickable), so it reads as the
// primary link — keyed on asset_id (doc 132 §2). The serial sits under it as a
// dim sub-line with a copy button (§3) — the value staff paste into ABM, not a
// key for any page, so no link. When there's no asset code the serial is
// promoted to the title so identity is never buried.
function DeviceIdentity({ serial, assetCode, assetId }: {
  serial: string;
  assetCode: string | null;
  assetId: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const copySerial = () => {
    navigator.clipboard?.writeText(serial).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const copyBtn = (
    <button
      type="button"
      onClick={copySerial}
      aria-label={t('common.copy')}
      className="shrink-0 inline-flex items-center justify-center text-subtler hover:text-fg bg-transparent border-none p-0 cursor-pointer"
    >
      {copied ? <Check size={13} className="text-success-fg" /> : <Copy size={13} />}
    </button>
  );

  return (
    <div className="min-w-0">
      {assetCode ? (
        <>
          <button
            type="button"
            onClick={() => navigate(`/admin/inventory/assets/${assetId}`)}
            className="max-w-full text-[0.95rem] font-semibold text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer tabular-nums"
          >
            <span className="truncate">{assetCode}</span>
            <ExternalLink size={13} className="shrink-0" />
          </button>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle tabular-nums">
            <span className="truncate">{serial}</span>
            {copyBtn}
          </div>
        </>
      ) : (
        // No asset code — promote the serial to the title (still not a link).
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[0.95rem] font-semibold tabular-nums truncate">{serial}</span>
          {copyBtn}
        </div>
      )}
    </div>
  );
}

// 0 rows is the goal state of this page — render it as good news, not an error.
function PositiveEmpty({ headline, hint }: { headline: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center">
      <CheckCircle2 size={40} className="text-success-fg" />
      <div className="font-medium">{headline}</div>
      <div className="text-sm text-subtle">{hint}</div>
    </div>
  );
}

function PageFooter({ pageIndex, totalCount, onPageChange }: {
  pageIndex: number;
  totalCount: number;
  onPageChange: (p: number) => void;
}) {
  if (totalCount <= PAGE_SIZE) return null;
  return (
    <DataTableFooter
      currentPage={pageIndex + 1}
      totalPages={Math.ceil(totalCount / PAGE_SIZE) || 1}
      onPageChange={(p) => onPageChange(p - 1)}
      pageSize={PAGE_SIZE}
      pageSizeOptions={[PAGE_SIZE]}
      onPageSizeChange={() => {}}
      totalRows={totalCount}
      controlSize="sm"
    />
  );
}
