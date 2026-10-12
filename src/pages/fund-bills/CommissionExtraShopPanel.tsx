// The right-hand panel for a shop picked on the "ค่าคอมส่วนเพิ่ม" tab of the
// fund documents page: what one press of รวบ would bundle now, and what is
// released but still waiting — step by step, with the contract each belongs to.
//
// The queue row only carries counts; the user picking a shop wants to know
// WHICH steps and WHY they wait, so the steps are read here per shop.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge, Button, Tooltip } from 'tsp-form';
import { ChevronRight, ExternalLink, Store } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { fmtCurrency, formatEntityCode } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import type { CommissionExtraQueueRow } from '../shop-commission/useShopCommission';
import {
  payNoLabel, waitingSummary, TRANCHE_STATUS_COLOR, type CommissionTrancheRow,
} from '../shop-commission/shopCommissionTypes';

type Row = Pick<CommissionTrancheRow,
  'contract_id' | 'contract_code' | 'product_display_name' | 'pay_no' | 'pct' | 'amount' | 'status' | 'unlocked_on' | 'hold_until'>;

export function useCommissionExtraShopTranches(branchId: number | null) {
  return useQuery({
    queryKey: ['shop-commission', 'extra-queue', 'shop', branchId],
    queryFn: () => apiClient.get<Row[]>(
      `/v_commission_tranches?branch_id=eq.${branchId}&status=in.(READY,WAIT_DAY_CLOSE,WAIT_DAY_END,WAIT_HOLD)`
      + '&select=contract_id,contract_code,product_display_name,pay_no,pct,amount,status,unlocked_on,hold_until&order=contract_code,pay_no',
    ),
    enabled: branchId != null,
    staleTime: 10 * 1000,
  });
}

export function CommissionExtraShopPanel({ shop, canBundle, onBundle }: {
  shop: CommissionExtraQueueRow;
  canBundle: boolean;
  onBundle: () => void;
}) {
  const { t } = useTranslation();
  const { data: rows = [], isLoading } = useCommissionExtraShopTranches(shop.branch_id);
  const ready = rows.filter(r => r.status === 'READY');
  const waiting = rows.filter(r => r.status !== 'READY');
  const nothingReady = shop.ready_count === 0;
  const waitingLine = waitingSummary({
    wait_day_close: shop.wait_day_close_count,
    wait_day_end: shop.wait_day_end_count,
    wait_hold: shop.wait_hold_count,
  }, t);

  const when = (r: Row) => r.status === 'WAIT_HOLD'
    ? (r.hold_until ? <>{t('shopCommission.holdUntil')} <DateTime value={r.hold_until} showTime={false} /></> : null)
    : (r.unlocked_on ? <>{t('shopCommission.unlockedOn')} <DateTime value={r.unlocked_on} showTime={false} /></> : null);

  // Groups fold the lists at real volume: ready slices per contract (finance
  // presses รวบ for all of them, so the per-contract sum is what matters);
  // waiting slices per "what they wait for + when", since the question there
  // is when, not which. Each group unfolds to its slices.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  type Group = { key: string; head: React.ReactNode; items: Row[]; total: number };
  const groupBy = (items: Row[], keyOf: (r: Row) => string, headOf: (r: Row) => React.ReactNode): Group[] => {
    const m = new Map<string, Group>();
    for (const r of items) {
      const k = keyOf(r);
      let g = m.get(k);
      if (!g) { g = { key: k, head: headOf(r), items: [], total: 0 }; m.set(k, g); }
      g.items.push(r); g.total += Number(r.amount);
    }
    return [...m.values()];
  };
  const readyGroups = groupBy(ready, r => `c${r.contract_id}`, r => (
    <>
      <Link to={`/admin/contracts/search/${r.contract_id}`} className="font-medium text-primary-fg hover:underline inline-flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
        {formatEntityCode(r.contract_code)}<ExternalLink size={12} />
      </Link>
      {r.product_display_name && <span className="text-xs text-subtle truncate">{r.product_display_name}</span>}
    </>
  ));
  const waitingGroups = groupBy(waiting, r => `${r.status}|${r.status === 'WAIT_HOLD' ? r.hold_until : r.unlocked_on}`, r => (
    <span className="min-w-0 truncate">
      <Badge size="sm" color={TRANCHE_STATUS_COLOR[r.status]}>{t(`shopCommission.tranche_${r.status}`)}</Badge>
      <span className="text-xs text-subtle ml-2">{when(r)}</span>
    </span>
  ));

  const slice = (r: Row, showContract: boolean) => (
    <div key={`${r.contract_id}-${r.pay_no}`} className="pl-9 pr-3 py-1.5 border-t border-line-subtle flex items-center gap-2 text-sm">
      {showContract && (
        <>
          <Link to={`/admin/contracts/search/${r.contract_id}`} className="text-primary-fg hover:underline inline-flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            {formatEntityCode(r.contract_code)}<ExternalLink size={12} />
          </Link>
          {r.product_display_name && <span className="text-xs text-subtle truncate">{r.product_display_name}</span>}
        </>
      )}
      <span className="text-subtle">{payNoLabel(r.pay_no, t)} {Number(r.pct)}%</span>
      <span className="flex-1" />
      <span className="tabular-nums">{fmtCurrency(r.amount)}</span>
    </div>
  );

  const list = (title: string, groups: Group[], count: number, total: number | null, showContractInSlice: boolean, hint?: string) => (
    <div className="rounded-md border border-line overflow-hidden">
      <div className="px-3 py-2 bg-surface text-sm font-medium flex items-center gap-2">
        <span>{title}</span>
        <span className="text-subtle font-normal">({count})</span>
        <span className="flex-1" />
        {total != null && <span className="tabular-nums">{fmtCurrency(total)}</span>}
      </div>
      {hint && count > 0 && (
        <div className="px-3 py-1.5 text-xs text-subtle border-t border-line">{hint}</div>
      )}
      {groups.length === 0 ? (
        <div className="px-3 py-3 text-sm text-subtler">{t('common.noData')}</div>
      ) : groups.map(g => {
        const isOpen = open.has(g.key);
        return (
          <div key={g.key} className="border-t border-line">
            <button type="button" onClick={() => toggle(g.key)}
              className="w-full text-left px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-surface-hover">
              <ChevronRight size={14} className={`shrink-0 text-subtle transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              <span className="flex-1 min-w-0 text-sm flex items-center gap-2">{g.head}</span>
              <span className="text-xs text-subtle shrink-0">{t('shopCommission.sliceCount', { count: g.items.length })}</span>
              <span className="text-sm tabular-nums font-medium shrink-0">{fmtCurrency(g.total)}</span>
            </button>
            {isOpen && g.items.map(r => slice(r, showContractInSlice))}
          </div>
        );
      })}
    </div>
  );

  const bundleButton = (
    <Button size="sm" variant="primary" disabled={nothingReady} onClick={onBundle}>
      {t('shopCommission.extraCreateAction')}
    </Button>
  );

  return (
    <>
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        <Store size={14} className="text-subtle shrink-0" />
        <span className="font-medium text-sm truncate">{shop.branch_name ?? '—'}</span>
        <span className="flex-1" />
        {canBundle && (nothingReady
          ? <Tooltip content={t('shopCommission.extraEmpty', { parts: waitingLine })}><span className="pointer-events-auto inline-flex">{bundleButton}</span></Tooltip>
          : bundleButton)}
      </div>
      <div className="flex-1 overflow-auto better-scroll px-4 py-3">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {isLoading ? (
            <div className="text-sm text-subtler">{t('common.loading')}</div>
          ) : (
            <>
              {list(t('shopCommission.panelReady'), readyGroups, ready.length, shop.ready_amount, false)}
              {list(t('shopCommission.panelWaiting'), waitingGroups, waiting.length, null, true, t('shopCommission.panelWaitingHint'))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
