import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Select, Input } from 'tsp-form';
import { XCircle, Plus, Trash2, CheckCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../contractUtils';
import { useWizard } from './WizardContext';
import type { PaymentMethod, PaymentLine, BillCreateResult, BankAccount } from './WizardTypes';

const PAYMENT_METHOD_OPTIONS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'TRANSFER', label: 'Bank Transfer' },
];

export function SectionBillPayment() {
  const { t } = useTranslation();
  const { data: wizardData, updateData } = useWizard();
  const downAmount = wizardData.selectedQuote?.down_amount ?? 0;

  const [payments, setPayments] = useState<PaymentLine[]>([{ method: 'CASH', amount: downAmount, bank_account_id: null }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Bank accounts for transfer
  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts-active'],
    queryFn: () => apiClient.get<BankAccount[]>('/v_bank_accounts?is_active=is.true&order=bank_name'),
    staleTime: 5 * 60 * 1000,
  });

  const bankOptions = (bankAccounts ?? []).map(b => ({
    value: String(b.id),
    label: `${b.bank_name} - ${b.account_number} (${b.account_name})`,
  }));

  const totalPayment = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const isBalanced = Math.abs(totalPayment - downAmount) < 0.01;

  const addPaymentLine = () => {
    const remaining = downAmount - totalPayment;
    setPayments(prev => [...prev, { method: 'CASH', amount: remaining > 0 ? remaining : 0, bank_account_id: null }]);
  };

  const removePaymentLine = (idx: number) => {
    setPayments(prev => prev.filter((_, i) => i !== idx));
  };

  const updatePayment = (idx: number, updates: Partial<PaymentLine>) => {
    setPayments(prev => prev.map((p, i) => i === idx ? { ...p, ...updates } : p));
  };

  const handleProcess = async () => {
    if (!isBalanced) return;
    setLoading(true);
    setError('');

    try {
      // Step 1: Create bill if not already
      let billId = wizardData.billId;
      if (!billId) {
        const billResult = await apiClient.rpc<BillCreateResult>('fn_bill_create', {
          p_branch_id: wizardData.branchId,
          p_customer_id: wizardData.customerId,
          p_line_items: [
            {
              line_type: 'CONTRACT',
              description: 'down payment',
              amount: downAmount,
              ref_type: 'CONTRACT',
              ref_id: wizardData.contractId,
            },
          ],
        });
        billId = billResult.bill_id;
        updateData({ billId: billResult.bill_id, billCode: billResult.bill_code });
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
        p_contract_id: wizardData.contractId,
      });

      updateData({ billConfirmed: true });

      // Save step
      await apiClient.rpc('fn_contract_save_step', {
        p_contract_id: wizardData.contractId,
        p_step: 'PAYMENT',
        p_data: { bill_id: billId, confirmed: true },
      }).catch(() => {});
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

  if (wizardData.billConfirmed) {
    return (
      <div className="flex flex-col gap-5 py-6">
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <div>
            <div className="alert-title">{t('wizard.paymentConfirmed')}</div>
            <div className="alert-description">{t('wizard.contractActivated')}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 py-6">
      <h2 className="text-lg font-semibold">{t('wizard.billPayment')}</h2>

      {error && (
        <div className="alert alert-danger">
          <XCircle size={18} />
          <div><div className="alert-description">{error}</div></div>
        </div>
      )}

      {/* Down payment summary */}
      <div className="border border-line rounded-lg p-4 bg-surface">
        <div className="flex justify-between items-center">
          <span className="text-sm text-subtle">{t('contract.downPayment')}</span>
          <span className="text-lg font-semibold tabular-nums">{fmtCurrency(downAmount)}</span>
        </div>
        {wizardData.selectedQuote && (
          <div className="text-xs text-subtle mt-1">
            {wizardData.selectedQuote.finance_model} · {wizardData.selectedQuote.term_months} {t('contract.months')} · {wizardData.selectedQuote.down_percent}%
          </div>
        )}
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
                  options={PAYMENT_METHOD_OPTIONS}
                  value={payment.method}
                  onChange={(val) => updatePayment(idx, { method: val as PaymentMethod, bank_account_id: null })}
                  size="sm"
                />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label text-xs">{t('contract.amount')}</label>
                <Input
                  type="number"
                  value={String(payment.amount)}
                  onChange={(e) => updatePayment(idx, { amount: parseFloat(e.target.value) || 0 })}
                  size="sm"
                  className="w-full"
                />
              </div>
              {payments.length > 1 && (
                <Button size="sm" className="btn-icon-sm shrink-0" onClick={() => removePaymentLine(idx)}>
                  <Trash2 size={14} />
                </Button>
              )}
            </div>

            {payment.method === 'TRANSFER' && (
              <div className="flex flex-col">
                <label className="form-label text-xs">{t('wizard.bankAccount')}</label>
                <Select
                  options={bankOptions}
                  value={payment.bank_account_id ? String(payment.bank_account_id) : null}
                  onChange={(val) => updatePayment(idx, { bank_account_id: val ? Number(val) : null })}
                  placeholder={t('wizard.selectBankAccount')}
                  size="sm"
                  showChevron
                  searchable
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
        isBalanced ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
      }`}>
        <span className="text-sm">{t('wizard.totalPayment')}</span>
        <span className={`font-semibold tabular-nums ${isBalanced ? 'text-success' : 'text-warning'}`}>
          {fmtCurrency(totalPayment)}
        </span>
      </div>

      <div className="flex justify-end">
        <Button
          color="primary"
          onClick={handleProcess}
          disabled={loading || !isBalanced}
        >
          {loading ? t('common.saving') : t('wizard.confirmPayment')}
        </Button>
      </div>
    </div>
  );
}
