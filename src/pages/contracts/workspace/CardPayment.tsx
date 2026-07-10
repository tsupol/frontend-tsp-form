import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select, MaskedInput } from 'tsp-form';
import { Plus, Trash2, XCircle, Loader2, CreditCard, ChevronsRight } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import { BranchPaymentAccountField } from '../../../components/BranchPaymentAccountField';
import type { PaymentMethod, PaymentLine, BillOpenResult } from './WorkspaceTypes';

const BASE_PAYMENT_METHOD_VALUES = ['CASH', 'TRANSFER'] as const;

/**
 * Payment card for contract open bill.
 * Two modes:
 * - Pre-bill (billId=null): shows payment form, "Confirm & Activate" does bill_open + payment_add + confirm in one go
 * - Post-bill (billId set, resumed PENDING_PAYMENT): same form but skips bill_open
 */
export function CardPayment() {
  const { t } = useTranslation();
  const { data, updateData, contract, invalidateContract } = useWorkspace();
  const savingBalance = contract?.saving_balance ?? 0;

  // Bill total: from existing bill data or from contract pricing (preview)
  const existingBill = data.billData;
  const previewTotal = (contract?.down_payment ?? 0) + (contract?.insurance_deposit ?? 0);
  const totalAmount = existingBill?.total_amount ?? previewTotal;

  const paymentMethodOptions = useMemo(() => {
    const opts = BASE_PAYMENT_METHOD_VALUES.map(v => ({ value: v as string, label: t(`paymentMethod.${v}`) }));
    if (savingBalance > 0) {
      opts.push({ value: 'SAVING_WALLET', label: `${t('workspace.savingWallet')} (${fmtCurrency(savingBalance)})` });
    }
    return opts;
  }, [savingBalance, t]);

  const [payments, setPayments] = useState<PaymentLine[]>([
    { method: savingBalance > 0 && savingBalance >= totalAmount ? 'SAVING_WALLET' : 'CASH', amount: totalAmount, bank_account_id: null },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const totalPayment = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const isBalanced = totalAmount > 0 && Math.abs(totalPayment - totalAmount) < 0.01;

  const addPaymentLine = () => {
    const remaining = totalAmount - totalPayment;
    setPayments(prev => [...prev, { method: 'CASH', amount: remaining > 0 ? remaining : 0, bank_account_id: null }]);
  };

  const removePaymentLine = (idx: number) => {
    setPayments(prev => prev.filter((_, i) => i !== idx));
  };

  const updatePayment = (idx: number, updates: Partial<PaymentLine>) => {
    setPayments(prev => prev.map((p, i) => i === idx ? { ...p, ...updates } : p));
  };

  const handleConfirm = async () => {
    if (!isBalanced || !data.contractId) return;
    setLoading(true);
    setError('');

    try {
      let billId = data.billId;

      // Step 1: Create bill if not yet created
      if (!billId) {
        const bill = await apiClient.rpc<BillOpenResult>('fn_bill_contract_open', {
          p_contract_id: data.contractId,
        });
        billId = bill.bill_id;
        updateData({
          billId: bill.bill_id,
          billCode: bill.bill_code,
          billData: bill,
        });
        // Idempotent (mig 576): the contract was already open past the payment
        // stage (paid → signing, or active). Don't re-add payments to a settled
        // bill — mark confirmed so the panel advances instead of erroring.
        if (bill.already_open && (bill.contract_state === 'PENDING_SIGN' || bill.contract_state === 'ACTIVE')) {
          updateData({ billConfirmed: true });
          invalidateContract();
          return;
        }
      }

      // Step 2: Add each payment
      for (const payment of payments) {
        await apiClient.rpc('fn_bill_payment_add', {
          p_bill_id: billId,
          p_method: payment.method,
          p_amount: payment.amount,
          p_bank_account_id: payment.method === 'TRANSFER' ? payment.bank_account_id : null,
        });
      }

      // Step 3: Confirm bill → activates contract
      await apiClient.rpc('fn_bill_payment_confirm', {
        p_bill_id: billId,
        p_contract_id: data.contractId,
      });

      updateData({ billConfirmed: true });
      invalidateContract();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  };

  if (totalAmount <= 0) return null;

  // Build preview lines from contract data when no bill exists yet
  const previewLines: Array<{ key: string; description: string; amount: number }> = [];
  if (!existingBill) {
    if (contract?.down_payment) previewLines.push({ key: 'down', description: t('contract.downPayment'), amount: contract.down_payment });
    if (contract?.insurance_deposit) previewLines.push({ key: 'ins', description: t('contract.insuranceDeposit'), amount: contract.insurance_deposit });
  }
  const displayLines = existingBill?.lines ?? previewLines;

  return (
    <div className="border border-primary rounded-lg bg-primary-soft">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary">
        <CreditCard size={16} className="text-primary-fg shrink-0" />
        <span className="font-medium text-sm flex-1">{t('workspace.cardPayment')}</span>
        {data.billCode && <span className="text-xs font-mono text-subtle">{data.billCode}</span>}
      </div>

      <div className="px-4 py-3 flex flex-col gap-4">
        {error && (
          <div className="alert alert-danger">
            <XCircle size={18} />
            <div><div className="alert-description">{error}</div></div>
          </div>
        )}

        {/* Bill lines summary */}
        <div className="border border-line rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {displayLines.map((line, i) => (
                <tr key={'line_item_id' in line ? line.line_item_id : line.key ?? i}>
                  <td className="px-3 py-2">{line.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(line.amount)}</td>
                </tr>
              ))}
              <tr className="bg-surface font-medium">
                <td className="px-3 py-2">{t('workspace.total')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(totalAmount)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Payment lines */}
        <div className="flex flex-col gap-3">
          <label className="form-label">{t('wizard.paymentMethods')}</label>

          {payments.map((payment, idx) => (
            <div key={idx} className="border border-line rounded-lg p-3 flex flex-col gap-3">
              <div className="flex gap-3 items-end">
                <div className="flex flex-col" style={{ width: '10rem' }}>
                  <label className="form-label text-xs">{t('wizard.method')}</label>
                  <Select
                    options={paymentMethodOptions}
                    value={payment.method}
                    onChange={(val) => updatePayment(idx, { method: val as PaymentMethod, bank_account_id: null })}
                    size="sm"
                  />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <label className="form-label text-xs">{t('contract.amount')}</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={2}
                    value={String(payment.amount || '')}
                    onChange={(raw) => updatePayment(idx, { amount: parseFloat(raw) || 0 })}
                    size="sm"
                    className="w-full"
                    endIcon={<ChevronsRight size={14} />}
                    onEndIconClick={() => {
                      const otherTotal = payments.reduce((sum, p, i) => i === idx ? sum : sum + (p.amount || 0), 0);
                      const remaining = Math.max(0, totalAmount - otherTotal);
                      const fill = payment.method === 'SAVING_WALLET'
                        ? Math.min(savingBalance, remaining)
                        : remaining;
                      updatePayment(idx, { amount: fill });
                    }}
                  />
                </div>
                {payments.length > 1 && (
                  <Button
                    size="sm"
                    className="shrink-0"
                    startIcon={<Trash2 size={14} />}
                    onClick={() => removePaymentLine(idx)}
                  />
                )}
              </div>

              {payment.method === 'TRANSFER' && (
                <div className="flex flex-col">
                  <label className="form-label text-xs">{t('wizard.bankAccount')}</label>
                  <BranchPaymentAccountField
                    active={payment.method === 'TRANSFER'}
                    onResolve={(id) => updatePayment(idx, { bank_account_id: id })}
                  />
                </div>
              )}
            </div>
          ))}

          <Button size="sm" onClick={addPaymentLine} startIcon={<Plus size={14} />}>
            {t('wizard.addPayment')}
          </Button>
        </div>

        {/* Total check */}
        <div className={`flex justify-between items-center p-3 rounded-lg border ${
          isBalanced ? 'border-success-border bg-success-soft' : 'border-warning-border bg-warning-soft'
        }`}>
          <span className="text-sm">{t('wizard.totalPayment')}</span>
          <span className={`font-semibold tabular-nums ${isBalanced ? 'text-success' : 'text-warning-fg'}`}>
            {fmtCurrency(totalPayment)}
          </span>
        </div>

        <div className="flex justify-end">
          <Button
            color="primary"
            onClick={handleConfirm}
            disabled={loading || !isBalanced}
            startIcon={loading ? <Loader2 size={16} className="animate-spin" /> : undefined}
          >
            {loading ? t('common.loading') : t('wizard.confirmPayment')}
          </Button>
        </div>
      </div>
    </div>
  );
}
