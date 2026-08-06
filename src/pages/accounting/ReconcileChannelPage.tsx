import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  MobileHeader, Badge, InputDateRangePicker, Button,
} from 'tsp-form';
import {
  ArrowRightFromLine, Keyboard, ChevronRight, ChevronDown, Banknote, Landmark, Building2, Wallet, FileSpreadsheet, Loader2, Receipt, Image as ImageIcon, XCircle,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { MediaLightbox } from '../../components/MediaLightbox';
import { FilterBar, type FilterBarItem } from '../../components/FilterBar';
import {
  fmtCurrency, toLocalDateStr, parseLocalDate, makeDateRangePickerFormat,
} from '../../lib/format';
import type { Branch, ReconcileChannelResult, ReconcileChannelPayment } from './accountingTypes';
import { exportReconcileChannel } from './dayCloseExport';
import { MiniPager } from './MiniPager';
import { useReconcileBranchScope, useReconcileDateRange, branchRpcParams, type BranchScope } from './useReconcileBranchScope';
import { BranchScopeSelect } from './BranchScopeSelect';
import { BranchBreakdownStrip } from './BranchBreakdownStrip';
import { translateApiError } from '../../lib/apiErrors';

type Channel = 'CASH' | 'TRANSFER' | 'HOLDING_BUDGET' | 'WALLET';

const SLIPS_PER_PAGE = 10;

function defaultRange() {
  const today = new Date();
  const to = toLocalDateStr(today);
  const fromD = new Date(today);
  fromD.setDate(fromD.getDate() - 6);
  return { from: toLocalDateStr(fromD), to };
}

export function ReconcileChannelPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const userBranchId = isBranchUser && user?.branch_id ? String(user.branch_id) : '';

  const initial = defaultRange();
  const [, setSearchParams] = useSearchParams();
  // Shared with ① ยอดนำส่ง — the two pages must always read the same branch set
  // so ①total_amount and ②remit_total stay comparable.
  const fallbackScope: BranchScope = userBranchId
    ? { mode: 'SET', branchIds: [Number(userBranchId)] }
    : { mode: 'ALL' };
  const { scope, setScope } = useReconcileBranchScope(fallbackScope);
  const { from: fromDate, to: toDate } = useReconcileDateRange(initial);

  const [isTypingRange, setIsTypingRange] = useState(false);
  const [expanded, setExpanded] = useState<Set<Channel>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [slipOnly, setSlipOnly] = useState(false);
  // Slip image lightbox (private key → presigned via useMediaUrl inside).
  const [slipImageKey, setSlipImageKey] = useState<string | null>(null);

  const pendingPatchRef = useRef<Record<string, string> | null>(null);
  const updateFilters = useCallback((patch: Partial<{ from: string; to: string }>) => {
    if (pendingPatchRef.current) {
      Object.assign(pendingPatchRef.current, patch);
      return;
    }
    pendingPatchRef.current = { ...patch } as Record<string, string>;
    queueMicrotask(() => {
      const merged = pendingPatchRef.current ?? {};
      pendingPatchRef.current = null;
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(merged)) {
          if (v) next.set(k, v);
          else if (k === 'from' || k === 'to') next.set(k, '');
          else next.delete(k);
        }
        return next;
      }, { replace: true });
    });
  }, [setSearchParams]);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const scopedBranches = scope.mode === 'SET'
    ? branches.filter(b => scope.branchIds.includes(b.id))
    : branches;
  // Company comes from the JWT; picked branches only narrow within it. RLS still
  // scopes the RPC to what the user may see.
  const companyId = user?.company_id ?? scopedBranches[0]?.company_id ?? null;

  const branchParams = branchRpcParams(scope);
  const { data, isFetching, error } = useQuery({
    queryKey: ['accounting', 'reconcile-channel', branchParams.p_branch_ids?.join(',') ?? 'all', companyId, fromDate, toDate],
    queryFn: () => apiClient.rpc<ReconcileChannelResult>('fn_reconcile_by_channel', {
      p_company_id: companyId,
      ...branchParams,
      p_date_from: fromDate,
      p_date_to: toDate,
    }),
    enabled: !!companyId,
    placeholderData: keepPreviousData,
  });
  const errorMessage = error ? translateApiError(error, t) : null;

  // by_branch[] here carries no branch_name (unlike ①'s) — join the names from
  // the branch list. `physical` is the per-branch figure that matters on ②:
  // the cash+transfer the branch has to count.
  const branchNameById = useMemo(
    () => new Map(branches.map(b => [b.id, b.name])),
    [branches],
  );
  // Carry the per-branch problem signals too — a closer scanning 30 branches
  // needs to see which ones are short/over or owe a wallet settlement, not just
  // who has the biggest till.
  const branchBreakdown = (data?.by_branch ?? []).map(b => ({
    branchId: b.branch_id,
    name: branchNameById.get(b.branch_id) ?? String(b.branch_id),
    amount: b.physical,
    shortage: b.shortage,
    overage: b.overage,
    walletAction: b.wallet_action,
    walletActionAmount: b.wallet_action_amount,
  }));

  const summary = data?.summary;
  // "เฉพาะจากสลิป" filters the expandable payment lists (client-side — payments[]
  // arrives un-paginated). The channel totals above stay unchanged.
  const shownPayments = useMemo(
    () => slipOnly ? (data?.payments ?? []).filter(p => p.from_slip_submission) : (data?.payments ?? []),
    [data?.payments, slipOnly],
  );
  const paymentsByMethod = useMemo(() => {
    const m = new Map<string, ReconcileChannelPayment[]>();
    for (const p of shownPayments) {
      const arr = m.get(p.method) ?? [];
      arr.push(p);
      m.set(p.method, arr);
    }
    return m;
  }, [shownPayments]);
  const hasSlipPayments = (summary?.slip_payment_count ?? 0) > 0;

  // Holding-budget (คืนเงินเจรจา) net. summary.net_holding_budget is authoritative
  // but only populated from the persisted day_close snapshot AFTER close — on an
  // open day it stays 0 even when there are HOLDING_BUDGET payments. So fall back
  // to summing the live payments so the row shows before close too.
  const holdingBudgetLive = useMemo(
    () => (data?.payments ?? []).filter(p => p.method === 'HOLDING_BUDGET').reduce((s, p) => s + p.amount, 0),
    [data?.payments],
  );
  const holdingBudgetNet = (summary?.net_holding_budget ?? 0) !== 0
    ? summary!.net_holding_budget
    : holdingBudgetLive;

  const toggle = (c: Channel) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(c) ? next.delete(c) : next.add(c);
    return next;
  });

  const handleExport = async () => {
    if (!summary) return;
    setExporting(true);
    try {
      const branchLabel = scope.mode === 'ALL'
        ? 'all'
        : scopedBranches.map(b => b.name).join('-') || scope.branchIds.join('-');
      // Export what's on screen — respects the "เฉพาะจากสลิป" filter.
      await exportReconcileChannel(
        summary,
        shownPayments,
        t,
        `moneycheck_${branchLabel}_${fromDate}_${toDate}`,
      );
    } finally {
      setExporting(false);
    }
  };
  const canExport = !!summary && !exporting;

  const dateFilter: ReactNode = (
    <InputDateRangePicker
      fromDate={parseLocalDate(fromDate)}
      toDate={parseLocalDate(toDate)}
      onFromDateChange={(d) => updateFilters({ from: toLocalDateStr(d) })}
      onToDateChange={(d) => updateFilters({ to: toLocalDateStr(d) })}
      dateFormat={makeDateRangePickerFormat(i18n.language)}
      size="sm"
      locale={i18n.language}
      calendar="gregorian"
      endIcon={<Keyboard size={14} />}
      onEndIconClick={() => setIsTypingRange(v => !v)}
      typingMode={isTypingRange}
      onTypingModeChange={setIsTypingRange}
      typingMask="##/##/#### - ##/##/####"
      typingPlaceholder="DD/MM/YYYY - DD/MM/YYYY"
      parseTypedDates={(raw) => {
        const parse = (digits: string) => {
          if (digits.length !== 8) return null;
          const day = parseInt(digits.slice(0, 2), 10);
          const month = parseInt(digits.slice(2, 4), 10);
          let year = parseInt(digits.slice(4, 8), 10);
          if (year > 2400) year -= 543;
          if (month < 1 || month > 12 || day < 1 || day > 31) return null;
          const d = new Date(year, month - 1, day);
          if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
          return d;
        };
        return {
          from: parse(raw.slice(0, 8)),
          to: raw.length >= 16 ? parse(raw.slice(8, 16)) : null,
        };
      }}
    />
  );
  const branchNode: ReactNode = (
    <BranchScopeSelect
      branches={branches}
      scope={scope}
      onChange={setScope}
      disabled={isBranchUser}
    />
  );
  const slipToggleNode: ReactNode = (
    <Button
      size="sm"
      variant={slipOnly ? undefined : 'outline'}
      color={slipOnly ? 'primary' : undefined}
      startIcon={<Receipt size={14} />}
      onClick={() => setSlipOnly(v => !v)}
    >
      {t('accounting.reconcile.slipOnly', { defaultValue: 'From slip only' })}
    </Button>
  );
  const filterItems: FilterBarItem[] = [
    { key: 'date', width: 260, node: dateFilter, priority: 20 },
    { key: 'branch', width: 240, node: branchNode, priority: 10 },
    ...(hasSlipPayments ? [{ key: 'slip', width: 150, node: slipToggleNode, priority: 8 }] : []),
  ];

  return (
    <>
      <MobileHeader className="mobile-header-scrolled-shadow md:hidden">
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
          {t('accounting.reconcile.channelTitle')}
        </div>
        <div className="mobile-header-end w-nav flex items-center justify-center">
          <Button
            size="sm"
            variant="ghost"
            className="btn-icon-sm"
            startIcon={exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            onClick={handleExport}
            disabled={!canExport}
            aria-label={t('accounting.reconcile.export')}
          />
        </div>
      </MobileHeader>

      <div className="flex flex-col h-dvh">
        <div className="flex-none px-4 py-2.5 border-b border-line items-center gap-4 max-md:hidden flex">
          <h1 className="heading-2 shrink-0">{t('accounting.reconcile.channelTitle')}</h1>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            startIcon={exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            onClick={handleExport}
            disabled={!canExport}
          >
            {exporting ? t('accounting.reconcile.exporting') : t('accounting.reconcile.export')}
          </Button>
        </div>

        <FilterBar
          className="flex-none p-2 border-b border-line"
          items={filterItems}
          activeCount={0}
        />

        {/* Per-branch split (by_branch[]) — only when the scope spans >1 branch */}
        <BranchBreakdownStrip
          entries={branchBreakdown}
          label={t('accounting.reconcile.mustCount')}
          total={summary?.physical}
        />

        <div className={`flex-1 min-h-0 overflow-auto better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          {errorMessage && (
            <div className="m-4 alert alert-danger">
              <XCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}
          {!errorMessage && summary && (
            <div className="max-w-2xl mx-auto p-4">
              {/* Column headers */}
              <div className="flex items-center gap-3 px-2 pb-2 text-xs font-semibold text-subtle uppercase tracking-wider">
                <span className="flex-1" />
                <span className="w-24 text-right">{t('accounting.reconcile.system')}</span>
                <span className="w-24 text-right">{t('accounting.reconcile.counted')}</span>
                <span className="w-20 text-right">{t('accounting.reconcile.diff')}</span>
                <span className="w-24 text-right">{t('accounting.reconcile.shortOver')}</span>
              </div>

              {/* Cash */}
              <ChannelRow
                icon={<Banknote size={16} className="text-success" />}
                label={t('accounting.reconcile.cash')}
                net={summary.net_cash}
                counted={summary.counted_cash}
                diff={summary.diff_cash}
                shortage={summary.cash_shortage}
                overage={summary.cash_overage}
                open={expanded.has('CASH')}
                onToggle={() => toggle('CASH')}
                payments={paymentsByMethod.get('CASH') ?? []}
                onViewSlip={setSlipImageKey}
              />
              {/* Transfer */}
              <ChannelRow
                icon={<Landmark size={16} className="text-primary-fg" />}
                label={t('accounting.reconcile.transfer')}
                net={summary.net_transfer}
                counted={summary.counted_transfer}
                diff={summary.diff_transfer}
                shortage={summary.transfer_shortage}
                overage={summary.transfer_overage}
                open={expanded.has('TRANSFER')}
                onToggle={() => toggle('TRANSFER')}
                payments={paymentsByMethod.get('TRANSFER') ?? []}
                onViewSlip={setSlipImageKey}
              />
              {/* งบ holding — holding-refund payouts (mig 714). Shown only when
                  there's activity; read-only (no count, no shortage/overage). */}
              {holdingBudgetNet !== 0 && (
                <ChannelRow
                  icon={<Building2 size={16} className="text-secondary-fg" />}
                  label={t('accounting.reconcile.holdingBudget')}
                  note={t('accounting.reconcile.holdingBudgetNote')}
                  net={holdingBudgetNet}
                  counted={null}
                  diff={null}
                  shortage={0}
                  overage={0}
                  readOnly
                  open={expanded.has('HOLDING_BUDGET')}
                  onToggle={() => toggle('HOLDING_BUDGET')}
                  payments={paymentsByMethod.get('HOLDING_BUDGET') ?? []}
                  onViewSlip={setSlipImageKey}
                />
              )}

              {/* Transfer breakdown — how net_transfer arrived: front-store (staff-
                  recorded) vs back-office (slip-checked). Both already inside
                  net_transfer above; this only shows the split so the closer knows
                  which side each baht came from (migs 537/543). */}
              <div className="pl-9 pr-2 pb-1 flex flex-col gap-1 text-xs">
                <div className="flex flex-col py-1">
                  <div className="flex items-center gap-3">
                    <span className="flex-1 text-subtle">{t('accounting.reconcile.transferFront')}</span>
                    <span className="w-24 text-right tabular-nums text-fg">{fmtCurrency(summary.transfer_front_total)}</span>
                    <span className="w-24" /><span className="w-20" /><span className="w-24" />
                  </div>
                  {/* mig 1014 — the net figure hides money that came in and went back
                      out the same channel. Show the gross split only on days that
                      actually had a refund; a normal day stays a single clean line. */}
                  {summary.transfer_front_refund !== 0 && (
                    <span className="text-subtler mt-0.5">
                      {t('accounting.reconcile.transferFrontDetail', {
                        received: fmtCurrency(summary.transfer_front_in),
                        refunded: fmtCurrency(summary.transfer_front_refund),
                      })}
                    </span>
                  )}
                </div>
                <div className="flex flex-col py-1">
                  <div className="flex items-center gap-3">
                    <span className="flex-1 text-subtle">{t('accounting.reconcile.transferBack')}</span>
                    <span className="w-24 text-right tabular-nums text-fg">{fmtCurrency(summary.slip_payment_total)}</span>
                    <span className="w-24" /><span className="w-20" /><span className="w-24" />
                  </div>
                  {summary.slip_reversed_total !== 0 && (
                    <span className="text-subtler mt-0.5">
                      {t('accounting.reconcile.transferBackDetail', {
                        count: summary.slip_payment_count,
                        reversed: fmtCurrency(Math.abs(summary.slip_reversed_total)),
                        net: fmtCurrency(summary.slip_payment_total),
                      })}
                    </span>
                  )}
                </div>
              </div>

              {/* Must-count subtotal */}
              <div className="flex items-center gap-3 py-3 px-2 border-t-2 border-line">
                <span className="flex-1 font-medium">{t('accounting.reconcile.mustCount')}</span>
                <span className="w-24 text-right tabular-nums font-semibold">{fmtCurrency(summary.physical)}</span>
                <span className="w-24" />
                <span className="w-20" />
                <span className="w-24" />
              </div>

              {/* Wallet action helper — in/usage/cashout/net + action badge (mig 488).
                  Not a mano-count line: it tells the branch to withdraw from / remit surplus to company. */}
              <div className="mt-1 py-3 px-3 border-t border-line bg-secondary-soft rounded-md">
                <div className="flex items-center gap-2">
                  <Wallet size={16} className="text-secondary-fg" />
                  <span className="font-medium flex-1">{t('accounting.reconcile.wallet')}</span>
                  {summary.wallet_action !== 'NONE' && (
                    <Badge color={summary.wallet_action === 'WITHDRAW_FROM_COMPANY' ? 'warning' : 'success'}>
                      {t(`accounting.reconcile.walletAction_${summary.wallet_action}`, {
                        amount: fmtCurrency(summary.wallet_action_amount),
                      })}
                    </Badge>
                  )}
                </div>
                <div className="mt-2 space-y-1 text-xs text-subtle">
                  <div className="flex items-center justify-between">
                    <span>{t('accounting.reconcile.walletIn')}</span>
                    <span className="tabular-nums text-fg">+{fmtCurrency(summary.wallet_in)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t('accounting.reconcile.walletUsage')}</span>
                    <span className="tabular-nums text-fg">−{fmtCurrency(summary.wallet_usage)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t('accounting.reconcile.walletCashout')}</span>
                    <span className="tabular-nums text-fg">−{fmtCurrency(summary.wallet_cashout)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-line/60 font-medium text-fg">
                    <span>{t('accounting.reconcile.walletNet')}</span>
                    <span className={`tabular-nums ${summary.wallet_net < 0 ? 'text-warning-fg' : summary.wallet_net > 0 ? 'text-success' : ''}`}>
                      {summary.wallet_net > 0 ? '+' : ''}{fmtCurrency(summary.wallet_net)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Remit total (= Step 1) */}
              <div className="flex items-center gap-3 py-3 px-2 border-t-2 border-line mt-1">
                <span className="flex-1 font-semibold">{t('accounting.reconcile.totalRemit')}</span>
                <span className="w-24 text-right text-lg font-bold tabular-nums text-primary-fg">
                  {fmtCurrency(summary.remit_total)}
                </span>
                <span className="w-20" />
                <span className="w-24" />
              </div>

              {(summary.diff_cash === null || summary.diff_transfer === null) && (
                <div className="mt-3 text-center text-xs text-subtler">
                  {t('accounting.reconcile.notClosedYet')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <MediaLightbox
        open={slipImageKey !== null}
        onClose={() => setSlipImageKey(null)}
        mediaKey={slipImageKey}
        alt={t('accounting.reconcile.slipImageAlt', { defaultValue: 'Payment slip' })}
      />
    </>
  );
}

function ChannelRow({
  icon, label, net, counted, diff, shortage, overage, open, onToggle, payments, onViewSlip,
  readOnly = false, note,
}: {
  icon: ReactNode;
  label: string;
  net: number;
  counted: number | null;
  diff: number | null;
  shortage: number;
  overage: number;
  open: boolean;
  onToggle: () => void;
  payments: ReconcileChannelPayment[];
  onViewSlip: (key: string) => void;
  // readOnly = a shown-not-counted channel (งบ holding): blanks the
  // counted/diff/short-over columns — no till count, no shortage/overage.
  readOnly?: boolean;
  note?: string;
}) {
  const { t } = useTranslation();
  const hasSlips = payments.length > 0;
  // 3 states (§89): counted === null → รอนับ (grey); shortage=overage=0 → ตรง ✓;
  // else the shortage (red) / overage (amber) amount. Use counted, not the value,
  // to detect "uncounted" — the range summary COALESCEs shortage to 0 even then.
  const uncounted = counted === null;
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(payments.length / SLIPS_PER_PAGE);
  useEffect(() => { if (!open) setPage(1); }, [open]);
  const pageSlips = payments.slice((page - 1) * SLIPS_PER_PAGE, page * SLIPS_PER_PAGE);
  return (
    <div className="border-t border-line">
      <div className="flex items-center gap-3 py-3 px-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={!hasSlips}
          className={`shrink-0 bg-transparent border-none p-0 ${hasSlips ? 'cursor-pointer text-subtle' : 'text-subtler cursor-default'}`}
          aria-label="expand"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {icon}
        <span className="flex-1 font-medium inline-flex items-center gap-2 min-w-0">
          <span className="truncate">{label}</span>
          {note && <span className="text-xs text-subtler shrink-0">{note}</span>}
          {hasSlips && <span className="text-xs text-subtler shrink-0">({payments.length} {t('accounting.reconcile.slips')})</span>}
        </span>
        <span className="w-24 text-right tabular-nums font-medium">{fmtCurrency(net)}</span>
        {readOnly ? (
          <>
            <span className="w-24" />
            <span className="w-20" />
            <span className="w-24" />
          </>
        ) : (
          <>
            <span className="w-24 text-right tabular-nums text-subtle">
              {counted === null ? '—' : fmtCurrency(counted)}
            </span>
            <span className={`w-20 text-right tabular-nums ${diff ? (diff < 0 ? 'text-danger' : 'text-warning') : 'text-subtle'}`}>
              {diff === null ? '—' : fmtCurrency(diff)}
            </span>
            <span className="w-24 text-right tabular-nums text-xs">
              {uncounted ? (
                <span className="text-subtler">{t('accounting.reconcile.pendingCount')}</span>
              ) : shortage > 0 ? (
                <span className="text-danger">−{fmtCurrency(shortage)}</span>
              ) : overage > 0 ? (
                <span className="text-warning-fg">+{fmtCurrency(overage)}</span>
              ) : (
                <span className="text-success">✓ {t('accounting.reconcile.matched')}</span>
              )}
            </span>
          </>
        )}
      </div>

      {open && hasSlips && (
        <div className="pl-9 pb-2">
          {pageSlips.map(p => (
            <div key={p.payment_id} className="flex items-center gap-2 py-1.5 border-t border-line/60">
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  <span className="font-mono text-xs truncate">{p.code}</span>
                  {p.is_reversal && <Badge color="danger" size="xs">{t('accounting.reconcile.refund')}</Badge>}
                  {p.from_slip_submission && (
                    <Badge color="info" size="xs">
                      <span className="inline-flex items-center gap-1">
                        <Receipt size={10} />
                        {p.submission_code ?? t('accounting.reconcile.fromSlip', { defaultValue: 'From slip' })}
                      </span>
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-subtle truncate">
                  {p.bank_name && <>{p.bank_name} {p.account_number} · </>}
                  {p.payer_name && <>{p.payer_name} · </>}
                  <DateTime value={p.created_at} showTime={true} />
                </span>
              </div>
              {p.from_slip_submission && p.slip_key && (
                <button
                  type="button"
                  onClick={() => onViewSlip(p.slip_key!)}
                  className="shrink-0 inline-flex items-center gap-1 text-xs text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer"
                >
                  <ImageIcon size={13} />
                  {t('accounting.reconcile.viewSlip', { defaultValue: 'View slip' })}
                </button>
              )}
              <span className={`shrink-0 text-xs tabular-nums ${p.amount < 0 ? 'text-danger' : ''}`}>
                {fmtCurrency(p.amount)}
              </span>
            </div>
          ))}
          <MiniPager page={page} totalPages={totalPages} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
