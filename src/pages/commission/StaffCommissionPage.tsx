import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, Button, Input,
  Modal, TextArea, Badge, MobileHeader, useSnackbarContext,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, XCircle, ArrowDownCircle, RotateCcw } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';

// ── Types ────────────────────────────────────────────────────────────────────

interface CommissionMonthly {
  user_id: number;
  holding_id: number;
  company_id: number;
  yr: number;
  mo: number;
  earned: number;
  withdrawn: number;
  reverted: number;
}

interface CommissionDetail {
  txn_id: number;
  contract_id: number;
  contract_code: string;
  contract_code_display: string;
  user_id: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  txn_type: string;
  amount: number;
  note: string | null;
  created_by: number;
  created_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('en-US');

const getTxnColor = (type: string) => {
  switch (type) {
    case 'COMMISSION_GRANT': return 'success';
    case 'COMMISSION_WITHDRAW': return 'warning';
    case 'COMMISSION_REVERT': return 'info';
    default: return 'default' as const;
  }
};

const getTxnLabel = (type: string, t: (k: string) => string) => {
  switch (type) {
    case 'COMMISSION_GRANT': return t('commission.txnGrant');
    case 'COMMISSION_WITHDRAW': return t('commission.txnWithdraw');
    case 'COMMISSION_REVERT': return t('commission.txnRevert');
    default: return type;
  }
};

// ── Component ────────────────────────────────────────────────────────────────

export function StaffCommissionPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [tab, setTab] = useState<'monthly' | 'detail'>('monthly');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [revertTxn, setRevertTxn] = useState<CommissionDetail | null>(null);

  // Monthly data
  const { data: monthlyData } = useQuery({
    queryKey: ['commission-monthly'],
    queryFn: () => apiClient.get<CommissionMonthly[]>('/v_commission_monthly?order=yr.desc,mo.desc'),
    staleTime: 60 * 1000,
  });

  // Detail data
  const { data: detailData } = useQuery({
    queryKey: ['commission-detail'],
    queryFn: () => apiClient.get<CommissionDetail[]>('/v_commission_detail?order=created_at.desc&limit=200'),
    staleTime: 60 * 1000,
  });

  const monthlyList = monthlyData ?? [];
  const detailList = detailData ?? [];

  // ── Monthly columns ──
  const monthlyColumns: ColumnDef<CommissionMonthly>[] = useMemo(() => [
    {
      accessorKey: 'period',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.period')} />,
      cell: ({ row }) => `${row.original.yr}-${String(row.original.mo).padStart(2, '0')}`,
    },
    {
      accessorKey: 'earned',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.earned')} />,
      cell: ({ row }) => <span className="tabular-nums text-success font-medium">{fmt(row.original.earned)}</span>,
    },
    {
      accessorKey: 'withdrawn',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.withdrawn')} />,
      cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.withdrawn)}</span>,
    },
    {
      accessorKey: 'reverted',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.reverted')} />,
      cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.reverted)}</span>,
    },
    {
      id: 'balance',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.balance')} />,
      cell: ({ row }) => {
        const balance = row.original.earned - row.original.withdrawn + row.original.reverted;
        return <span className="tabular-nums font-semibold">{fmt(balance)}</span>;
      },
    },
  ], [t]);

  // ── Detail columns ──
  const detailColumns: ColumnDef<CommissionDetail>[] = useMemo(() => [
    {
      accessorKey: 'created_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.date')} />,
      cell: ({ row }) => <DateTime value={row.original.created_at} />,
    },
    {
      accessorKey: 'txn_type',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.type')} />,
      cell: ({ row }) => (
        <Badge size="sm" color={getTxnColor(row.original.txn_type)}>
          {getTxnLabel(row.original.txn_type, t)}
        </Badge>
      ),
    },
    {
      accessorKey: 'contract_code_display',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.contract')} />,
      cell: ({ row }) => <span className="text-sm">{row.original.contract_code_display}</span>,
    },
    {
      accessorKey: 'amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.amount')} />,
      cell: ({ row }) => {
        const amt = row.original.amount;
        return <span className={`tabular-nums font-medium ${amt > 0 ? 'text-success' : amt < 0 ? 'text-danger' : ''}`}>{amt > 0 ? '+' : ''}{fmt(amt)}</span>;
      },
    },
    {
      accessorKey: 'note',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.note')} />,
      cell: ({ row }) => <span className="text-xs text-subtle truncate max-w-40 block">{row.original.note ?? '—'}</span>,
    },
    {
      id: 'actions',
      className: 'w-10',
      cell: ({ row }) => {
        if (row.original.txn_type === 'COMMISSION_WITHDRAW') {
          return (
            <Button size="sm" variant="ghost" className="btn-icon-sm" onClick={() => setRevertTxn(row.original)}>
              <RotateCcw size={14} />
            </Button>
          );
        }
        return null;
      },
    },
  ], [t]);

  const tabs = [
    { key: 'monthly' as const, label: t('commission.tabMonthly') },
    { key: 'detail' as const, label: t('commission.tabDetail') },
  ];

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['commission-monthly'] });
    queryClient.invalidateQueries({ queryKey: ['commission-detail'] });
  };

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title">{t('commission.staffTitle')}</div>
        <div className="mobile-header-end w-12" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('commission.staffTitle')}</h1>
          <Button color="primary" startIcon={<ArrowDownCircle size={16} />} onClick={() => setWithdrawOpen(true)}>
            {t('commission.withdraw')}
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex-none flex border-b border-line mb-4">
          {tabs.map(tb => (
            <button
              key={tb.key}
              className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
                tab === tb.key ? 'border-primary text-primary' : 'border-transparent text-fg/50 hover:text-fg/80'
              }`}
              onClick={() => { setTab(tb.key); setPageIndex(0); }}
            >
              {tb.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === 'monthly' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-auto">
              <DataTable
                columns={monthlyColumns}
                data={monthlyList}
                sorting={sorting}
                onSortingChange={setSorting}
              />
            </div>
          </div>
        )}

        {tab === 'detail' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-auto">
              <DataTable
                columns={detailColumns}
                data={detailList.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)}
                sorting={sorting}
                onSortingChange={setSorting}
              />
            </div>
            {detailList.length > 0 && (
              <DataTableFooter
                currentPage={pageIndex + 1}
                totalPages={Math.ceil(detailList.length / pageSize)}
                onPageChange={(p) => setPageIndex(p - 1)}
                pageSize={pageSize}
                pageSizeOptions={[15, 25, 50]}
                onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
                totalRows={detailList.length}
              />
            )}
          </div>
        )}
      </div>

      {/* Withdraw Modal */}
      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        onSuccess={() => {
          setWithdrawOpen(false);
          refreshAll();
          addSnackbar({
            message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('commission.withdrawSuccess')}</span></div>,
          });
        }}
      />

      {/* Revert Modal */}
      <RevertModal
        txn={revertTxn}
        onClose={() => setRevertTxn(null)}
        onSuccess={() => {
          setRevertTxn(null);
          refreshAll();
          addSnackbar({
            message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('commission.revertSuccess')}</span></div>,
          });
        }}
      />
    </>
  );
}

// ── Withdraw Modal ───────────────────────────────────────────────────────────

function WithdrawModal({ open, onClose, onSuccess }: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [contractId, setContractId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const resetForm = () => { setContractId(''); setAmount(''); setNote(''); setError(''); };

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_commission_withdraw', {
      p_contract_id: Number(contractId),
      p_amount: Number(amount),
      p_note: note.trim() || undefined,
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

  const canSubmit = contractId && Number(amount) > 0;

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
            <label className="form-label">{t('commission.contractId')} *</label>
            <Input type="number" value={contractId} onChange={(e) => setContractId(e.target.value)} placeholder="Contract ID" className="w-full" />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('commission.amount')} *</label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="w-full" min="1" />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('commission.note')}</label>
            <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('commission.notePlaceholder')} rows={2} />
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

// ── Revert Modal ─────────────────────────────────────────────────────────────

function RevertModal({ txn, onClose, onSuccess }: {
  txn: CommissionDetail | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_commission_revert', {
      p_txn_id: txn!.txn_id,
      p_note: note.trim() || undefined,
    }),
    onSuccess: () => { setNote(''); onSuccess(); },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else setError(String(err));
      setErrorKey(k => k + 1);
    },
  });

  return (
    <Modal open={!!txn} onClose={() => { setNote(''); setError(''); onClose(); }} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('commission.revert')}</h2>
        <button type="button" className="modal-close-btn" onClick={() => { setNote(''); setError(''); onClose(); }}>&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
            <XCircle size={16} /><span>{error}</span>
          </div>
        )}
        {txn && (
          <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line text-sm">
            <div className="font-medium">{txn.contract_code_display}</div>
            <div className="text-xs text-subtle">TXN #{txn.txn_id} · {t('commission.amount')}: {fmt(Math.abs(txn.amount))}</div>
          </div>
        )}
        <div className="form-grid gap-4">
          <div className="flex flex-col">
            <label className="form-label">{t('commission.note')}</label>
            <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('commission.notePlaceholder')} rows={2} />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={() => { setNote(''); setError(''); onClose(); }}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? t('common.loading') : t('commission.revert')}
        </Button>
      </div>
    </Modal>
  );
}
