import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  MobileHeader, Select, Badge, Button, InputDateRangePicker,
} from 'tsp-form';
import {
  ArrowRightFromLine, Keyboard, FileSpreadsheet, Loader2, Repeat, Flag,
  Landmark, Smartphone, User, Receipt, Image as ImageIcon, ExternalLink,
} from 'lucide-react';
import { ApiError, apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { MediaLightbox } from '../../components/MediaLightbox';
import { FilterBar, type FilterBarItem } from '../../components/FilterBar';
import {
  fmtCurrency, toLocalDateStr, parseLocalDate, makeDateRangePickerFormat,
} from '../../lib/format';
import type { Branch, InstallmentCheckResult } from './accountingTypes';
import { exportInstallmentCheck } from './dayCloseExport';

// Toggleable channels. TRANSFER is the default (bank statement only shows transfers);
// the rest are opt-in. Order matters — it's how the toggle chips render.
const METHOD_OPTIONS = ['TRANSFER', 'CASH', 'SAVING_WALLET', 'CREDIT_WALLET', 'INSURANCE_WALLET'] as const;
const DEFAULT_METHODS = ['TRANSFER'];

function todayStr() {
  return toLocalDateStr(new Date());
}

export function InstallmentCheckPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const userBranchId = isBranchUser && user?.branch_id ? String(user.branch_id) : '';

  const [searchParams, setSearchParams] = useSearchParams();
  const branchId = searchParams.get('branch_id') ?? (isBranchUser ? userBranchId : '__ALL__');
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const fromDate = fromParam === null ? todayStr() : fromParam;
  const toDate = toParam === null ? todayStr() : toParam;
  // methods: absent param = default (TRANSFER only); "__ALL__" = all channels (null to RPC);
  // otherwise a comma list of selected method codes.
  const methodsParam = searchParams.get('methods');
  const selectedMethods: string[] | null = methodsParam === null
    ? DEFAULT_METHODS
    : methodsParam === '__ALL__'
      ? null
      : methodsParam.split(',').filter(Boolean);

  const [isTypingRange, setIsTypingRange] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [slipImageKey, setSlipImageKey] = useState<string | null>(null);

  const pendingPatchRef = useRef<Record<string, string> | null>(null);
  const updateFilters = useCallback((patch: Record<string, string>) => {
    if (pendingPatchRef.current) {
      Object.assign(pendingPatchRef.current, patch);
      return;
    }
    pendingPatchRef.current = { ...patch };
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

  const selectedBranch = branches.find(b => String(b.id) === branchId);
  const allBranches = branchId === '__ALL__';
  // Company comes from the selected branch, or the user's own company (JWT) for
  // "all branches" — or for a branch id not in the visible list (a hand-crafted
  // ?branch_id=X for a branch the user can't see). The RPC re-scopes by role and
  // returns FORBIDDEN in that last case, which we surface below.
  const companyId = selectedBranch?.company_id ?? user?.company_id ?? null;

  const { data, isFetching, error } = useQuery({
    queryKey: ['accounting', 'installment-check', branchId, companyId, fromDate, toDate, methodsParam],
    queryFn: () => apiClient.rpc<InstallmentCheckResult>('fn_installment_check', {
      p_company_id: companyId,
      p_branch_id: allBranches ? null : (branchId ? Number(branchId) : null),
      p_date_from: fromDate,
      p_date_to: toDate,
      p_methods: selectedMethods,
    }),
    enabled: !!branchId && !!companyId,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const isForbidden = error instanceof ApiError && error.message === 'AUTH.AUTH.FORBIDDEN';
  const rows = data?.rows ?? [];

  const toggleMethod = (m: string) => {
    const current = selectedMethods ?? [...METHOD_OPTIONS];
    const next = current.includes(m) ? current.filter(x => x !== m) : [...current, m];
    // Empty selection is meaningless — fall back to the default.
    updateFilters({ methods: next.length ? next.join(',') : DEFAULT_METHODS.join(',') });
  };
  const setAllMethods = () => updateFilters({ methods: '__ALL__' });
  const isMethodOn = (m: string) => selectedMethods === null || selectedMethods.includes(m);

  const handleExport = async () => {
    if (!data || rows.length === 0) return;
    setExporting(true);
    try {
      const branchLabel = selectedBranch?.name ?? (allBranches ? t('accounting.installmentCheck.allBranches') : branchId);
      await exportInstallmentCheck(
        rows,
        data.by_method,
        data.total_amount,
        t,
        `${t('accounting.installmentCheck.title')}_${branchLabel}_${fromDate}_${toDate}`,
      );
    } finally {
      setExporting(false);
    }
  };
  const canExport = rows.length > 0 && !exporting;

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
    <Select
      value={branchId || null}
      onChange={(v) => updateFilters({ branch_id: (v as string) ?? '' })}
      placeholder={t('accounting.reconcile.pickBranch')}
      options={[
        ...(isBranchUser ? [] : [{ label: t('accounting.installmentCheck.allBranches'), value: '__ALL__' }]),
        ...branches.map(b => ({ label: b.name, value: String(b.id) })),
      ]}
      size="sm"
      showChevron
      clearable={false}
      disabled={isBranchUser}
    />
  );
  const filterItems: FilterBarItem[] = [
    { key: 'date', width: 260, node: dateFilter, priority: 20 },
    ...(isBranchUser ? [] : [{ key: 'branch', width: 200, node: branchNode, priority: 10 }]),
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
          {t('accounting.installmentCheck.title')}
        </div>
        <div className="mobile-header-end w-nav flex items-center justify-center">
          <Button
            size="sm"
            variant="ghost"
            className="btn-icon-sm"
            startIcon={exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            onClick={handleExport}
            disabled={!canExport}
            aria-label={t('accounting.installmentCheck.export')}
          />
        </div>
      </MobileHeader>

      <div className="flex flex-col h-dvh">
        <div className="flex-none px-4 py-2.5 border-b border-line items-center gap-4 max-md:hidden flex">
          <h1 className="heading-2 shrink-0">{t('accounting.installmentCheck.title')}</h1>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            startIcon={exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            onClick={handleExport}
            disabled={!canExport}
          >
            {exporting ? t('accounting.installmentCheck.exporting') : t('accounting.installmentCheck.export')}
          </Button>
        </div>

        <FilterBar
          className="flex-none p-2 border-b border-line"
          items={filterItems}
          activeCount={0}
        />

        {/* Channel toggles */}
        <div className="flex-none flex items-center gap-2 flex-wrap px-3 py-2 border-b border-line">
          <span className="text-xs font-medium text-subtle shrink-0">{t('accounting.installmentCheck.channels')}</span>
          {METHOD_OPTIONS.map(m => (
            <button
              key={m}
              type="button"
              onClick={() => toggleMethod(m)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                isMethodOn(m)
                  ? 'bg-primary-soft border-primary-fg text-primary-fg font-medium'
                  : 'border-line text-subtle hover:bg-item-hover-bg'
              }`}
            >
              {t(`paymentMethod.${m}`)}
            </button>
          ))}
          <button
            type="button"
            onClick={setAllMethods}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
              selectedMethods === null
                ? 'bg-primary-soft border-primary-fg text-primary-fg font-medium'
                : 'border-line text-subtle hover:bg-item-hover-bg'
            }`}
          >
            {t('accounting.installmentCheck.allChannels')}
          </button>
        </div>

        <div className={`flex-1 min-h-0 overflow-auto better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          {isForbidden ? (
            <div className="p-8 text-center text-danger">{t('accounting.installmentCheck.forbidden')}</div>
          ) : !branchId ? (
            <div className="p-8 text-center text-subtler">{t('accounting.reconcile.pickBranch')}</div>
          ) : data && data.count === 0 ? (
            <div className="p-8 text-center text-subtler">{t('accounting.installmentCheck.empty')}</div>
          ) : data ? (
            <div className="max-w-3xl mx-auto p-4">
              {/* Summary chips */}
              <div className="flex items-center gap-x-4 gap-y-1 flex-wrap pb-3 mb-1 border-b border-line">
                <span className="font-semibold">
                  {t('accounting.installmentCheck.totalLabel', { count: data.count })}
                  {' · '}
                  <span className="text-primary-fg tabular-nums">{fmtCurrency(data.total_amount)}</span>
                </span>
                {data.by_method.map(m => (
                  <span key={m.method} className="text-xs text-subtle">
                    {t(`paymentMethod.${m.method}`)}{' '}
                    <span className="text-fg tabular-nums">{m.count}/{fmtCurrency(m.total)}</span>
                  </span>
                ))}
              </div>

              {rows.map(r => (
                <div key={r.payment_id} className="py-3 border-b border-line/70">
                  {/* Line 1 — payment code + amount + transfer time */}
                  <div className="flex items-baseline gap-2 flex-wrap">
                    {r.kind === 'EARLY_PAYOFF'
                      ? <Flag size={14} className="text-warning-fg shrink-0 self-center" />
                      : <Repeat size={14} className="text-subtle shrink-0 self-center" />}
                    <span className="font-mono text-sm font-medium">{r.payment_code}</span>
                    <Badge color={r.kind === 'EARLY_PAYOFF' ? 'warning' : 'secondary'} size="xs">
                      {t(`accounting.installmentCheck.kind_${r.kind}`)}
                    </Badge>
                    <span className="ml-auto tabular-nums font-semibold">{fmtCurrency(r.amount)}</span>
                  </div>
                  <div className="text-xs text-subtle mt-0.5">
                    {t(`paymentMethod.${r.method}`)}
                    {' · '}
                    {r.transfer_at
                      ? <>{t('accounting.installmentCheck.transferredAt')} <DateTime value={r.transfer_at} showTime={true} /></>
                      : <><DateTime value={r.paid_at} showTime={true} /></>}
                    {r.days_early != null && r.days_early > 0 && (
                      <> · {t('accounting.installmentCheck.daysEarly', { count: r.days_early })}</>
                    )}
                  </div>

                  {/* Line 2 — bill · contract · customer (bill + contract link out) */}
                  <div className="flex items-center gap-1.5 text-xs text-subtle mt-1.5 flex-wrap">
                    <Receipt size={12} className="shrink-0" />
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/accounting/bills/${r.bill_id}`)}
                      className="font-mono text-primary-fg hover:underline inline-flex items-center gap-0.5 bg-transparent border-none p-0 cursor-pointer"
                    >
                      {r.bill_code}
                      <ExternalLink size={10} />
                    </button>
                    <span className="text-line">|</span>
                    <User size={12} className="shrink-0" />
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/contracts/search/${r.contract_id}`)}
                      className="font-mono text-primary-fg hover:underline inline-flex items-center gap-0.5 bg-transparent border-none p-0 cursor-pointer"
                    >
                      {r.contract_code}
                      <ExternalLink size={10} />
                    </button>
                    <span className="text-fg">{r.customer_name}</span>
                    {r.customer_tel && <span>· {r.customer_tel}</span>}
                  </div>

                  {/* Line 3 — device */}
                  {(r.product_display_name || r.device_serial || r.device_imei) && (
                    <div className="flex items-center gap-1.5 text-xs text-subtle mt-1 flex-wrap">
                      <Smartphone size={12} className="shrink-0" />
                      {r.product_display_name && <span className="text-fg">{r.product_display_name}</span>}
                      {r.device_serial && <span>· S/N {r.device_serial}</span>}
                      {r.device_imei && <span>· IMEI {r.device_imei}</span>}
                      {r.device_external_ref && <span>· ref {r.device_external_ref}</span>}
                    </div>
                  )}

                  {/* Line 4 — transfer origin + slip (transfers only) */}
                  {(r.sender_account_name || r.sender_bank || r.transaction_ref || r.slip_key) && (
                    <div className="flex items-center gap-1.5 text-xs text-subtle mt-1 flex-wrap">
                      <Landmark size={12} className="shrink-0" />
                      {(r.sender_account_name || r.sender_bank) && (
                        <span>
                          {t('accounting.installmentCheck.from')}{' '}
                          {r.sender_account_name}{r.sender_bank ? `/${r.sender_bank}` : ''}
                          {r.sender_account_no ? ` ${r.sender_account_no}` : ''}
                        </span>
                      )}
                      {r.transaction_ref && <span>· ref {r.transaction_ref}</span>}
                      {r.slip_key && (
                        <button
                          type="button"
                          onClick={() => setSlipImageKey(r.slip_key)}
                          className="inline-flex items-center gap-1 text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer ml-1"
                        >
                          <ImageIcon size={12} />
                          {t('accounting.installmentCheck.viewSlip')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-subtler">{t('accounting.reconcile.pickBranch')}</div>
          )}
        </div>
      </div>

      <MediaLightbox
        open={slipImageKey !== null}
        onClose={() => setSlipImageKey(null)}
        mediaKey={slipImageKey}
        alt={t('accounting.installmentCheck.slipImageAlt')}
      />
    </>
  );
}
