import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, Button, Input, Select,
  Modal, TextArea, Badge, Drawer, MobileHeader, useSnackbarContext,
  type ColumnDef, type SortingState, type RowExpansionState,
} from 'tsp-form';
import { ArrowRightFromLine, ArrowDownCircle, SlidersHorizontal, CheckCircle, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';

// ── Types ────────────────────────────────────────────────────────────────────

interface CommissionBalance {
  user_id: number;
  username: string;
  balance: number;
  total_granted: number;
  total_withdrawn: number;
  total_adjust_plus: number;
  total_adjust_minus: number;
}

interface CommissionLedger {
  id: number;
  user_id: number;
  user_name: string;
  txn_type: string;
  amount: number;
  running_balance: number;
  contract_id: number | null;
  contract_code: string | null;
  contract_code_display: string | null;
  note: string | null;
  holding_id: number;
  company_id: number;
  branch_id: number | null;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
}

interface CommissionMonthly {
  user_id: number;
  user_name: string;
  month: string;
  holding_id: number;
  company_id: number;
  granted: number;
  withdrawn: number;
  adjusted: number;
  net_change: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('en-US');

const getTxnColor = (type: string) => {
  switch (type) {
    case 'GRANT': return 'success';
    case 'WITHDRAW': return 'warning';
    case 'ADJUST': return 'info';
    default: return 'default' as const;
  }
};

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'];

// ── Component ────────────────────────────────────────────────────────────────

export function StaffCommissionPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const canManage = ADMIN_ROLES.includes(user?.role_code ?? '');

  const [tab, setTab] = useState<'balance' | 'monthly'>('balance');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [monthlyPageIndex, setMonthlyPageIndex] = useState(0);
  const [monthlyPageSize, setMonthlyPageSize] = useState(15);

  const [drawerUser, setDrawerUser] = useState<CommissionBalance | null>(null);
  const [ledgerPageIndex, setLedgerPageIndex] = useState(0);
  const [ledgerPageSize, setLedgerPageSize] = useState(15);

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  // ── Balance query ──
  const selfFilter = !canManage && user ? `&user_id=eq.${user.user_id}` : '';
  const { data: balanceData, isFetching: balanceFetching } = useQuery({
    queryKey: ['commission-balance', pageIndex, pageSize, selfFilter],
    queryFn: () => apiClient.getPaginated<CommissionBalance>(
      `/v_commission_balance?order=username.asc${selfFilter}`,
      { page: pageIndex + 1, pageSize },
    ),
    placeholderData: keepPreviousData,
  });
  const balanceList = balanceData?.data ?? [];
  const balanceTotal = balanceData?.totalCount ?? 0;

  // ── Monthly query ──
  const { data: monthlyData, isFetching: monthlyFetching } = useQuery({
    queryKey: ['commission-monthly', monthlyPageIndex, monthlyPageSize, selfFilter],
    queryFn: () => apiClient.getPaginated<CommissionMonthly>(
      `/v_commission_monthly?order=month.desc${selfFilter}`,
      { page: monthlyPageIndex + 1, pageSize: monthlyPageSize },
    ),
    placeholderData: keepPreviousData,
    enabled: tab === 'monthly',
  });
  const monthlyList = monthlyData?.data ?? [];
  const monthlyTotal = monthlyData?.totalCount ?? 0;

  // ── Ledger query (for drawer) ──
  const { data: ledgerData, isFetching: ledgerFetching } = useQuery({
    queryKey: ['commission-ledger', drawerUser?.user_id, ledgerPageIndex, ledgerPageSize],
    queryFn: () => apiClient.getPaginated<CommissionLedger>(
      `/v_commission_ledger?user_id=eq.${drawerUser!.user_id}&order=created_at.desc`,
      { page: ledgerPageIndex + 1, pageSize: ledgerPageSize },
    ),
    placeholderData: keepPreviousData,
    enabled: !!drawerUser,
  });

  useEffect(() => { setLedgerPageIndex(0); }, [drawerUser?.user_id]);

  // ── Balance columns ──
  const balanceColumns: ColumnDef<CommissionBalance>[] = useMemo(() => [
    {
      accessorKey: 'username',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.username')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.username}</span>,
    },
    {
      accessorKey: 'balance',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.balance')} />,
      cell: ({ row }) => {
        const b = row.original.balance;
        return <span className={`tabular-nums font-semibold ${b < 0 ? 'text-danger' : ''}`}>{fmt(b)}</span>;
      },
      className: 'w-24',
    },
    {
      accessorKey: 'total_granted',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.totalGranted')} />,
      cell: ({ row }) => <span className="tabular-nums text-success">{fmt(row.original.total_granted)}</span>,
      className: 'w-24 max-md:hidden',
    },
    {
      accessorKey: 'total_withdrawn',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.totalWithdrawn')} />,
      cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.total_withdrawn)}</span>,
      className: 'w-24 max-lg:hidden',
    },
    {
      accessorKey: 'total_adjust_plus',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.adjustPlus')} />,
      cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.total_adjust_plus)}</span>,
      className: 'w-24 max-lg:hidden',
    },
    {
      accessorKey: 'total_adjust_minus',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.adjustMinus')} />,
      cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.total_adjust_minus)}</span>,
      className: 'w-24 max-xl:hidden',
    },
  ], [t]);

  // ── Monthly columns ──
  const monthlyColumns: ColumnDef<CommissionMonthly>[] = useMemo(() => [
    {
      accessorKey: 'month',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.month')} />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.month?.slice(0, 7)}</span>,
    },
    {
      accessorKey: 'user_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.username')} />,
      cell: ({ row }) => <span className="font-medium">{row.original.user_name}</span>,
    },
    {
      accessorKey: 'granted',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.granted')} />,
      cell: ({ row }) => <span className="tabular-nums text-success">{fmt(row.original.granted)}</span>,
      className: 'w-24',
    },
    {
      accessorKey: 'withdrawn',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.withdrawn')} />,
      cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.withdrawn)}</span>,
      className: 'w-24',
    },
    {
      accessorKey: 'adjusted',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.adjusted')} />,
      cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.adjusted)}</span>,
      className: 'w-24 max-md:hidden',
    },
    {
      accessorKey: 'net_change',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.netChange')} />,
      cell: ({ row }) => {
        const n = row.original.net_change;
        return <span className={`tabular-nums font-medium ${n > 0 ? 'text-success' : n < 0 ? 'text-danger' : ''}`}>{n > 0 ? '+' : ''}{fmt(n)}</span>;
      },
      className: 'w-24',
    },
  ], [t]);

  // ── Row click → open drawer ──
  const handleRowExpansionChange = (updater: RowExpansionState | ((prev: RowExpansionState) => RowExpansionState)) => {
    const next = typeof updater === 'function' ? updater({}) : updater;
    const clickedId = Object.keys(next).find(k => next[k]);
    if (clickedId) {
      const row = balanceList[Number(clickedId)];
      if (row) setDrawerUser(row);
    }
  };

  const tabs = [
    { key: 'balance' as const, label: t('commission.tabBalance') },
    { key: 'monthly' as const, label: t('commission.tabMonthly') },
  ];

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['commission-balance'] });
    queryClient.invalidateQueries({ queryKey: ['commission-monthly'] });
    queryClient.invalidateQueries({ queryKey: ['commission-ledger'] });
  };

  const userOptions = useMemo(
    () => balanceList.map(u => ({ value: String(u.user_id), label: `${u.username} (${fmt(u.balance)})` })),
    [balanceList],
  );

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title">{t('commission.staffTitle')}</div>
        <div className="mobile-header-end">
          {canManage && (
            <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => setWithdrawOpen(true)}>
              <ArrowDownCircle size={18} />
            </button>
          )}
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('commission.staffTitle')}</h1>
          {canManage && (
            <div className="flex gap-2">
              <Button variant="outline" startIcon={<SlidersHorizontal size={16} />} onClick={() => setAdjustOpen(true)}>
                {t('commission.adjust')}
              </Button>
              <Button color="primary" startIcon={<ArrowDownCircle size={16} />} onClick={() => setWithdrawOpen(true)}>
                {t('commission.withdraw')}
              </Button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex-none flex border-b border-line mb-4">
          {tabs.map(tb => (
            <button
              key={tb.key}
              className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
                tab === tb.key ? 'border-primary text-primary' : 'border-transparent text-fg/50 hover:text-fg/80'
              }`}
              onClick={() => { setTab(tb.key); }}
            >
              {tb.label}
            </button>
          ))}
        </div>

        {/* Balance tab */}
        {tab === 'balance' && (
          <>
            {/* Desktop table */}
            <DataTable<CommissionBalance>
              data={balanceList}
              columns={balanceColumns}
              sorting={sorting}
              onSortingChange={setSorting}
              expandOnRowClick
              getRowCanExpand={() => true}
              renderExpandedRow={() => null}
              rowExpansion={{}}
              onRowExpansionChange={handleRowExpansionChange}
              enablePagination
              pageIndex={pageIndex}
              pageSize={pageSize}
              pageSizeOptions={[15, 25, 50]}
              rowCount={balanceTotal}
              onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
              tableClassName="[&_tbody_tr]:cursor-pointer"
              className={`flex-1 min-h-0 hidden md:flex ${balanceFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
              noResults={<div className="p-8 text-center text-control-label">{t('commission.noData')}</div>}
            />

            {/* Mobile cards */}
            <div className={`flex-1 min-h-0 flex flex-col md:hidden ${balanceFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
              <div className="flex-1 overflow-auto better-scroll pb-8">
                {balanceList.length === 0 ? (
                  <div className="p-8 text-center text-control-label">{t('commission.noData')}</div>
                ) : (
                  <div className="flex flex-col divide-y divide-line">
                    {balanceList.map(row => (
                      <div
                        key={row.user_id}
                        className="px-1 py-3 cursor-pointer active:bg-surface-hover"
                        onClick={() => setDrawerUser(row)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{row.username}</span>
                          <span className={`tabular-nums font-semibold ${row.balance < 0 ? 'text-danger' : ''}`}>{fmt(row.balance)}</span>
                        </div>
                        <div className="flex gap-4 mt-1 text-xs text-control-label tabular-nums">
                          <span className="text-success">+{fmt(row.total_granted)}</span>
                          <span>−{fmt(row.total_withdrawn)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {balanceTotal > 0 && (
                <DataTableFooter
                  currentPage={pageIndex + 1}
                  totalPages={Math.ceil(balanceTotal / pageSize)}
                  onPageChange={p => setPageIndex(p - 1)}
                  pageSize={pageSize}
                  pageSizeOptions={[15, 25, 50]}
                  onPageSizeChange={ps => { setPageSize(ps); setPageIndex(0); }}
                  totalRows={balanceTotal}
                />
              )}
            </div>
          </>
        )}

        {/* Monthly tab */}
        {tab === 'monthly' && (
          <>
            <DataTable<CommissionMonthly>
              data={monthlyList}
              columns={monthlyColumns}
              sorting={sorting}
              onSortingChange={setSorting}
              enablePagination
              pageIndex={monthlyPageIndex}
              pageSize={monthlyPageSize}
              pageSizeOptions={[15, 25, 50]}
              rowCount={monthlyTotal}
              onPageChange={({ pageIndex: pi, pageSize: ps }) => { setMonthlyPageIndex(pi); setMonthlyPageSize(ps); }}
              className={`flex-1 min-h-0 hidden md:flex ${monthlyFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
              noResults={<div className="p-8 text-center text-control-label">{t('commission.noData')}</div>}
            />

            {/* Mobile cards */}
            <div className={`flex-1 min-h-0 flex flex-col md:hidden ${monthlyFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
              <div className="flex-1 overflow-auto better-scroll pb-8">
                {monthlyList.length === 0 ? (
                  <div className="p-8 text-center text-control-label">{t('commission.noData')}</div>
                ) : (
                  <div className="flex flex-col divide-y divide-line">
                    {monthlyList.map((row, i) => (
                      <div key={i} className="px-1 py-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{row.user_name}</span>
                          <span className="tabular-nums text-xs text-control-label">{row.month?.slice(0, 7)}</span>
                        </div>
                        <div className="flex gap-4 mt-1 text-xs tabular-nums">
                          <span className="text-success">+{fmt(row.granted)}</span>
                          <span>−{fmt(row.withdrawn)}</span>
                          <span>{fmt(row.adjusted)}</span>
                          <span className={`font-medium ${row.net_change > 0 ? 'text-success' : row.net_change < 0 ? 'text-danger' : ''}`}>
                            = {row.net_change > 0 ? '+' : ''}{fmt(row.net_change)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {monthlyTotal > 0 && (
                <DataTableFooter
                  currentPage={monthlyPageIndex + 1}
                  totalPages={Math.ceil(monthlyTotal / monthlyPageSize)}
                  onPageChange={p => setMonthlyPageIndex(p - 1)}
                  pageSize={monthlyPageSize}
                  pageSizeOptions={[15, 25, 50]}
                  onPageSizeChange={ps => { setMonthlyPageSize(ps); setMonthlyPageIndex(0); }}
                  totalRows={monthlyTotal}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* User Ledger Drawer */}
      <UserLedgerDrawer
        user={drawerUser}
        open={!!drawerUser}
        onClose={() => setDrawerUser(null)}
        ledgerData={ledgerData?.data ?? []}
        ledgerTotal={ledgerData?.totalCount ?? 0}
        ledgerFetching={ledgerFetching}
        ledgerPageIndex={ledgerPageIndex}
        ledgerPageSize={ledgerPageSize}
        onLedgerPageChange={(pi) => setLedgerPageIndex(pi)}
        onLedgerPageSizeChange={(ps) => { setLedgerPageSize(ps); setLedgerPageIndex(0); }}
      />

      {/* Withdraw Modal */}
      {canManage && (
        <WithdrawModal
          open={withdrawOpen}
          onClose={() => setWithdrawOpen(false)}
          userOptions={userOptions}
          currentUserId={user?.user_id ?? 0}
          onSuccess={() => {
            setWithdrawOpen(false);
            refreshAll();
            addSnackbar({
              message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('commission.withdrawSuccess')}</span></div>,
            });
          }}
        />
      )}

      {/* Adjust Modal */}
      {canManage && (
        <AdjustModal
          open={adjustOpen}
          onClose={() => setAdjustOpen(false)}
          userOptions={userOptions}
          currentUserId={user?.user_id ?? 0}
          onSuccess={() => {
            setAdjustOpen(false);
            refreshAll();
            addSnackbar({
              message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('commission.adjustSuccess')}</span></div>,
            });
          }}
        />
      )}
    </>
  );
}

// ── User Ledger Drawer ──────────────────────────────────────────────────────

function UserLedgerDrawer({ user: u, open, onClose, ledgerData, ledgerTotal, ledgerFetching, ledgerPageIndex, ledgerPageSize, onLedgerPageChange, onLedgerPageSizeChange }: {
  user: CommissionBalance | null;
  open: boolean;
  onClose: () => void;
  ledgerData: CommissionLedger[];
  ledgerTotal: number;
  ledgerFetching: boolean;
  ledgerPageIndex: number;
  ledgerPageSize: number;
  onLedgerPageChange: (page: number) => void;
  onLedgerPageSizeChange: (size: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('commission.ledgerTitle')}>
      <div className="drawer-header">
        <h2 className="drawer-title">{t('commission.ledgerTitle')}</h2>
        <button className="drawer-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="drawer-content">
        {u && (
          <div className="space-y-4">
            {/* Summary card */}
            <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
              <div className="font-medium text-sm mb-2">{u.username}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <DetailRow label={t('commission.balance')} value={fmt(u.balance)} bold />
                <DetailRow label={t('commission.totalGranted')} value={fmt(u.total_granted)} color="text-success" />
                <DetailRow label={t('commission.totalWithdrawn')} value={fmt(u.total_withdrawn)} />
                <DetailRow label={t('commission.adjustPlus')} value={fmt(u.total_adjust_plus)} />
                <DetailRow label={t('commission.adjustMinus')} value={fmt(u.total_adjust_minus)} />
              </div>
            </div>

            {/* Ledger entries */}
            <div className={`space-y-0 divide-y divide-line ${ledgerFetching ? 'opacity-60' : ''}`}>
              {ledgerData.length === 0 ? (
                <div className="py-8 text-center text-control-label text-sm">{t('commission.noData')}</div>
              ) : (
                ledgerData.map(entry => (
                  <div key={entry.id} className="py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <Badge size="sm" color={getTxnColor(entry.txn_type)}>
                        {t(`commission.txn${entry.txn_type === 'GRANT' ? 'Grant' : entry.txn_type === 'WITHDRAW' ? 'Withdraw' : 'Adjust'}`)}
                      </Badge>
                      <DateTime value={entry.created_at} className="text-xs text-control-label" />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-sm text-control-label truncate">{entry.contract_code_display ?? '—'}</span>
                      <div className="text-right tabular-nums">
                        <span className={`font-medium ${entry.amount > 0 ? 'text-success' : entry.amount < 0 ? 'text-danger' : ''}`}>
                          {entry.amount > 0 ? '+' : ''}{fmt(entry.amount)}
                        </span>
                        <span className="text-xs text-control-label ml-2">→ {fmt(entry.running_balance)}</span>
                      </div>
                    </div>
                    {entry.note && <div className="text-xs text-control-label mt-0.5 truncate">{entry.note}</div>}
                    {entry.created_by_name && <div className="text-[11px] text-subtle mt-0.5">{entry.created_by_name}</div>}
                  </div>
                ))
              )}
            </div>

            {ledgerTotal > ledgerPageSize && (
              <DataTableFooter
                currentPage={ledgerPageIndex + 1}
                totalPages={Math.ceil(ledgerTotal / ledgerPageSize)}
                onPageChange={p => onLedgerPageChange(p - 1)}
                pageSize={ledgerPageSize}
                pageSizeOptions={[15, 25, 50]}
                onPageSizeChange={onLedgerPageSizeChange}
                totalRows={ledgerTotal}
              />
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function DetailRow({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-control-label text-xs">{label}</span>
      <span className={`tabular-nums text-xs ${bold ? 'font-semibold' : ''} ${color ?? ''}`}>{value}</span>
    </div>
  );
}

// ── Withdraw Modal ──────────────────────────────────────────────────────────

function WithdrawModal({ open, onClose, userOptions, currentUserId, onSuccess }: {
  open: boolean;
  onClose: () => void;
  userOptions: { value: string; label: string }[];
  currentUserId: number;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [userId, setUserId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const resetForm = () => { setUserId(null); setAmount(''); setNote(''); setError(''); };

  // Backend note: fn_commission_withdraw has a branch_id NOT NULL bug on commission_ledger.
  // The modal is built correctly — will work once backend fixes the constraint.
  const mutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_commission_withdraw', {
      p_user_id: Number(userId),
      p_amount: Number(amount),
      p_note: note.trim() || null,
      p_withdrawn_by: currentUserId,
    }),
    onSuccess: () => { resetForm(); onSuccess(); },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else setError(String(err));
      setErrorKey(k => k + 1);
    },
  });

  const canSubmit = userId && Number(amount) > 0;

  return (
    <Modal open={open} onClose={() => { resetForm(); onClose(); }} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('commission.withdraw')}</h2>
        <button type="button" className="modal-close-btn" onClick={() => { resetForm(); onClose(); }}>&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
            <XCircle size={16} /><span>{error}</span>
          </div>
        )}
        <div className="form-grid gap-4">
          <div className="flex flex-col">
            <label className="form-label">{t('commission.selectUser')} *</label>
            <Select
              options={userOptions}
              value={userId}
              onChange={val => setUserId(val as string)}
              placeholder={t('commission.selectUser')}
              searchable
              showChevron
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('commission.amount')} *</label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" className="w-full" min="1" />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('commission.note')}</label>
            <TextArea value={note} onChange={e => setNote(e.target.value)} placeholder={t('commission.notePlaceholder')} rows={2} />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={() => { resetForm(); onClose(); }}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending ? t('common.loading') : t('commission.withdraw')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Adjust Modal ────────────────────────────────────────────────────────────

function AdjustModal({ open, onClose, userOptions, currentUserId, onSuccess }: {
  open: boolean;
  onClose: () => void;
  userOptions: { value: string; label: string }[];
  currentUserId: number;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [userId, setUserId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const resetForm = () => { setUserId(null); setAmount(''); setNote(''); setError(''); };

  // Backend note: fn_commission_adjust has the same branch_id NOT NULL bug as withdraw.
  const mutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_commission_adjust', {
      p_user_id: Number(userId),
      p_amount: Number(amount),
      p_note: note.trim(),
      p_adjusted_by: currentUserId,
    }),
    onSuccess: () => { resetForm(); onSuccess(); },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else setError(String(err));
      setErrorKey(k => k + 1);
    },
  });

  const canSubmit = userId && Number(amount) !== 0 && note.trim().length > 0;

  return (
    <Modal open={open} onClose={() => { resetForm(); onClose(); }} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('commission.adjust')}</h2>
        <button type="button" className="modal-close-btn" onClick={() => { resetForm(); onClose(); }}>&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
            <XCircle size={16} /><span>{error}</span>
          </div>
        )}
        <div className="form-grid gap-4">
          <div className="flex flex-col">
            <label className="form-label">{t('commission.selectUser')} *</label>
            <Select
              options={userOptions}
              value={userId}
              onChange={val => setUserId(val as string)}
              placeholder={t('commission.selectUser')}
              searchable
              showChevron
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('commission.amount')} *</label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 5 or -3" className="w-full" />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('commission.note')} *</label>
            <TextArea value={note} onChange={e => setNote(e.target.value)} placeholder={t('commission.notePlaceholder')} rows={2} />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={() => { resetForm(); onClose(); }}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending ? t('common.loading') : t('commission.adjust')}
        </Button>
      </div>
    </Modal>
  );
}
