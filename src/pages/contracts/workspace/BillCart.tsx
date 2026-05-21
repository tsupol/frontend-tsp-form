import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, MaskedInput, Modal, PopOver, Input } from 'tsp-form';
import { Plus, Trash2, Loader2, Truck, Gift, ShoppingBag } from 'lucide-react';
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

interface AddableRow {
  charge_type: string;
  line_type: string;
  name_th: string;
  name_en: string;
  sort_order: number;
}

interface Props {
  billId: number;
  branchId: number | null;
  onChange?: () => void;
}

// Lines added automatically by fn_bill_contract_open — UI cannot remove.
const AUTO_CHARGE_TYPES = new Set(['DOWN_PAYMENT', 'INSURANCE_DEPOSIT']);
// Paired-discount lines — hidden in the list (shown inline under their parent GIFT row).
const PAIRED_DISCOUNT_TYPES = new Set(['GIFT_DISCOUNT']);
// Charge types that pick a variant via the sellable modal.
const SELLABLE_CHARGE_TYPES = new Set(['ACCESSORY_SALE', 'GIFT']);

const CHARGE_ICONS: Record<string, JSX.Element> = {
  ACCESSORY_SALE: <ShoppingBag size={14} />,
  GIFT: <Gift size={14} />,
  SHIPPING_FEE: <Truck size={14} />,
};

/**
 * Editable cart for a CONTRACT_OPEN bill. Lines come from v_bill_detail; the
 * Add menu is driven by v_bill_line_addable_by_purpose so any future
 * MANUAL charge_type (shipping, accessory, gift, …) shows up automatically.
 */
export function BillCart({ billId, branchId, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [sellablePick, setSellablePick] = useState<{ chargeType: string; lineType: string; name: string } | null>(null);
  const [freeForm, setFreeForm] = useState<{ chargeType: string; lineType: string; name: string } | null>(null);
  const [freeFormDesc, setFreeFormDesc] = useState('');
  const [freeFormAmount, setFreeFormAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { data: bill, isLoading } = useQuery({
    queryKey: ['bill-detail', billId],
    queryFn: () => apiClient.get<BillDetail[]>(
      `/v_bill_detail?bill_id=eq.${billId}`,
    ).then(rows => rows[0] ?? null),
    staleTime: 0,
  });

  const { data: addable = [] } = useQuery({
    queryKey: ['bill-addable', 'CONTRACT_OPEN'],
    queryFn: () => apiClient.get<AddableRow[]>(
      '/v_bill_line_addable_by_purpose?bill_purpose=eq.CONTRACT_OPEN&is_user_addable=eq.true&order=sort_order',
    ),
    staleTime: 5 * 60 * 1000,
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

  const chargeLabel = (row: AddableRow) => (i18n.language === 'th' ? row.name_th : row.name_en) || row.charge_type;

  const handlePickType = (row: AddableRow) => {
    setAddOpen(false);
    setError('');
    if (SELLABLE_CHARGE_TYPES.has(row.charge_type)) {
      setSellablePick({ chargeType: row.charge_type, lineType: row.line_type, name: chargeLabel(row) });
    } else {
      setFreeForm({ chargeType: row.charge_type, lineType: row.line_type, name: chargeLabel(row) });
      setFreeFormDesc(chargeLabel(row));
      setFreeFormAmount('');
    }
  };

  const handleSellablePick = async (variant: SellableVariant, qty: number) => {
    if (!sellablePick) return;
    const { chargeType } = sellablePick;
    const asGift = chargeType === 'GIFT';
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
          p_amount: asGift ? 0 : variant.retail_price * qty,
          p_quantity: qty,
          p_variant_id: variant.variant_id,
        },
      );
      if (asGift) {
        await apiClient.rpc('fn_bill_line_convert_to_gift', { p_line_id: added.line_item_id });
      }
      setSellablePick(null);
      refresh();
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleFreeFormSubmit = async () => {
    if (!freeForm) return;
    const amount = parseFloat(freeFormAmount) || 0;
    if (!freeFormDesc.trim() || amount <= 0) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.rpc('fn_bill_line_item_add', {
        p_bill_id: billId,
        p_line_type: freeForm.lineType,
        p_charge_type: freeForm.chargeType,
        p_description: freeFormDesc.trim(),
        p_amount: amount,
        p_quantity: 1,
        p_variant_id: null,
      });
      setFreeForm(null);
      setFreeFormDesc('');
      setFreeFormAmount('');
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
              const icon = CHARGE_ICONS[line.charge_type];
              return (
                <tr key={line.line_id} className={isAuto ? 'bg-surface/40' : ''}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {icon && <span className="text-info shrink-0">{icon}</span>}
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

      <div className="flex flex-wrap items-center gap-2">
        <PopOver
          isOpen={addOpen}
          onClose={() => setAddOpen(false)}
          trigger={
            <Button
              size="sm"
              color="primary"
              startIcon={<Plus size={14} />}
              onClick={() => setAddOpen(v => !v)}
              disabled={busy}
            >
              {t('workspace.cart_addLine')}
            </Button>
          }
          placement="bottom"
          align="start"
          minWidth="14rem"
        >
          <div className="flex flex-col py-1">
            {addable.map(row => (
              <button
                key={row.charge_type}
                type="button"
                className="flex items-center gap-2 px-3 py-2 text-sm text-left bg-transparent border-none cursor-pointer hover:bg-surface-hover"
                onClick={() => handlePickType(row)}
              >
                <span className="text-info shrink-0">{CHARGE_ICONS[row.charge_type] ?? <Plus size={14} />}</span>
                <span>{chargeLabel(row)}</span>
              </button>
            ))}
          </div>
        </PopOver>
        {busy && <Loader2 size={16} className="animate-spin text-subtle ml-1" />}
      </div>

      {error && (
        <div className="alert alert-danger">
          <span>{error}</span>
        </div>
      )}

      <SellableVariantPickerModal
        open={sellablePick != null}
        branchId={branchId}
        onClose={() => setSellablePick(null)}
        onPick={handleSellablePick}
        titleKey={sellablePick?.chargeType === 'GIFT' ? 'workspace.cart_pickGift' : 'workspace.cart_pickAccessory'}
        addLabelKey={sellablePick?.chargeType === 'GIFT' ? 'workspace.cart_giveAsGift' : 'retail.create.add'}
      />

      <Modal open={freeForm != null} onClose={() => setFreeForm(null)} maxWidth="24rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{freeForm?.name ?? ''}</h2>
          <button type="button" className="modal-close-btn" onClick={() => setFreeForm(null)} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('workspace.cart_lineDescription')}</label>
              <Input
                size="sm"
                className="w-full"
                value={freeFormDesc}
                onChange={(e) => setFreeFormDesc(e.target.value)}
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('contract.amount')}</label>
              <MaskedInput
                mask="number"
                decimalScale={2}
                value={freeFormAmount}
                onChange={(raw) => setFreeFormAmount(raw)}
                size="sm"
                className="w-full"
                placeholder="0"
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="outline" onClick={() => setFreeForm(null)}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={handleFreeFormSubmit}
            disabled={busy || !freeFormDesc.trim() || !(parseFloat(freeFormAmount) > 0)}
            startIcon={busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          >
            {t('common.add')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
