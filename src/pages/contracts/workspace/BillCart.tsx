import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, MaskedInput, Modal, PopOver, Input } from 'tsp-form';
import { Plus, Trash2, Truck, Gift, ShoppingBag } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { fmtCurrency } from '../../../lib/format';
import { SellableVariantPickerModal, type SellableVariant } from '../../../components/SellableVariantPickerModal';

/* ─────────────────────────────────────────────────────────────────────────────
   ⚠️  CLIENT-SIDE DRAFT CART — DO NOT WIRE THIS TO LIVE BILL RPCs.

   The cart in PanelReviewPay holds line items entirely in client state until
   the user explicitly clicks "Confirm & Activate". Confirm runs the full
   server sequence in one handler:

     fn_bill_contract_open
       → loop fn_bill_line_item_add (+ fn_bill_line_convert_to_gift for gifts)
       → loop fn_bill_payment_add
       → fn_bill_payment_confirm   (server cascades activation)

   This is intentional. The backend has NO "open bill with extra lines" or
   "batch line add" RPC. The previous approach auto-opened the bill on panel
   mount, which silently flipped the contract from DRAFT to PENDING_PAYMENT
   just by viewing the screen — that is wrong. Opening the bill is a real
   state change and MUST be user-driven.

   DO NOT:
     • Call fn_bill_contract_open from this component or PanelReviewPay's
       mount effect.
     • Call fn_bill_line_item_add / _remove from here.
     • Add a useEffect that fires any state-changing RPC.

   If a future backend change adds a true "open bill with lines" RPC, swap
   the Confirm sequence in PanelReviewPay — keep the cart client-side here.
   ──────────────────────────────────────────────────────────────────────── */

export interface DraftCartLine {
  id: string;
  charge_type: string;
  line_type: string;
  description: string;
  amount: number;
  quantity: number;
  variant_id: number | null;
  /** True for charge_type='GIFT': add as ACCESSORY_SALE then convert to gift. */
  as_gift: boolean;
}

interface AddableRow {
  charge_type: string;
  line_type: string;
  name_th: string;
  name_en: string;
  sort_order: number;
}

interface Props {
  branchId: number | null;
  /** Auto / system lines from contract pricing (down payment, insurance) — shown read-only. */
  systemLines: Array<{ key: string; description: string; amount: number }>;
  lines: DraftCartLine[];
  onChange: (next: DraftCartLine[]) => void;
  /** Right-aligned action on the "+ add line" row (e.g. print invoice). */
  rowAction?: ReactNode;
}

const SELLABLE_CHARGE_TYPES = new Set(['ACCESSORY_SALE', 'GIFT']);

const CHARGE_ICONS: Record<string, ReactNode> = {
  ACCESSORY_SALE: <ShoppingBag size={14} />,
  GIFT: <Gift size={14} />,
  SHIPPING_FEE: <Truck size={14} />,
};

let cartIdCounter = 0;
const nextCartId = () => `cart-${Date.now()}-${++cartIdCounter}`;

export function BillCart({ branchId, systemLines, lines, onChange, rowAction }: Props) {
  const { t, i18n } = useTranslation();

  const [addOpen, setAddOpen] = useState(false);
  const [sellablePick, setSellablePick] = useState<{ chargeType: string; lineType: string; name: string } | null>(null);
  const [freeForm, setFreeForm] = useState<{ chargeType: string; lineType: string; name: string } | null>(null);
  const [freeFormDesc, setFreeFormDesc] = useState('');
  const [freeFormAmount, setFreeFormAmount] = useState('');

  const { data: addable = [] } = useQuery({
    queryKey: ['bill-addable', 'CONTRACT_OPEN'],
    queryFn: () => apiClient.get<AddableRow[]>(
      '/v_bill_line_addable_by_purpose?bill_purpose=eq.CONTRACT_OPEN&is_user_addable=eq.true&order=sort_order',
    ),
    staleTime: 5 * 60 * 1000,
  });

  const chargeLabel = (row: { name_th: string; name_en: string; charge_type: string }) =>
    (i18n.language === 'th' ? row.name_th : row.name_en) || row.charge_type;

  const handlePickType = (row: AddableRow) => {
    setAddOpen(false);
    if (SELLABLE_CHARGE_TYPES.has(row.charge_type)) {
      setSellablePick({ chargeType: row.charge_type, lineType: row.line_type, name: chargeLabel(row) });
    } else {
      setFreeForm({ chargeType: row.charge_type, lineType: row.line_type, name: chargeLabel(row) });
      setFreeFormDesc(chargeLabel(row));
      setFreeFormAmount('');
    }
  };

  const handleSellablePick = (variant: SellableVariant, qty: number) => {
    if (!sellablePick) return;
    const asGift = sellablePick.chargeType === 'GIFT';
    onChange([
      ...lines,
      {
        id: nextCartId(),
        charge_type: 'ACCESSORY_SALE',
        line_type: 'REVENUE',
        description: variant.full_name,
        amount: asGift ? 0 : variant.retail_price * qty,
        quantity: qty,
        variant_id: variant.variant_id,
        as_gift: asGift,
      },
    ]);
    setSellablePick(null);
  };

  const handleFreeFormSubmit = () => {
    if (!freeForm) return;
    const amount = parseFloat(freeFormAmount) || 0;
    if (!freeFormDesc.trim() || amount <= 0) return;
    onChange([
      ...lines,
      {
        id: nextCartId(),
        charge_type: freeForm.chargeType,
        line_type: freeForm.lineType,
        description: freeFormDesc.trim(),
        amount,
        quantity: 1,
        variant_id: null,
        as_gift: false,
      },
    ]);
    setFreeForm(null);
    setFreeFormDesc('');
    setFreeFormAmount('');
  };

  const handleRemove = (id: string) => {
    onChange(lines.filter(l => l.id !== id));
  };

  const total = systemLines.reduce((sum, l) => sum + l.amount, 0)
    + lines.reduce((sum, l) => sum + (l.as_gift ? 0 : l.amount), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="border border-line rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {systemLines.map(l => (
              <tr key={l.key} className="bg-surface/40">
                <td className="px-3 py-2">{l.description}</td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{fmtCurrency(l.amount)}</td>
                <td className="px-3 py-2 w-10" />
              </tr>
            ))}
            {lines.map(line => {
              const icon = CHARGE_ICONS[line.as_gift ? 'GIFT' : line.charge_type];
              return (
                <tr key={line.id}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {icon && <span className="text-info shrink-0">{icon}</span>}
                      <span>{line.description}</span>
                      {line.quantity > 1 && (
                        <span className="text-xs text-subtle">× {line.quantity}</span>
                      )}
                    </div>
                    {line.as_gift && (
                      <div className="text-xs text-subtle ml-5 mt-0.5">{t('workspace.cart_giveAsGift')}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {line.as_gift ? (
                      <span className="text-subtle">{fmtCurrency(0)}</span>
                    ) : (
                      fmtCurrency(line.amount)
                    )}
                  </td>
                  <td className="px-3 py-2 w-10">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="btn-icon-sm"
                      onClick={() => handleRemove(line.id)}
                      startIcon={<Trash2 size={14} />}
                    />
                  </td>
                </tr>
              );
            })}
            <tr className="bg-surface font-medium">
              <td className="px-3 py-2">{t('workspace.total')}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(total)}</td>
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
        {rowAction && <div className="ml-auto">{rowAction}</div>}
      </div>

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
            disabled={!freeFormDesc.trim() || !(parseFloat(freeFormAmount) > 0)}
            startIcon={<Plus size={14} />}
          >
            {t('common.add')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
