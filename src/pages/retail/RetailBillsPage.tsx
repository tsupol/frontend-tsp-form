import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTable, Select, Badge, Button,
} from 'tsp-form';
import { ArrowRightFromLine, ArrowLeft, Plus } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { CreateRetailBillModal } from './CreateRetailBillModal';

interface Branch {
  id: number;
  name: string;
}

interface RetailBillRow {
  id: number;
  code_display: string;
  branch_id: number;
  branch_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  total_amount: number;
  paid_amount: number;
  cash_amount: number;
  transfer_amount: number;
  status: string;
  bill_date: string;
  created_at: string;
}

interface BillLineItem {
  line_id: number;
  line_type: string;
  charge_type: string;
  description: string;
  amount: number;
  quantity: number;
  owner_type: string;
  variant_id: number | null;
}

interface BillPayment {
  id: number;
  method: string;
  amount: number;
  bank_name: string | null;
  account_number: string | null;
  reference: string | null;
}

interface BillDetail {
  bill_id: number;
  bill_code_display: string;
  status: string;
  total_amount: number;
  paid_amount: number;
  customer_name: string | null;
  line_items: BillLineItem[];
  payments: BillPayment[] | null;
}

const METHOD_COLOR: Record<string, 'success' | 'primary' | 'secondary' | 'info' | 'default'> = {
  CASH: 'success',
  TRANSFER: 'primary',
};

const STATUS_VALUES = ['PAID', 'VOIDED'] as const;

export function RetailBillsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState<string>(user?.branch_id ? String(user.branch_id) : '');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selectedBillId, setSelectedBillId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const params = new URLSearchParams();
  params.set('bill_purpose', 'eq.RETAIL');
  if (branchId) params.set('branch_id', `eq.${branchId}`);
  if (statusFilter) params.set('status', `eq.${statusFilter}`);
  params.set('order', 'created_at.desc');

  const { data: billsData, isFetching } = useQuery({
    queryKey: ['retail', 'bills', branchId, statusFilter, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<RetailBillRow>(
      `/v_bills?${params.toString()}`,
      { page: pageIndex + 1, pageSize }
    ),
    placeholderData: keepPreviousData,
  });

  const bills = billsData?.data ?? [];
  const totalCount = billsData?.totalCount ?? 0;

  const detailTitle = selectedBillId
    ? bills.find(b => b.id === selectedBillId)?.code_display ?? t('retail.bills.title')
    : t('retail.bills.title');

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label="Open menu"
                    onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                  >
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    onClick={goBack}
                  >
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('retail.bills.title') : detailTitle}
              </div>
              <div className="mobile-header-end">
                {isRoot && (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label={t('retail.bills.newBill')}
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus size={20} />
                  </button>
                )}
              </div>
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('retail.bills.title')}</h1>
              <p className="text-sm text-fg/60 truncate flex-1">{t('retail.bills.description')}</p>
              <Button
                color="primary"
                size="sm"
                startIcon={<Plus size={14} />}
                onClick={() => setCreateOpen(true)}
              >
                {t('retail.bills.newBill')}
              </Button>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              <div className="flex-none flex items-center p-2 border-b border-line gap-2">
                <div className="flex-1 min-w-0">
                  <Select
                    value={branchId || null}
                    onChange={(v) => { setBranchId((v as string) ?? ''); setPageIndex(0); }}
                    placeholder={t('accounting.branch')}
                    options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <Select
                    value={statusFilter || null}
                    onChange={(v) => { setStatusFilter((v as string) ?? ''); setPageIndex(0); }}
                    placeholder={t('retail.bills.statusFilter')}
                    options={STATUS_VALUES.map(s => ({ label: t(`retail.bills.tab_${s}`), value: s }))}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
              </div>

              <DataTable<RetailBillRow>
                data={bills}
                renderRow={(row) => {
                  const b = row.original;
                  const isSelected = selectedBillId === b.id;
                  const statusColor = b.status === 'PAID' ? 'success' : b.status === 'VOIDED' ? 'default' : 'warning';
                  return (
                    <button
                      key={b.id}
                      className={`w-full text-left px-4 py-3 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => {
                        setSelectedBillId(b.id);
                        if (isMobile) goTo('detail');
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-mono text-sm font-medium">{b.code_display}</span>
                          <Badge color={statusColor} size="sm">{b.status}</Badge>
                        </div>
                        <div className="text-xs text-fg/60 truncate">
                          {b.customer_name || t('retail.walkIn')}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium tabular-nums">{fmtCurrency(b.total_amount)}</div>
                        <div className="text-xs text-fg/50">
                          <DateTime value={b.bill_date} showTime={false} />
                        </div>
                      </div>
                    </button>
                  );
                }}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[10, 25, 50]}
                rowCount={totalCount}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={<div className="p-8 text-center text-subtler">{t('retail.bills.empty')}</div>}
              />
            </PageNavPanel>

            <PageNavPanel id="detail" className="flex-1 overflow-y-auto better-scroll">
              {!selectedBillId && (
                <div className="flex-1 h-full flex items-center justify-center text-subtler p-8">
                  {t('retail.bills.selectToView')}
                </div>
              )}
              {selectedBillId && <RetailBillDetail billId={selectedBillId} />}
            </PageNavPanel>
          </div>

          <CreateRetailBillModal
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['retail', 'bills'] });
              setPageIndex(0);
            }}
          />
        </>
      )}
    </PageNav>
  );
}

function RetailBillDetail({ billId }: { billId: number }) {
  const { t } = useTranslation();

  const { data: details, isLoading } = useQuery({
    queryKey: ['retail', 'bill-detail', billId],
    queryFn: () => apiClient.get<BillDetail[]>(`/v_bill_detail?bill_id=eq.${billId}`),
  });

  if (isLoading) return <div className="p-6 text-sm text-subtler">{t('common.loading')}</div>;
  const detail = details?.[0];
  if (!detail) return <div className="p-6 text-sm text-subtler">—</div>;

  const lines = detail.line_items ?? [];
  const payments = detail.payments ?? [];
  const statusColor = detail.status === 'PAID' ? 'success' : detail.status === 'VOIDED' ? 'default' : 'warning';

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center gap-3 mb-1">
        <h2 className="heading-3 font-mono">{detail.bill_code_display}</h2>
        <Badge color={statusColor} size="sm">{detail.status}</Badge>
      </div>
      <div className="text-sm text-fg/60 mb-6">
        {detail.customer_name || t('retail.walkIn')}
      </div>

      <dl className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <dt className="text-xs text-fg/60 uppercase mb-1">{t('retail.bills.totalCharged')}</dt>
          <dd className="text-base font-semibold tabular-nums">{fmtCurrency(detail.total_amount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg/60 uppercase mb-1">{t('retail.bills.totalPaid')}</dt>
          <dd className="text-base font-semibold tabular-nums">{fmtCurrency(detail.paid_amount)}</dd>
        </div>
      </dl>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-semibold text-fg/60 uppercase mb-3">
            {t('retail.bills.lineItems')} ({lines.length})
          </div>
          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.line_id} className="flex items-center gap-2 text-sm">
                <Badge size="sm" color="default">{line.charge_type}</Badge>
                <span className="flex-1 min-w-0 truncate">{line.description}</span>
                <span className="tabular-nums font-medium shrink-0">
                  {fmtCurrency(line.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-fg/60 uppercase mb-3">
            {t('retail.bills.payments')} ({payments.length})
          </div>
          {payments.length === 0 ? (
            <div className="text-sm text-fg/40 italic">{t('retail.bills.noPayments')}</div>
          ) : (
            <div className="space-y-2">
              {payments.map((pay) => (
                <div key={pay.id} className="flex items-center gap-2 text-sm">
                  <Badge color={METHOD_COLOR[pay.method] ?? 'default'} size="sm">
                    {pay.method}
                  </Badge>
                  <span className="flex-1 min-w-0 truncate text-fg/60">
                    {pay.bank_name ? `${pay.bank_name} ${pay.account_number ?? ''}` : '—'}
                  </span>
                  <span className="tabular-nums font-medium shrink-0">
                    {fmtCurrency(pay.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
