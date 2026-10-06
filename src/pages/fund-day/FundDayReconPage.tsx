// Fund company — reconciliation history (UI_SUMMARY/148 §5).
//
// Two questions this page answers. At the top, per account: how much money is
// sitting in the bank that the system cannot yet account for (the cumulative
// difference), and how far behind the counting is. Below, one row per day and
// account: whether it was counted, and whether the system's own figure has
// moved since it was counted (`drifted`), which is the one case that needs
// someone to go back and count again.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Button, DataTable, DataTableColumnHeader, InputDatePicker, MobileHeader,
  type ColumnDef,
} from 'tsp-form';
import {
  AlertTriangle, ArrowRightFromLine, CalendarClock, History, Keyboard, Loader2, Wallet,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import {
  fmtCurrency, makeDatePickerFormat, parseLocalDate, toLocalDateStr,
} from '../../lib/format';
import { FundReconVersionsModal } from './FundReconVersionsModal';
import { useFundCompanyId, useFundReconHistory, useFundReconOverview } from './useFundDay';
import {
  UNSPECIFIED_ACCOUNT,
  type FundReconHistoryRow, type FundReconOverviewAccount,
} from './fundDayTypes';

/** First day of the month, two months back — enough to see the recent trail. */
function defaultFromDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  d.setDate(1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function FundDayReconPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const companyId = useFundCompanyId();

  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [isTypingDate, setIsTypingDate] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [trail, setTrail] = useState<FundReconHistoryRow | null>(null);

  const overview = useFundReconOverview(companyId);
  const history = useFundReconHistory(companyId, fromDate, pageIndex + 1, pageSize);

  const accountLabel = (row: { account_key: string; bank_name: string | null; account_number: string | null }) =>
    row.account_key === UNSPECIFIED_ACCOUNT
      ? t('fundDay.unspecifiedAccount')
      : [row.bank_name ?? row.account_key, row.account_number].filter(Boolean).join(' · ');

  const columns: ColumnDef<FundReconHistoryRow>[] = [
    {
      accessorKey: 'recon_date',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fundDay.colDate')} />,
      cell: ({ row }) => <DateTime value={row.original.recon_date} showTime={false} />,
    },
    {
      accessorKey: 'account_key',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fundDay.colAccount')} />,
      cell: ({ row }) => <span className="font-medium">{accountLabel(row.original)}</span>,
    },
    {
      id: 'system',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fundDay.colSystemNow')} />,
      cell: ({ row }) => (
        <div className="tabular-nums text-sm">
          <div className="text-success-fg">{fmtCurrency(row.original.system_in_now)}</div>
          <div className="text-danger-fg">{fmtCurrency(row.original.system_out_now)}</div>
        </div>
      ),
      enableSorting: false,
    },
    {
      id: 'counted',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fundDay.colCounted')} />,
      cell: ({ row }) => (
        row.original.is_saved ? (
          <div className="tabular-nums text-sm">
            <div>{fmtCurrency(row.original.counted_in)}</div>
            <div>{fmtCurrency(row.original.counted_out)}</div>
          </div>
        ) : <span className="text-subtler">{'—'}</span>
      ),
      enableSorting: false,
    },
    {
      id: 'diff',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fundDay.colDiff')} />,
      cell: ({ row }) => (
        row.original.is_saved ? (
          <div className="tabular-nums text-sm">
            <div>{fmtCurrency(row.original.diff_in)}</div>
            <div>{fmtCurrency(row.original.diff_out)}</div>
          </div>
        ) : <span className="text-subtler">{'—'}</span>
      ),
      enableSorting: false,
    },
    {
      id: 'state',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fundDay.colState')} />,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex flex-col gap-1 items-start">
            {!r.is_saved && <Badge color="warning" size="sm">{t('fundDay.badgeUnsaved')}</Badge>}
            {r.is_saved && !r.drifted && (
              <Badge color="success" size="sm">
                {t('fundDay.badgeSavedVersion', { version: r.version })}
              </Badge>
            )}
            {r.drifted && (
              <>
                <Badge color="danger" size="sm">{t('fundDay.badgeDrifted')}</Badge>
                <span className="text-xs text-subtle tabular-nums">
                  {t('fundDay.driftAmounts', {
                    in: fmtCurrency(r.drift_in),
                    out: fmtCurrency(r.drift_out),
                  })}
                </span>
              </>
            )}
            {r.saved_by_name && (
              <span className="text-xs text-subtle">
                {r.saved_by_name} · <DateTime value={r.saved_at} showTime={false} />
              </span>
            )}
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">{t('fundDay.colActions')}</span>,
      cell: ({ row }) => {
        const r = row.original;
        const reconcilable = r.account_key !== UNSPECIFIED_ACCOUNT;
        return (
          <div className="flex items-center gap-1.5 justify-end">
            {r.is_saved && (
              <Button
                variant="outline"
                size="sm"
                startIcon={<History size={14} />}
                onClick={() => setTrail(r)}
              >
                {t('fundDay.viewTrail')}
              </Button>
            )}
            {reconcilable && (
              <Button
                variant={r.drifted ? 'primary' : 'outline'}
                size="sm"
                startIcon={<CalendarClock size={14} />}
                onClick={() => navigate(`/admin/fund-day-money?date=${r.recon_date}`)}
              >
                {r.drifted ? t('fundDay.reconcileAgain') : t('fundDay.openDay')}
              </Button>
            )}
          </div>
        );
      },
      enableSorting: false,
      className: 'w-64',
    },
  ];

  const renderOverviewCard = (account: FundReconOverviewAccount) => {
    const net = account.cumulative_diff_net;
    return (
      <div key={account.account_key} className="border border-line rounded-lg px-4 py-3 min-w-0">
        <div className="font-medium truncate">{accountLabel(account)}</div>
        {account.account_name && (
          <div className="text-xs text-subtle truncate">{account.account_name}</div>
        )}
        <div className="mt-2">
          <div className="text-xs text-subtle">{t('fundDay.cumulativeDiff')}</div>
          <div className={`text-lg font-medium tabular-nums ${
            net === 0 ? '' : net > 0 ? 'text-success-fg' : 'text-danger-fg'
          }`}>
            {net > 0 ? '+' : ''}{fmtCurrency(net)}
          </div>
          <div className="text-xs text-subtle">
            {net === 0
              ? t('fundDay.cumulativeDiffZero')
              : net > 0 ? t('fundDay.cumulativeDiffPositive') : t('fundDay.cumulativeDiffNegative')}
          </div>
        </div>
        <div className="mt-2 flex flex-col gap-1 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-subtle">{t('fundDay.unsavedDays')}</span>
            <span className="tabular-nums">{account.unsaved_days}</span>
          </div>
          {account.first_unsaved_date && (
            <button
              type="button"
              onClick={() => navigate(`/admin/fund-day-money?date=${account.first_unsaved_date}`)}
              className="text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer text-xs text-left"
            >
              {t('fundDay.firstUnsaved')}: <DateTime value={account.first_unsaved_date} showTime={false} />
            </button>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-subtle">{t('fundDay.driftedDays')}</span>
            <span className={`tabular-nums ${account.drifted_days > 0 ? 'text-danger-fg' : ''}`}>
              {account.drifted_days}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-subtle">{t('fundDay.savedDays')}</span>
            <span className="tabular-nums">{account.saved_days}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
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
          {t('fundDay.reconTitle')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header flex flex-col">
        <div className="flex items-center justify-between gap-3 mb-4 max-md:hidden">
          <div>
            <h1 className="heading-2">{t('fundDay.reconTitle')}</h1>
            <p className="text-sm text-subtle mt-1">{t('fundDay.reconDescription')}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            startIcon={<Wallet size={16} />}
            onClick={() => navigate('/admin/fund-day-money')}
          >
            {t('fundDay.openSummary')}
          </Button>
        </div>

        {overview.isLoading && (
          <div className="flex items-center gap-2 text-sm text-subtle mb-4">
            <Loader2 size={16} className="animate-spin" />
            <span>{t('common.loading')}</span>
          </div>
        )}

        {overview.isError && (
          <div className="alert alert-danger mb-4">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{(overview.error as Error)?.message ?? t('common.error')}</span>
          </div>
        )}

        {overview.data && overview.data.accounts.length > 0 && (
          <div className="grid gap-3 mb-4 sm:grid-cols-2 xl:grid-cols-3">
            {overview.data.accounts.map(renderOverviewCard)}
          </div>
        )}

        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className="text-sm text-subtle">{t('fundDay.showFrom')}</span>
          <div className="w-44">
            <InputDatePicker
              value={parseLocalDate(fromDate)}
              onChange={(v) => {
                const d = toLocalDateStr(v);
                if (d) { setFromDate(d); setPageIndex(0); }
              }}
              dateFormat={makeDatePickerFormat(i18n.language)}
              endIcon={<Keyboard size={16} />}
              onEndIconClick={() => setIsTypingDate(v => !v)}
              size="sm"
              locale={i18n.language}
              calendar="gregorian"
              typingMode={isTypingDate}
              onTypingModeChange={setIsTypingDate}
              typingMask="##/##/####"
              typingPlaceholder="DD/MM/YYYY"
              parseTypedDate={(raw) => {
                if (raw.length !== 8) return null;
                const day = parseInt(raw.slice(0, 2), 10);
                const month = parseInt(raw.slice(2, 4), 10);
                let year = parseInt(raw.slice(4, 8), 10);
                if (year > 2400) year -= 543;
                if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                const d = new Date(year, month - 1, day);
                if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                return d;
              }}
            />
          </div>
        </div>

        <DataTable<FundReconHistoryRow>
          outlined
          data={history.data?.data ?? []}
          columns={columns}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[15, 25, 50]}
          rowCount={history.data?.totalCount ?? 0}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
          className={`flex-1 min-h-0 ${history.isFetching ? 'opacity-60' : ''} transition-opacity`}
          noResults={
            <div className="p-8 text-center text-subtler">
              <History size={28} className="mx-auto mb-2 opacity-50" />
              <div>{t('fundDay.reconEmpty')}</div>
            </div>
          }
        />
      </div>

      <FundReconVersionsModal
        open={!!trail}
        companyId={companyId}
        date={trail?.recon_date ?? null}
        accountKey={trail?.account_key ?? null}
        accountLabel={trail ? accountLabel(trail) : null}
        onClose={() => setTrail(null)}
      />
    </>
  );
}
