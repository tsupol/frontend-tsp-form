// Reassign commission owner on a DRAFT / SAVING contract.
//
// RPC: api.fn_contract_change_draft_owner(p_contract_id, p_new_owner_id, p_pin)
//   - PIN required every call (no session cache)
//   - Server enforces sale._is_editable(state) — UI hides the button on
//     ACTIVE / closed states but the RPC also returns CONTRACT.NOT_EDITABLE
//     as a race-condition safety net.
//
// Picker source: api.v_branch_commission_eligible_users (branch-scoped by JWT).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Select } from 'tsp-form';
import { XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';
import { translateApiError } from '../../lib/apiErrors';

interface EligibleUser {
  user_id: number;
  display_name: string;
  role_code: string;
  branch_id: number;
  branch_name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  contractId: number;
  currentOwnerId: number | null;
  currentOwnerName: string | null;
}

function describeApiError(
  err: unknown,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  if (err instanceof ApiError) {
    const translated = translateApiError(err, t);
    return translated || err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function CommissionOwnerModal({
  open, onClose, contractId, currentOwnerId, currentOwnerName,
}: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [newOwnerId, setNewOwnerId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setNewOwnerId(currentOwnerId != null ? String(currentOwnerId) : null);
      setPin('');
      setError('');
    }
  }, [open, currentOwnerId]);

  const { data: eligible = [], isLoading: loadingEligible } = useQuery({
    queryKey: ['commission-eligible-users'],
    queryFn: () => apiClient.get<EligibleUser[]>(
      `/v_branch_commission_eligible_users?order=display_name`,
    ),
    enabled: open,
    staleTime: 60_000,
  });

  const options = eligible.map(u => ({
    value: String(u.user_id),
    label: `${u.display_name} · ${t(`role.${u.role_code}`, { defaultValue: u.role_code })}`,
  }));

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_contract_change_draft_owner', {
      p_contract_id: contractId,
      p_new_owner_id: Number(newOwnerId),
      p_pin: pin,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-search'] });
      queryClient.invalidateQueries({ queryKey: ['saving-contracts'] });
      onClose();
    },
    onError: (err) => setError(describeApiError(err, t)),
  });

  const sameAsCurrent = newOwnerId != null && Number(newOwnerId) === currentOwnerId;
  const canSubmit =
    !!newOwnerId &&
    !sameAsCurrent &&
    pin.length === 6 &&
    !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('contract.commissionOwner_changeTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4 animate-pop-in">
            <XCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {currentOwnerName && (
          <div className="mb-3 text-xs text-subtle">
            {t('contract.commissionOwner_current')}: <span className="text-fg">{currentOwnerName}</span>
          </div>
        )}

        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('contract.commissionOwner_newAssignee')} *</label>
            <Select
              options={options}
              value={newOwnerId}
              onChange={(val) => setNewOwnerId((val as string) || null)}
              placeholder={t('contract.commissionOwner_pickPlaceholder')}
              loading={loadingEligible}
              searchable
              showChevron
            />
            {sameAsCurrent && (
              <div className="text-xs text-warning-fg mt-1">
                {t('contract.commissionOwner_sameWarning')}
              </div>
            )}
          </div>

          <BranchPinInput value={pin} onChange={setPin} required />
        </div>

        <div className="text-xs text-subtle mt-3">
          {t('contract.commissionOwner_hint')}
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={() => mutation.mutate()} disabled={!canSubmit}>
          {mutation.isPending ? t('common.loading') : t('contract.commissionOwner_save')}
        </Button>
      </div>
    </Modal>
  );
}
