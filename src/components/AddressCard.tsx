import { useTranslation } from 'react-i18next';
import { Button, Modal } from 'tsp-form';
import { Info, MapPin, Pencil, Plus } from 'lucide-react';
import { AddressFormPostal } from '../pages/contracts/workspace/AddressFormPostal';
import type { CustomerAddress } from '../pages/contracts/workspace/WorkspaceTypes';

function formatAddress(a: CustomerAddress): string {
  const parts = [a.address_line1];
  if (a.address_line2) parts.push(a.address_line2);
  if (a.soi) parts.push(`ซ.${a.soi}`);
  if (a.road) parts.push(`ถ.${a.road}`);
  parts.push(`${a.sub_district}, ${a.district}, ${a.province} ${a.postal_code}`);
  return parts.join(', ');
}

interface AddressCardProps {
  label: string;
  address: CustomerAddress | undefined;
  onEdit: () => void;
  disabled?: boolean;
  /** Optional hint shown only when there's no address yet (e.g. "Shipping uses Home if blank"). */
  emptyHint?: string;
  /** Optional "(optional)" pill next to the label. */
  optional?: boolean;
}

export function AddressCard({ label, address, onEdit, disabled, emptyHint, optional }: AddressCardProps) {
  const { t } = useTranslation();
  return (
    <div className={`mb-3 px-3 py-2.5 rounded-md border transition-colors ${address ? 'border-success-border bg-success-soft' : 'bg-surface border-line'} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium flex items-center gap-1.5">
          <MapPin size={13} className="text-subtle" />
          {label}
          {optional && (
            <span className="text-xs font-normal text-subtle">
              ({t('common.optional', { defaultValue: 'optional' })})
            </span>
          )}
        </span>
        <Button
          variant="ghost"
          className="btn-icon-xs"
          onClick={onEdit}
          startIcon={address ? <Pencil size={12} /> : <Plus size={12} />}
        />
      </div>
      {address ? (
        <div className="text-sm text-subtle">{formatAddress(address)}</div>
      ) : emptyHint ? (
        <div className="alert alert-info text-xs mt-1">
          <Info size={14} />
          <span>{emptyHint}</span>
        </div>
      ) : (
        <div className="text-sm text-subtler">—</div>
      )}
    </div>
  );
}

interface AddressEditModalProps {
  open: boolean;
  onClose: () => void;
  customerId: number;
  addressType: 'HOME' | 'WORK' | 'SHIPPING';
  existing?: CustomerAddress;
  onSuccess: () => void;
}

export function AddressEditModal({ open, onClose, customerId, addressType, existing, onSuccess }: AddressEditModalProps) {
  const { t } = useTranslation();
  const label = addressType === 'HOME'
    ? t('customer.addressHome')
    : addressType === 'WORK'
      ? t('customer.addressWork')
      : t('customer.addressShipping');

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{label}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        <AddressFormPostal
          customerId={customerId}
          addressType={addressType}
          existing={existing}
          onSuccess={() => { onSuccess(); onClose(); }}
        />
      </div>
    </Modal>
  );
}
