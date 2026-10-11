// Pick a deal-partner shop's commission plan (mig 1400, work order 10-10 §A).
//
// Its own window rather than a dropdown in the shop's edit window: the plans
// differ in WHEN the shop is paid, not just in name, and that needs room to be
// read. Each plan is a card with its steps and the backend's description.
//
// Only the plan is sent — every other parameter of the save is left out, which
// the backend reads as "keep as is". Clearing goes back to the old system.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Modal } from 'tsp-form';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { useCommissionPlans, planTranchesLabel, type PlanTranche } from './shopCommissionTypes';

/** The shop's current plan, as the shop list carries it. */
export interface CommissionPlanTarget {
  branch_id: number;
  branch_name: string;
  company_name: string | null;
  commission_plan: string | null;
  commission_plan_name: string | null;
}

export interface SavedRow {
  commission_plan: string | null;
  commission_plan_name: string | null;
  commission_plan_tranches: PlanTranche[] | null;
}

interface Props {
  open: boolean;
  shop: CommissionPlanTarget | null;
  onClose: () => void;
  /** Called with what the backend saved, for screens showing the plan beneath. */
  onSaved: (saved: SavedRow & { branch_id: number }) => void;
}

export function CommissionPlanModal({ open, shop: shopProp, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const { data: plans = [] } = useCommissionPlans();

  const lastShop = useRef(shopProp);
  if (shopProp) lastShop.current = shopProp;
  const shop = shopProp ?? lastShop.current;

  const [picked, setPicked] = useState('');
  const [view, setView] = useState<'form' | 'done'>('form');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SavedRow | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) {
      setPicked(shopProp?.commission_plan ?? '');
      setView('form');
      setError(null);
      setResult(null);
    }
  }, [open, shopProp?.branch_id, shopProp?.commission_plan]);

  const current = shop?.commission_plan ?? '';
  const dirty = picked !== current;

  // Open plans can be picked; the shop's current plan stays listed even after
  // it was closed, so the window still names what is in force.
  const cards = plans.filter(p => p.is_active || p.code === current);
  const nameOf = (code: string) =>
    code ? (plans.find(p => p.code === code)?.name_th ?? code) : t('shopCommission.planNoneShort');

  const handleSave = async () => {
    if (!shop || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await apiClient.rpc<SavedRow>('fn_deal_partner_branch_config_set', {
        p_branch_id: shop.branch_id,
        ...(picked ? { p_commission_plan: picked } : { p_clear_commission_plan: true }),
      });
      setResult(saved);
      setView('done');
      onSaved({ ...saved, branch_id: shop.branch_id });
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (saving) return;
    if (view === 'form' && dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const card = (code: string, title: string, sub: string | null, desc: string | null, closed = false) => {
    const selected = picked === code;
    return (
      <button
        key={code || 'none'}
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => setPicked(code)}
        className={`w-full text-left px-3 py-2.5 rounded-md border cursor-pointer transition-colors flex items-start gap-3 ${
          selected ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-hover'
        }`}
      >
        <span className={`mt-1 shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${selected ? 'border-primary' : 'border-line'}`}>
          {selected && <span className="w-2 h-2 rounded-full bg-primary" />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{title}</span>
            {code === current && <Badge size="sm" color="info">{t('shopCommission.planCurrent')}</Badge>}
            {closed && <Badge size="sm" color="warning">{t('shopCommission.planClosedBadge')}</Badge>}
          </span>
          {sub && <span className="block text-sm mt-0.5">{sub}</span>}
          {desc && <span className="block text-xs text-subtle mt-0.5">{desc}</span>}
        </span>
      </button>
    );
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('shopCommission.planModalTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="flex flex-col gap-3 pb-2">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{shop?.branch_name ?? '—'}</div>
                  <div className="text-xs text-subtle">
                    {t('shopCommission.planNow', { plan: nameOf(current) })}
                  </div>
                </div>

                <div className="alert alert-info text-sm">
                  <span>{t('shopCommission.planEffectHint')}</span>
                </div>

                <div role="radiogroup" aria-label={t('shopCommission.plan')} className="flex flex-col gap-2">
                  {cards.map(p => card(
                    p.code,
                    `${p.name_th} · ${Number(p.total_pct)}%`,
                    planTranchesLabel(p.tranches, t),
                    p.description,
                    !p.is_active,
                  ))}
                  {card('', t('shopCommission.planNoneShort'), null, t('shopCommission.planNoneDesc'))}
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleSave} disabled={saving || !dirty || !shop}>
                {t('common.save')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('shopCommission.planSaved')}
            contractCode={shop?.branch_name ?? ''}
            stateTransition={{
              from: nameOf(current),
              to: result.commission_plan ? (result.commission_plan_name ?? result.commission_plan) : t('shopCommission.planNoneShort'),
              toColor: 'success',
            }}
            detailRows={result.commission_plan ? [
              { label: t('shopCommission.planSteps'), value: planTranchesLabel(result.commission_plan_tranches, t) },
            ] : []}
            extras={<p className="text-sm text-subtle">{t('shopCommission.planEffectHint')}</p>}
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
