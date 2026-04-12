import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Select, Input } from 'tsp-form';
import { Plus, Trash2, XCircle, Loader2, CreditCard } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../contractUtils';
import { useWorkspace } from './WorkspaceContext';
import type { PaymentMethod, PaymentLine, BankAccount } from './WorkspaceTypes';

const PAYMENT_METHOD_OPTIONS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'TRANSFER', label: 'Bank Transfer' },
];

export function CardPayment() {
  const { t } = useTranslation();
  const { data, updateData } = useWorkspace();
  const billData = data.billData;
  const totalAmount = billData?.total_amount ?? 0;

  const [payments, setPayments] = useState<PaymentLine[]>([
    { method: 'CASH', amount: totalAmount, bank_account_id: null },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
  const isBalanced = Math.abs(totalPayment - totalAmount) < 0.01;

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
    if (!isBalanced || !data.billId) return;
    setLoading(true);
    setError('');

    try {
      // Add each payment
      for (const payment of payments) {
        await apiClient.rpc('fn_bill_payment_add', {
          p_bill_id: data.billId,
          p_method: payment.method,
          p_amount: payment.amount,
          p_bank_account_id: payment.method === 'TRANSFER' ? payment.bank_account_id : null,
        });
      }

      // Confirm bill → activates contract
      await apiClient.rpc('fn_bill_payment_confirm', {
        p_bill_id: data.billId,
        p_contract_id: data.contractId,
      });

      updateData({ billConfirmed: true });

      // Save step
      await apiClient.rpc('fn_contract_save_step', {
        p_contract_id: data.contractId,
        p_step: 'PAYMENT',
        p_data: { bill_id: data.billId, confirmed: true },
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

  if (!billData) return null;

  return (
    <div className="border border-primary/30 rounded-lg bg-primary/3">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/20">
        <CreditCard size={16} className="text-primary shrink-0" />
        <span className="font-medium text-sm flex-1">{t('workspace.cardPayment')}</span>
        <span className="text-xs font-mono text-subtle">{data.billCode}</span>
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
              {billData.lines.map(line => (
                <tr key={line.line_item_id}>
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
