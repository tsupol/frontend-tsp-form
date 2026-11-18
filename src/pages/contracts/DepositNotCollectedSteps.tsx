import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Tooltip, useSnackbarContext } from 'tsp-form';
import { CheckCircle, ListChecks, Receipt, Link2Off, ShieldCheck, Undo2, XOctagon } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';
import { blockingReasonText } from '../../lib/apiErrors';
import { DateTime } from '../../components/DateTime';
import { ContractFeeModal } from './ContractFeeModal';
import { WalletActionModal } from './wallet/WalletActionModal';
import { useContractInvalidate } from './useContractInvalidate';

// A deposited device the customer never came back for (mig 1724, IMPLEMENT
// 2026-11-18 deposit_not_collected_unbind). The deposit slip says "not collected
// by the deadline = device returned + contract cancelled", but staff could not
// see how to get there. This lays the backend's order out as four steps, each a
// button that already exists — nothing here decides what is allowed:
//   ① waive the late fee   → LATE_FEE_COLLECT (the late-fee window waives)
//   ② unbind the device    → UNBIND_DEVICE, greyed with the deadline until it passes
//   ③ insurance money      → staff pick: keep it as a service charge (company income,
//                            paid from the insurance wallet) or give it back (cash-out)
//   ④ terminate            → TERMINATE_CONTRACT, reason defaults to CUSTOMER_REQUEST
// Each step's tick reads a balance or the bound device off the contract; whether
// a button is pressable comes from fn_contract_available_actions.

export interface DepositStepsContract {
  id: number;
  code?: string;
  code_display?: string | null;
  state: string;
  branch_id: number;
  holding_id?: number;
  company_id?: number | null;
  customer_id?: number | null;
  device_id: number | null;
  deposit_deadline?: string | null;
  late_fee_balance?: number | null;
  insurance_balance?: number | null;
  saving_balance?: number | null;
  credit_balance?: number | null;
}

interface ActionRow {
  action_code: string;
  is_available: boolean;
  blocking_reason?: string | null;
  blocking_params?: Record<string, unknown> | null;
}

export function DepositNotCollectedSteps({
  contract, actions, onRequestAction,
}: {
  contract: DepositStepsContract;
  actions: ActionRow[] | undefined;
  onRequestAction: (action: 'late_fee_collect' | 'unbind_device' | 'terminate') => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const queryClient = useQueryClient();
  const invalidate = useContractInvalidate(contract.id);
  const [keepOpen, setKeepOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);

  const row = (code: string) => actions?.find(a => a.action_code === code);
  const lateFee = Number(contract.late_fee_balance ?? 0) || 0;
  const insurance = Number(contract.insurance_balance ?? 0) || 0;
  const unbound = contract.device_id == null;
  const unbindRow = row('UNBIND_DEVICE');
  const code = contract.code_display ?? contract.code ?? '';

  const steps: {
    key: string; done: boolean; title: string; detail: React.ReactNode; actions?: React.ReactNode;
  }[] = [
    {
      key: 'late_fee',
      done: lateFee <= 0,
      title: t('deposit.notCollected.step1'),
      detail: lateFee > 0
        ? t('deposit.notCollected.step1Owed', { amount: fmtCurrency(lateFee) })
        : t('deposit.notCollected.step1Clear'),
      actions: lateFee > 0 && (
        <Button size="sm" variant="outline" startIcon={<Receipt size={14} />}
          data-action="LATE_FEE_COLLECT"
          disabled={!row('LATE_FEE_COLLECT')?.is_available}
          onClick={() => onRequestAction('late_fee_collect')}>
          {t('deposit.notCollected.step1Button')}
        </Button>
      ),
    },
    {
      key: 'unbind',
      done: unbound,
      title: t('deposit.notCollected.step2'),
      detail: unbound
        ? t('deposit.notCollected.step2Done')
        : unbindRow?.is_available
          ? t('deposit.notCollected.step2NoUndo')
          : (
            <span>
              {t('deposit.notCollected.step2NotYet')}{' '}
              <DateTime value={contract.deposit_deadline ?? null} showTime={false} />
            </span>
          ),
      actions: !unbound && (
        <Tooltip
          content={unbindRow && !unbindRow.is_available && unbindRow.blocking_reason
            ? blockingReasonText({ blocking_reason: unbindRow.blocking_reason, blocking_params: unbindRow.blocking_params }, t)
            : t('deposit.notCollected.step2NoUndo')}
        >
          <span className="inline-flex">
            <Button size="sm" variant="outline" color="danger" startIcon={<Link2Off size={14} />}
              data-action="UNBIND_DEVICE"
              data-blocked-reason={unbindRow?.blocking_reason ?? undefined}
              disabled={!unbindRow?.is_available}
              onClick={() => onRequestAction('unbind_device')}>
              {t('contract.action_unbind_device')}
            </Button>
          </span>
        </Tooltip>
      ),
    },
    {
      key: 'insurance',
      done: insurance <= 0,
      title: t('deposit.notCollected.step3'),
      detail: insurance <= 0
        ? t('deposit.notCollected.step3Clear')
        : unbound
          ? t('deposit.notCollected.step3Choose', { amount: fmtCurrency(insurance) })
          : t('deposit.notCollected.step3AfterUnbind', { amount: fmtCurrency(insurance) }),
      actions: insurance > 0 && (
        <>
          <Button size="sm" variant="outline" startIcon={<ShieldCheck size={14} />}
            disabled={!unbound} onClick={() => setKeepOpen(true)}>
            {t('deposit.notCollected.step3Keep')}
          </Button>
          <Button size="sm" variant="outline" startIcon={<Undo2 size={14} />}
            disabled={!unbound} onClick={() => setRefundOpen(true)}>
            {t('deposit.notCollected.step3Refund')}
          </Button>
        </>
      ),
    },
    {
      key: 'terminate',
      done: contract.state === 'TERMINATED',
      title: t('deposit.notCollected.step4'),
      detail: unbound ? t('deposit.notCollected.step4Detail') : t('deposit.notCollected.step4AfterUnbind'),
      actions: (
        <Button size="sm" variant="outline" color="danger" startIcon={<XOctagon size={14} />}
          data-action="TERMINATE_CONTRACT"
          disabled={!unbound || !row('TERMINATE_CONTRACT')?.is_available}
          onClick={() => onRequestAction('terminate')}>
          {t('deposit.notCollected.step4')}
        </Button>
      ),
    },
  ];
  // The first step not yet done is the one to do now.
  const current = steps.findIndex(s => !s.done);

  return (
    <section className="border border-danger-border rounded-md" data-testid="deposit-not-collected-steps">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
        <ListChecks size={16} className="text-subtle shrink-0" />
        <h3 className="text-sm font-semibold">{t('deposit.notCollected.title')}</h3>
      </header>
      <div className="px-4 py-3 flex flex-col gap-3">
        <div className="text-xs text-subtle">{t('deposit.notCollected.intro')}</div>
        <ol className="flex flex-col gap-3">
          {steps.map((s, i) => (
            <li key={s.key} className="flex items-start gap-3">
              {s.done ? (
                <CheckCircle size={20} className="text-success-fg shrink-0" />
              ) : (
                // A tsp-form Badge, not a hand-made circle: Badge moves its text
                // down by the theme's --text-shift-y, which is what centres digits
                // and Thai in Noto Sans Thai (the font keeps more room above the
                // baseline than below). w-5/h-5/px-0 only make the pill a circle.
                <Badge
                  size="sm"
                  color={i === current ? 'primary' : 'default'}
                  variant="outline"
                  className="w-5 h-5 px-0 shrink-0 font-semibold"
                >
                  {i + 1}
                </Badge>
              )}
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <div>
                  <div className={`text-sm font-medium ${s.done ? 'text-subtle' : ''}`}>{s.title}</div>
                  <div className="text-xs text-subtle">{s.detail}</div>
                </div>
                {!s.done && s.actions && <div className="flex flex-wrap gap-2">{s.actions}</div>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* ③ keep: a service charge paid from the insurance wallet (company income). */}
      <ContractFeeModal
        open={keepOpen}
        contract={keepOpen && contract.holding_id != null ? {
          id: contract.id,
          code: contract.code ?? code,
          code_display: contract.code_display ?? null,
          state: contract.state,
          branch_id: contract.branch_id,
          company_id: contract.company_id ?? null,
          holding_id: contract.holding_id,
          customer_id: contract.customer_id ?? null,
          saving_balance: contract.saving_balance ?? null,
          credit_balance: contract.credit_balance ?? null,
          insurance_balance: contract.insurance_balance ?? null,
        } : null}
        preset={{
          chargeType: 'SERVICE_CHARGE',
          amount: insurance,
          description: t('deposit.notCollected.keepDescription'),
          method: 'INSURANCE_WALLET',
        }}
        onClose={() => setKeepOpen(false)}
        onSuccess={() => { invalidate(); }}
      />

      {/* ③ give back: cash-out of the insurance wallet (PIN). */}
      <WalletActionModal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        onSuccess={(msgKey) => {
          setRefundOpen(false);
          invalidate();
          queryClient.invalidateQueries({ queryKey: ['contract-actions', contract.id] });
          addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t(msgKey)}</span></div> });
        }}
        contractId={contract.id}
        contractCode={code}
        holdingId={contract.holding_id ?? 0}
        walletType="INSURANCE"
        action="CASHOUT"
      />
    </section>
  );
}
