// Reassign the commission owner of a contract — in ANY state.
//
// RPC: api.fn_contract_change_draft_owner(p_contract_id, p_new_owner_id, p_pin)
//   - The `draft` in the name is legacy compatibility only. Since migs 1015/1016
//     (2026-08-06) this works on ACTIVE and closed contracts too; branches often
//     find out after activation that the credit went to the wrong person.
//   - PIN required every call (no session cache).
//   - `already_granted: true` in the response means commission was ALREADY paid
//     out to the previous owner. That ledger is not rewritten — the change only
//     affects the displayed owner and reports from here on. We surface that as a
//     warning on the success step.
//
// Picker source: api.v_branch_commission_eligible_users (branch-scoped by JWT) —
// its rows are exactly the set the RPC accepts, so a pick can't fail on branch.
// Do NOT swap in fn_commission_owner_candidates (branch-lead picker, holding-wide)
// — the RPC rejects those with COMMISSION_OWNER_NOT_IN_BRANCH.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Select } from 'tsp-form';
import { XCircle, AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';
import { translateApiError } from '../../lib/apiErrors';
import { ActionDoneView } from './ActionDoneView';

interface EligibleUser {
  user_id: number;
  display_name: string;
  role_code: string;
  branch_id: number;
  branch_name: string;
}

interface ChangeOwnerResult {
  contract_id: number;
  old_owner_id: number | null;
  new_owner_id: number;
  state: string;
  already_granted: boolean;
  changed_by: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  contractId: number;
  contractCode?: string;
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
  open, onClose, contractId, contractCode, currentOwnerId, currentOwnerName,
}: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [newOwnerId, setNewOwnerId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ChangeOwnerResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) {
      setView('form');
      setNewOwnerId(currentOwnerId != null ? String(currentOwnerId) : null);
      setPin('');
      setError('');
      setResult(null);
      setConfirmClose(false);
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
    mutationFn: () => apiClient.rpc<ChangeOwnerResult>('fn_contract_change_draft_owner', {
      p_contract_id: contractId,
      p_new_owner_id: Number(newOwnerId),
      p_pin: pin,
    }),
    onSuccess: (data) => {
      // The RPC writes a contract note itself, so the timeline picks the change
      // up from the same refetch.
      queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-search'] });
      queryClient.invalidateQueries({ queryKey: ['saving-contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contract-notes', contractId] });
      setResult(data);
      setView('done');
    },
    onError: (err) => setError(describeApiError(err, t)),
  });

  const sameAsCurrent = newOwnerId != null && Number(newOwnerId) === currentOwnerId;
  const canSubmit =
    !!newOwnerId &&
    !sameAsCurrent &&
    pin.length === 6 &&
    !mutation.isPending;

  const newOwnerName = eligible.find(u => String(u.user_id) === newOwnerId)?.display_name ?? '';

  // Dirty = a real pick change or a typed PIN. The seeded current-owner value
  // is untouched state. On the done step nothing is at risk.
  const isDirty = view === 'form' && (pin !== '' || !sameAsCurrent);
  const handleClose = () => {
    if (mutation.isPending) return;
    if (isDirty) { setConfirmClose(true); return; }
    onClose();
  };

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {view === 'done'
            ? t('contract.commissionOwner_changedTitle', { defaultValue: 'Commission owner changed' })
            : t('contract.commissionOwner_changeTitle')}
        </h2>
        <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
      </div>

      {view === 'form' && (
      <>
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
        <Button onClick={handleClose}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={() => { setError(''); mutation.mutate(); }} disabled={!canSubmit}>
          {mutation.isPending ? t('common.loading') : t('contract.commissionOwner_save')}
        </Button>
      </div>
      </>
      )}

      {view === 'done' && result && (
        <ActionDoneView
          headline={t('contract.commissionOwner_changedTitle', { defaultValue: 'Commission owner changed' })}
          contractCode={contractCode ?? `#${contractId}`}
          detailRows={[
            { label: t('contract.commissionOwner_previous', { defaultValue: 'Previous' }), value: currentOwnerName ?? '—' },
            { label: t('contract.commissionOwner_new', { defaultValue: 'New owner' }), value: newOwnerName || `#${result.new_owner_id}`, emphasis: true },
          ]}
          extras={result.already_granted ? (
            <div className="alert alert-warning">
              <AlertTriangle size={16} />
              <span>{t('contract.commissionOwner_alreadyGrantedWarning')}</span>
            </div>
          ) : undefined}
          onClose={onClose}
        />
      )}
    </Modal>

    {/* Unsaved-changes guard — sibling, not nested, to keep the shared modal
        context in sync. */}
    <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
      <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
      <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={() => { setConfirmClose(false); onClose(); }}>{t('common.discard')}</Button>
      </div>
    </Modal>
    </>
  );
}
