import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { Plus, Gift, Trash2, Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../../../lib/format';
import { SellableVariantPickerModal, type SellableVariant } from '../../../components/SellableVariantPickerModal';

interface BillLine {
  line_id: number;
  line_type: string;
  charge_type: string;
  description: string;
  amount: number;
  quantity: number;
  ref_type: string | null;
  ref_id: number | null;
}

interface BillDetail {
  bill_id: number;
  total_amount: number;
  status: string;
  line_items: BillLine[];
}

interface Props {
  billId: number;
  branchId: number | null;
  /** Callback after the cart mutates — parent can refresh totals downstream. */
  onChange?: () => void;
}

// charge_types we treat as "auto" (added by fn_bill_contract_open, can't remove)
const AUTO_CHARGE_TYPES = new Set(['DOWN_PAYMENT', 'INSURANCE_DEPOSIT']);

// charge_types that are auto-paired with a user line (ref_type=BILL_LINE → parent is editable)
const PAIRED_DISCOUNT_TYPES = new Set(['GIFT_DISCOUNT']);

/**
 * Editable cart for a CONTRACT_OPEN bill in PENDING_PAYMENT state.
 * Lists current lines from v_bill_detail and lets the user add accessories
 * (sellable, charged) or gifts (free, GIFT + GIFT_DISCOUNT pair).
 *
 * Uses live multi-call RPCs (per doc 33 §3e + doc 24): no preview/submit
 * one-shot wrapper. Each cart edit hits the server and we refetch.
 */
export function BillCart({ billId, branchId, onChange }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pickerMode, setPickerMode] = useState<'accessory' | 'gift' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { data: bill, isLoading } = useQuery({
    queryKey: ['bill-detail', billId],
    queryFn: () => apiClient.get<BillDetail[]>(
      `/v_bill_detail?bill_id=eq.${billId}`,
    ).then(rows => rows[0] ?? null),
    staleTime: 0, // always fresh after mutation
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['bill-detail', billId] });
    onChange?.();
  };

  const handleApiError = (err: unknown) => {
    if (err instanceof ApiError) {
      const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
        || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
      setError(tr || err.message);
    } else {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePick = async (variant: SellableVariant, qty: number) => {
    if (!pickerMode) return;
    setBusy(true);
    setError('');
    try {
      const added = await apiClient.rpc<{ line_item_id: number }>(
        'fn_bill_line_item_add',
        {
          p_bill_id: billId,
          p_line_type: 'REVENUE',
          p_charge_type: 'ACCESSORY_SALE',
          p_description: variant.full_name,
          p_amount: pickerMode === 'gift' ? 0 : variant.retail_price * qty,
          p_quantity: qty,
          p_variant_id: variant.variant_id,
        },
      );
      if (pickerMode === 'gift') {
        await apiClient.rpc('fn_bill_line_convert_to_gift', { p_line_id: added.line_item_id });
      }
      setPickerMode(null);
      refresh();
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (lineId: number) => {
    setBusy(true);
    setError('');
    try {
      await apiClient.rpc('fn_bill_line_item_remove', { p_line_item_id: lineId });
      refresh();
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !bill) {
    return (
      <div className="flex items-center justify-center p-4 text-subtle">
        <Loader2 size={16} className="animate-spin mr-2" />
        {t('common.loading')}
      </div>
    );
  }

  const lines = bill.line_items ?? [];
  // Hide GIFT_DISCOUNT rows — they're shown inline under their paired GIFT line.
  const visibleLines = lines.filter(l => !PAIRED_DISCOUNT_TYPES.has(l.charge_type));

  const findPairedDiscount = (giftLineId: number) =>
    lines.find(l => l.charge_type === 'GIFT_DISCOUNT' && l.ref_id === giftLineId);

  return (
    <div className="flex flex-col gap-3">
      <div className="border border-line rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {visibleLines.map(line => {
              const isAuto = AUTO_CHARGE_TYPES.has(line.charge_type);
              const isGift = line.charge_type === 'GIFT';
              const pairedDiscount = isGift ? findPairedDiscount(line.line_id) : undefined;

              return (
                <tr key={line.line_id} className={isAuto ? 'bg-surface/40' : ''}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {isGift && <Gift size={12} className="text-info shrink-0" />}
                      <span>{line.description}</span>
                      {line.quantity > 1 && (
                        <span className="text-xs text-subtle">× {line.quantity}</span>
                      )}
                    </div>
                    {pairedDiscount && (
                      <div className="flex items-center gap-2 text-xs text-subtle mt-0.5 ml-5">
                        <span>{pairedDiscount.description}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    <div>{fmtCurrency(line.amount)}</div>
                    {pairedDiscount && (
                      <div className="text-xs text-subtle">{fmtCurrency(pairedDiscount.amount)}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 w-10">
                    {!isAuto && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="btn-icon-sm"
                        onClick={() => handleRemove(line.line_id)}
                        disabled={busy}
                        startIcon={<Trash2 size={14} />}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-surface font-medium">
              <td className="px-3 py-2">{t('workspace.total')}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(bill.total_amount)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          startIcon={<Plus size={14} />}
          onClick={() => setPickerMode('accessory')}
          disabled={busy}
        >
          {t('workspace.cart_addAccessory')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          startIcon={<Gift size={14} />}
          onClick={() => setPickerMode('gift')}
          disabled={busy}
        >
          {t('workspace.cart_addGift')}
        </Button>
        {busy && <Loader2 size={16} className="animate-spin text-subtle ml-1" />}
      </div>

      {error && (
        <div className="alert alert-danger">
          <span>{error}</span>
        </div>
      )}

      <SellableVariantPickerModal
        open={pickerMode != null}
        branchId={branchId}
        onClose={() => setPickerMode(null)}
        onPick={handlePick}
        titleKey={pickerMode === 'gift' ? 'workspace.cart_pickGift' : 'workspace.cart_pickAccessory'}
        addLabelKey={pickerMode === 'gift' ? 'workspace.cart_giveAsGift' : 'retail.create.add'}
      />
    </div>
  );
}
