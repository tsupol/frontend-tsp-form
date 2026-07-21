// Team Load (ภาระงานทีม) — per-collector workload + capacity control.
// Reads v_collector_load. Capacity write (OPS.ASSIGN.MANAGE) via
// ops_collector_set_capacity, which returns branch_shares to re-render live.
// With only OPS.ASSIGN.OVERSEE, renders read-only (no slider).

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { MobileHeader, Slider, useSnackbarContext } from 'tsp-form';
import { ArrowRightFromLine, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { useCollectorLoad, setCollectorCapacity, mgrKeys, type CollectorLoad } from './managerApi';

function CapacityControl({
  row, sharePreview, onCommit, readOnly,
}: {
  row: CollectorLoad;
  sharePreview: number;
  onCommit: (pct: number) => Promise<void>;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const [pct, setPct] = useState(row.capacity_pct);
  const [saving, setSaving] = useState(false);

  // Keep local slider in sync when the row re-renders from branch_shares.
  useEffect(() => { setPct(row.capacity_pct); }, [row.capacity_pct]);

  if (readOnly) {
    return (
      <div className="text-sm">
        <span className="font-medium">{row.capacity_pct}%</span>
        <span className="text-subtle text-xs ml-2">→ {row.share_pct}%</span>
      </div>
    );
  }

  const commit = async () => {
    if (pct === row.capacity_pct) return;
    setSaving(true);
    try { await onCommit(pct); } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-1 min-w-48">
      <div className="flex items-center gap-2">
        <Slider
          value={pct}
          min={0}
          max={100}
          step={5}
          onChange={setPct}
          className="flex-1"
          disabled={saving}
        />
        <span className="text-sm font-medium w-10 text-right">{pct}%</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-subtle">
          {t('collectionsManager.sharePreview', { pct: pct === row.capacity_pct ? row.share_pct : Math.round(sharePreview * 10) / 10 })}
        </span>
        {pct !== row.capacity_pct && (
          <button
            className="text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer disabled:opacity-50"
            onClick={commit}
            disabled={saving}
          >
            {t('common.save')}
          </button>
        )}
      </div>
    </div>
  );
}

export function TeamLoadPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { data, isLoading, isError } = useCollectorLoad();
  const canManage = can('OPS.ASSIGN.MANAGE');

  const commitCapacity = async (userId: number, pct: number) => {
    try {
      const res = await setCollectorCapacity(userId, pct, t('collectionsManager.reassignReason'));
      // Re-render the whole table from branch_shares — one write shifts everyone.
      queryClient.setQueryData<CollectorLoad[]>(mgrKeys.collectorLoad, (prev) => {
        if (!prev) return prev;
        const byId = new Map(res.branch_shares.map(s => [s.collector_user_id, s]));
        return prev.map(r => {
          const s = byId.get(r.collector_user_id);
          return s ? { ...r, capacity_pct: s.capacity_pct, share_pct: s.share_pct } : r;
        });
      });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={18} /><span>{t('collectionsManager.capacitySaved')}</span></div>,
        type: 'success', duration: 2500,
      });
    } catch {
      addSnackbar({
        message: <div className="alert alert-danger"><XCircle size={18} /><span>{t('common.error')}</span></div>,
        type: 'error', duration: 2500,
      });
    }
  };

  // Preview: naive re-share estimate as the slider moves (server is authoritative on commit).
  const totalCapacityExcl = (data ?? []).reduce((sum, r) => sum + r.capacity_pct, 0);

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
        <div className="mobile-header-title mobile-header-title-truncate">{t('collectionsManager.teamLoadTitle')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content flex flex-col gap-4 p-4">
        <div className="hidden md:flex items-center gap-3">
          <h1 className="heading-2">{t('collectionsManager.teamLoadTitle')}</h1>
          {!canManage && <span className="text-xs text-subtle">{t('collectionsManager.capacityReadOnly')}</span>}
        </div>
        {canManage && <div className="text-xs text-subtle">{t('collectionsManager.capacityHint')}</div>}

        {isLoading && <div className="text-subtle">{t('common.loading')}</div>}
        {isError && <div className="alert alert-danger"><AlertTriangle size={18} /><span>{t('common.error')}</span></div>}
        {data && data.length === 0 && <div className="text-subtler">{t('collectionsManager.noCollectors')}</div>}

        {data && data.length > 0 && (
          <div className="flex flex-col gap-3">
            {data.map(row => {
              // Estimate this row's share if its slider value changed (server re-computes on commit).
              const previewShare = totalCapacityExcl > 0 ? (row.capacity_pct / totalCapacityExcl) * 100 : 0;
              return (
                <div key={row.collector_user_id} className="rounded-lg border border-line p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="font-medium">{row.collector_username}</div>
                    <CapacityControl
                      row={row}
                      sharePreview={previewShare}
                      onCommit={(pct) => commitCapacity(row.collector_user_id, pct)}
                      readOnly={!canManage}
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-subtle">{t('collectionsManager.activeContracts')}</div>
                      <div className="font-medium">{row.active_contract_count}</div>
                    </div>
                    <div>
                      <div className="text-xs text-subtle">{t('collectionsManager.overdueAmount')}</div>
                      <div className="font-medium">
                        ฿{fmtCurrency(row.overdue_amount)}
                        <span className="text-subtle text-xs ml-1">({row.overdue_amount_share_pct}%)</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-subtle">{t('collectionsManager.overdueInstallments')}</div>
                      <div className="font-medium">{row.overdue_installments}<span className="text-subtle text-xs">/{row.held_installments}</span></div>
                    </div>
                    <div>
                      <div className="text-xs text-subtle">{t('collectionsManager.dueNext30d')}</div>
                      <div className="font-medium">{row.installments_due_next_30d}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
