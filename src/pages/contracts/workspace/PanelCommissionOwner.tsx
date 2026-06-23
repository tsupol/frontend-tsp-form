import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Select, useSnackbarContext } from 'tsp-form';
import { XCircle, Loader2, CheckCircle, User } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useWorkspace } from './WorkspaceContext';
import { BranchPinInput } from '../../../components/BranchPinInput';

interface BranchStaffUser {
  id: number;
  username: string;
  branch_id: number | null;
}

// Commission owner reassignment, lifted out of Review & Pay into its own step.
// Pre-activation only: fn_contract_change_draft_owner is PIN-protected and the
// contract must still be a DRAFT/SAVING (no bill yet) — isReadOnly guards that.
export function PanelCommissionOwner({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { data, contract, invalidateContract, setPanelDirty, isReadOnly } = useWorkspace();
  const { addSnackbar } = useSnackbarContext();

  const branchId = contract?.branch_id ?? null;
  const ownerId = contract?.commission_owner_id ?? null;
  const ownerName = contract?.commission_owner_name ?? null;

  const [ownerPick, setOwnerPick] = useState<number | null>(ownerId);
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset the picker to the server's current owner whenever it changes.
  useEffect(() => {
    setOwnerPick(ownerId);
    setPin('');
    setError('');
  }, [ownerId]);

  const { data: branchStaff } = useQuery({
    queryKey: ['branch-staff-users', branchId],
    queryFn: () => apiClient.get<BranchStaffUser[]>(
      `/v_users?is_active=is.true&branch_id=eq.${branchId}&order=username`,
    ),
    enabled: branchId != null && !isReadOnly,
    staleTime: 5 * 60 * 1000,
  });

  const ownerOptions = useMemo(() => (branchStaff ?? []).map(u => ({
    value: String(u.id),
    label: u.username,
  })), [branchStaff]);

  const pickChanged = ownerPick != null && ownerPick !== ownerId;
  const canSave = pickChanged && pin.length === 6 && !saving;

  // Dirty when the user has staged a different owner or started typing a PIN.
  useEffect(() => {
    setPanelDirty(pickChanged || pin.length > 0);
  }, [pickChanged, pin, setPanelDirty]);
  useEffect(() => () => setPanelDirty(false), [setPanelDirty]);

  const save = async () => {
    if (!data.contractId || ownerPick == null) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_contract_change_draft_owner', {
        p_contract_id: data.contractId,
        p_new_owner_id: ownerPick,
        p_pin: pin,
      });
      setPanelDirty(false);
      invalidateContract();
      setPin('');
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('workspace.commissionOwnerSaved')}</span></div>,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.message);
      } else {
        setError(String(err));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-2xl">
      <div className="flex-1 overflow-y-auto better-scroll p-4 flex flex-col gap-5">
        {/* Current owner */}
        <div>
          <label className="form-label">{t('workspace.commissionOwner')}</label>
          <div className="flex items-center gap-3 p-3 border border-line rounded-lg">
            <User size={16} className="text-subtle shrink-0" />
            <div className="flex flex-col min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
                {ownerName
                  ? ownerName
                  : ownerId != null
                    ? <span className="text-subtle font-normal">{t('workspace.commissionOwnerUnknown', { id: ownerId, defaultValue: 'user #{{id}}' })}</span>
                    : <span className="text-subtle">{t('workspace.commissionOwnerUnset')}</span>}
              </div>
              <div className="text-xs text-subtle">{t('workspace.commissionOwnerHint')}</div>
            </div>
          </div>
        </div>

        {/* Reassign — only while the contract is still pre-bill */}
        {isReadOnly ? (
          <div className="text-xs text-subtle">{t('workspace.commissionOwnerLocked')}</div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col">
              <label className="form-label text-xs">{t('workspace.commissionOwnerPicker')}</label>
              <Select
                options={ownerOptions}
                value={ownerPick != null ? String(ownerPick) : null}
                onChange={(val) => setOwnerPick(val ? Number(val) : null)}
                size="sm"
                searchable
                showChevron
              />
            </div>
            <BranchPinInput value={pin} onChange={setPin} required />
            {error && (
              <div className="alert alert-danger">
                <XCircle size={14} />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-bg px-4 py-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>
          {t('common.close')}
        </Button>
        {!isReadOnly && (
          <Button
            size="sm"
            color="primary"
            onClick={save}
            disabled={!canSave}
            startIcon={saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
          >
            {t('workspace.commissionOwnerSave')}
          </Button>
        )}
      </div>
    </div>
  );
}
